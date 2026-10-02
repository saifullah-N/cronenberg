import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { ComponentGroup } from "../types.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const SNIFF_BYTES = 8192;
const DOC_PATH = /(^|\/)docs?\//i;
const DOC_FILE = /(^|\/)(README|CHANGELOG|SECURITY|CONTRIBUTING|CODE_OF_CONDUCT)[^/]*$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|fixtures?)\//i;
const TEST_FILE = /\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/i;

export type FileKind = "markdown" | "script" | "json" | "yaml" | "other";

export interface DetectTarget extends ComponentGroup {
  ref: string;
}

export interface Candidate {
  component: string;
  absRoot: string;
  path: string;
  agentLoaded: boolean;
}

export interface FileContext {
  component: string;
  path: string;
  text: string;
  kind: FileKind;
  context?: "documentation" | "test"; // non-runtime file; findings are lowered one level
}

export interface SkipCounts {
  binary: number;
  large: number;
  deps: number;
}

export function fileKind(file: string): FileKind {
  const ext = path.posix.extname(file).toLowerCase();
  if (ext === ".md" || ext === ".mdx") return "markdown";
  if ([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".py", ".sh", ".bash", ".zsh", ".ps1", ".rb", ".pl"].includes(ext)) {
    return "script";
  }
  if (ext === ".json" || ext === ".jsonc") return "json";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  return "other";
}

export function isDocPath(file: string): boolean {
  return DOC_PATH.test(file) || DOC_FILE.test(file) || /guide/i.test(path.posix.basename(file));
}

export function isTestPath(file: string): boolean {
  return TEST_PATH.test(file) || TEST_FILE.test(file);
}

// Files the agent loads are always runtime context, whatever their path looks like.
export function contextOf(file: string, agentLoaded: boolean): FileContext["context"] {
  if (agentLoaded) return undefined;
  if (isTestPath(file)) return "test";
  if (isDocPath(file)) return "documentation";
  return undefined;
}

function inDeps(file: string): boolean {
  return file.startsWith("node_modules/") || file.includes("/node_modules/");
}

// Files the agent actually loads are never treated as documentation.
function agentLoadedPaths(target: DetectTarget): Set<string> {
  const loaded = new Set<string>([".mcp.json", ".claude-plugin/plugin.json", "settings.json"]);
  for (const doc of [...target.skills, ...target.agents, ...target.commands]) loaded.add(doc.path);
  for (const hook of target.hooks) loaded.add(hook.source);
  return loaded;
}

export function selectFiles(target: DetectTarget, includeDeps: boolean, skipped: SkipCounts): Candidate[] {
  if (!target.absRoot) return [];
  const loaded = agentLoadedPaths(target);
  const out: Candidate[] = [];
  for (const record of target.files) {
    if ("symlink" in record) continue;
    if (!includeDeps && inDeps(record.path)) {
      skipped.deps++;
      continue;
    }
    out.push({ component: target.ref, absRoot: target.absRoot, path: record.path, agentLoaded: loaded.has(record.path) });
  }
  return out;
}

// Re-checks with lstat: a file swapped for a symlink after inventory is skipped, never followed.
export async function readTextFile(c: Candidate): Promise<{ ctx?: FileContext; skip?: keyof SkipCounts | "gone" }> {
  const abs = path.join(c.absRoot, c.path);
  const stat = await lstat(abs);
  if (!stat.isFile()) return { skip: "gone" };
  if (stat.size > MAX_BYTES) return { skip: "large" };
  const buf = await readFile(abs);
  if (buf.subarray(0, SNIFF_BYTES).includes(0)) return { skip: "binary" };
  const context = contextOf(c.path, c.agentLoaded);
  return {
    ctx: {
      component: c.component,
      path: c.path,
      text: buf.toString("utf8"),
      kind: fileKind(c.path),
      ...(context ? { context } : {}),
    },
  };
}
