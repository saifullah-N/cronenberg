// Usage: npm run scan -- [--root <dir>] [--project <dir>] [--out <dir>] [--json]
//                        [--include-deps] [--fail-on critical|high|medium|low|info]
// Exit codes: 0 ok, 1 error, 2 findings at or above --fail-on.
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { SCANNER_NAME, SCANNER_VERSION } from "./cyclonedx.ts";
import { isSeverity, SEVERITIES, SEVERITY_RANK } from "./detect/rules.ts";
import { buildSarif } from "./detect/sarif.ts";
import { scan } from "./scan.ts";
import type { Finding, ScanSummary } from "./types.ts";
import { errorMessage } from "./util.ts";
import { validateBom } from "./validate.ts";

const MAX_ERRORS_SHOWN = 10;
const TOP_FINDINGS = 10;

function formatFinding(f: Finding): string {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
  const doc = f.context === "documentation" ? " (documentation)" : "";
  return [
    `  ${f.severity.toUpperCase().padEnd(8)}`,
    f.rule.padEnd(22),
    f.component.padEnd(24),
    where.padEnd(36),
    `${f.message.slice(0, 90)}${doc}`,
  ].join(" ");
}

function formatSummary(s: ScanSummary, findings: readonly Finding[]): string {
  const pairs = (record: Record<string, number>) =>
    Object.entries(record).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const lines = [
    `AI-BOM: ${s.plugins} plugins, ${s.skills} skills, ${s.agents} agents, ${s.commands} commands, ` +
      `${s.hooks} hooks, ${s.mcpServers.length} MCP servers`,
    `Hooks by event: ${pairs(s.hooksByEvent)}`,
    `Hook interpreters: ${pairs(s.hookInterpreters)}`,
    "MCP servers:",
    ...(s.mcpServers.length
      ? s.mcpServers.map((m) =>
          [
            `  ${m.owner} / ${m.name}`.padEnd(44),
            m.transport.padEnd(6),
            m.host ?? m.command ?? "",
            m.pinned === false ? "  UNPINNED" : m.pinned ? "  pinned" : "",
          ].join(" "),
        )
      : ["  none"]),
    `Agents: ${s.agentsWithWriteOrShellTools} can write/edit/run shell; ` +
      `${s.agentsInheritingAllTools} inherit all tools (no \`tools\` list)`,
    `npm packages (from lockfiles): ${s.npmPackages}`,
    `Files hashed: ${s.files}; symlinks recorded, not followed: ${s.symlinks}`,
    "",
    `Findings: ${SEVERITIES.map((sev) => `${s.findings[sev]} ${sev}`).join(", ")}`,
    `  (scanned ${s.textFilesScanned} text files; skipped: ${s.textFilesSkipped.deps} in node_modules, ` +
      `${s.textFilesSkipped.binary} binary, ${s.textFilesSkipped.large} over 2 MB)`,
  ];
  const top = findings.filter((f) => f.severity !== "info").slice(0, TOP_FINDINGS);
  if (top.length) lines.push("Top findings:", ...top.map(formatFinding));
  if (s.missingPlugins.length) lines.push(`Missing plugin directories: ${s.missingPlugins.join(", ")}`);
  if (s.errors.length) {
    lines.push(`Errors (${s.errors.length}):`, ...s.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => `  ${e}`));
    if (s.errors.length > MAX_ERRORS_SHOWN) lines.push(`  … ${s.errors.length - MAX_ERRORS_SHOWN} more in --json output`);
  }
  return lines.join("\n");
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      project: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
      "include-deps": { type: "boolean", default: false },
      "fail-on": { type: "string" },
    },
    strict: true,
  });

  const failOn = values["fail-on"];
  if (failOn !== undefined && !isSeverity(failOn)) {
    console.error(`--fail-on must be one of: ${SEVERITIES.join(", ")}`);
    return 1;
  }

  const result = await scan({
    root: values.root ?? os.homedir(),
    includeDeps: values["include-deps"] ?? false,
    ...(values.project ? { project: values.project } : {}),
  });

  const bomJson = JSON.stringify(result.bom, null, 2);
  const invalid = await validateBom(bomJson);
  if (invalid !== null) {
    console.error("Generated BOM is not valid CycloneDX 1.7:");
    console.error(JSON.stringify(invalid, null, 2));
    return 1;
  }

  const out = path.resolve(values.out ?? "scanner/out");
  await mkdir(out, { recursive: true });
  const written = {
    bom: path.join(out, "aibom.cdx.json"),
    snapshot: path.join(out, "snapshot.json"),
    findings: path.join(out, "findings.json"),
    sarif: path.join(out, "findings.sarif"),
  };
  const sarif = buildSarif(result.findings, result.bases, { name: SCANNER_NAME, version: SCANNER_VERSION });
  await writeFile(written.bom, `${bomJson}\n`);
  await writeFile(written.snapshot, `${JSON.stringify(result.snapshot, null, 2)}\n`);
  await writeFile(written.findings, `${JSON.stringify({ generatedAt: result.snapshot.generatedAt, findings: result.findings }, null, 2)}\n`);
  await writeFile(written.sarif, `${JSON.stringify(sarif, null, 2)}\n`);

  if (values.json) {
    console.log(JSON.stringify(result.summary));
  } else {
    console.log(formatSummary(result.summary, result.findings));
    console.log(`Wrote ${Object.values(written).map((p) => path.relative(process.cwd(), p)).join(", ")}`);
  }

  if (failOn && result.findings.some((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn])) {
    console.error(`Findings at or above "${failOn}" found; exiting with code 2.`);
    return 2;
  }
  return 0;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(errorMessage(err));
  return 1;
});
