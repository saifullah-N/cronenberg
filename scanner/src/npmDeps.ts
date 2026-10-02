import type { NpmPackage } from "./types.ts";
import { compare, isObject } from "./util.ts";

const NODE_MODULES = "node_modules/";

// "sha512-<base64>" (space-separated list allowed) → hex digest.
export function sriToHex(integrity: unknown, alg = "sha512"): string | undefined {
  if (typeof integrity !== "string") return undefined;
  for (const part of integrity.trim().split(/\s+/)) {
    if (!part.startsWith(`${alg}-`)) continue;
    const hex = Buffer.from(part.slice(alg.length + 1), "base64").toString("hex");
    return hex.length === 128 ? hex : undefined;
  }
  return undefined;
}

export function npmPurl(name: string, version: string): string {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

// Reads lockfileVersion 2/3 `packages`. Each package is listed once.
export function parseLockfile(value: unknown): { packages: NpmPackage[]; error?: string } {
  if (!isObject(value) || !isObject(value.packages)) {
    return { packages: [], error: "unsupported package-lock.json (no `packages` map; lockfileVersion 2+ needed)" };
  }
  const seen = new Map<string, NpmPackage>();
  for (const [key, raw] of Object.entries(value.packages)) {
    if (!key || !isObject(raw) || raw.link === true) continue;
    const at = key.lastIndexOf(NODE_MODULES);
    const name = typeof raw.name === "string" ? raw.name : at >= 0 ? key.slice(at + NODE_MODULES.length) : undefined;
    const version = typeof raw.version === "string" ? raw.version : undefined;
    if (!name || !version) continue;
    const purl = npmPurl(name, version);
    if (seen.has(purl)) continue;
    const pkg: NpmPackage = { name, version, purl, dev: raw.dev === true };
    const sha512 = sriToHex(raw.integrity);
    if (sha512) pkg.sha512 = sha512;
    seen.set(purl, pkg);
  }
  return { packages: [...seen.values()].sort((a, b) => compare(a.purl, b.purl)) };
}
