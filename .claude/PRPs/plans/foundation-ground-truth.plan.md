# Plan: Foundation & Ground Truth

## Summary
Bootstrap the `cronenberg` Cloudflare Worker project (TypeScript, Wrangler, D1, Vitest in workerd) and build the ground-truth pipeline: a cron-triggered ingest of the OpenPhish community feed and (optionally) PhishTank into D1, tagged against a configurable brand list. Add a small export/import loop so a human can label a sample of brand-matched feed entries (ID-harvesting vs credential vs other) and measure the base rate the PRD's hypothesis depends on.

## User Story
As the project owner evaluating the detector,
I want every public-feed phishing URL for my target brands recorded with a first-seen timestamp and a human label,
So that later phases can measure lead time and precision against independent ground truth.

## Problem → Solution
Empty folder, no ground truth, unknown base rate of ID-harvesting phish → Deployed Worker that ingests feeds every 6h into D1 with brand tags and first-seen times, plus a CSV label loop yielding the ID-harvesting base rate for the chosen brands.

## Metadata
- **Complexity**: Medium (greenfield; ~20 files, ~600 lines incl. tests)
- **Source PRD**: `.claude/PRPs/prds/cronenberg.prd.md`
- **PRD Phase**: 1 — Foundation & ground truth
- **Estimated Files**: 22

---

## UX Design

### Before
N/A — nothing exists.

### After
Internal/operator change — no end-user UI. Operator touchpoints:
```
npm run db:migrate:remote        → schema in D1
edit seeds/brands.sql + npm run db:seed:remote
(cron every 6h)                  → feed_entries grows; ingest_runs logs each run
npm run label:export             → labels/sample.csv (brand-matched, unlabeled)
(human fills `label` column)
npm run label:import             → labels table; base-rate query prints %
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Brand config | none | `brands` table seeded from `seeds/brands.sql` | Seed file is user-specific, gitignored; `brands.example.sql` committed |
| Ground truth | none | `feed_entries` + `ingest_runs` | Cron `0 */6 * * *` |
| Labeling | none | CSV export/import scripts | Label via urlscan.io lookups, not by visiting URLs |

---

## Mandatory Reading

Greenfield project — no existing code. Read these external references instead:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `.claude/PRPs/prds/cronenberg.prd.md` | Phase 1 + Technical Approach | Scope and downstream consumers of this schema |
| P0 | https://raw.githubusercontent.com/cloudflare/workers-sdk/main/fixtures/vitest-plugin-examples/d1/vitest.config.ts | all | Current (2026) test config shape |
| P1 | https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/ | all | Plugin options |
| P1 | https://openphish.com/phishing_feeds.html | Community feed | Format, 12h refresh, non-commercial license |
| P2 | https://www.phishtank.com/developer_info.php | all | Data-dump URL format, app key, User-Agent expectations |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Vitest integration | `@cloudflare/vitest-plugin@1.3.x` (npm) | Import `cloudflareTest`, `readD1Migrations` from `@cloudflare/vitest-plugin`; tests import `applyD1Migrations` from `cloudflare:test` and `env` from `cloudflare:workers` |
| Vitest version | npm peerDeps | Plugin requires `vitest@^4.1.0`; latest vitest is 5.x → **pin `vitest@~4.1`** |
| Wrangler | `wrangler@4.145.x` | `wrangler types` generates `worker-configuration.d.ts` (Env) |
| OpenPhish | openphish.com | `https://openphish.com/feed.txt`, one URL per line, refreshed every 12h, **no timestamps**, non-commercial use only |
| PhishTank | phishtank.com | `https://data.phishtank.com/data/<APP_KEY>/online-valid.json.gz`; fields incl. `phish_id`, `url`, `submission_time`, `verification_time`, `target`; rate-limited; wants descriptive User-Agent |
| Public suffix | `tldts@7.x` | `parse(url)` → `hostname`, `domain` (registrable), pure JS, Workers-safe |

