# Implementation Report: Foundation & Ground Truth

## Summary
Scaffolded the `cronenberg` Worker (TypeScript, Wrangler 4.145, D1, Vitest 4.1 in workerd) and built the Phase 1 ground-truth pipeline: a 6-hourly cron that ingests OpenPhish (and PhishTank when `PHISHTANK_APP_KEY` is set) into D1, normalizes and dedupes URLs, extracts registrable domains, tags brands, and records every run in `ingest_runs`. Added CSV export/import scripts for human labeling. Everything is verified locally, including a live OpenPhish ingest. **Remote steps (D1 create, migrate, seed, deploy) have not been run** and are awaiting confirmation of the Workers Paid plan.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | 8/10 | Single pass; one type fix in a test |
| Files Changed | ~22 | 29 authored files (~1,045 lines) + generated `worker-configuration.d.ts`, lockfile |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Scaffold project | Complete | TypeScript pinned to ~5.9 (see deviations); `workerd`/`esbuild` install scripts approved in `package.json` `allowScripts` |
| 2 | Wrangler config + D1 | Complete (local) | Placeholder `database_id`; `wrangler d1 create` pending |
| 3 | Schema migration | Complete | Applied locally; 4 tables |
| 4 | Brand seed | Complete | Example brand only; real brands still an open question |
| 5 | Shared libs | Complete | |
| 6 | Brand repository + matcher | Complete | |
| 7 | Feed fetchers | Complete | |
| 8 | Repository + orchestration | Complete | `scheduled` awaits instead of `waitUntil` (see deviations) |
| 9 | Tests | Complete | 24 tests, 4 files |
| 10 | Labeling loop | Complete | Added shared `scripts/d1.mjs` helper |
| 11 | Deploy + README | Partial | README done; deploy pending user confirmation |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `tsc` for src and test; no linter configured (none in plan) |
| Unit Tests | Pass | 24/24 |
| Build | Pass | `wrangler deploy --dry-run`: 173.96 KiB / 52.11 KiB gzip |
| Integration | Pass | `wrangler dev --test-scheduled`: `/health` 200, other paths 404, scheduled run ingested 300 live OpenPhish URLs, `ingest_runs` recorded, PhishTank skip logged |
| Edge Cases | Pass | Empty feed, malformed URLs, duplicates, HTTP errors, partial source failure, missing key, key not leaked in errors, CSV quoting/commas |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `package.json`, `tsconfig.json`, `test/tsconfig.json`, `.gitignore`, `wrangler.jsonc`, `vitest.config.ts` | CREATED | +105 |
| `migrations/0001_init.sql`, `seeds/brands.example.sql` | CREATED | +54 |
| `src/**` (12 files) | CREATED | +392 |
| `test/**` (6 files incl. setup/env) | CREATED | +280 |
| `scripts/*.mjs` (3 files) | CREATED | +152 |
| `README.md` | CREATED | +54 |

## Deviations from Plan
- **TypeScript ~5.9 instead of ^5 → latest:** npm's latest is 7.0 (native compiler). It hasn't been verified against Wrangler's generated types, so it's pinned to avoid churn.
- **`scheduled` awaits `ingestFeeds`** instead of `ctx.waitUntil`, so failed ingests mark the cron invocation as failed in the dashboard.
- **`normalizeUrl` keeps the trailing `/` on bare hosts** (`URL.href` form) rather than stripping it; this is consistent and simpler.
- **Upsert also refreshes `brand_id`**, so editing the brand config re-tags existing URLs on the next run.
- **`TEST_MIGRATIONS` typing lives in `test/env.d.ts`**, not `src/env.d.ts`, so production types don't depend on `cloudflare:test`.
- **Added `scripts/d1.mjs`** (wrangler wrapper, CSV read/write) shared by both label scripts.
- **Invalid-URL test case** uses `http://` and `ftp://` instead of `ht!tp://`, which WHATWG URL parses as a valid host.

## Issues Encountered
- npm 11 blocked `workerd`/`esbuild` postinstall scripts → approved via `npm install-scripts approve`. The approval is pinned to exact versions in `package.json` `allowScripts`, so upgrading Wrangler will require re-approval.
- `satisfies ExportedHandler<Env>` keeps the narrower inferred `fetch(request)` signature → the test calls it through an `ExportedHandler<Env>`-typed reference.
- **Finding that affects the PRD:** one live OpenPhish snapshot has ~300 URLs, and only ~20 contain any brand name. Fintech brands (chase, wellsfargo, hsbc) appeared about once each. The community feed alone may not give enough brand-matched samples for a solid base rate in 2 weeks. The PhishTank key, and possibly additional feeds, matter more than the plan assumed.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `test/url.test.ts` | 7 | normalizeUrl, domainInfo (multi-part TLD, IP, punycode), sha256Hex |
| `test/match.test.ts` | 5 | legit-domain exclusion, subdomain/path keyword, target field, no match |
| `test/feeds.test.ts` | 7 | OpenPhish parse/HTTP error, PhishTank parse/gunzip/key not leaked |
| `test/ingest.test.ts` | 5 | end-to-end ingest into D1, repeat run, failure recording, partial failure, /health |

## Next Steps
- [ ] Confirm Workers Paid plan → `wrangler d1 create`, set `database_id`, migrate/seed remote, deploy
- [ ] Choose the 5–10 monitored brands (`seeds/brands.sql`)
- [ ] Register for a PhishTank app key; consider additional ground-truth feeds given low brand-match volume
- [ ] After ~2 weeks: `label:export` → label → `label:import`; record the base rate in the PRD
- [ ] Code review via `/code-review`, then commit
