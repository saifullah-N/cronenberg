# Implementation Report: Deterministic Detectors (Scanner Phase 2)

## Summary
Added static detectors to `npm run scan`:
- hidden Unicode (tags with decoded payload, bidi controls, variation selectors, zero-width, invisible operators), with emoji, keycap and joining-script exceptions;
- download-and-run commands, obfuscated payloads, exfiltration (network call near a credential store or bulk env dump), and concealment phrases;
- capability findings from the inventory (hooks, MCP servers, shell-capable agents).

Findings carry severity, file:line:column and sanitized evidence. They're written to `findings.json` and SARIF 2.1.0. Documentation and test files are lowered one level (hidden tags and bidi never are), cited concealment phrases are lowered and not escalated, and `--fail-on` gives CI exit codes. On the owner's machine, after tightening (below): **0 critical, 1 high, 5 medium, 5 low, 80 info across 4,534 text files**, all reviewed by hand. None malicious; every one points at text that really contains the pattern.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 7/10 | Implementation went smoothly; the real-machine run forced a redesign of the exfiltration rule (anticipated in plan risks) |
| Files Changed | ~16 | 9 created (8 `detect/` modules + `detectors.test.ts`), 9 updated |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Fix literal BOM | Complete | Root cause found: see Issues |
| 2 | Types + absRoot | Complete | |
| 3 | Text file selection | Complete | Adds test-path context (deviation) |
| 4 | Location + evidence | Complete | |
| 5 | Hidden-Unicode detector | Complete | 100% recall on seeded set; 7 legit-sequence negatives pass |
| 6 | Pattern detectors | Complete | Tightened after Task 10 (deviation) |
| 7 | Capability findings | Complete | |
| 8 | Orchestration, SARIF, CLI | Complete | |
| 9 | Tests + self-check | Complete | 71 new tests |
| 10 | Real-machine run + FP baseline | Complete | Baseline below |

## False-Positive Baseline (owner's machine, 2 plugins, 4,534 text files)

| Run | Critical | High | Medium | Low | Alerts (medium+) per 500 files |
|---|---|---|---|---|---|
| First run (rules as planned) | 0 | 288 | 98 | 3 | **42.6** |
| After tightening | 0 | 1 | 5 | 5 | **0.66** (PRD target ≤ 1) |

Hand review of all 11 non-info findings after tightening:
- **1 high:** a real `curl … | bash` installer instruction (`.opencode/MIGRATION.md`). The pattern is a true positive; the intent is benign.
- **1 medium:** an exfiltration attack example in a translated security guide (`docs/zh-CN/…`). Correctly detected; downgraded as documentation. The English guide doesn't contain it, so it's not a false negative.
- **4 medium:** `curl … | bash` analogies in docs (2) and attack strings in test fixtures (2). Correctly downgraded.
- **3 low:** match-all tool hooks. Real capabilities.
- **2 low:** cited "ignore previous instructions" in a defensive prompt. Correctly lowered.

No in-file or per-file suppressions were used; every change is a rule change covered by tests.

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | `npm run typecheck` (Worker, Worker tests, scanner) |
| Unit Tests | Pass | Scanner 106/106 (35 → 106); Worker 26/26 unchanged |
| Build | N/A | Node runs TypeScript directly |
| Integration | Pass | Real scan: 1.8 s; `--fail-on critical` → 0, `high` → 2, invalid → 1; SARIF structurally valid with 0 absolute URIs; no home path in any output |
| Edge Cases | Pass | Binary, > 2 MB, symlink swapped in after inventory, CRLF, 1 MB file < 1 s, 50-per-rule cap, decoy secrets |

## Files Changed

| File | Action |
|---|---|
| `scanner/src/detect/{rules,location,unicode,patterns,textFiles,capabilities,index,sarif}.ts` | CREATED |
| `scanner/test/detectors.test.ts` | CREATED |
| `scanner/src/{types,plugins,userConfig,components,scan,cli}.ts` | UPDATED |
| `scanner/test/{fixture,scan.test}.ts` | UPDATED |

## Deviations from Plan
- **Exfiltration rule redesigned (Task 10):** "network call anywhere in a file that reads any secret-looking name" flagged every normal API example (348 hits). Sources are now **credential stores and bulk environment dumps only**, and the network call must be **within 5 lines** of the source.
- **fetch-and-run requires a URL or hostname**, so prose like "reject `curl … | sh`" no longer matches. Python `-c` must both `urlopen` **and** `exec`/`eval`; a fetch-only healthcheck no longer matches.
- **Test-path context added** (`tests/`, `*.test.*`, `test_*.py`), alongside documentation context. Files the agent loads are never downgraded.
- **Cited-concealment rule:** a phrase is lowered one level and never escalated only when it's quoted **and** follows a citation cue (`e.g.`, `such as`, `like`, `:` …). A bare quoted string in code is still treated as a possible payload.
- **Concealment applies to all text kinds**, not "markdown + script string literals". Literal parsing wasn't worth it; contexts handle the noise.
- **No SARIF location** for capability findings whose source lies outside a scanned directory (e.g. MCP servers in `~/.claude.json`). GitHub code scanning may require locations; revisit if uploading.

## Issues Encountered
- **Root cause of the literal BOM (Task 1):** the file-writing tool converts 4-digit `\uXXXX` escapes into literal characters but leaves the `\u{…}` brace form alone. The first versions of `unicode.ts` and `location.ts` therefore contained literal invisible characters too. Fixed by rewriting them as `\u{…}` escapes; tests build invisible characters with `String.fromCodePoint`. The repo self-check test now fails on any invisible character in source.
- A test expectation for token redaction was wrong (`key=` is part of the token, so the value is fully redacted). The test was corrected; the behavior is the safer one.
- Reading `findings.sarif` with `require()` fails (`.sarif` isn't treated as JSON); use `JSON.parse`.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `scanner/test/detectors.test.ts` | 67 | Unicode seeded recall (14) + negatives (7), runs; fetch-and-run ±; exfil sources/proximity; concealment ± and citation; obfuscation tiers; escalation; doc/test downgrade; cap; 1 MB perf; location/evidence; text-file skips; doc/test context; SARIF; repo self-check |
| `scanner/test/scan.test.ts` | +4 | End-to-end findings, capabilities, `includeDeps`, `detect: false`; decoy/root-path checks now include findings and SARIF |

## Next Steps
- [ ] Code review, then commit to `feat/scanner-detectors` and push
- [ ] Scanner Phase 3 (SimHash near-duplicates) reuses `textFiles()` and `sanitizeEvidence()`
- [ ] Evasion benchmark (Phase 6) will measure what these regex rules miss
