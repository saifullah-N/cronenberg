# Plan: AI-BOM Inventory (Scanner Phase 1)

## Summary
Add a local Node CLI under `scanner/` that inventories every installed agent component: Claude Code plugins with their skills, agents, commands, hooks and MCP servers, plus user- and project-level skills and MCP configs. It hashes every file and emits a CycloneDX 1.7 JSON AI-BOM and a per-file snapshot for later diffing. It also produces a written gap analysis of what SkillSpector and mcp-scan already cover. The scan is static only: it never executes plugin code or starts MCP servers.

## User Story
As a developer who installs agent plugins,
I want a pinned, hashed inventory of every installed component and what it can do,
So that I know what I'm running and can detect when it changes.

## Problem → Solution
1,000+ files across 2 plugins (plus 7.5k `node_modules` files), 24 inline hook commands and 2 MCP servers, none of them inventoried → `npm run scan` writes `scanner/out/aibom.cdx.json` (schema-valid CycloneDX 1.7) and `scanner/out/snapshot.json`, and prints a capability summary.

## Metadata
- **Complexity**: Large (new package, ~18 files, ~900 lines incl. tests/fixtures)
- **Source PRD**: `.claude/PRPs/prds/agent-supply-chain-scanner.prd.md`
- **PRD Phase**: 1 — AI-BOM inventory
- **Estimated Files**: 18

---

## UX Design

### Before
```
(no visibility) — plugins installed via /plugin, auto-updated, unreviewed
```

### After
```
$ npm run scan
AI-BOM: 2 plugins, 293 skills, 68 agents, 94 commands, 24 hooks, 2 MCP servers, 1 user skill
Capabilities
  hooks       24 (all run shell: `node -e …` inline; events: PreToolUse×9, Stop×7, …)
  mcp         chrome-devtools (stdio, npx, UNPINNED)   cloudflare (http → mcp.cloudflare.com)
  agents      with Write/Edit/Bash tools: N
Wrote scanner/out/aibom.cdx.json (CycloneDX 1.7, valid) and scanner/out/snapshot.json (11,xxx files)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Inventory | none | `npm run scan [-- --root <dir>] [--out <dir>]` | `--root` defaults to `$HOME`; tests pass a fixture root |
| Output | none | `aibom.cdx.json`, `snapshot.json`, stdout summary | `scanner/out/` is gitignored (contains local paths) |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `.claude/PRPs/prds/agent-supply-chain-scanner.prd.md` | Phase 1 + Architecture Notes | Scope; static-only rule |
| P0 | `src/feeds/ingest.ts` | 1–60 | Repo conventions: DI, `Promise.allSettled`, typed summaries |
| P1 | `src/lib/log.ts` | all | Worker logging (the CLI deviates; see Notes) |
| P1 | `vitest.config.ts`, `test/tsconfig.json` | all | Root tests run in workerd; scanner tests must be excluded |
| P2 | `scripts/d1.mjs` | all | Existing Node-side script style |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| CycloneDX 1.7 JSON | https://cyclonedx.org/docs/1.7/json/ | Top level: `bomFormat:"CycloneDX"`, `specVersion:"1.7"`, `serialNumber:"urn:uuid:…"`, `version`, `metadata`, `components[]` (nestable), `services[]`, `dependencies[]`. Hash alg names like `"SHA-256"`, `"SHA-512"` |
| CycloneDX validator | `@cyclonedx/cyclonedx-library@10.3.x` | `new Validation.JsonStrictValidator(Spec.Version.v1dot7).validate(json)` resolves `null` when valid. Needs optional peers `ajv`, `ajv-formats`, `ajv-formats-draft2019` |
| Agent BOM proposal | https://github.com/CycloneDX/specification/issues/895 | Not standardized; use namespaced `properties` (`agentbom:*`) |
| Node type stripping | Node 24 | Runs `.ts` directly; imports must use `.ts` extensions; no enums, namespaces or parameter properties |

KEY_INSIGHT: Plugin metadata lives in `~/.claude/plugins/installed_plugins.json` → `{ version: 2, plugins: { "<name>@<marketplace>": [{ scope, installPath, version, installedAt, lastUpdated, gitCommitSha }] } }`.
APPLIES_TO: Task 4.
GOTCHA: The value is an **array** (multiple scopes possible). Iterate all entries.

KEY_INSIGHT: `.claude-plugin/plugin.json` `mcpServers` is either an inline object (`ecc`: `{}`) or a **path string** (`cloudflare`: `"./.mcp.json"`). `skills`/`commands` may be arrays of directory paths (`["./skills/"]`).
APPLIES_TO: Task 5.
GOTCHA: Fall back to the conventional `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json` when the manifest omits them. Resolve paths relative to the plugin root and **reject paths that escape it** (`..`).

KEY_INSIGHT: `hooks/hooks.json` = `{ hooks: { <Event>: [{ matcher?, hooks: [{ type: "command", command }] }] } }`. `ecc` has 24 commands, each a 1–1.4k-char inline `node -e "…"`.
APPLIES_TO: Task 6.
GOTCHA: Record the event, matcher, a SHA-256 of the command, its length and the interpreter (`node -e`, `bash`, `python`…). **Do not** store full command text in the BOM. Phase 2 analyzes content from the files.

KEY_INSIGHT: `.mcp.json` = `{ mcpServers: { <name>: { type?: "stdio"|"http"|"sse", command?, args?, env?, url?, headers? } } }` (or the map at top level). `ecc` → `chrome-devtools` via `npx` (unpinned); `cloudflare` → `https://mcp.cloudflare.com/…`.
APPLIES_TO: Task 6.
GOTCHA: **Never read env or header values.** Record key names only. Redact arg values that look like secrets (`/(token|key|secret|password|auth)[=:]\S+/i`). HTTP servers go in CycloneDX `services[]`, stdio servers in `components[]`.

