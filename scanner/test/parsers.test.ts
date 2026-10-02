import { describe, expect, it } from "vitest";
import { normalizeTools, readFrontmatter } from "../src/components.ts";
import { interpreterOf, parseHooks } from "../src/hooks.ts";
import { isPinned, normalizeServers, redactArgs, safeUrl } from "../src/mcp.ts";
import { npmPurl, parseLockfile, sriToHex } from "../src/npmDeps.ts";

describe("readFrontmatter", () => {
  it("parses YAML frontmatter", () => {
    expect(readFrontmatter("---\nname: x\ntools:\n  - Read\n---\nbody").data).toEqual({ name: "x", tools: ["Read"] });
  });

  it("returns empty data without frontmatter", () => {
    expect(readFrontmatter("# just markdown")).toEqual({ data: {} });
  });

  it("reports invalid YAML instead of throwing", () => {
    const result = readFrontmatter("---\nname: [unclosed\n---\n");
    expect(result.data).toEqual({});
    expect(result.error).toBeTruthy();
  });
});

describe("normalizeTools", () => {
  it("accepts comma strings and lists", () => {
    expect(normalizeTools("Read, Bash ,")).toEqual(["Read", "Bash"]);
    expect(normalizeTools(["Read", " Write "])).toEqual(["Read", "Write"]);
    expect(normalizeTools(undefined)).toBeUndefined();
  });
});

describe("interpreterOf", () => {
  it.each([
    ['node -e "x"', "node -e"],
    ["bash -c 'echo'", "bash -c"],
    ["FOO=1 python3 -c 'x'", "python3 -c"],
    ["npx some-tool", "npx"],
    ["/usr/bin/env bash script.sh", "other"],
    ["${CLAUDE_PLUGIN_ROOT}/hook.sh", "other"],
    ["", "other"],
  ])("%s → %s", (command, expected) => {
    expect(interpreterOf(command)).toBe(expected);
  });
});

describe("parseHooks", () => {
  it("accepts wrapped and bare maps and defaults the matcher", () => {
    const hook = { hooks: [{ type: "command", command: "bash -c x" }] };
    const errors: string[] = [];
    expect(parseHooks({ hooks: { Stop: [hook] } }, "a", errors)).toHaveLength(1);
    expect(parseHooks({ Stop: [hook] }, "b", errors)[0]).toMatchObject({ event: "Stop", matcher: "*", source: "b" });
    expect(errors).toEqual([]);
  });

  it("records malformed events and keeps going", () => {
    const errors: string[] = [];
    expect(parseHooks({ Stop: "nope" }, "x", errors)).toEqual([]);
    expect(errors).toEqual(["x: hooks.Stop is not an array"]);
  });
});

describe("redactArgs", () => {
  it("redacts inline, env-style and following-value secrets", () => {
    expect(redactArgs(["--token=abc", "API_KEY=xyz", "--api-key", "v", "--verbose", "file.txt"])).toEqual([
      "--token=<redacted>",
      "API_KEY=<redacted>",
      "--api-key",
      "<redacted>",
      "--verbose",
      "file.txt",
    ]);
  });

  it("redacts header values and URL query strings passed as separate args", () => {
    expect(
      redactArgs(["--header", "Authorization: Bearer abc", "https://u:p@mcp.example/sse?token=x", "Accept: json"]),
    ).toEqual(["--header", "Authorization: <redacted>", "https://mcp.example/sse", "Accept: json"]);
  });
});

describe("isPinned", () => {
  it.each([
    ["npx", ["-y", "pkg@latest"], false],
    ["npx", ["pkg@1.2.3"], true],
    ["npx", ["@scope/pkg@2.0.0-beta.1"], true],
    ["npx", ["pkg"], false],
    ["uvx", ["tool==1.0.0"], true],
    ["uvx", ["tool"], false],
    ["node", ["server.js"], undefined],
  ] as const)("%s %j → %s", (command, args, expected) => {
    expect(isPinned(command, args)).toBe(expected);
  });
});

describe("safeUrl", () => {
  it("drops credentials and query strings", () => {
    expect(safeUrl("https://u:p@host.example/a/b?token=x#f")).toEqual({ url: "https://host.example/a/b", host: "host.example" });
    expect(safeUrl("not a url")).toEqual({});
  });
});

describe("normalizeServers", () => {
  it("keeps env and header key names only", () => {
    const [server] = normalizeServers(
      { mcpServers: { s: { command: "node", env: { B: "secret", A: "secret" }, headers: { X: "secret" } } } },
      "src",
    );
    expect(server).toEqual({ source: "src", name: "s", transport: "stdio", command: "node", envKeys: ["A", "B"], headerKeys: ["X"] });
    expect(JSON.stringify(server)).not.toContain("secret");
  });
});

describe("npm lockfile", () => {
  it("builds purls, including scoped names", () => {
    expect(npmPurl("@scope/pkg", "1.0.0")).toBe("pkg:npm/%40scope/pkg@1.0.0");
    expect(npmPurl("left-pad", "1.3.0+build")).toBe("pkg:npm/left-pad@1.3.0%2Bbuild");
  });

  it("converts sha512 SRI to hex", () => {
    expect(sriToHex(`sha512-${Buffer.alloc(64, 255).toString("base64")}`)).toBe("ff".repeat(64));
    expect(sriToHex("sha1-abc")).toBeUndefined();
  });

  it("rejects lockfiles without a packages map", () => {
    expect(parseLockfile({ lockfileVersion: 1, dependencies: {} }).error).toMatch(/unsupported/);
  });
});
