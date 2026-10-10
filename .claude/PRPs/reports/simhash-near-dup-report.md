# Implementation Report: SimHash Near-Duplicate Matching (Scanner Phase 3)

## Summary
New `known-payload` rule (high; lowered to medium in docs/tests like other rules). `scanner/src/detect/simhash.ts` holds normalization, 64-bit SimHash, Hamming distance and a block index, with no scanner types, so phishing Phase 7 can reuse it. `scanner/src/detect/payloads.ts` holds 3 self-authored seeds with provenance and matches each 15–120-word paragraph against them.

## Deviation from the PRD: parameters
The PRD specified word shingles, 4×16-bit blocks and Hamming ≤ 3. Measured on the owner's machine (2026-10-09), against 98,314 paragraphs (≥ 15 words) from 7,169 `.md/.txt/.json` files under `~/.claude/plugins`:

| Shingles | 1–2 word swaps of a seed: p50 / p90 / p99 / max | Nearest benign paragraph to any seed |
|---|---|---|
| 1 word | 3 / 7 / 10 / 12 bits | 9 bits (one paragraph; next 11) |
| 3 words | 8 / 12 / 16 / 19 bits | 13 bits |

With ≤ 3 bits, most single-word rewordings of a ~40-word payload were missed. The ≤ 3 rule comes from web-page dedup, where documents are much longer. **Chosen: single-word shingles, Hamming ≤ 7, 8×8-bit blocks** (pigeonhole still guarantees no missed candidates). That catches about 90% of 1–2 word swaps, and the closest benign paragraph stays 2 bits outside the threshold. The margin is thin and measured on one machine; Phase 6 must retune on the held-out benchmark (`shortcut:` comment in `simhash.ts`).

## Real scan
- `known-payload` findings: **0** across 4,692 text files (no false positives).
- Runtime: 1.6 s → 2.6 s wall (~0.2 ms/file). Index lookups don't register in the CPU profile; the cost is normalization (NFKC on non-ASCII paragraphs) and hashing. Mitigations applied: skip paragraphs over 120 words (they can't be within 7 bits of a ~40-word seed), an ASCII fast path, set-bit vote counting.

## Validation
| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (Worker) | 26/26 |
| `npm run scanner:test` | 114/114 (8 new) |
| `npm run scan` | pass, 0 new findings |

## Known limits
- One hash per blank-line paragraph: a payload merged into a long paragraph is missed.
- Unigram SimHash ignores word order, so a paragraph with the same vocabulary in a different order matches as well. That's acceptable for instructions, but expect it to show up in Phase 6.
- 3 seeds only; the corpus grows with Phase 6.