KEY_INSIGHT: Skills are `skills/<name>/SKILL.md`; agents `agents/*.md` and commands `commands/*.md`, all with YAML frontmatter (`name`, `description`, agents also `model`, `tools: Read, Write, …`).
APPLIES_TO: Task 5.
GOTCHA: Frontmatter can be multi-line YAML. Use the `yaml` package; on parse failure record `agentbom:parseError` and continue.

KEY_INSIGHT: User-level `~/.claude/settings.json` can hold `hooks` (none today) and `enabledPlugins`. `~/.claude.json` may hold `mcpServers` at the top level and under `projects[<path>].mcpServers` (none today). `~/.claude/skills|agents|commands` hold user components (1 skill today).
APPLIES_TO: Task 7.
GOTCHA: `~/.claude.json` contains unrelated account/session data. Read **only** `mcpServers` keys through the same name-only extractor; never copy anything else.

---

## Patterns to Mirror

### NAMING_CONVENTION
// SOURCE: src/feeds/ingest.ts:11-24, src/feeds/types.ts:1-10
```ts
interface SourceDef { source: FeedSource; fetchEntries: () => Promise<FeedEntry[]>; }
export interface SourceSummary { source: FeedSource; fetched: number; unique: number; skipped: number; newRows: number; }
```
camelCase files and functions, PascalCase types, one concern per module.

### ERROR_HANDLING
// SOURCE: src/feeds/ingest.ts:46-53 — isolate units, collect failures
```ts
const results = await Promise.allSettled(sources.map((s) => runSource(env.DB, s, brands, now)));
const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
```
Scanner variant: a broken plugin or file must **not** abort the scan. Record `agentbom:error` on that component, add it to `summary.errors`, and continue. Exit code 1 only when the BOM can't be written or fails schema validation.

### SERVICE_PATTERN
// SOURCE: src/feeds/ingest.ts:26-30 — dependencies injected for tests
```ts
export async function ingestFeeds(env: Env, fetcher: Fetcher = defaultFetcher, now: () => Date = () => new Date())
```
Scanner variant: `scan({ root, now, randomUUID })`. `root` replaces `$HOME`; tests pass fixtures, a fixed `now` and a fixed UUID for deterministic output.

### TEST_STRUCTURE
// SOURCE: test/match.test.ts:1-20
```ts
import { describe, expect, it } from "vitest";
describe("matchBrand", () => { it("never matches the brand's own domain", () => { /* ... */ }); });
```

