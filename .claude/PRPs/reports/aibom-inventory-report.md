# Implementation Report: AI-BOM Inventory (Scanner Phase 1)

## Summary
Added a static, local Node CLI (`npm run scan`) under `scanner/` that inventories installed Claude Code plugins (skills, agents, commands, hooks, MCP servers, npm dependencies) plus user and project config. It hashes every file without following symlinks and writes a schema-valid CycloneDX 1.7 AI-BOM and a per-file snapshot. On the owner's machine: 2 plugins, 307 skills, 68 agents, 94 commands, 24 hooks, 2 MCP servers, 214 npm packages and 12,148 files hashed in under 1 s. A README-based gap analysis compares SkillSpector and Agent Scan (formerly mcp-scan).

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 7/10 | All tests passed on the first run; no rework |
| Files Changed | ~18 | 20 created (13 src, 3 test, 2 config, 1 doc, 1 report) + 3 updated (`package.json`, `vitest.config.ts`, `.gitignore`); ~1,680 lines |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Package wiring | Complete | Root vitest restricted to `test/**` |
| 2 | Types + file walk/hash | Complete | Plus a `util.ts` of shared helpers |
| 3 | Frontmatter + component parsers | Complete | Single function `docsAt` for all three kinds |
| 4 | Installed plugins | Complete | |
| 5 | Hooks + MCP + npm deps | Complete | |
| 6 | User-level config | Complete | |
| 7 | CycloneDX builder + scan | Complete | |
| 8 | CLI | Complete | Adds a separate `validate.ts` |
| 9 | Tests | Complete | Fixture generated at runtime (see deviations) |
| 10 | Real-machine run + gap analysis | Complete | `docs/scanner/gap-analysis.md` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `npm run typecheck` covers Worker, Worker tests and scanner |
| Unit Tests | Pass | 34 scanner tests; Worker tests still 25/25 |
| Build | N/A | No build step; Node runs `.ts` directly |
| Integration | Pass | Real `$HOME` scan: valid BOM; counts cross-checked with `find` (293 + 14 skills, 68 agents, 94 commands, 24 hooks) |
| Edge Cases | Pass | Missing plugin, malformed YAML, path escape, symlink, empty home, decoy secrets |

## Deviations from Plan
- **Fixture built at test time** (`scanner/test/fixture.ts` into a temp dir) instead of committed files under `scanner/test/fixtures/home/`. This avoids committing absolute paths, a symlink and decoy secrets.
- **Declared manifest paths supplement the conventional dirs** (`skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`) rather than replacing them. The inventory is a superset of what the agent could load.
- **Extra modules:** `util.ts` (lstat-only file kinds, safe JSON reads, bounded concurrency) and `validate.ts`.
- **Plan's expected output was wrong on one point:** it predicted `chrome-devtools` as UNPINNED. The scan shows `npx -y chrome-devtools-mcp@1.10.1`, which is pinned. The plan was written from the command alone, without reading the args.
- **Summary reports `agentsInheritingAllTools`** separately (agents with no `tools` list get every tool); 0 on this machine.

## Issues Encountered
- npm blocked `fsevents`' install script (optional macOS watcher). It isn't needed and was left blocked.
- `ecc` ships about 720 extra `SKILL.md` copies for other harnesses and translations (`docs/*/skills`, `.kiro`, `.agents`, `pi`). They aren't counted as Claude Code skills but are hashed in the snapshot. Phase 2 detectors should scan them anyway.
- Output contains no home path; the 7 "personal" matches are the words "personality" and "personalized" in skill descriptions.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `scanner/test/parsers.test.ts` | 26 | frontmatter, tools, hook interpreters, hook parsing, arg redaction, pinning, URL sanitizing, MCP key-only extraction, purl, SRI, lockfile |
| `scanner/test/scan.test.ts` | 8 | end-to-end counts, MCP pinning, 10 decoy secrets absent, root path absent, symlink not followed, path escape, schema validity, unique refs, determinism, empty home |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Commit (branch `feat/foundation-ground-truth` has no commits yet; consider a separate branch for scanner work)
- [ ] Scanner Phase 2 (deterministic detectors) and Phase 3 (SimHash) can run in parallel
