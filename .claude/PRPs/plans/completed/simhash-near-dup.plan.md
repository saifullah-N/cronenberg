# Plan: SimHash Near-Duplicate Matching (Scanner Phase 3)

## Summary
Add a `known-payload` rule: hash each paragraph of every scanned text file with a 64-bit SimHash and look it up in a block index built from a small seeded payload corpus, so reworded copies of known malicious instructions are flagged with file:line evidence.

## User Story
As a plugin user, I want reworded copies of known attack instructions flagged, so that a payload with a few words changed doesn't slip past exact-match rules.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/prds/agent-supply-chain-scanner.prd.md`
- **PRD Phase**: 3 — SimHash near-dup matching
- **Estimated Files**: 2 new, 6 updated

## Scope pushback (ultra / YAGNI)
"Implement the missing items" covered 11 pending phases across two PRDs. Most need deploys, labeled data, LLM quota or human disclosure (AGENTS.md rules 5–6). Phase 3 is the next eligible phase that is fully local, so only it is built.

## Patterns to Mirror
- Shared, scanner-type-free module like `scanner/src/detect/unicode.ts` (header comment says the phishing hunter can reuse it).
- Matchers return `{ rule, severity, offset, length, message }` like `scanner/src/detect/patterns.ts`; `detectFile` in `scanner/src/detect/index.ts` handles location, evidence, caps and the documentation downgrade.
- Every `RuleId` needs a `RULES` entry (`scanner/src/detect/rules.ts`) for SARIF.
- Tests in `scanner/test/detectors.test.ts`; invisible characters only via `String.fromCodePoint` (`cp`).

## Files to Change
| File | Action | Why |
|---|---|---|
| `scanner/src/detect/simhash.ts` | CREATE | normalize, SimHash, Hamming, block index, lookup |
| `scanner/src/detect/payloads.ts` | CREATE | seeded corpus with provenance + paragraph matcher |
| `scanner/src/detect/location.ts` | UPDATE | export existing `INVISIBLE` regex for reuse |
| `scanner/src/types.ts`, `scanner/src/detect/rules.ts` | UPDATE | `known-payload` rule id + SARIF text |
| `scanner/src/detect/index.ts` | UPDATE | call `knownPayloads` in `detectFile` |
| `scanner/test/detectors.test.ts` | UPDATE | positive + negative cases |

## NOT Building
- Sliding windows inside long paragraphs (paragraph granularity only; `shortcut:` comment).
- A corpus file format, loader or CLI flag: 3 in-code seeds are enough until Phase 6.
- Moving the module to a shared package: extract when the phishing hunter's Phase 7 needs it.
- Any held-out variants in the repo (Phase 6 keeps them local).

## Tasks
1. `simhash.ts`: NFKC + strip `INVISIBLE` + lowercase + non-alphanumerics to spaces; FNV-1a ×2 seeds → 64 bits per shingle; majority vote; `hamming`; block index with pigeonhole candidates confirmed by full distance.
2. `payloads.ts`: 3 self-authored seeds (`id`, `provenance`, `text`); split on blank lines; skip paragraphs outside 15–120 words; best match → `known-payload`, severity high.
3. Wire rule id, `RULES` entry, `detectFile`.
4. Tests: normalization, index confirm/reject, each seed reworded (word swap + Markdown + zero-width split), benign and short negatives, line/column + documentation downgrade.
5. Validate on a real scan: false positives and runtime.

## Validation
```bash
npm run typecheck && npm test && npm run scanner:test && npm run scan
```

## Risks
| Risk | Mitigation |
|---|---|
| PRD's 3-bit / 4×16 parameters miss rewordings on short texts | Measure; tune (see report) |
| False positives on prose with similar vocabulary | Measure nearest benign distance on the real install |
| Hashing cost on thousands of files | Word-count bounds, ASCII fast path; measure |