### LOGGING_PATTERN
// SOURCE: src/lib/log.ts — JSON lines for the Worker.
The CLI prints a human summary to stdout and warnings/errors to stderr. With `--json`, it prints the summary object as one JSON line instead (machine-readable, same spirit as `log()`).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `scanner/src/cli.ts` | CREATE | Arg parsing, run scan, write outputs, print summary |
| `scanner/src/scan.ts` | CREATE | Orchestration: sources → components → BOM + snapshot |
| `scanner/src/types.ts` | CREATE | `Component`, `HookEntry`, `McpServer`, `ScanResult`, `FileRecord` |
| `scanner/src/fsWalk.ts` | CREATE | Recursive walk (no symlink follow), streaming SHA-256 |
| `scanner/src/plugins.ts` | CREATE | `installed_plugins.json` + manifest → plugin components |
| `scanner/src/components.ts` | CREATE | Skills/agents/commands from dirs + frontmatter |
| `scanner/src/hooks.ts` | CREATE | `hooks.json` → hook entries (hash, interpreter, event, matcher) |
| `scanner/src/mcp.ts` | CREATE | `.mcp.json`/inline/`~/.claude.json` → servers (names only, redaction, pinning) |
| `scanner/src/npmDeps.ts` | CREATE | `package-lock.json` → library components with purl + SHA-512 |
| `scanner/src/userConfig.ts` | CREATE | User-level skills/agents/commands, settings hooks, `~/.claude.json` MCP |
| `scanner/src/cyclonedx.ts` | CREATE | Build CycloneDX 1.7 JSON (stable sort) |
| `scanner/test/*.test.ts` | CREATE | Unit + fixture integration + schema validation |
| `scanner/test/fixtures/home/**` | CREATE | Synthetic `.claude` tree (no real plugin content) |
| `scanner/tsconfig.json`, `scanner/vitest.config.ts` | CREATE | Node-env typecheck/tests |
| `vitest.config.ts` | UPDATE | `test.include: ["test/**/*.test.ts"]` so workerd doesn't pick up scanner tests |
| `package.json` | UPDATE | Scripts `scan`, `scanner:test`, `scanner:typecheck`; deps |
| `.gitignore` | UPDATE | `scanner/out/` |
| `docs/scanner/gap-analysis.md` | CREATE | What SkillSpector / mcp-scan cover vs this scanner |

## NOT Building

- Content detectors (hidden Unicode, exfil patterns): Phase 2.
- SimHash, LLM judge, diff/approval, disclosure: Phases 3–7.
- Executing plugin code, starting MCP servers, `npx`-resolving package versions, or any network call.
- Reading env or header values, or any part of `~/.claude.json` besides `mcpServers`.
- Running mcp-scan: it starts MCP servers and calls an external API, which violates static-only. Its gap analysis comes from docs and source.

---

## Step-by-Step Tasks

### Task 1: Package wiring
- **ACTION**: Add the scanner as a sub-folder of the existing package (no workspace).
- **IMPLEMENT**:
  - `package.json` scripts:
    - `"scan": "node scanner/src/cli.ts"`
    - `"scanner:test": "vitest run --config scanner/vitest.config.ts"`
    - `"scanner:typecheck": "tsc --noEmit -p scanner"`
    - append `&& npm run -s scanner:typecheck` to `typecheck`
  - deps: `yaml@^2`. devDeps: `@cyclonedx/cyclonedx-library@~10.3`, `ajv@^8`, `ajv-formats@^3`, `ajv-formats-draft2019@^1`.
  - `scanner/tsconfig.json`:
    - `module/moduleResolution: "NodeNext"`, `target: "ES2023"`, `strict`, `noUncheckedIndexedAccess`
    - `allowImportingTsExtensions: true`, `erasableSyntaxOnly: true`, `noEmit: true`
    - `types: ["node"]`, `include: ["src", "test"]`
  - `scanner/vitest.config.ts`: `defineConfig({ test: { include: ["scanner/test/**/*.test.ts"], environment: "node" } })` (run from the repo root).
  - Root `vitest.config.ts`: add `include: ["test/**/*.test.ts"]` to `test`.
  - `.gitignore`: `scanner/out/`.
- **GOTCHA**: `erasableSyntaxOnly` requires TS ≥ 5.8 (repo pins ~5.9, OK). Node type stripping ignores `tsconfig`, so `.ts` import extensions are mandatory.
- **VALIDATE**: `npm test` still runs only the 25 Worker tests; `npm run scanner:test` runs nothing yet (exit 0 with `--passWithNoTests`, or add a placeholder).

