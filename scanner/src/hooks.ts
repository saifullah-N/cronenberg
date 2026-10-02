import path from "node:path";
import type { HookEntry } from "./types.ts";
import { isObject, sha256Hex } from "./util.ts";

const KNOWN = new Set([
  "node", "bun", "deno", "bash", "sh", "zsh", "python", "python3",
  "npx", "bunx", "uvx", "pipx", "pwsh", "powershell", "ruby", "perl",
]);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Best-effort label for what a hook command runs, e.g. "node -e", "bash -c", "npx", "other".
export function interpreterOf(command: string): string {
  const tokens = command.trim().split(/\s+/);
  while (tokens.length && ENV_ASSIGNMENT.test(tokens[0] ?? "")) tokens.shift();
  const first = tokens[0];
  if (!first) return "other";
  const exe = path.basename(first.replace(/^["']|["']$/g, ""));
  if (!KNOWN.has(exe)) return "other";
  const flag = tokens[1];
  if (["node", "bun", "deno"].includes(exe) && ["-e", "--eval", "-p", "--print"].includes(flag ?? "")) {
    return `${exe} -e`;
  }
  if (["bash", "sh", "zsh", "python", "python3"].includes(exe) && flag === "-c") return `${exe} -c`;
  return exe;
}

// Accepts `{ hooks: { Event: [...] } }` or the bare `{ Event: [...] }` map.
export function parseHooks(value: unknown, source: string, errors: string[]): HookEntry[] {
  const root = isObject(value) && isObject(value.hooks) ? value.hooks : value;
  if (!isObject(root)) {
    if (value !== undefined) errors.push(`${source}: hooks is not an object`);
    return [];
  }

  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(root)) {
    if (!Array.isArray(groups)) {
      errors.push(`${source}: hooks.${event} is not an array`);
      continue;
    }
    for (const group of groups) {
      if (!isObject(group)) continue;
      const matcher = typeof group.matcher === "string" && group.matcher ? group.matcher : "*";
      for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
        if (!isObject(hook)) continue;
        const type = typeof hook.type === "string" ? hook.type : "command";
        const text =
          typeof hook.command === "string" ? hook.command : typeof hook.prompt === "string" ? hook.prompt : "";
        out.push({
          source,
          event,
          matcher,
          type,
          interpreter: type === "command" && text ? interpreterOf(text) : "none",
          commandSha256: sha256Hex(text),
          commandLength: text.length,
        });
      }
    }
  }
  return out;
}
