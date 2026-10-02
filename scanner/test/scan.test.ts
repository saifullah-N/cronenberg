import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSarif } from "../src/detect/sarif.ts";
import { scan, type ScanResult } from "../src/scan.ts";
import { validateBom } from "../src/validate.ts";
import { buildFixtureHome, DECOYS } from "./fixture.ts";

const fixed = { now: () => new Date("2026-10-02T00:00:00.000Z"), randomUUID: () => "00000000-0000-4000-8000-000000000000" };

function allRefs(bom: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const visit = (items: unknown) => {
    for (const c of (items as Array<Record<string, unknown>> | undefined) ?? []) {
      refs.push(c["bom-ref"] as string);
      visit(c.components);
    }
  };
  visit(bom.components);
  visit(bom.services);
  return refs;
}

describe("scan (fixture home)", () => {
  let root: string;
  let result: ScanResult;
  let output: string;

  beforeAll(async () => {
    root = await buildFixtureHome();
    result = await scan({ root, ...fixed });
    const sarif = buildSarif(result.findings, result.bases, { name: "t", version: "0" });
    output = JSON.stringify([result.bom, result.snapshot, result.summary, result.findings, sarif]);
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("inventories plugins, user config and their components", () => {
    const s = result.summary;
    expect(s.plugins).toBe(3);
    expect(s.skills).toBe(3); // s1, declared s2, user my-skill
    expect(s.agents).toBe(3);
    expect(s.commands).toBe(1);
    expect(s.hooks).toBe(3);
    expect(s.hookInterpreters).toEqual({ "bash -c": 1, "node -e": 1, other: 1 });
    expect(s.missingPlugins).toEqual(["ghost@market"]);
    expect(s.agentsWithWriteOrShellTools).toBe(1);
    expect(s.agentsInheritingAllTools).toBe(2);
    expect(s.npmPackages).toBe(2);
  });

  it("records MCP servers with pinning and without secrets", () => {
    const byName = Object.fromEntries(result.summary.mcpServers.map((m) => [m.name, m]));
    expect(Object.keys(byName).sort()).toEqual(["devtools", "local", "projsrv", "remote"]);
    expect(byName.devtools).toMatchObject({ owner: "alpha@market", transport: "stdio", pinned: false });
    expect(byName.local).toMatchObject({ owner: "user-config", pinned: true });
    expect(byName.remote).toMatchObject({ owner: "beta@market", transport: "http", host: "mcp.example.com" });
  });

  it("never copies secret values, account data or the local root path", () => {
    for (const decoy of DECOYS) expect(output).not.toContain(decoy);
    expect(output).not.toContain(root);
    expect(output).toContain("API_TOKEN"); // key names are kept
    expect(output).toContain("--api-key <redacted>");
  });

  it("records symlinks without following them", () => {
    const alpha = result.snapshot.components["plugin:alpha@market"];
    expect(alpha?.files).toContainEqual({ path: "link-out", symlink: true });
    expect(result.summary.symlinks).toBe(1);
  });

  it("rejects manifest paths that escape the plugin and keeps scanning", () => {
    expect(result.summary.errors.some((e) => e.includes('"../../escape" points outside the plugin'))).toBe(true);
    expect(result.summary.skills).toBe(3);
  });

  it("emits schema-valid CycloneDX 1.7 with unique bom-refs", async () => {
    expect(await validateBom(JSON.stringify(result.bom))).toBeNull();
    const refs = allRefs(result.bom);
    expect(new Set(refs).size).toBe(refs.length);
    const services = result.bom.services as Array<Record<string, unknown>>;
    expect(services.map((s) => s.endpoints)).toContainEqual(["https://mcp.example.com/v1"]);
  });

  it("reports content findings with locations, doc context and escalation rules applied", () => {
    const at = (rule: string, file: string) =>
      result.findings.find((f) => f.rule === rule && f.component === "plugin:alpha@market" && f.file === file);
    expect(at("unicode-tags", "skills/s1/SKILL.md")).toMatchObject({ severity: "critical", line: 6 });
    expect(at("unicode-tags", "skills/s1/SKILL.md")?.message).toContain('hidden text: "HIDDEN TEST PAYLOAD"');
    expect(at("concealment", "skills/s1/SKILL.md")).toMatchObject({ severity: "medium" });
    expect(at("fetch-and-run", "scripts/install.sh")).toMatchObject({ severity: "high", line: 2 });
    expect(at("concealment", "docs/security-guide.md")).toMatchObject({ severity: "low", context: "documentation" });
    expect(result.findings.some((f) => f.file?.includes("node_modules"))).toBe(false);
    expect(result.summary.textFilesSkipped.deps).toBeGreaterThan(0);
  });

  it("reports capability findings from the inventory", () => {
    const count = (rule: string) => result.findings.filter((f) => f.rule === rule).length;
    expect(count("hook-command")).toBe(3); // alpha ×2 + user settings
    expect(count("mcp-unpinned")).toBe(1); // devtools via npx …@latest
    expect(count("mcp-remote")).toBe(2); // beta remote + user project server
    expect(count("agent-shell")).toBe(1); // a1
    expect(result.summary.findings.critical).toBe(1);
  });

  it("scans node_modules only with includeDeps", async () => {
    const withDeps = await scan({ root, ...fixed, includeDeps: true });
    const dep = withDeps.findings.find((f) => f.file === "node_modules/evil/index.js");
    expect(dep).toMatchObject({ rule: "fetch-and-run", severity: "high" });
  });

  it("skips detection when asked", async () => {
    const inventoryOnly = await scan({ root, ...fixed, detect: false });
    expect(inventoryOnly.findings).toEqual([]);
    expect(inventoryOnly.summary.textFilesScanned).toBe(0);
  });

  it("is deterministic for a fixed clock and serial number", async () => {
    const again = await scan({ root, ...fixed });
    expect(JSON.stringify(again.bom)).toBe(JSON.stringify(result.bom));
    expect(JSON.stringify(again.snapshot)).toBe(JSON.stringify(result.snapshot));
  });
});

describe("scan (empty home)", () => {
  it("produces a valid, empty BOM and explains why", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "scanner-empty-"));
    try {
      const result = await scan({ root, ...fixed });
      expect(result.summary.plugins).toBe(0);
      expect(result.summary.errors).toContain("installed_plugins.json not found; no plugins scanned");
      expect(await validateBom(JSON.stringify(result.bom))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
