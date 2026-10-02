# Deployment Plan — Workers Free

Status: **planning only. Nothing is deployed, and no Cloudflare resources exist.** The `database_id` in `wrangler.jsonc` is a placeholder. All verification so far is local (`vitest` in workerd, `wrangler dev`, `wrangler deploy --dry-run`).

Rule until this plan is approved: no `wrangler deploy`, `d1 create`, `--remote`, `secret put`, or any other command that creates or changes Cloudflare resources.

## 1. Free plan limits that matter (checked 2026-10-01)

| Resource | Free limit | Source |
|---|---|---|
| Worker CPU per invocation (HTTP **and Cron**) | **10 ms** | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| `limits.cpu_ms` config | Paid only; a deploy with it will be rejected | same |
| Requests | 100,000 / day | same |
| Subrequests | 50 external, 1,000 to Cloudflare services, per invocation | same |
| Cron Triggers | 5 per account | same |
| Memory | 128 MB | same |
| D1 | 5M rows read/day, **100k rows written/day**, 5 GB; queries fail once exceeded (enforced since 2026-09-01) | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) |
| Queues | 10,000 ops/day, 24h retention | [changelog](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/) |
| Durable Objects | SQLite-backed only | Workers pricing docs |
| Workflows | 3,000 steps/day | Workflows docs (verify before Phase 4) |
| Browser Run | **10 min browser time/day**, 3 concurrent | Browser Run docs (verify before Phase 4) |
| Workers AI | **10,000 neurons/day** | Workers AI docs (verify before Phase 4) |

## 2. Phase 1 Free-plan changes — ✅ applied 2026-10-01

Benchmark (Node, 300 real OpenPhish URLs): with per-URL SHA-256, ~10 ms CPU on the first run and ~2.4 ms warm; without it, ~0.2 ms.

| # | Change | Status |
|---|---|---|
| F1 | Removed `limits.cpu_ms` from `wrangler.jsonc` | ✅ |
| F2 | Dropped per-URL SHA-256; `feed_entries` is unique on `(source, url)`; `src/lib/hash.ts` deleted | ✅ |
| F3 | PhishTank is opt-in: it runs only if `PHISHTANK_ENABLED="true"` **and** `PHISHTANK_APP_KEY` are set; it's skipped and logged otherwise | ✅ |
| F4 | Index `(source, first_seen_at)` so `countNew` reads only new rows | ✅ |
| F5 | Cron every 12h instead of 6h | Not applied; still open |

Budget (OpenPhish only): ~300 upserts × 4 runs ≈ 1.2k rows written/day plus index writes, well under 100k. There is 1 external subrequest per run. CPU is expected well under 10 ms; confirm via Workers Logs `cpuTime` after the first real run.

## 3. Code review findings — ✅ fixed 2026-10-01

| # | Issue | Fix | Verified |
|---|---|---|---|
| R1 | Blank `id` in label CSV became `0` and broke the whole import | Rejects blank or non-positive ids with a per-line error | Local import: `line 3: bad id ""` |
| R2 | UTF-8 BOM from spreadsheet re-saves broke the header | `parseCsv` strips a leading BOM | Local import of a BOM-prefixed CSV parsed correctly |
| R3 | Empty keyword matched every URL | `loadBrands` trims and drops blank keywords and domains | Test `ignores blank brand keywords…` |
| R4 | PhishTank dump may exceed 128 MB | Moot while F3 keeps it disabled; revisit if PhishTank moves into the collector | — |

## 4. Local verification gate (must pass before any deploy)

```bash
npm run typecheck
npm test
npx wrangler deploy --dry-run --outdir <scratch dir>    # bundles; uploads nothing
npm run dev                                             # then:
curl -s localhost:8787/health
curl -s "localhost:8787/__scheduled?cron=0+*/6+*+*+*"   # live OpenPhish fetch into LOCAL D1
```

