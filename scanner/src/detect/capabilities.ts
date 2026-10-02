import type { Finding } from "../types.ts";
import type { DetectTarget } from "./textFiles.ts";

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);
const MATCH_ALL = new Set(["*", ".*", ""]);
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "uvx", "pipx"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

// Maps an inventory `source` label to a path relative to the component root.
function sourceFile(source: string, isPlugin: boolean): string | undefined {
  if (source === "plugin.json") return ".claude-plugin/plugin.json";
  if (source.startsWith(".claude/")) return source.slice(".claude/".length); // project settings
  if (!isPlugin && source.startsWith(".claude.json")) return undefined; // lives outside the scanned dir
  if (!isPlugin && source === ".mcp.json") return undefined; // project root, outside .claude/
  return source;
}

function withFile(finding: Finding, file: string | undefined): Finding {
  return file ? { ...finding, file } : finding;
}

// Findings derived from the inventory (what components can do), not from file contents.
export function capabilityFindings(target: DetectTarget): Finding[] {
  const isPlugin = target.ref.startsWith("plugin:");
  const out: Finding[] = [];

  for (const hook of target.hooks) {
    if (hook.type !== "command") continue;
    const file = sourceFile(hook.source, isPlugin);
    const base = { component: target.ref };
    out.push(
      withFile(
        {
          ...base,
          rule: "hook-command",
          severity: "info",
          message: `${hook.event} hook (matcher ${hook.matcher}) runs \`${hook.interpreter}\` (${hook.commandLength} chars)`,
        },
        file,
      ),
    );
    if (TOOL_EVENTS.has(hook.event) && MATCH_ALL.has(hook.matcher)) {
      out.push(
        withFile({ ...base, rule: "hook-all-tools", severity: "low", message: `${hook.event} hook runs on every tool call` }, file),
      );
    }
    if (PACKAGE_RUNNERS.has(hook.interpreter)) {
      out.push(
        withFile(
          {
            ...base,
            rule: "hook-package-runner",
            severity: "medium",
            message: `${hook.event} hook downloads and runs a package with \`${hook.interpreter}\``,
          },
          file,
        ),
      );
    }
  }

  for (const server of target.mcpServers) {
    const file = sourceFile(server.source, isPlugin);
    if (server.pinned === false) {
      out.push(
        withFile(
          {
            component: target.ref,
            rule: "mcp-unpinned",
            severity: "medium",
            message: `MCP server "${server.name}" runs \`${[server.command, ...(server.args ?? [])].join(" ")}\` without a pinned version`,
          },
          file,
        ),
      );
    }
    if (server.transport !== "stdio") {
      out.push(
        withFile(
          {
            component: target.ref,
            rule: "mcp-remote",
            severity: "info",
            message: `MCP server "${server.name}" connects to ${server.urlHost ?? "a remote service"} (${server.transport})`,
          },
          file,
        ),
      );
    }
  }

  for (const agent of target.agents) {
    const shells = (agent.tools ?? []).filter((t) => SHELL_TOOLS.has(t.split("(")[0]?.trim() ?? ""));
    if (shells.length) {
      out.push({
        component: target.ref,
        rule: "agent-shell",
        severity: "info",
        file: agent.path,
        message: `Agent "${agent.name}" can run shell commands (${shells.join(", ")})`,
      });
    }
  }
  return out;
}
