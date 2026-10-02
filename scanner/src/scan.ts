import { randomUUID as nodeRandomUUID } from "node:crypto";
import path from "node:path";
import { buildBom } from "./cyclonedx.ts";
import { loadPlugins } from "./plugins.ts";
import type { ComponentGroup, ConfigScope, PluginInfo, ScanSummary, Snapshot } from "./types.ts";
import { loadProjectConfig, loadUserConfig } from "./userConfig.ts";
import { compare, isObject, readJsonFile } from "./util.ts";

export interface ScanOptions {
  root: string; // stands in for $HOME
  project?: string;
  now?: () => Date;
  randomUUID?: () => string;
}

export interface ScanResult {
  bom: Record<string, unknown>;
  snapshot: Snapshot;
  summary: ScanSummary;
}

const WRITE_OR_SHELL_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replaces the scanned root with "~" so outputs don't carry local usernames or paths.
function tildeFor(root: string): (s: string) => string {
  if (root === path.parse(root).root) return (s) => s;
  const re = new RegExp(`${escapeRegExp(root)}(?=$|[\\\\/\\s"'\\]])`, "g");
  return (s) => s.replace(re, "~");
}

function tildeGroup(g: ComponentGroup, tilde: (s: string) => string): void {
  g.errors = g.errors.map(tilde);
  for (const h of g.hooks) h.source = tilde(h.source);
  for (const s of g.mcpServers) {
    s.source = tilde(s.source);
    if (s.command) s.command = tilde(s.command);
    if (s.args) s.args = s.args.map(tilde);
  }
}

function assignRefs(plugins: PluginInfo[]): void {
  const perId = new Map<string, number>();
  for (const p of plugins) perId.set(p.id, (perId.get(p.id) ?? 0) + 1);
  for (const p of plugins) p.ref = (perId.get(p.id) ?? 0) > 1 ? `plugin:${p.id}#${p.scope}` : `plugin:${p.id}`;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1] || compare(a[0], b[0])));
}

function summarize(plugins: readonly PluginInfo[], scopes: readonly ConfigScope[], errors: string[]): ScanSummary {
  const groups = [
    ...plugins.map((p) => ({ owner: p.id, group: p as ComponentGroup })),
    ...scopes.map((s) => ({ owner: s.name, group: s as ComponentGroup })),
  ];
  const hooksByEvent: Record<string, number> = {};
  const hookInterpreters: Record<string, number> = {};
  for (const { group } of groups) {
    for (const h of group.hooks) {
      increment(hooksByEvent, h.event);
      increment(hookInterpreters, h.interpreter);
    }
  }
  const agents = groups.flatMap(({ group }) => group.agents);
  const files = groups.flatMap(({ group }) => group.files);
  const symlinks = files.filter((f) => "symlink" in f).length;
  const sum = (pick: (g: ComponentGroup) => number) => groups.reduce((n, { group }) => n + pick(group), 0);

  return {
    plugins: plugins.length,
    skills: sum((g) => g.skills.length),
    agents: agents.length,
    commands: sum((g) => g.commands.length),
    hooks: sum((g) => g.hooks.length),
    hooksByEvent: sortRecord(hooksByEvent),
    hookInterpreters: sortRecord(hookInterpreters),
    mcpServers: groups.flatMap(({ owner, group }) =>
      group.mcpServers.map((s) => ({
        owner,
        name: s.name,
        transport: s.transport,
        ...(s.command ? { command: s.command } : {}),
        ...(s.urlHost ? { host: s.urlHost } : {}),
        ...(s.pinned !== undefined ? { pinned: s.pinned } : {}),
      })),
    ),
    agentsWithWriteOrShellTools: agents.filter((a) =>
      a.tools?.some((t) => WRITE_OR_SHELL_TOOLS.has(t.split("(")[0]?.trim() ?? "")),
    ).length,
    agentsInheritingAllTools: agents.filter((a) => !a.tools).length,
    npmPackages: plugins.reduce((n, p) => n + p.npm.length, 0),
    files: files.length - symlinks,
    symlinks,
    missingPlugins: plugins.filter((p) => p.missing).map((p) => p.id),
    errors,
  };
}

// Static inventory only: reads files, never executes plugin code or contacts the network.
export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const root = path.resolve(opts.root);
  const now = (opts.now ?? (() => new Date()))();
  const uuid = (opts.randomUUID ?? nodeRandomUUID)();
  const tilde = tildeFor(root);
  const errors: string[] = [];

  const settingsRead = await readJsonFile(path.join(root, ".claude", "settings.json"));
  if (settingsRead.error) errors.push(settingsRead.error);
  const settings = isObject(settingsRead.value) ? settingsRead.value : {};
  const enabled = isObject(settings.enabledPlugins) ? settings.enabledPlugins : {};

  const plugins = await loadPlugins(root, enabled, errors);
  assignRefs(plugins);
  const scopes = [await loadUserConfig(root, settings)];
  if (opts.project) scopes.push(await loadProjectConfig(path.resolve(opts.project)));

  for (const p of plugins) {
    p.installPath = tilde(p.installPath);
    tildeGroup(p, tilde);
  }
  for (const s of scopes) {
    s.location = tilde(s.location);
    tildeGroup(s, tilde);
  }

  const allErrors = [
    ...errors.map(tilde),
    ...plugins.flatMap((p) => p.errors.map((e) => `${p.ref}: ${e}`)),
    ...scopes.flatMap((s) => s.errors.map((e) => `${s.ref}: ${e}`)),
  ];

  const generatedAt = now.toISOString();
  const snapshot: Snapshot = { generatedAt, root: "~", components: {} };
  for (const c of [...plugins, ...scopes]) {
    snapshot.components[c.ref] = { ...(c.digest ? { digest: c.digest } : {}), files: c.files };
  }

  return {
    bom: buildBom({ plugins, scopes, timestamp: generatedAt, serialNumber: `urn:uuid:${uuid}` }),
    snapshot,
    summary: summarize(plugins, scopes, allErrors),
  };
}