KEY_INSIGHT: `DecompressionStream` in Workers supports gzip/deflate but not bzip2.
APPLIES_TO: PhishTank fetch.
GOTCHA: Use the `.json.gz` dump, never `.bz2`.

KEY_INSIGHT: Default Workers CPU limit (30s on Paid) may not cover parsing the full PhishTank dump plus batching thousands of D1 statements.
APPLIES_TO: `wrangler.jsonc`.
GOTCHA: Set `"limits": { "cpu_ms": 300000 }`. Requires Workers Paid; the Free plan (10ms CPU) cannot run this phase.

KEY_INSIGHT: OpenPhish has no per-URL timestamp; our `first_seen_at` is poll time, so lead-time comparisons have up to 12h + poll-interval granularity.
APPLIES_TO: Phase 8 metrics.
GOTCHA: Record it; don't pretend precision we don't have.

---

## Patterns to Mirror

No existing codebase. The conventions below are **established by this plan**; later phases must follow them.

### NAMING_CONVENTION
// ESTABLISHED HERE
```ts
// files: camelCase.ts, one concern per module: src/feeds/openphish.ts
// types: PascalCase; functions: camelCase verbs
export interface FeedEntry { source: FeedSource; url: string; /* ... */ }
export async function fetchOpenPhish(fetcher: Fetcher): Promise<FeedEntry[]> { /* ... */ }
// SQL: snake_case tables/columns, plural table names
```

### ERROR_HANDLING
// ESTABLISHED HERE — isolate sources, record failure, surface to Cron
```ts
const results = await Promise.allSettled(sources.map((s) => runSource(env, s, fetcher)));
const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
if (failures.length) throw new AggregateError(failures.map((f) => f.reason), "feed ingest failed");
```
Each `runSource` writes an `ingest_runs` row in both success and failure paths (`error` column holds the message).

### LOGGING_PATTERN
// ESTABLISHED HERE — structured JSON, picked up by Workers Logs
```ts
// src/lib/log.ts
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}
// usage
log("feed.ingest.done", { source: "openphish", fetched: 512, new: 37, ms: 840 });
```

