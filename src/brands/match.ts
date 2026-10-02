import type { Brand } from "./repository";

export interface MatchInput {
  url: string;
  registrableDomain: string | null;
  sourceTarget?: string;
}

// Naive Phase 1 matcher: keyword substring or feed-provided target name.
// Phase 2 replaces this with confusable-aware scoring.
export function matchBrand(brands: readonly Brand[], input: MatchInput): Brand | null {
  const url = input.url.toLowerCase();
  const target = input.sourceTarget?.trim().toLowerCase();

  for (const brand of brands) {
    if (input.registrableDomain && brand.legitDomains.includes(input.registrableDomain)) continue;
    if (brand.keywords.some((k) => url.includes(k))) return brand;
    if (target && target === brand.name.toLowerCase()) return brand;
  }
  return null;
}
