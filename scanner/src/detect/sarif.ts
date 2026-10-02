import { pathToFileURL } from "node:url";
import type { Finding, RuleId, Severity } from "../types.ts";
import { compare } from "../util.ts";
import { RULES } from "./rules.ts";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

type Json = Record<string, unknown>;

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

// `bases` maps a component bom-ref to its directory in "~/…" form (or an absolute path).
function artifactLocation(base: string | undefined, file: string): Json {
  if (base === "~") return { uri: encodePath(file), uriBaseId: "HOME" };
  if (base?.startsWith("~/")) return { uri: encodePath(`${base.slice(2)}/${file}`), uriBaseId: "HOME" };
  if (base) return { uri: pathToFileURL(`${base}/${file}`).href };
  return { uri: encodePath(file) };
}

export function buildSarif(
  findings: readonly Finding[],
  bases: Readonly<Record<string, string>>,
  tool: { name: string; version: string },
): Json {
  const ruleIds = [...new Set(findings.map((f) => f.rule))].sort(compare) as RuleId[];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: tool.name,
            version: tool.version,
            rules: ruleIds.map((id) => ({
              id,
              shortDescription: { text: RULES[id].title },
              help: { text: RULES[id].help },
            })),
          },
        },
        originalUriBaseIds: { HOME: { description: { text: "user home directory" } } },
        results: findings.map((f) => {
          const result: Json = {
            ruleId: f.rule,
            level: LEVEL[f.severity],
            message: { text: f.evidence ? `${f.message} — ${f.evidence}` : f.message },
            properties: {
              severity: f.severity,
              component: f.component,
              ...(f.context ? { context: f.context } : {}),
              ...(f.escalatedBy ? { escalatedBy: f.escalatedBy } : {}),
            },
          };
          if (f.file) {
            const physicalLocation: Json = { artifactLocation: artifactLocation(bases[f.component], f.file) };
            if (f.line) physicalLocation.region = { startLine: f.line, startColumn: Math.max(1, f.column ?? 1) };
            result.locations = [{ physicalLocation }];
          }
          return result;
        }),
      },
    ],
  };
}
