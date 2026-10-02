import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function str(value: unknown, max?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  return max !== undefined && s.length > max ? `${s.slice(0, max)}…` : s;
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

export type PathKind = "file" | "dir" | "symlink" | "missing" | "other";

// lstat-based: symlinks are reported as such and never followed.
export async function kindOf(p: string): Promise<PathKind> {
  try {
    const s = await lstat(p);
    if (s.isSymbolicLink()) return "symlink";
    if (s.isFile()) return "file";
    if (s.isDirectory()) return "dir";
    return "other";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    throw err;
  }
}

export interface JsonRead {
  value?: unknown;
  error?: string;
  missing?: boolean;
}

// Reads JSON only from a regular file, never through a symlink.
export async function readJsonFile(p: string): Promise<JsonRead> {
  try {
    const kind = await kindOf(p);
    if (kind === "missing") return { missing: true };
    if (kind !== "file") return { error: `${p}: not a regular file (${kind}); not read` };
    return { value: JSON.parse(await readFile(p, "utf8")) };
  } catch (err) {
    return { error: `${p}: ${errorMessage(err)}` };
  }
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
