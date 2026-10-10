// 64-bit SimHash over word shingles with an 8×8-bit block index. Free of scanner types so the
// phishing hunter's campaign clustering can reuse it.
import { INVISIBLE } from "./location.ts";

// shortcut: tuned on one machine (2026-10-09, 98k plugin paragraphs): 1–2 word swaps of a
// ~40-word seed land at p90 7 bits, the nearest benign paragraph at 9. 3-word shingles and a
// 3-bit threshold missed most rewordings. Retune on the Phase 6 benchmark.
const SHINGLE = 1;
const BLOCKS = 8;
// With 8 blocks, any hash within 7 bits shares at least one identical block (pigeonhole).
export const MAX_DISTANCE = BLOCKS - 1;
const BLOCK_BITS = 64 / BLOCKS;

// NFKC folds look-alike forms, invisible characters are dropped so they can't split words,
// and anything that isn't a letter or digit (incl. Markdown syntax) becomes a word break.
export function normalize(text: string): string {
  // NFKC and invisible stripping are no-ops on ASCII, which is most text and most of the cost.
  const folded = /[^\0-\x7f]/.test(text) ? text.normalize("NFKC").replace(INVISIBLE, "") : text;
  return folded
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function fnv1a(text: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Null when the text has fewer words than one shingle.
export function simhash(text: string): bigint | null {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length < SHINGLE) return null;
  // Count set bits only (the hot loop); a bit is 1 when more than half the shingles set it.
  const ones = new Int32Array(64);
  const shingles = words.length - SHINGLE + 1;
  for (let i = 0; i < shingles; i++) {
    const shingle = SHINGLE === 1 ? (words[i] ?? "") : words.slice(i, i + SHINGLE).join(" ");
    for (const [base, seed] of [[0, 0x811c9dc5], [32, 0x2c9277b5]] as const) {
      for (let h = fnv1a(shingle, seed); h; h &= h - 1) {
        const bit = base + 31 - Math.clz32(h & -h);
        ones[bit] = (ones[bit] ?? 0) + 1;
      }
    }
  }
  let hash = 0n;
  for (let bit = 63; bit >= 0; bit--) hash = (hash << 1n) | ((ones[bit] ?? 0) * 2 > shingles ? 1n : 0n);
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  for (; x; n++) x &= x - 1n;
  return n;
}

const blockKeys = (hash: bigint) =>
  Array.from({ length: BLOCKS }, (_, i) => `${i}:${(hash >> BigInt(i * BLOCK_BITS)) & ((1n << BigInt(BLOCK_BITS)) - 1n)}`);

export type SimHashIndex<T> = Map<string, Array<{ hash: bigint; value: T }>>;

export function buildIndex<T>(items: ReadonlyArray<{ hash: bigint; value: T }>): SimHashIndex<T> {
  const index: SimHashIndex<T> = new Map();
  for (const item of items) {
    for (const key of blockKeys(item.hash)) index.set(key, [...(index.get(key) ?? []), item]);
  }
  return index;
}

// Block hits are only candidates; the full distance confirms them.
export function lookup<T>(index: SimHashIndex<T>, hash: bigint): Array<{ value: T; distance: number }> {
  const seen = new Set<{ hash: bigint; value: T }>();
  const out: Array<{ value: T; distance: number }> = [];
  for (const key of blockKeys(hash)) {
    for (const item of index.get(key) ?? []) {
      if (seen.has(item)) continue;
      seen.add(item);
      const distance = hamming(hash, item.hash);
      if (distance <= MAX_DISTANCE) out.push({ value: item.value, distance });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
