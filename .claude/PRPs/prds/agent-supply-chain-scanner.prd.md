# Agent Supply-Chain Scanner

## Problem Statement

Developers who install third-party agent plugins (skills, hooks, commands, sub-agents, MCP servers) into Claude Code, Codex and similar tools give that text and code direct influence over an agent with file, shell and network access. Hidden instructions (invisible Unicode, reworded injection payloads) and risky capabilities (shell hooks, auto-started MCP servers) are impractical to spot by reading, and marketplaces auto-update, so an approved component can change silently. The cost of not solving it: a single malicious or compromised plugin can run commands or exfiltrate data from the developer's machine.

## Evidence

- Snyk ToxicSkills (Feb 2026): 36.82% of skills studied (1,467) had at least one security flaw; 13.4% had critical issues including malware, prompt injection and credential theft.
- Hidden-Unicode instruction injection in skills, tool descriptions and MCP servers is documented by the Cloud Security Alliance. Invisible instructions in skill Markdown were shown to trigger shell commands on several production agent platforms (Feb 2026).
- Reworked malicious skills evaded almost all of eight widely used scanners across 1,600+ real samples (2026 report). Existing detection is brittle against rewording.
- Observed in this project (2026-09-30): installing one plugin (`ecc` 2.2.2) added 6 hook files, an MCP config, 68 agents, 94 commands and 585 skill files to the agent's context. None of it was reviewed before activation, and its hooks immediately began gating tool calls.
- **Assumption – needs validation:** existing tools under-cover Claude Code plugin **hooks** and whole-plugin change review. Validate by running SkillSpector and mcp-scan (local modes) against the same installed plugins in Phase 1.

## Proposed Solution

A local-first scanner, living in the `cronenberg` repo as a second package, that builds an **AI bill of materials (AI-BOM)** of every agent component installed, pinned to version and commit. It runs cheap deterministic detectors on every file (hidden Unicode, shell-exec hooks, network/exfil patterns, capability inventory), then matches normalized text against a corpus of known injection payloads using **SimHash near-duplicate search** to catch reworded variants. Only flagged or changed files go to a **sandboxed LLM judge**, which sees content as quoted data, has no tools and returns structured, advisory output. Results are re-checked whenever a component updates. Findings in public repos produce **draft reports that a human validates before anything is sent upstream**. We differentiate on evasion robustness (measured, not claimed), whole-plugin coverage including hooks, change review, and CycloneDX output, rather than building "another scanner". The hidden-Unicode detector, SimHash index and LLM-judge evaluation harness are shared with the phishing hunter.

## Key Hypothesis

We believe normalization plus SimHash near-duplicate matching, combined with deterministic agent-capability checks, will catch reworded malicious skill payloads that exact-match and regex scanners miss, for developers installing agent plugins.
We'll know we're right when, on a held-out benchmark of reworded payload variants, recall exceeds an exact-match/regex baseline by ≥ 30 percentage points at an equal or lower false-positive rate on a clean corpus.

## What We're NOT Building

- Executing or dynamically sandboxing plugin code — static analysis only in v1. Dynamic analysis needs isolation we can't build for $0.
- Auto-blocking installs or modifying a user's agent config — the scanner reports; humans decide.
- Publishing the evasion/mutation corpus or working payloads — dual-use; kept local, reported only in aggregate.
- Sending any finding upstream or publicly without human validation — see the disclosure workflow.
- Scanning private repositories without the owner's consent.
- A hosted SaaS or dashboard for other users.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Reworded-payload recall vs baseline | ≥ +30 pts over exact-match/regex at ≤ equal FP rate | Held-out evasion benchmark (Phase 6) |
| Hidden-Unicode recall | 100% on seeded set (tags, zero-width, bidi, variation selectors) | Seeded test files |
| False positives on clean corpus | TBD after baseline; target ≤ 1 alert per 500 files | Popular, manually reviewed plugins/skills |
| AI-BOM completeness on own machine | 100% of installed plugins and their components listed with hashes | Compare with `installed_plugins.json` and directory walk |
| Scan time, own setup (~1,000+ files) | < 2 min deterministic; LLM only on flagged/changed files | Timed CLI run |
| LLM judge cost | Within free quota (shared 10k neurons/day) or $0 local model | Neurons logged per run |
| Public scan | N ≥ 200 public repos scanned | Scan log |
| Upstream reports | M = number of **human-validated** findings reported (no target; a target would reward false reports) | Disclosure tracker |

## Open Questions

