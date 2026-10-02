import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Strings planted in places the scanner must never copy into its output.
export const DECOYS = [
  "DECOY-SECRET-123", // plugin MCP env value
  "DECOY-OAUTH-456", // ~/.claude.json account data
  "decoy-person@example.com",
  "DECOY-ARG-789", // value after --api-key
  "DECOY-QUERY-000", // URL query string
  "DECOY-HISTORY", // ~/.claude.json project data besides mcpServers
  "DECOY-URL", // URL query on a plugin server
  "DECOY-HEADER", // header value
  "DECOY-OUTSIDE", // content behind a symlink
  "pw@mcp.example.com", // URL credentials
];

async function put(file: string, content: string | object): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

const doc = (fields: string, body = "Body.") => `---\n${fields}\n---\n\n${body}\n`;

// Builds a synthetic $HOME with three installed plugins (one missing) and user config.
export async function buildFixtureHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "scanner-fixture-"));
  const claude = path.join(root, ".claude");
  const plugins = path.join(claude, "plugins");
  const alpha = path.join(plugins, "cache", "market", "alpha", "1.0.0");
  const beta = path.join(plugins, "cache", "market", "beta", "0.2.0");

  await put(path.join(plugins, "installed_plugins.json"), {
    version: 2,
    plugins: {
      "alpha@market": [{ scope: "user", installPath: alpha, version: "1.0.0", gitCommitSha: "abc123" }],
      "beta@market": [{ scope: "user", installPath: beta }],
      "ghost@market": [{ scope: "user", installPath: path.join(plugins, "cache", "market", "ghost", "0.1.0") }],
    },
  });

  await put(path.join(alpha, ".claude-plugin", "plugin.json"), {
    name: "alpha",
    version: "1.0.0",
    description: "Alpha test plugin",
    repository: "https://github.com/example/alpha",
    license: "MIT",
    author: { name: "Example Author" },
    skills: ["./extra-skills/", "../../escape"],
    mcpServers: {
      devtools: { command: "npx", args: ["-y", "some-mcp@latest"], env: { API_TOKEN: "DECOY-SECRET-123" } },
    },
  });
  await put(path.join(alpha, "skills", "s1", "SKILL.md"), doc("name: s1\ndescription: First skill"));
  await put(path.join(alpha, "extra-skills", "s2", "SKILL.md"), doc("name: s2\ndescription: Declared skill"));
  await put(path.join(alpha, "agents", "a1.md"), doc("name: a1\ndescription: Shell agent\ntools: Read, Bash"));
  await put(path.join(alpha, "agents", "a2.md"), doc("name: a2\ndescription: Inherits tools"));
  await put(path.join(alpha, "agents", "bad.md"), doc("name: [unclosed\ndescription: broken"));
  await put(path.join(alpha, "commands", "c1.md"), doc("description: A command"));
  await put(path.join(alpha, "hooks", "hooks.json"), {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node -e "process.exit(0)"' }] }],
      Stop: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/stop.sh" }] }],
    },
  });
  await put(path.join(alpha, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "": { name: "alpha" },
      "node_modules/left-pad": {
        version: "1.3.0",
        integrity: `sha512-${Buffer.alloc(64, 7).toString("base64")}`,
      },
      "node_modules/@scope/pkg": { version: "2.0.0", dev: true },
    },
  });
  await put(path.join(root, "outside-secret.txt"), "DECOY-OUTSIDE");
  await symlink(path.join(root, "outside-secret.txt"), path.join(alpha, "link-out"));

  await put(path.join(beta, ".claude-plugin", "plugin.json"), { name: "beta", mcpServers: "./.mcp.json" });
  await put(path.join(beta, ".mcp.json"), {
    mcpServers: {
      remote: {
        type: "http",
        url: "https://user:pw@mcp.example.com/v1?key=DECOY-URL",
        headers: { Authorization: "Bearer DECOY-HEADER" },
      },
    },
  });

  await put(path.join(claude, "settings.json"), {
    enabledPlugins: { "alpha@market": true },
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "bash -c 'echo hello'" }] }] },
  });
  await put(path.join(claude, "skills", "my-skill", "SKILL.md"), doc("name: my-skill\ndescription: User skill"));
  await put(path.join(root, ".claude.json"), {
    oauthAccount: { emailAddress: "decoy-person@example.com", accessToken: "DECOY-OAUTH-456" },
    mcpServers: { local: { command: "uvx", args: ["mcp-local==1.0.0", "--api-key", "DECOY-ARG-789"] } },
    projects: {
      [path.join(root, "proj")]: {
        history: ["DECOY-HISTORY"],
        mcpServers: { projsrv: { type: "http", url: "https://example.com/mcp?token=DECOY-QUERY-000" } },
      },
    },
  });

  return root;
}