### Task 2: Types + file walk/hash
- **ACTION**: Create `types.ts`, `fsWalk.ts`.
- **IMPLEMENT**:
  - `FileRecord { path: string /* relative to the component root */; size: number; sha256: string }`.
  - `walk(dir, { skip?: (rel) => boolean })` async generator using `fs.promises.opendir`. Skip symlinks (record them as `{ path, symlink: true }`, never follow). Sort entries for determinism.
  - `hashFile(abs)`: stream through `crypto.createHash("sha256")`.
  - `digest(records)`: SHA-256 over sorted `path\0sha256\n` lines (the plugin content digest).
- **GOTCHA**: Never follow symlinks: a malicious plugin could link to `~/.ssh`. Bounded concurrency (e.g. 32 in flight) to avoid EMFILE on 11k files.
- **VALIDATE**: The test fixture includes a symlink; it's reported, not followed.

### Task 3: Frontmatter + component parsers
- **ACTION**: `components.ts`.
- **IMPLEMENT**: `readFrontmatter(text)` extracts the leading `---\n…\n---` block and parses it with `yaml`. Returns `{ data, error? }`.
  - `skillsIn(dir)`: each `*/SKILL.md` → `{ kind: "skill", name: fm.name ?? dirname, description, file: FileRecord }`.
  - `agentsIn(dir)`: `*.md` → `{ kind: "agent", name, description, model, tools: string[] }`. `tools` may be a comma string or a YAML list; normalize to a trimmed array.
  - `commandsIn(dir)`: `*.md` → `{ kind: "command", name: basename, description }`.
- **GOTCHA**: Truncate `description` to 300 chars in the BOM; full text stays in files for Phase 2.
- **VALIDATE**: Unit tests cover comma tools, list tools, missing frontmatter and invalid YAML.