- [ ] Do SkillSpector / mcp-scan already cover Claude Code plugin hooks and whole-plugin diffs? (Determines differentiation; check in Phase 1.)
- [ ] Source and licensing of a known-malicious payload corpus (published studies' datasets, CSA examples, self-authored seeds). Can we use any of it?
- [ ] LLM judge: Workers AI free quota (shared with the phishing hunter) vs a local model (e.g. via Ollama). Quality vs cost is measured with the shared eval harness.
- [ ] CycloneDX Agent BOM fields are still a proposal (#895). Emit as CycloneDX 1.7 with custom properties, and track the proposal.
- [ ] Disclosure channel per repo: GitHub private vulnerability reporting, SECURITY.md contact, or email. Embargo window before any public mention (default 90 days?).
- [ ] False positives on legitimate security docs (e.g. `ecc` ships security guides that quote injection examples). Context rules or allowlists?
- [ ] Public-repo selection: which marketplaces/registries, and GitHub API limits (authenticated 5k requests/hour) vs shallow clones.

---

## Users & Context

**Primary User**
- **Who**: The project owner first; then developers using Claude Code / Codex who install marketplace plugins and MCP servers.
- **Current behavior**: Installs plugins from marketplaces without reviewing hundreds of files; trusts auto-updates.
- **Trigger**: Installing a new plugin or skill, or an auto-update changing one.
- **Success state**: Knows exactly what each installed component can do, sees any hidden or suspicious content with file:line evidence, and is alerted when an approved component changes.

**Job to Be Done**
When I install or update an agent plugin, I want to know what it can do (run hooks, start MCP servers, use shell or network) and whether any file hides instructions, so I can approve it knowingly or block it.

**Non-Users**
- Enterprises buying full AI-security platforms (they have vendors).
- Anyone seeking evasion techniques. The mutation corpus stays private; results are published only in aggregate and after disclosure.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | AI-BOM inventory: installed plugins (version, commit), skills, agents, commands, hooks (event → command), MCP servers (command/URL, env var names), scripts; SHA-256 per file; CycloneDX 1.7 JSON output | Can't secure what isn't inventoried; pins what was approved |
| Must | Deterministic detectors with file:line evidence: hidden Unicode (U+E0000–E007F tags, zero-width, bidi controls, variation selectors), shell-exec hooks, `curl \| sh`-style fetch-and-run, base64/obfuscated blobs, network/exfil patterns, concealment phrases ("do not tell the user") | Cheap, explainable, runs on every file |
| Must | SimHash near-duplicate matching of normalized text against a known-payload corpus (64-bit, 4×16-bit block index) | The differentiator: robustness to rewording |
| Must | Sandboxed LLM judge on flagged/changed files only: content as quoted data, no tools, strict JSON verdict, advisory; deterministic signals take precedence | Catches novel phrasing; budget-bounded |
| Must | Disclosure workflow: auto-generated draft report → human validation (validated / rejected, with notes) → private upstream report → tracker | Owner requirement; avoids false or harmful reports |
| Must | Evasion benchmark + eval via the shared harness (precision/recall, FP on clean corpus, baseline comparison) | Without measurement the hypothesis is untestable |
| Should | Change review: diff against the approved snapshot on update; re-scan changed files only | Marketplaces auto-update |
| Should | Optional Claude Code `SessionStart` hook that warns when installed components differ from the approved snapshot | Brings alerts to where the user works |
| Could | Run SkillSpector / mcp-scan locally as extra signals and report agreement | Cross-validation; honest comparison |
| Could | Cross-component risk (safe skills that are dangerous together) | Active research area; later |
| Won't | Dynamic execution, auto-blocking, publishing payload corpus | See NOT Building |

### MVP Scope

Scan the owner's installed plugins (`ecc`, `cloudflare`) → AI-BOM in CycloneDX → deterministic detectors → SimHash against a small seeded corpus → LLM judge on flagged files → findings report with file:line evidence → one end-to-end draft disclosure report in the human-validation queue (from a seeded test repo, not a real target).

### User Flow

1. `scan` → AI-BOM + findings for everything installed.
2. Review findings (severity, evidence, LLM reasons) and approve a snapshot.
3. On update: `scan --diff` shows changed components and new findings only.
4. Public repos: `scan <repo>` → draft report → human marks it validated or rejected → validated reports are sent privately upstream and tracked.

---

## Technical Approach

**Feasibility**: HIGH for inventory, deterministic detectors and SimHash (local Node, no external dependencies needed). MEDIUM for the LLM judge (free-quota limits; injection risk) and the evasion benchmark (corpus availability).

**Architecture Notes**
- Local Node CLI in `scanner/`. Code being scanned never leaves the machine unless the LLM judge is pointed at Workers AI. In that case only flagged excerpts are sent, never whole repos.
- Shared modules with the phishing hunter, extracted when both need them: hidden-Unicode detector, SimHash + block index (phishing Phase 7), LLM-judge wrapper + eval harness (phishing Phase 5).
- Reads `~/.claude/plugins/installed_plugins.json` (version + `gitCommitSha` per plugin) and plugin manifests (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`).
- Text normalization before SimHash: Unicode NFKC, strip invisible characters (recording that they existed), lowercase, collapse whitespace, Markdown → text.
- The LLM judge never executes, fetches or follows anything in scanned content; output is schema-validated and advisory.
- Snapshots stored locally (JSON or SQLite) keyed by `plugin@commit` for diffing.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Attackers adapt to our detectors | H | Measure evasion rate; never claim "safe"; verdicts are "flagged / not flagged with evidence" |
| LLM judge prompt-injected by scanned files | H | Data-only prompt, no tools, schema output, deterministic signals override; adversarial eval set |
| False positives on security docs that quote payloads | H | Context rules (docs vs executable instructions), per-file allowlist with justification, FP metric |
| No usable known-malicious corpus | M | Self-authored seeds + published examples where licensed; label provenance |
| Overlap with SkillSpector / mcp-scan | M | Verify gaps in Phase 1; position on evasion robustness, hooks and change review |
| Free LLM quota shared with phishing hunter | M | Judge only flagged/changed files; local model option |
| Disclosure mistakes (wrong or harmful report) | L | Mandatory human validation; private channels; embargo |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | AI-BOM inventory | Enumerate installed plugins/components, hash files, CycloneDX output; gap check vs SkillSpector/mcp-scan | complete | - | - | [plan](../plans/completed/aibom-inventory.plan.md), [report](../reports/aibom-inventory-report.md) |
| 2 | Deterministic detectors | Hidden Unicode, hooks, fetch-and-run, obfuscation, exfil, concealment phrases; file:line findings | complete | with 3 | 1 | [plan](../plans/completed/scanner-detectors.plan.md), [report](../reports/scanner-detectors-report.md) |
| 3 | SimHash near-dup matching | Normalization, 64-bit SimHash, block index, seeded payload corpus | pending | with 2 | 1 | - |
| 4 | Sandboxed LLM judge | Judge flagged/changed files; schema output; budget caps; local or Workers AI | pending | - | 2, 3 | - |
| 5 | Change review | Snapshot approval, diff on update, optional SessionStart warning hook | pending | with 6 | 2 | - |
| 6 | Evasion benchmark & eval | Held-out reworded variants, clean corpus, baseline comparison, shared harness | pending | with 5 | 3, 4 | - |
| 7 | Disclosure workflow | Draft report → human validation → private upstream report → tracker | pending | - | 4 | - |
| 8 | Public scan & write-up | Scan N repos, validate, disclose, aggregate write-up after embargo | pending | - | 6, 7 | - |

### Phase Details

**Phase 1: AI-BOM inventory**
- **Goal**: Know exactly what is installed and pin it.
- **Scope**: Read `installed_plugins.json` and plugin manifests; enumerate skills, agents, commands, hooks (event → command), MCP servers, scripts; SHA-256 every file; CycloneDX 1.7 JSON; run SkillSpector and mcp-scan locally on the same plugins and record what they cover (hooks? diffs?).
- **Success signal**: BOM lists 100% of components for `ecc` and `cloudflare`; written gap analysis vs existing tools.

**Phase 2: Deterministic detectors**
- **Goal**: Cheap, explainable findings on every file.
- **Scope**: Detectors listed in MoSCoW; severity levels; file:line evidence; seeded unit tests per detector; context rule for documentation files.
- **Success signal**: 100% recall on the seeded hidden-Unicode set; first FP measurement on the installed plugins.

**Phase 3: SimHash near-dup matching**
- **Goal**: Catch reworded copies of known payloads.
- **Scope**: Normalization pipeline, 64-bit SimHash over word shingles, 4×16-bit block index (Hamming ≤ 3 by pigeonhole, confirm by full distance), seeded corpus with provenance labels.
- **Success signal**: Known payload variants within the distance threshold are matched; lookup time is negligible compared with file I/O.

**Phase 4: Sandboxed LLM judge**
- **Goal**: Second opinion on flagged/changed files.
- **Scope**: Data-only prompt, no tools, JSON schema, confidence + reasons citing excerpts; daily cap; provider switch (local / Workers AI).
- **Success signal**: Verdicts on all flagged files from the MVP run within budget; schema-valid output 100%.

**Phase 5: Change review**
- **Goal**: Re-review only what changed after updates.
- **Scope**: Approve snapshot, `--diff` mode, optional SessionStart hook warning (read-only, never blocks).
- **Success signal**: A simulated plugin update shows exactly the changed files and their new findings.

**Phase 6: Evasion benchmark & eval**
- **Goal**: Test the key hypothesis.
- **Scope**: Held-out reworded variants (kept local), clean corpus of reviewed plugins, exact-match/regex baseline, per-detector and combined metrics via the shared eval harness; adversarial set for the LLM judge.
- **Success signal**: Report answering the hypothesis (≥ +30 pts recall at ≤ equal FP), including where it fails.

**Phase 7: Disclosure workflow**
- **Goal**: Turn findings into responsible upstream reports.
- **Scope**: Draft generator (component, version/commit, evidence, impact, suggested fix); human validation queue (`draft → validated | rejected` with notes); private submission checklist per channel; tracker (sent date, response, embargo end).
- **Success signal**: A seeded test finding goes draft → validated → ready-to-send with no manual reformatting.

**Phase 8: Public scan & write-up**
- **Goal**: Real-world results.
- **Scope**: Select repos (marketplaces/registries), scan N ≥ 200, validate, disclose privately, publish aggregate results after embargo.
- **Success signal**: N scanned, M validated reports sent, write-up with methodology and limitations.

### Parallelism Notes

Phases 2 and 3 are independent detectors over the Phase 1 inventory. Phase 5 needs only deterministic findings (2), so it can proceed alongside the benchmark (6). Phase 3's SimHash and Phase 4/6's judge and eval should be built as shared modules, because the phishing hunter's Phases 5 and 7 need the same pieces.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Location | Second package in `cronenberg` repo | Separate repo | Shares Unicode detector, SimHash, LLM judge + eval harness |
| Runtime | Local Node CLI | Cloudflare Worker | Scanned code stays local; no 10 ms CPU limit; $0 |
| Positioning | Evasion-tested, whole-plugin (incl. hooks), change review, CycloneDX | Generic skill/MCP scanner | Space is crowded (mcp-scan, SkillSpector, Cisco, Skill Cop); evasion is the documented gap |
| LLM role | Advisory judge on flagged/changed files only | Judge every file | Budget (1,000+ files on own setup) and injection risk |
| Disclosure | Auto draft → human validation → private upstream → tracker | Auto-report; public issues | Owner requirement; avoids false/harmful reports |
| Upstream-report metric | Count of validated reports, no target | Target M | A target would incentivize weak reports |
| Budget | $0 | Paid APIs | Owner constraint (2026-10-02) |

---

## Research Summary

**Market Context**
- MCP scanners: Invariant mcp-scan (tool poisoning, cross-origin escalation, tool pinning against rug pulls) https://invariantlabs.ai/blog/introducing-mcp-scan ; Cisco mcp-scanner https://github.com/cisco-ai-defense/mcp-scanner ; others https://github.com/badchars/mcp-security-scanner , https://github.com/0xelitesystem/mcp-tool-poisoning-scanner
- Skill scanners: NVIDIA SkillSpector https://github.com/nvidia/skillspector ; Skill Cop (Claude Code hooks) https://github.com/cfitzgerald-pd/skillcop
- Prevalence: Snyk ToxicSkills https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/ ; CSA hidden-Unicode note https://labs.cloudsecurityalliance.org/research/csa-research-note-unicode-instruction-injection-ai-skills-20/
- Evasion of existing scanners: https://cybersecuritynews.com/agent-skill-malware-targets-claude-code-and-openai-codex/amp/
- Research: https://arxiv.org/pdf/2602.06547 , https://arxiv.org/pdf/2604.02837 , https://arxiv.org/pdf/2606.00448 , https://arxiv.org/pdf/2608.05223
- AI-BOM: CycloneDX Agent BOM proposal https://github.com/CycloneDX/specification/issues/895

**Technical Context**
- ASCII smuggling (Unicode Tags U+E0000–E007F), now also used for phishing-filter evasion: https://www.microsoft.com/en-us/security/blog/2026/09/03/ascii-smuggling-crosses-over-from-ai-prompt-injection-to-phishing-evasion/ ; https://blogs.cisco.com/ai/understanding-and-mitigating-unicode-tag-prompt-injection
- Local install metadata: `~/.claude/plugins/installed_plugins.json` records `version` and `gitCommitSha` per plugin. Plugins ship `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json`, `skills/`, `agents/`, `commands/`.
- Algorithms: Charikar (2002) SimHash; Manku et al. (2007) block-permutation near-duplicate index; Unicode TR39 for confusables.

---

*Generated: 2026-10-02*
*Status: DRAFT - needs validation*
