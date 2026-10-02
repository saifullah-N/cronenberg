import type { Finding, RuleId, Severity } from "../types.ts";
import { compare, errorMessage, mapLimit } from "../util.ts";
import { capabilityFindings } from "./capabilities.ts";
import { lineIndex, locate, sanitizeEvidence, snippetAround } from "./location.ts";
import { concealment, exfiltration, fetchAndRun, obfuscation } from "./patterns.ts";
import { SEVERITIES, SEVERITY_RANK } from "./rules.ts";
import { readTextFile, selectFiles, type DetectTarget, type FileContext, type SkipCounts } from "./textFiles.ts";
import { findHiddenUnicode, type UnicodeMatch } from "./unicode.ts";

export type { DetectTarget } from "./textFiles.ts";

const READ_CONCURRENCY = 16;
const PER_RULE_CAP = 50;
const NEVER_DOWNGRADE = new Set<RuleId>(["unicode-tags", "bidi-control"]);
const ESCALATORS = new Set<RuleId>(["fetch-and-run", "exfiltration"]);

const UNICODE_SEVERITY: Record<UnicodeMatch["rule"], Severity> = {
  "unicode-tags": "critical",
  "bidi-control": "high",
  "variation-selector-supplement": "high",
  "variation-selector-run": "medium",
  "zero-width": "medium",
  "zero-width-joiner": "medium",
  "invisible-operator": "medium",
};

interface RawMatch {
  rule: RuleId;
  severity: Severity;
  offset: number;
  length: number;
  message: string;
  quoted?: boolean;
}

function unicodeMessage(m: UnicodeMatch): string {
  switch (m.rule) {
    case "unicode-tags":
      return `Hidden Unicode tag characters (${m.count}); hidden text: "${(m.decoded ?? "").replace(/\s+/g, " ").slice(0, 120)}"`;
    case "bidi-control":
      return `Bidirectional control character(s) (${m.count}) can reorder displayed text (Trojan Source)`;
    case "variation-selector-supplement":
      return `Supplementary variation selectors (${m.count}) can encode hidden data`;
    case "variation-selector-run":
      return `Unexpected variation selector(s) (${m.count})`;
    case "zero-width":
      return `Zero-width character(s) (${m.count})`;
    case "zero-width-joiner":
      return "Zero-width joiner outside an emoji or joining-script sequence";
    case "invisible-operator":
      return `Invisible operator or filler character(s) (${m.count})`;
  }
}

function downgrade(severity: Severity): Severity {
  return SEVERITIES[Math.min(SEVERITY_RANK[severity] + 1, SEVERITIES.length - 1)] ?? "info";
}

// All content rules for one file, with caps, escalation and the documentation downgrade.
export function detectFile(ctx: FileContext): Finding[] {
  const raw: RawMatch[] = [
    ...findHiddenUnicode(ctx.text).map((m) => ({
      rule: m.rule,
      severity: UNICODE_SEVERITY[m.rule],
      offset: m.offset,
      length: m.length,
      message: unicodeMessage(m),
    })),
    ...fetchAndRun(ctx.text),
    ...obfuscation(ctx.text, ctx.path),
    ...exfiltration(ctx.text),
    ...concealment(ctx.text),
  ];
  if (!raw.length) return [];

  raw.sort((a, b) => a.offset - b.offset);
  const perRule = new Map<RuleId, number>();
  const kept: RawMatch[] = [];
  for (const m of raw) {
    const n = (perRule.get(m.rule) ?? 0) + 1;
    perRule.set(m.rule, n);
    if (n <= PER_RULE_CAP) kept.push(m);
  }

  const escalators = [...new Set(kept.map((m) => m.rule).filter((r) => ESCALATORS.has(r)))];
  const starts = lineIndex(ctx.text);
  const findings: Finding[] = kept.map((m) => {
    const finding: Finding = {
      rule: m.rule,
      severity: m.severity,
      component: ctx.component,
      file: ctx.path,
      ...locate(starts, m.offset),
      message: m.message,
      evidence: sanitizeEvidence(snippetAround(ctx.text, m.offset, m.length)),
    };
    // A quoted phrase is being cited (e.g. in a warning), so it doesn't escalate.
    if (m.rule === "concealment" && escalators.length && !m.quoted) {
      finding.severity = "high";
      finding.escalatedBy = escalators;
    }
    if (ctx.context && !NEVER_DOWNGRADE.has(m.rule)) {
      finding.severity = downgrade(finding.severity);
      finding.context = ctx.context;
    }
    return finding;
  });

  for (const [rule, n] of perRule) {
    if (n > PER_RULE_CAP) {
      findings.push({
        rule: "truncated",
        severity: "info",
        component: ctx.component,
        file: ctx.path,
        message: `${rule}: ${n - PER_RULE_CAP} more matches not listed`,
      });
    }
  }
  return findings;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compare(a.component, b.component) ||
      compare(a.file ?? "", b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      compare(a.rule, b.rule),
  );
}

export interface DetectResult {
  findings: Finding[];
  textFilesScanned: number;
  skipped: SkipCounts;
  errors: string[];
}

// Static only: reads already-inventoried regular files; never executes or follows symlinks.
export async function runDetectors(targets: readonly DetectTarget[], opts: { includeDeps?: boolean } = {}): Promise<DetectResult> {
  const skipped: SkipCounts = { binary: 0, large: 0, deps: 0 };
  const errors: string[] = [];
  const candidates = targets.flatMap((t) => selectFiles(t, opts.includeDeps ?? false, skipped));
  let scanned = 0;

  const perFile = await mapLimit(candidates, READ_CONCURRENCY, async (c): Promise<Finding[]> => {
    try {
      const { ctx, skip } = await readTextFile(c);
      if (skip === "binary" || skip === "large") skipped[skip]++;
      if (!ctx) return [];
      scanned++;
      return detectFile(ctx);
    } catch (err) {
      errors.push(`${c.component}: ${c.path}: ${errorMessage(err)}`);
      return [];
    }
  });

  const findings = [...perFile.flat(), ...targets.flatMap(capabilityFindings)];
  return { findings: sortFindings(findings), textFilesScanned: scanned, skipped, errors };
}
