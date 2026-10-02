// Usage: npm run scan -- [--root <dir>] [--project <dir>] [--out <dir>] [--json]
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { scan } from "./scan.ts";
import type { ScanSummary } from "./types.ts";
import { errorMessage } from "./util.ts";
import { validateBom } from "./validate.ts";

const MAX_ERRORS_SHOWN = 10;

function formatSummary(s: ScanSummary): string {
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
  ];
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
    },
    strict: true,
  });

  const result = await scan({
    root: values.root ?? os.homedir(),
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
  const bomPath = path.join(out, "aibom.cdx.json");
  const snapshotPath = path.join(out, "snapshot.json");
  await writeFile(bomPath, `${bomJson}\n`);
  await writeFile(snapshotPath, `${JSON.stringify(result.snapshot, null, 2)}\n`);

  if (values.json) {
    console.log(JSON.stringify(result.summary));
  } else {
    console.log(formatSummary(result.summary));
    console.log(`Wrote ${path.relative(process.cwd(), bomPath)} (CycloneDX 1.7, valid) and ${path.relative(process.cwd(), snapshotPath)}`);
  }
  return 0;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(errorMessage(err));
  return 1;
});
