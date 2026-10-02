# Gap Analysis: Existing Agent Scanners vs This Scanner

Date: 2026-10-02. **Method: README review only, not verified by running the tools.** Agent Scan was deliberately not run: it connects to MCP servers and its README warns that scanning "can execute commands or make outbound network requests", which conflicts with our static-only rule.

Sources:
- SkillSpector (NVIDIA, Apache-2.0): https://github.com/nvidia/skillspector — README
- Agent Scan, formerly mcp-scan (Invariant Labs, now under Snyk's GitHub org, Apache-2.0): https://github.com/invariantlabs-ai/mcp-scan — README

| Capability | SkillSpector | Agent Scan (mcp-scan) | This scanner | Source / notes |
|---|---|---|---|---|
| Agent skills | ✅ "skill metadata, code" | ✅ "agent tools, skills" | ✅ Phase 1 inventory (307 on the owner's machine) | READMEs |
| MCP servers | ✅ tool descriptions, statically | ✅ by **connecting** to servers | ✅ config inventory, statically (Phase 1); no tool descriptions yet | Agent Scan: "it connects to servers and retrieves tool descriptions" |
| Claude Code plugin **hooks** (`hooks.json`) | ❓ not mentioned | ❓ not mentioned ("Claude Code plugin discovery exists") | ✅ 24 hooks inventoried with event, matcher, interpreter, command hash | **Gap confirmed at doc level only** |
| Whole-plugin inventory (skills + agents + commands + hooks + MCP + npm deps) | ❌ per skill/repo | Partial (auto-discovery) | ✅ one CycloneDX component per plugin | |
| Hidden Unicode | ✅ "Homoglyphs, RTL overrides, mixed-script identifiers in tool metadata" (Unicode tag characters not explicitly listed) | ❓ not mentioned | Phase 2 (tags, zero-width, bidi, variation selectors) | |
| Reworded / paraphrased known payloads | ❌ no similarity matching described | ❓ not described | Phase 3 (SimHash near-duplicates) | Our main differentiator |
| Change review across versions | ❌ (flags unpinned deps only) | Partial: `--storage-file` state, details undocumented; tool pinning per blog | ✅ per-file hashes in snapshot (Phase 1); diff in Phase 5 | |
| Fully offline | Partial (`--no-llm`; OSV lookup falls back to a bundled list) | ❌ uses the Agent Scan API (secrets redacted before sending) | ✅ (Phase 1–3); LLM judge optional in Phase 4 | |
| Executes code / starts servers | ❌ "never executes the scanned skill" | ⚠️ yes, for MCP | ❌ never | |
| LLM | Optional; remote by default (Ollama supported) | Remote API | Phase 4, local or Workers AI free quota | |
| Output | Terminal, JSON, Markdown, SARIF | Human, JSON | CycloneDX 1.7 AI-BOM + snapshot JSON | We don't emit SARIF yet |
| Static analysis depth | ✅ regex, Python AST, YARA | Local checks + API | Phase 2 regex/heuristics; no AST yet | SkillSpector is stronger here today |

## Conclusions

1. **Hooks and whole-plugin inventory are a real gap at the documentation level.** Neither README mentions `hooks.json`. Confirm with a controlled test (a seeded plugin with a malicious hook) before claiming it publicly.
2. **Rewording robustness is uncovered by both.** That supports the PRD's key hypothesis and the Phase 3 / Phase 6 focus.
3. **SkillSpector's static engine (AST, YARA) is stronger than our planned Phase 2.** Running it as an extra signal (PRD "Could") is worth more than re-implementing AST rules.
4. **Only Agent Scan inspects live MCP tool descriptions**, because it connects to servers. Our static-only design can't see tool descriptions that a server generates at runtime. That's a documented limitation, not something to work around in v1.
5. **SARIF output** would make findings usable in GitHub code scanning. Add it in Phase 2 alongside the findings.