Last run (2026-10-01, after the fixes): typecheck ✅; 25/25 tests ✅; dry-run bundle 173.73 KiB / 52.01 KiB gzip, with no CPU limit setting ✅; scheduled ingest 300 fetched → 299 unique stored, PhishTank skipped ✅.

`wrangler dev` does **not** enforce the 10 ms limit. CPU fit is checked by the benchmark above, and by `cpuTime` after the first real run.

## 5. CT ingest — decision: external collector (option B)

The CT firehose (millions of certs/day) can't be processed on Workers Free (100k requests/day, 10 ms CPU), so a small process **outside Cloudflare** reads CT logs, filters to brand candidates, and sends only those (tens to hundreds per day) to the Worker.

**Hosting: not GitHub Actions.** GitHub's terms bar GitHub-hosted runners from being used "as part of a serverless application" or for "any other activity unrelated to the production, testing, deployment, or publication of the software project" ([GitHub Terms for Additional Products](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)). A 24/7 collector falls under that.

Hosting options (decision needed):

| Option | Cost | Uptime | Notes |
|---|---|---|---|
| Your own machine | Free | While it's on | Best for development and demos; the evaluation window needs it running continuously |
| Free-tier cloud VM (e.g. Oracle Cloud Always Free) | Free | 24/7 | Verify current free-tier terms and capacity before relying on it |
| Small paid VPS | ~$4–6/month | 24/7 | Cheapest reliable option if free VMs are unavailable |

Collector design sketch (to be detailed in the Phase 2 plan):
- Reads one or more CT logs over HTTP, preferring static/tiled CT logs, which can be fetched as cacheable tiles. It keeps a local checkpoint.
- Filters: punycode decode → Unicode TR39 skeleton → brand keyword / edit-distance score. **The Bloom filter of already-seen domains lives here**, where the volume is.
- Sends candidates in batches to an authenticated Worker endpoint (HMAC-signed requests, shared secret) → D1 `candidates`.
- Ingest budget on the Worker side: a few batches per hour, which is trivial on Free.

## 6. Later phases on Free — constraints

| Phase | Constraint | Implication |
|---|---|---|
| 3 Bloom filter | Volume is in the collector now | The Bloom filter and rendezvous-hash sharding move to the collector (in-memory shards persisted to disk). DO-based shards are optional |
| 4 Investigation | Browser Run 10 min/day ≈ 30–60 renders/day, **including re-checks** | New candidates must stay ≈ 10–20/day with 2 re-checks each. Cap renders/day in code |
| 4 LLM verdict | 10k neurons/day | Use a small model by default; reserve Llama 3.3 70B for borderline cases. Measure neurons per verdict (TBD) |
| 4 Workflows | 3,000 steps/day | ~5 steps × 3 checks × 20 candidates ≈ 300/day, OK |
| 5 LLM eval harness | Eval runs draw from the same 10k neurons/day as production verdicts | Run evals in small, scheduled batches; record neurons per run; never run a full eval on a day with live investigations near quota |
| 6 Chat UI | Workers static assets / Pages are free | OK |

## 7. Deploy runbook (future — do not run until approved)

1. Re-run §4.
2. `npx wrangler d1 create cronenberg` → paste the `database_id`, then `npm run types`.
3. `cp seeds/brands.example.sql seeds/brands.sql`, then edit it with the real brands.
4. `npm run db:migrate:remote && npm run db:seed:remote`
5. `npm run deploy`
6. Trigger once from the dashboard (Cron Triggers → run). Check that `ingest_runs` shows success and that the log `cpuTime` is < 10 ms.
7. Rollback: `npx wrangler delete cronenberg` (removes the Worker and cron). The D1 database stays until `wrangler d1 delete`.

## 8. Open decisions

- [ ] Collector host (§5)
- [ ] Brands to monitor
- [ ] Ground truth without PhishTank-in-Worker: run PhishTank in the collector, skip it, or add other free feeds
- [ ] Cron interval: 6h vs 12h
