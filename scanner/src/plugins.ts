import path from "node:path";
import { docsAt } from "./components.ts";
import { hashTree, treeDigest } from "./fsWalk.ts";
import { parseHooks } from "./hooks.ts";
import { normalizeServers } from "./mcp.ts";
import { parseLockfile } from "./npmDeps.ts";
import type { ComponentGroup, DocComponent, DocKind, HookEntry, McpServer, PluginInfo } from "./types.ts";
import {
  compare, errorMessage, isInside, isObject, kindOf, readJsonFile, str, toPosix, type JsonObject,
} from "./util.ts";

const HTTP_URL = /^https?:\/\/\S+$/;

export function emptyGroup(): ComponentGroup {
  return { skills: [], agents: [], commands: [], hooks: [], mcpServers: [], files: [], errors: [] };
}

function declaredPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

// Manifest paths are resolved against the plugin root and must stay inside it.
function resolveInside(root: string, p: string, what: string, errors: string[]): string | undefined {
  const abs = path.resolve(root, p);
  if (!isInside(root, abs)) {
    errors.push(`${what}: "${p}" points outside the plugin; skipped`);
    return undefined;
  }
  return abs;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Declared paths supplement the conventional directory rather than replacing it,
// so the inventory is a superset of what the agent could load.
async function collectDocs(
  kind: DocKind,
  declared: unknown,
  conventional: string,
  root: string,
  errors: string[],
): Promise<DocComponent[]> {
  const out: DocComponent[] = [];
  for (const p of [conventional, ...declaredPaths(declared)]) {
    const abs = resolveInside(root, p, `${kind}s`, errors);
    if (abs) out.push(...(await docsAt(kind, abs, root, errors)));
  }
  return uniqueBy(out, (d) => d.path);
}

async function collectHooks(declared: unknown, root: string, errors: string[]): Promise<HookEntry[]> {
  const out: HookEntry[] = [];
  const files = new Set([path.join(root, "hooks", "hooks.json")]);
  if (isObject(declared)) out.push(...parseHooks(declared, "plugin.json", errors));
  for (const p of declaredPaths(declared)) {
    const abs = resolveInside(root, p, "hooks", errors);
    if (abs) files.add(abs);
  }
  for (const abs of files) {
    const read = await readJsonFile(abs);
    if (read.error) errors.push(read.error);
    else if (!read.missing) out.push(...parseHooks(read.value, toPosix(path.relative(root, abs)), errors));
  }
  return out;
}

async function collectMcp(declared: unknown, root: string, errors: string[]): Promise<McpServer[]> {
  const out: McpServer[] = [];
  const files = new Set([path.join(root, ".mcp.json")]);
  if (isObject(declared)) out.push(...normalizeServers(declared, "plugin.json"));
  for (const p of declaredPaths(declared)) {
    const abs = resolveInside(root, p, "mcpServers", errors);
    if (abs) files.add(abs);
  }
  for (const abs of files) {
    const read = await readJsonFile(abs);
    if (read.error) errors.push(read.error);
    else if (!read.missing) out.push(...normalizeServers(read.value, toPosix(path.relative(root, abs))));
  }
  return uniqueBy(out, (s) => `${s.source}\0${s.name}`);
}

function httpUrl(value: unknown): string | undefined {
  const url = isObject(value) ? str(value.url) : str(value);
  return url && HTTP_URL.test(url) ? url : undefined;
}

function pickManifest(m: JsonObject): PluginInfo["manifest"] {
  const manifest: PluginInfo["manifest"] = {};
  const description = str(m.description, 300);
  const repository = httpUrl(m.repository);
  const homepage = httpUrl(m.homepage);
  const license = str(m.license);
  const author = isObject(m.author) ? str(m.author.name) : str(m.author);
  if (description) manifest.description = description;
  if (repository) manifest.repository = repository;
  if (homepage) manifest.homepage = homepage;
  if (license) manifest.license = license;
  if (author) manifest.author = author;
  return manifest;
}

async function scanPluginDir(info: PluginInfo, root: string): Promise<void> {
  info.absRoot = root;
  const errors = info.errors;
  const manifestRead = await readJsonFile(path.join(root, ".claude-plugin", "plugin.json"));
  if (manifestRead.error) errors.push(manifestRead.error);
  const m = isObject(manifestRead.value) ? manifestRead.value : {};
  info.manifest = pickManifest(m);
  if (!info.version) {
    const version = str(m.version);
    if (version) info.version = version;
  }

  info.skills = await collectDocs("skill", m.skills, "skills", root, errors);
  info.agents = await collectDocs("agent", m.agents, "agents", root, errors);
  info.commands = await collectDocs("command", m.commands, "commands", root, errors);
  info.hooks = await collectHooks(m.hooks, root, errors);
  info.mcpServers = await collectMcp(m.mcpServers, root, errors);

  const lock = await readJsonFile(path.join(root, "package-lock.json"));
  if (lock.error) {
    errors.push(lock.error);
  } else if (!lock.missing) {
    const parsed = parseLockfile(lock.value);
    info.npm = parsed.packages;
    if (parsed.error) errors.push(`package-lock.json: ${parsed.error}`);
  } else {
    info.nodeModulesUnlocked = (await kindOf(path.join(root, "node_modules"))) === "dir";
  }

  const tree = await hashTree(root);
  info.files = tree.records;
  info.digest = treeDigest(tree.records);
  errors.push(...tree.errors);
}

async function scanPlugin(id: string, entry: JsonObject, pluginsDir: string, enabled: boolean): Promise<PluginInfo> {
  const at = id.lastIndexOf("@");
  const installPath = typeof entry.installPath === "string" ? path.resolve(pluginsDir, entry.installPath) : "";
  const info: PluginInfo = {
    ...emptyGroup(),
    ref: "",
    id,
    name: at > 0 ? id.slice(0, at) : id,
    marketplace: at > 0 ? id.slice(at + 1) : "",
    scope: str(entry.scope) ?? "unknown",
    installPath,
    enabled,
    missing: false,
    outsidePluginsDir: installPath !== "" && !isInside(pluginsDir, installPath),
    manifest: {},
    npm: [],
    nodeModulesUnlocked: false,
  };
  const version = str(entry.version);
  if (version) info.version = version;
  const sha = str(entry.gitCommitSha);
  if (sha) info.gitCommitSha = sha;

  try {
    const kind = installPath ? await kindOf(installPath) : "missing";
    if (kind === "missing") info.missing = true;
    else if (kind !== "dir") info.errors.push(`install path is a ${kind}, not a directory; not scanned`);
    else await scanPluginDir(info, installPath);
  } catch (err) {
    info.errors.push(errorMessage(err));
  }
  return info;
}

export async function loadPlugins(
  root: string,
  enabled: Record<string, unknown>,
  errors: string[],
): Promise<PluginInfo[]> {
  const pluginsDir = path.join(root, ".claude", "plugins");
  const installed = await readJsonFile(path.join(pluginsDir, "installed_plugins.json"));
  if (installed.missing) {
    errors.push("installed_plugins.json not found; no plugins scanned");
    return [];
  }
  if (installed.error) {
    errors.push(installed.error);
    return [];
  }

  const map = isObject(installed.value) && isObject(installed.value.plugins) ? installed.value.plugins : {};
  const plugins: PluginInfo[] = [];
  for (const id of Object.keys(map).sort(compare)) {
    const entries = map[id];
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (isObject(entry)) plugins.push(await scanPlugin(id, entry, pluginsDir, enabled[id] === true));
    }
  }
  return plugins;
}
