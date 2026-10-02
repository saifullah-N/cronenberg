import path from "node:path";
import { docsAt } from "./components.ts";
import { hashTree, treeDigest } from "./fsWalk.ts";
import { parseHooks } from "./hooks.ts";
import { normalizeServers } from "./mcp.ts";
import { emptyGroup } from "./plugins.ts";
import type { ConfigScope, McpServer } from "./types.ts";
import { compare, isObject, kindOf, readJsonFile } from "./util.ts";

const DOC_DIRS = [
  ["skill", "skills"],
  ["agent", "agents"],
  ["command", "commands"],
] as const;

// Skills/agents/commands under a `.claude` directory, plus file hashes for the snapshot.
async function collectClaudeDir(scope: ConfigScope, claudeDir: string): Promise<void> {
  for (const [kind, dir] of DOC_DIRS) {
    const docs = await docsAt(kind, path.join(claudeDir, dir), claudeDir, scope.errors);
    if (kind === "skill") scope.skills = docs;
    else if (kind === "agent") scope.agents = docs;
    else scope.commands = docs;

    const abs = path.join(claudeDir, dir);
    if ((await kindOf(abs)) !== "dir") continue;
    const tree = await hashTree(abs);
    scope.files.push(...tree.records.map((r) => ({ ...r, path: `${dir}/${r.path}` })));
    scope.errors.push(...tree.errors.map((e) => `${dir}/${e}`));
  }
  scope.digest = treeDigest(scope.files);
}

function serversFrom(value: unknown, source: string): McpServer[] {
  return isObject(value) ? normalizeServers(value, source) : [];
}

export async function loadUserConfig(root: string, settings: Record<string, unknown>): Promise<ConfigScope> {
  const claudeDir = path.join(root, ".claude");
  const scope: ConfigScope = { ...emptyGroup(), ref: "config:user", name: "user-config", location: claudeDir };
  await collectClaudeDir(scope, claudeDir);
  if (settings.hooks !== undefined) scope.hooks.push(...parseHooks(settings.hooks, "settings.json", scope.errors));

  // ~/.claude.json also holds account and session data. Only `mcpServers` is read.
  const claudeJson = await readJsonFile(path.join(root, ".claude.json"));
  if (claudeJson.error) scope.errors.push(claudeJson.error);
  if (isObject(claudeJson.value)) {
    scope.mcpServers.push(...serversFrom(claudeJson.value.mcpServers, ".claude.json"));
    const projects = claudeJson.value.projects;
    if (isObject(projects)) {
      for (const project of Object.keys(projects).sort(compare)) {
        const entry = projects[project];
        if (isObject(entry)) scope.mcpServers.push(...serversFrom(entry.mcpServers, `.claude.json projects[${project}]`));
      }
    }
  }
  return scope;
}

export async function loadProjectConfig(project: string): Promise<ConfigScope> {
  const claudeDir = path.join(project, ".claude");
  const scope: ConfigScope = { ...emptyGroup(), ref: "config:project", name: "project-config", location: project };
  await collectClaudeDir(scope, claudeDir);

  for (const file of ["settings.json", "settings.local.json"]) {
    const read = await readJsonFile(path.join(claudeDir, file));
    if (read.error) scope.errors.push(read.error);
    else if (isObject(read.value) && read.value.hooks !== undefined) {
      scope.hooks.push(...parseHooks(read.value.hooks, `.claude/${file}`, scope.errors));
    }
  }

  const mcp = await readJsonFile(path.join(project, ".mcp.json"));
  if (mcp.error) scope.errors.push(mcp.error);
  else if (!mcp.missing) scope.mcpServers.push(...normalizeServers(mcp.value, ".mcp.json"));
  return scope;
}
