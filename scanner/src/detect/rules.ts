import type { RuleId, Severity } from "../types.ts";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

const COLUMN_NOTE = " Columns count UTF-16 code units.";

export const RULES: Record<RuleId, { title: string; help: string }> = {
  "unicode-tags": {
    title: "Hidden Unicode tag characters",
    help: "Unicode Tags (U+E0000–E007F) are invisible but mirror ASCII; models read them (ASCII smuggling)." + COLUMN_NOTE,
  },
  "bidi-control": {
    title: "Bidirectional control characters",
    help: "Bidi controls reorder how text is displayed, so reviewers see something different from what runs (Trojan Source, CVE-2021-42574)." + COLUMN_NOTE,
  },
  "variation-selector-supplement": {
    title: "Supplementary variation selectors",
    help: "U+E0100–E01EF are invisible and can encode arbitrary bytes after an innocent character." + COLUMN_NOTE,
  },
  "variation-selector-run": {
    title: "Unexpected variation selectors",
    help: "Variation selectors outside a normal emoji presentation sequence." + COLUMN_NOTE,
  },
  "zero-width": {
    title: "Zero-width characters",
    help: "Invisible characters that can split or hide words." + COLUMN_NOTE,
  },
  "zero-width-joiner": {
    title: "Zero-width joiner outside emoji or joining scripts",
    help: "ZWJ is legitimate inside emoji sequences and some scripts; elsewhere it can hide or split words." + COLUMN_NOTE,
  },
  "invisible-operator": {
    title: "Invisible operators or filler characters",
    help: "Invisible math operators and Hangul fillers render as nothing." + COLUMN_NOTE,
  },
  "fetch-and-run": {
    title: "Download-and-execute command",
    help: "Downloads code and runs it immediately (e.g. curl … | sh), so the executed code is never reviewed.",
  },
  "obfuscated-payload": {
    title: "Obfuscated payload",
    help: "Long encoded blobs, especially next to decode/eval calls, hide what code does.",
  },
  exfiltration: {
    title: "Possible data exfiltration",
    help: "A network call in a file that also reads secrets or credentials.",
  },
  concealment: {
    title: "Concealment or override instruction",
    help: "Text telling the agent to hide actions from the user or ignore its instructions.",
  },
  "hook-command": {
    title: "Hook runs a command",
    help: "Hooks run shell commands automatically on agent lifecycle events.",
  },
  "hook-all-tools": {
    title: "Hook runs on every tool call",
    help: "A tool hook with a match-all matcher sees every tool call the agent makes.",
  },
  "hook-package-runner": {
    title: "Hook downloads and runs a package",
    help: "npx/uvx-style runners fetch code at run time, so it can change without the plugin changing.",
  },
  "mcp-unpinned": {
    title: "MCP server without a pinned version",
    help: "The server package is resolved at launch time; a new release runs without review.",
  },
  "mcp-remote": {
    title: "Remote MCP server",
    help: "Tool calls and their data cross a trust boundary to a remote service.",
  },
  "agent-shell": {
    title: "Agent can run shell commands",
    help: "The agent definition grants a shell tool.",
  },
  truncated: {
    title: "Findings truncated",
    help: "A rule matched too many times in one file; only the first matches are listed.",
  },
};
