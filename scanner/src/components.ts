import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { DocComponent, DocKind } from "./types.ts";
import { compare, errorMessage, isObject, kindOf, sha256Hex, str, toPosix } from "./util.ts";

const MAX_DESCRIPTION = 300;
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function readFrontmatter(text: string): { data: Record<string, unknown>; error?: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) return { data: {} };
  try {
    const parsed: unknown = parseYaml(match[1] ?? "");
    return { data: isObject(parsed) ? parsed : {} };
  } catch (err) {
    return { data: {}, error: errorMessage(err) };
  }
}

export function normalizeTools(value: unknown): string[] | undefined {
  const list =
    typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.map(String) : undefined;
  return list?.map((t) => t.trim()).filter(Boolean);
}

async function readDoc(kind: DocKind, abs: string, base: string, fallbackName: string): Promise<DocComponent> {
  const buf = await readFile(abs);
  const { data, error } = readFrontmatter(buf.toString("utf8"));
  const doc: DocComponent = {
    kind,
    name: str(data.name) ?? fallbackName,
    path: toPosix(path.relative(base, abs)),
    sha256: sha256Hex(buf),
  };
  const description = str(data.description, MAX_DESCRIPTION);
  if (description) doc.description = description;
  if (kind === "agent") {
    const model = str(data.model);
    if (model) doc.model = model;
    const tools = normalizeTools(data.tools);
    if (tools) doc.tools = tools;
  }
  if (error) doc.parseError = error;
  return doc;
}

// Collects skills (`<dir>/<name>/SKILL.md`), agents or commands (`<dir>/*.md`).
// `target` may also point at a single skill dir or a single .md file.
// Symlinked files and directories are skipped. Paths are relative to `base`.
export async function docsAt(
  kind: DocKind,
  target: string,
  base: string,
  errors: string[],
): Promise<DocComponent[]> {
  const rel = (p: string) => toPosix(path.relative(base, p)) || ".";
  try {
    const targetKind = await kindOf(target);
    if (targetKind === "file") {
      return target.endsWith(".md") ? [await readDoc(kind, target, base, path.basename(target, ".md"))] : [];
    }
    if (targetKind !== "dir") return [];

    if (kind === "skill" && (await kindOf(path.join(target, "SKILL.md"))) === "file") {
      return [await readDoc(kind, path.join(target, "SKILL.md"), base, path.basename(target))];
    }

    const entries = await readdir(target, { withFileTypes: true });
    entries.sort((a, b) => compare(a.name, b.name));
    const out: DocComponent[] = [];
    for (const entry of entries) {
      const abs = path.join(target, entry.name);
      try {
        if (kind === "skill") {
          if (!entry.isDirectory()) continue;
          const skillFile = path.join(abs, "SKILL.md");
          if ((await kindOf(skillFile)) === "file") out.push(await readDoc(kind, skillFile, base, entry.name));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          out.push(await readDoc(kind, abs, base, entry.name.slice(0, -3)));
        }
      } catch (err) {
        errors.push(`${rel(abs)}: ${errorMessage(err)}`);
      }
    }
    return out;
  } catch (err) {
    errors.push(`${rel(target)}: ${errorMessage(err)}`);
    return [];
  }
}
