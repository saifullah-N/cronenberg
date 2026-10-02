import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { FileRecord, SymlinkRecord, TreeRecord } from "./types.ts";
import { compare, errorMessage, mapLimit, sha256Hex } from "./util.ts";

const HASH_CONCURRENCY = 32;

export function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(abs)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function list(
  root: string,
  rel: string,
  files: string[],
  links: string[],
  errors: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch (err) {
    errors.push(`${rel || "."}: ${errorMessage(err)}`);
    return;
  }
  entries.sort((a, b) => compare(a.name, b.name));
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    // readdir reports symlinks as symlinks; we never follow them.
    if (entry.isSymbolicLink()) links.push(child);
    else if (entry.isDirectory()) await list(root, child, files, links, errors);
    else if (entry.isFile()) files.push(child);
  }
}

// Hashes every regular file under `root`. Symlinks are recorded, never followed.
export async function hashTree(root: string): Promise<{ records: TreeRecord[]; errors: string[] }> {
  const files: string[] = [];
  const links: string[] = [];
  const errors: string[] = [];
  await list(root, "", files, links, errors);

  const hashed = await mapLimit(files, HASH_CONCURRENCY, async (rel): Promise<FileRecord | null> => {
    const abs = path.join(root, rel);
    try {
      const stat = await lstat(abs);
      if (!stat.isFile()) return null;
      return { path: rel, size: stat.size, sha256: await hashFile(abs) };
    } catch (err) {
      errors.push(`${rel}: ${errorMessage(err)}`);
      return null;
    }
  });

  const records: TreeRecord[] = [
    ...hashed.filter((r): r is FileRecord => r !== null),
    ...links.map((p): SymlinkRecord => ({ path: p, symlink: true })),
  ];
  records.sort((a, b) => compare(a.path, b.path));
  return { records, errors };
}

export function treeDigest(records: readonly TreeRecord[]): string {
  return sha256Hex(
    records.map((r) => ("symlink" in r ? `${r.path}\0symlink` : `${r.path}\0${r.sha256}`)).join("\n"),
  );
}