### REPOSITORY_PATTERN
// ESTABLISHED HERE — plain functions taking D1Database, batched prepared statements
```ts
export async function upsertFeedEntries(db: D1Database, rows: FeedEntryRow[]): Promise<void> {
  const stmt = db.prepare(`INSERT INTO feed_entries (...) VALUES (?1, ...)
    ON CONFLICT(source, url_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`);
  for (const chunk of chunks(rows, 100)) await db.batch(chunk.map((r) => stmt.bind(/* ... */)));
}
```

### SERVICE_PATTERN
// ESTABLISHED HERE — dependency-injected `fetcher` so tests never hit the network
```ts
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export async function ingestFeeds(env: Env, fetcher: Fetcher = fetch, now = () => new Date()) { /* ... */ }
```

### TEST_STRUCTURE
// SOURCE: cloudflare/workers-sdk fixtures/vitest-plugin-examples/d1/test/apply-migrations.ts
```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```
Test files: `test/<module>.test.ts`, `describe` per module, `it("does X when Y")`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` | CREATE | Scripts + pinned deps |
| `tsconfig.json` | CREATE | Worker source typing |
| `test/tsconfig.json` | CREATE | Adds `@cloudflare/vitest-plugin/types` |
| `wrangler.jsonc` | CREATE | D1 binding, cron, cpu limit, observability |
| `vitest.config.ts` | CREATE | Workers test pool + migrations binding |
| `.gitignore` | CREATE | node_modules, .wrangler, seeds/brands.sql, labels/*.csv, .dev.vars |
| `migrations/0001_init.sql` | CREATE | brands, feed_entries, labels, ingest_runs |
| `seeds/brands.example.sql` | CREATE | Example brand rows |
| `src/index.ts` | CREATE | `fetch` (health) + `scheduled` handlers |
| `src/env.d.ts` | CREATE | Secret + test binding typing |
| `src/lib/log.ts` | CREATE | Structured logging |
| `src/lib/hash.ts` | CREATE | SHA-256 hex |
| `src/lib/url.ts` | CREATE | URL normalization + registrable domain (tldts) |
| `src/lib/chunks.ts` | CREATE | Array chunking helper |
| `src/brands/repository.ts` | CREATE | Load brands from D1 |
| `src/brands/match.ts` | CREATE | Naive brand matcher (Phase 2 replaces) |
| `src/feeds/types.ts` | CREATE | `FeedSource`, `FeedEntry`, `Fetcher` |
| `src/feeds/openphish.ts` | CREATE | Fetch + parse feed.txt |
| `src/feeds/phishtank.ts` | CREATE | Fetch + gunzip + parse dump |
| `src/feeds/repository.ts` | CREATE | Upsert entries, ingest_runs writes |
| `src/feeds/ingest.ts` | CREATE | Orchestration |
| `test/apply-migrations.ts` + `test/*.test.ts` | CREATE | Unit + integration tests |
| `scripts/label-export.mjs`, `scripts/label-import.mjs` | CREATE | Labeling loop |
| `README.md` | CREATE | Setup + labeling safety note |

## NOT Building

- CT ingest, lookalike scoring, Bloom filters, Browser Run, LLM, chat UI — Phases 2–6.
- `candidates` / `verdicts` tables — deferred to Phases 2/4 where their shape is known (deviation from PRD Phase 1 wording; noted in PRD).
- A labeling web UI — CSV is enough for ~100–300 rows.
- Visiting phishing URLs from our infrastructure for labeling.
- PhishTank account creation — optional; ingest skips cleanly without `PHISHTANK_APP_KEY`.

---

## Step-by-Step Tasks

### Task 1: Scaffold project
- **ACTION**: Create `package.json`, `tsconfig.json`, `test/tsconfig.json`, `.gitignore`; run `git init`.
- **IMPLEMENT**:
  - `package.json`: `"type": "module"`, `"private": true`. devDeps: `wrangler@^4.145`, `vitest@~4.1.0`, `@cloudflare/vitest-plugin@^1.3`, `@cloudflare/workers-types@^5`, `typescript@^5`, `@types/node`. deps: `tldts@^7`.
  - Scripts: `dev` (`wrangler dev --test-scheduled`), `deploy`, `types` (`wrangler types`), `typecheck` (`tsc --noEmit && tsc --noEmit -p test`), `test` (`vitest run`), `db:migrate:local|remote` (`wrangler d1 migrations apply cronenberg --local|--remote`), `db:seed:local|remote` (`wrangler d1 execute cronenberg --local|--remote --file seeds/brands.sql`), `label:export`, `label:import`.
  - `tsconfig.json`: `target/module ES2022`, `moduleResolution: "Bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`, `types: ["./worker-configuration.d.ts"]`, `include: ["src"]`.
  - `test/tsconfig.json`: extends `../tsconfig.json`; `types: ["../worker-configuration.d.ts", "@cloudflare/vitest-plugin/types", "@types/node"]`; include `["./**/*.ts", "../src/env.d.ts"]`.
- **MIRROR**: NAMING_CONVENTION
- **GOTCHA**: Do not install `vitest@latest` (5.x): plugin peer is `^4.1.0`.
- **VALIDATE**: `npm install` completes without peer-dependency errors.

### Task 2: Wrangler config + D1
- **ACTION**: Create `wrangler.jsonc`; create the D1 database.
- **IMPLEMENT**:
  ```jsonc
  {
    "name": "cronenberg",
    "main": "src/index.ts",
    "compatibility_date": "2026-09-30",
    "compatibility_flags": ["nodejs_compat"],
    "observability": { "enabled": true },
    "limits": { "cpu_ms": 300000 },
    "triggers": { "crons": ["0 */6 * * *"] },
    "d1_databases": [{ "binding": "DB", "database_name": "cronenberg", "database_id": "<from create>", "migrations_dir": "migrations" }],
    "vars": { "USER_AGENT": "cronenberg/0.1 (+https://github.com/<you>/cronenberg)" }
  }
  ```
  Run `npx wrangler d1 create cronenberg`, paste `database_id`, then `npm run types`.
- **GOTCHA**: Requires `wrangler login` (or existing auth). `cpu_ms` is rejected on the Free plan.
- **VALIDATE**: `worker-configuration.d.ts` exists and contains `DB: D1Database`.

### Task 3: Schema migration
- **ACTION**: Create `migrations/0001_init.sql`.
- **IMPLEMENT**:
  ```sql
  CREATE TABLE brands (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL,        -- JSON array of lowercase strings, e.g. ["examplebank","exbank"]
    legit_domains TEXT NOT NULL,   -- JSON array of registrable domains, e.g. ["examplebank.com"]
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE feed_entries (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('openphish','phishtank')),
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL,              -- sha256 hex of normalized url
    hostname TEXT NOT NULL,
    registrable_domain TEXT,             -- NULL for IPs / unparseable
    brand_id INTEGER REFERENCES brands(id),
    source_first_seen_at TEXT,           -- PhishTank submission_time; NULL for OpenPhish
    source_target TEXT,                  -- PhishTank `target`
    first_seen_at TEXT NOT NULL,         -- our poll time, ISO-8601 UTC
    last_seen_at TEXT NOT NULL,
    UNIQUE (source, url_hash)
  );
  CREATE INDEX idx_feed_entries_domain ON feed_entries(registrable_domain);
  CREATE INDEX idx_feed_entries_brand ON feed_entries(brand_id, first_seen_at);
  CREATE TABLE labels (
    feed_entry_id INTEGER PRIMARY KEY REFERENCES feed_entries(id),
    label TEXT NOT NULL CHECK (label IN ('id_harvest','credential','payment','other','benign','unknown')),
    notes TEXT,
    labeled_at TEXT NOT NULL
  );
  CREATE TABLE ingest_runs (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    fetched INTEGER,
    new_rows INTEGER,
    error TEXT
  );
  ```
- **GOTCHA**: `registrable_domain` is the join key for Phase 8 lead time (CT gives domains, feeds give URLs). Keep it indexed.
- **VALIDATE**: `npm run db:migrate:local` succeeds; `wrangler d1 execute cronenberg --local --command "SELECT name FROM sqlite_master"` lists 4 tables.

### Task 4: Brand seed
- **ACTION**: Create `seeds/brands.example.sql`; copy it to gitignored `seeds/brands.sql` for real brands.
- **IMPLEMENT**: `INSERT INTO brands (slug,name,keywords,legit_domains) VALUES ('examplebank','Example Bank','["examplebank"]','["examplebank.com"]') ON CONFLICT(slug) DO UPDATE SET keywords=excluded.keywords, legit_domains=excluded.legit_domains;`
- **GOTCHA**: Keywords shorter than 5 chars cause many false matches in naive substring matching. Document this in the file header.
- **VALIDATE**: `npm run db:seed:local`; `SELECT * FROM brands` returns rows.

### Task 5: Shared libs
- **ACTION**: Create `src/lib/log.ts`, `hash.ts`, `url.ts`, `chunks.ts`, `src/feeds/types.ts`.
- **IMPLEMENT**:
  - `sha256Hex(s)`: `crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))` → hex.
  - `normalizeUrl(raw)`: trim; prepend `http://` if no scheme; `new URL()`; lowercase host; drop fragment; strip trailing `/` on bare paths. Return `null` on parse failure.
  - `domainInfo(url)`: `tldts.parse(url)` → `{ hostname, registrableDomain: domain ?? null, isIp }`.
  - `chunks<T>(arr, size)`: generator.
  - types: `type FeedSource = "openphish" | "phishtank"`; `interface FeedEntry { source; url; sourceFirstSeenAt?: string; sourceTarget?: string }`; `Fetcher`.
- **MIRROR**: LOGGING_PATTERN, NAMING_CONVENTION
- **IMPORTS**: `import { parse } from "tldts";`
- **GOTCHA**: Punycode hosts: `new URL()` returns an ASCII (xn--) hostname. Keep the ASCII form in the DB; Phase 2 decodes it for confusable scoring.
- **VALIDATE**: `test/url.test.ts` and `test/hash.test.ts` pass.

### Task 6: Brand repository + matcher
- **ACTION**: Create `src/brands/repository.ts`, `src/brands/match.ts`.
- **IMPLEMENT**:
  - `loadBrands(db)`: `SELECT id, slug, name, keywords, legit_domains FROM brands` → parse JSON columns into `Brand { id; slug; name; keywords: string[]; legitDomains: string[] }`.
  - `matchBrand(brands, { url, registrableDomain, sourceTarget })`: return first brand where `registrableDomain` ∉ `legitDomains` AND (lowercased url contains any keyword OR `sourceTarget` case-insensitively equals `name`). Otherwise `null`.
- **GOTCHA**: Legit domains must never match; this prevents the real brand's own URLs being counted as phish.
- **VALIDATE**: `test/match.test.ts` covers the legit-domain exclusion, keyword in subdomain, keyword in path, target-field match, and no match.

### Task 7: Feed fetchers
- **ACTION**: Create `src/feeds/openphish.ts`, `src/feeds/phishtank.ts`.
- **IMPLEMENT**:
  - `parseOpenPhish(text)`: split lines, trim, drop empty and `#`-comment lines → `FeedEntry[]`.
  - `fetchOpenPhish(fetcher, userAgent)`: GET `https://openphish.com/feed.txt` with `User-Agent`; throw `Error("openphish HTTP <status>")` if not ok.
  - `parsePhishTank(json)`: map items → `{ source: "phishtank", url, sourceFirstSeenAt: submission_time, sourceTarget: target }`; skip items without `url`.
  - `fetchPhishTank(fetcher, appKey, userAgent)`: GET `https://data.phishtank.com/data/${appKey}/online-valid.json.gz`. If the `content-encoding` header is not already gzip, pipe the body through `new DecompressionStream("gzip")`. Then `await new Response(stream).json()`.
- **MIRROR**: SERVICE_PATTERN, ERROR_HANDLING
- **GOTCHA**: Some CDNs set `Content-Encoding: gzip` and the runtime decompresses transparently. Decompressing twice fails, so check `res.headers.get("content-encoding")` first. PhishTank may redirect; the default `redirect: "follow"` handles it.
- **VALIDATE**: Parser unit tests use fixture strings/objects in `test/fixtures/`.

### Task 8: Repository + orchestration
- **ACTION**: Create `src/feeds/repository.ts`, `src/feeds/ingest.ts`.
- **IMPLEMENT**:
  - `startRun(db, source, startedAt)` → id. `finishRun(db, id, { finishedAt, fetched, newRows, error })`.
  - `upsertFeedEntries(db, rows)`: see REPOSITORY_PATTERN; chunk size 100.
  - `countNew(db, source, since)`: `SELECT COUNT(*) AS n FROM feed_entries WHERE source=?1 AND first_seen_at >= ?2`.
  - `ingestFeeds(env, fetcher = fetch, now = () => new Date())`:
    1. Load brands.
    2. Build the source list: OpenPhish always; PhishTank only if `env.PHISHTANK_APP_KEY`, else `log("feed.phishtank.skipped")`.
    3. Per source, via `Promise.allSettled`: startRun → fetch → normalize and dedupe in memory by url_hash → domainInfo + matchBrand → upsert → countNew → finishRun → log `feed.ingest.done`. On catch: finishRun with error, log `feed.ingest.failed`, rethrow.
    4. Throw `AggregateError` if any source failed.
  - `src/index.ts`: `scheduled(controller, env, ctx) { ctx.waitUntil(ingestFeeds(env)); }` and `fetch` → `GET /health` returns `{ ok: true }`, all other paths 404.
  - `src/env.d.ts`: augment `Cloudflare.Env` with `PHISHTANK_APP_KEY?: string` and `TEST_MIGRATIONS: import("cloudflare:test").D1Migration[]`.
- **MIRROR**: ERROR_HANDLING, REPOSITORY_PATTERN, LOGGING_PATTERN
- **GOTCHA**: Dedupe in memory before batching. Two identical `url_hash` values in one batch are harmless with ON CONFLICT, but they waste writes. Use one `now().toISOString()` value per run for both `first_seen_at` and `last_seen_at`.
- **VALIDATE**: The integration test (below) passes. Locally: `npm run dev`, then `curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"`, then check `feed_entries` in the local DB.

### Task 9: Tests
- **ACTION**: Create `vitest.config.ts`, `test/apply-migrations.ts`, and unit and integration tests.
- **IMPLEMENT**: Copy the config from the Cloudflare D1 example (TEST_STRUCTURE), with `configPath: "./wrangler.jsonc"`, the `TEST_MIGRATIONS` binding, and `setupFiles`. The integration test `test/ingest.test.ts`:
  - Seed 1 brand.
  - Call `ingestFeeds(env, stubFetcher)`, where the stub returns a 3-line OpenPhish fixture: one brand match, one legit-domain URL, one unrelated URL.
  - Assert 3 rows, `brand_id` set on exactly 1, and 1 `ingest_runs` row with `error IS NULL`.
  - Run again with the same fixture: `new_rows` is 0 and `last_seen_at` has advanced (inject `now`).
  - A stub returning 500 → rejects with `AggregateError`, and the `ingest_runs.error` value contains "HTTP 500".
- **GOTCHA**: The setup file runs outside per-file storage isolation. Seed data inside each test, not in the setup file.
- **VALIDATE**: `npm test` is green.

### Task 10: Labeling loop
- **ACTION**: Create `scripts/label-export.mjs`, `scripts/label-import.mjs`, and a `labels/` directory (gitignored CSVs).
- **IMPLEMENT**:
  - Export: run `wrangler d1 execute cronenberg --remote --json --command "<SELECT fe.id, b.slug, fe.url, fe.registrable_domain, fe.first_seen_at FROM feed_entries fe JOIN brands b ON b.id=fe.brand_id LEFT JOIN labels l ON l.feed_entry_id=fe.id WHERE l.feed_entry_id IS NULL ORDER BY random() LIMIT 150>"` via `child_process.execFileSync`. Write `labels/sample.csv` with an empty `label,notes` column pair, and add a urlscan search link column: `https://urlscan.io/search/#domain:<registrable_domain>`.
  - Import: read `labels/sample.csv`, validate `label` against the allowed set, write `labels/import.sql` with `INSERT ... ON CONFLICT(feed_entry_id) DO UPDATE`, execute it with `--file`, then print the base rate: `SELECT label, COUNT(*) FROM labels GROUP BY label`.
- **GOTCHA**: CSV fields contain commas in URLs, so quote every field and escape `"`. **Do not open phishing URLs directly.** Label from existing urlscan.io screenshots; if there's no scan, use `unknown`. Put this safety note in the README.
- **VALIDATE**: Round trip against the local DB (add a `--local` flag to both scripts).

### Task 11: Deploy + README
- **ACTION**: Write `README.md` (purpose, setup, commands, labeling safety, feed licenses). Then run `npm run db:migrate:remote && npm run db:seed:remote && npm run deploy`. Optionally run `wrangler secret put PHISHTANK_APP_KEY`.
- **GOTCHA**: The OpenPhish community feed is for non-commercial use only. State this in the README.
- **VALIDATE**: After the first cron fire (or a manual trigger from the dashboard), `SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 5` shows a success. Workers Logs shows `feed.ingest.done`.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| normalizeUrl adds scheme | `Example.com/a` | `http://example.com/a` | |
| normalizeUrl invalid | `ht!tp://` | `null` | ✓ |
| domainInfo IP | `http://1.2.3.4/x` | `registrableDomain: null, isIp: true` | ✓ |
| domainInfo multi-part TLD | `https://a.b.example.co.uk` | `example.co.uk` | ✓ |
| domainInfo punycode | `http://xn--exmple-cua.com` | hostname kept ASCII | ✓ |
| sha256Hex | `"abc"` | `ba7816bf…` | |
| matchBrand legit domain | url on `examplebank.com` | `null` | ✓ |
| matchBrand keyword in subdomain | `examplebank.secure-login.xyz` | brand | |
| matchBrand target field | sourceTarget `"Example Bank"` | brand | |
| parseOpenPhish | text with blanks/comments | only URLs | ✓ |
| parsePhishTank missing url | `[{}]` | `[]` | ✓ |

### Edge Cases Checklist
- [x] Empty input (empty feed → 0 rows, run recorded)
- [x] Maximum size input (PhishTank dump → chunked batches, cpu_ms raised)
- [x] Invalid types (malformed URLs skipped, not fatal)
- [ ] Concurrent access (single cron; not applicable)
- [x] Network failure (non-2xx → run error + AggregateError)
- [x] Permission denied (missing PhishTank key → skip, logged)

---

## Validation Commands

### Static Analysis
```bash
npm run types && npm run typecheck
```
EXPECT: Zero type errors

### Unit Tests
```bash
npm test
```
EXPECT: All tests pass

### Full Test Suite
```bash
npm test
```
EXPECT: No regressions (single suite in Phase 1)

### Database Validation
```bash
npm run db:migrate:local
npx wrangler d1 execute cronenberg --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```
EXPECT: brands, feed_entries, labels, ingest_runs (+ d1_migrations)

### Browser Validation
```bash
npm run dev
curl -s localhost:8787/health
curl -s "localhost:8787/__scheduled?cron=0+*/6+*+*+*"
```
EXPECT: `{"ok":true}`; the scheduled run logs `feed.ingest.done` (real network fetch of OpenPhish)

### Manual Validation
- [ ] Remote D1 has rows after the first scheduled run
- [ ] `ingest_runs` shows the PhishTank run skipped or succeeded, never silently missing
- [ ] Label export produces ≤ 150 rows with urlscan links
- [ ] Import prints the label distribution (the ID-harvesting base rate)

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors
- [ ] Deployed; cron ingesting every 6h
- [ ] Base rate of `id_harvest` among brand-matched entries recorded in the PRD Evidence section

## Completion Checklist
- [ ] Code follows the conventions established above
- [ ] Every source failure recorded in `ingest_runs`
- [ ] Structured JSON logs only
- [ ] No hardcoded brands in code (D1 only)
- [ ] README includes the labeling safety note and feed licenses
- [ ] No Phase 2+ scope added

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PhishTank registration unavailable or slow | M | L | Optional source; OpenPhish alone is enough for Phase 1 |
| PhishTank dump too large for memory/CPU | L | M | cpu_ms 300000; if still an issue, stream-parse or filter to brand-matched before upsert |
| Too few brand-matched entries to estimate a base rate | M | H | Choose frequently phished brands; widen keywords; let it accumulate 2+ weeks |
| Naive substring matching mislabels brands | H | L | Human labeling catches it; Phase 2 replaces the matcher |
| Vitest/plugin version drift | M | L | Pin `vitest@~4.1` and the plugin minor version |

## Notes
- **Deviation from PRD:** `candidates`/`verdicts` tables move to Phases 2/4 (YAGNI; their shape depends on the scoring and verdict design).
- **Prerequisite:** Workers Paid plan ($5/mo), because of `cpu_ms`. This was still open in the PRD constraints.
- **Open PRD question blocking Task 4 (real brands):** which 5–10 brands to monitor. The example seed unblocks everything else.