### Task 4: Installed plugins
- **ACTION**: `plugins.ts`.
- **IMPLEMENT**: `loadInstalledPlugins(root)` reads `<root>/.claude/plugins/installed_plugins.json`. For every `name@marketplace` → entry: resolve `installPath` (absolute in the file; if it's outside `<root>/.claude/plugins/`, record `agentbom:outsidePluginsDir=true` but still scan). Read `.claude-plugin/plugin.json` (name, version, description, author, repository, homepage, license, `skills`, `commands`, `agents`, `hooks`, `mcpServers`). Mark `enabled` from `settings.json` `enabledPlugins`. Missing install dir → component with `agentbom:missing=true`.
- **GOTCHA**: Manifest paths are resolved with `path.resolve(pluginRoot, p)` and must stay inside `pluginRoot`. Otherwise record an error and skip.
- **VALIDATE**: Fixtures with inline `mcpServers`, path `mcpServers`, an array `skills`, and a missing install dir.

### Task 5: Hooks + MCP + npm deps
- **ACTION**: `hooks.ts`, `mcp.ts`, `npmDeps.ts`.
- **IMPLEMENT**:
  - Hooks: for each event/matcher/hook → `{ event, matcher: matcher ?? "*", type, interpreter, commandSha256, commandLength }`. `interpreter` = first token (`node -e` → `"node -e"`, `bash`, `sh -c`, `python`, `npx`, else `"other"`).
  - MCP: `normalizeServers(json)` accepts `{mcpServers:{…}}` or a bare map → `{ name, transport: type ?? (url ? "http" : "stdio"), command?, args? (redacted), urlHost?, envKeys, headerKeys, pinned? }`. `pinned` applies to `npx`/`uvx`/`pipx` only: true if the package arg has an exact version (`pkg@1.2.3`), false otherwise.
  - npm: if a plugin has `package-lock.json` (lockfileVersion 2/3 `packages` map) → library components `{ name, version, purl: pkg:npm/<name>@<version> (scoped names percent-encode "@"), hashes: SHA-512 from the `integrity` base64 → hex }`. Without a lockfile, record `agentbom:nodeModulesUnlocked=true` and the file count only.
- **GOTCHA**: Never `JSON.stringify` the raw `env`/`headers` objects. Build the record by picking fields.
- **VALIDATE**: The redaction test (`--token=abc` → `--token=<redacted>`) and a pinning test (`chrome-devtools-mcp@latest` → false, `pkg@1.4.0` → true).

### Task 6: User-level config
- **ACTION**: `userConfig.ts`.
- **IMPLEMENT**: `~/.claude/skills|agents|commands` via the Task 3 parsers. `settings.json` `hooks` via Task 5. `~/.claude.json` → `mcpServers` and `projects[*].mcpServers` (project path recorded with `~` substitution). Project-level `.mcp.json` and `.claude/` in `--project <dir>` (optional flag).
- **VALIDATE**: The fixture `.claude.json` contains a decoy secret field. The test asserts the secret string never appears in the BOM or snapshot output.

### Task 7: CycloneDX builder + scan orchestration
- **ACTION**: `cyclonedx.ts`, `scan.ts`.
- **IMPLEMENT**:
  - `scan(opts)` collects everything and returns `{ bom, snapshot, summary }`.
  - Paths in all outputs replace `root` with `~`.
  - BOM:
    - `metadata.timestamp = now().toISOString()`; `metadata.tools.components = [{ type:"application", name:"cronenberg-scanner", version }]`.
    - `serialNumber = "urn:uuid:" + randomUUID()`.
    - Plugin → `{ type:"application", "bom-ref":"plugin:<name>@<marketplace>", name, version, externalReferences:[vcs/website], hashes:[{alg:"SHA-256", content: digest}], properties:[agentbom:kind=plugin, agentbom:marketplace, agentbom:gitCommitSha, agentbom:scope, agentbom:enabled, agentbom:installPath, agentbom:fileCount], components:[…children] }`.
    - Children: skills/agents/commands `type:"data"` with the SKILL/agent file SHA-256; hooks `type:"data"` (`agentbom:kind=hook`, event, matcher, interpreter, commandSha256); stdio MCP `type:"application"` (`agentbom:kind=mcp-server`, transport, command, pinned, envKeys); npm libraries `type:"library"` with `purl`.
    - HTTP/SSE MCP → top-level `services[]` `{ "bom-ref":"mcp:<plugin>:<name>", name, endpoints:[url], "x-trust-boundary": true, properties }`.
    - `dependencies[]`: plugin `dependsOn` its children and services.
  - Sort components and properties by name for stable diffs.
  - Snapshot: `{ generatedAt, components: { [bomRef]: { digest, files: FileRecord[] } } }`.
  - Summary: counts per kind, hooks by event, MCP list with pinned flag, agents with any of `Write|Edit|Bash` tools, `errors[]`.
- **GOTCHA**: `bom-ref` values must be unique across the document. Plugins installed in two scopes get a `#<scope>` suffix.
- **VALIDATE**: Schema validation test (Task 9).

### Task 8: CLI
- **ACTION**: `cli.ts`.
- **IMPLEMENT**: Flags via `node:util` `parseArgs`: `--root` (default `os.homedir()`), `--project`, `--out` (default `scanner/out`), `--json`. Write `aibom.cdx.json` and `snapshot.json` with a 2-space indent. Validate the BOM with `JsonStrictValidator` before writing; if invalid, print the errors and exit 1. Print the summary (UX "After").
- **GOTCHA**: The validator's optional peers must be installed (Task 1), or `validate` throws a "missing dependency" error. Catch it and report it clearly.
- **VALIDATE**: `npm run scan -- --root scanner/test/fixtures/home --out <scratch>` prints the summary and exits 0.

### Task 9: Tests
- **ACTION**: `scanner/test/{frontmatter,mcp,hooks,npmDeps,scan}.test.ts` and the fixture tree.
- **IMPLEMENT**: The fixture `home/.claude/` contains:
  - `plugins/installed_plugins.json` with 2 plugins (one with a missing dir);
  - plugin A: inline `mcpServers` with an `npx` server (unpinned) and `env: { API_TOKEN: "DECOY-SECRET-123" }`;
  - plugin B: `"mcpServers": "./.mcp.json"` with an http server;
  - `hooks/hooks.json` with 2 events;
  - `skills/s1/SKILL.md`; `agents/a1.md` with `tools: Read, Bash`; `commands/c1.md`;
  - a `package-lock.json` with 2 packages, plus a symlink to `../../outside`;
  - `settings.json` with `enabledPlugins`; `.claude.json` with `mcpServers` and a decoy `oauthAccount` secret.

  `scan.test.ts` asserts:
  - counts;
  - `bom-ref` uniqueness;
  - `JsonStrictValidator(v1dot7)` returns `null`;
  - a deterministic snapshot for a fixed `now`/UUID;
  - `"DECOY-SECRET-123"` and the decoy oauth value appear in **neither** output;
  - the symlink is reported and not followed;
  - the missing plugin is flagged.
- **VALIDATE**: `npm run scanner:test` passes.

### Task 10: Real-machine run + gap analysis
- **ACTION**: Run on the real `$HOME`. Write `docs/scanner/gap-analysis.md`.
- **IMPLEMENT**:
  - Run `npm run scan` and check that the counts match `installed_plugins.json` and directory listings: `ecc` 68 agents and 94 commands, both MCP servers, 24 hooks.
  - Gap analysis: read the SkillSpector and mcp-scan READMEs and source (no execution). Produce a table of what each covers: skills, hooks, MCP tool descriptions, plugin-level diffs or pinning, hidden Unicode, reworded payloads, output format, offline operation. Cite file or README sections.
- **GOTCHA**: The real-machine output contains local paths. It stays in the gitignored `scanner/out/`; don't commit or publish it.
- **VALIDATE**: The summary matches the counts; the gap table has a source per cell.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| frontmatter comma tools | `tools: Read, Bash` | `["Read","Bash"]` | |
| frontmatter list tools | YAML list | array | |
| frontmatter invalid | broken YAML | `{ error }`, no throw | ✓ |
| hook interpreter | `node -e "…"` | `"node -e"` | |
| mcp normalize bare map | `{ x: { url } }` | transport http | ✓ |
| mcp redaction | `args:["--token=abc"]` | `--token=<redacted>` | ✓ |
| mcp pinning | `pkg@latest` / `pkg@1.2.3` / `pkg` | false / true / false | ✓ |
| npm purl scoped | `@scope/pkg` | `pkg:npm/%40scope/pkg@v` | ✓ |
| integrity → hex | `sha512-<b64>` | 128-char hex | |
| path escape | manifest `skills: ["../../x"]` | error recorded, skipped | ✓ |

### Edge Cases Checklist
- [x] Empty input (no `installed_plugins.json` → empty BOM, warning)
- [x] Maximum size input (11k files: bounded concurrency, streaming hashes)
- [x] Invalid types (malformed JSON or YAML → recorded per component)
- [ ] Concurrent access (single process; N/A)
- [x] Network failure (none: no network by design)
- [x] Permission denied (unreadable file → `agentbom:error`, continue)

---

## Validation Commands

### Static Analysis
```bash
npm run typecheck          # now includes scanner:typecheck
```
EXPECT: Zero type errors

### Unit Tests
```bash
npm run scanner:test
```
EXPECT: All pass

### Full Test Suite
```bash
npm test && npm run scanner:test
```
EXPECT: 25 Worker tests unchanged plus the scanner tests

### Manual Validation
- [ ] `npm run scan -- --root scanner/test/fixtures/home --out <scratch>` exits 0 with a valid BOM
- [ ] `npm run scan` on the real machine: counts match; `chrome-devtools` flagged unpinned; `cloudflare` listed as a service
- [ ] `grep` the real outputs for env/header values: none present (key names only)

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] Schema-valid CycloneDX 1.7 BOM
- [ ] 100% of installed components on the real machine listed with hashes
- [ ] No secrets in outputs (decoy test + manual grep)
- [ ] Gap analysis written with sources
- [ ] No type errors; Worker tests unaffected

## Completion Checklist
- [ ] Static only: no process spawn, no network
- [ ] Symlinks never followed; manifest paths can't escape the plugin root
- [ ] Errors recorded per component, scan continues
- [ ] Deterministic output for fixed `now`/UUID
- [ ] No Phase 2+ scope

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Plugin format varies across plugins/versions | M | M | Manifest-first with conventional fallbacks; per-component errors |
| CycloneDX validator peers or ESM issues | M | L | Pin versions; schema test catches early |
| Secrets leak into BOM | L | H | Name-only extraction by construction; decoy-secret test |
| `node_modules` without lockfile | M | L | Record unlocked + file count; files still hashed in snapshot |
| Gap analysis wrong because it's docs-only | M | M | Cite sources; mark "not verified by execution" |

## Notes
- **Deviation from repo logging:** the CLI uses human output plus `--json`, not JSON-lines `log()`. The Worker convention doesn't fit an interactive CLI.
- The `agentbom:*` property namespace is ours until CycloneDX #895 lands. Map it to official fields later.
- Shared modules (Unicode, SimHash, judge) are **not** extracted in this phase. They're extracted in scanner Phases 2–4 or phishing Phases 5/7, whichever comes first.
