import path from "node:path";
import type { McpServer } from "./types.ts";
import { compare, isObject, str } from "./util.ts";

const SECRET_WORD = /(token|key|secret|passw(?:or)?d|auth|credential|cookie)/i;
const FLAG_WITH_VALUE = /^(--?[\w.-]+[=:])(.+)$/;
const ENV_STYLE = /^([A-Za-z_][\w]*=)(.+)$/;
const HEADER_STYLE = /^([A-Za-z][\w-]*:\s*)(.+)$/; // e.g. "Authorization: Bearer x"
const HTTP_ARG = /^https?:\/\//i;
const RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx", "pipx"]);
const NPM_EXACT = /^(@[^/@\s]+\/)?[^@/\s]+@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

// Redacts values that look like credentials: `--token=x`, `API_KEY=x`, `--token x`,
// `--header "Authorization: Bearer x"`, and URL query strings or userinfo.
export function redactArgs(args: readonly string[]): string[] {
  return args.map((arg, i) => {
    if (HTTP_ARG.test(arg)) return safeUrl(arg).url ?? arg;
    const inline = FLAG_WITH_VALUE.exec(arg) ?? ENV_STYLE.exec(arg) ?? HEADER_STYLE.exec(arg);
    if (inline && SECRET_WORD.test(inline[1] ?? "")) return `${inline[1]}<redacted>`;
    const prev = args[i - 1];
    if (prev && /^--?[\w.-]+$/.test(prev) && SECRET_WORD.test(prev) && !arg.startsWith("-")) return "<redacted>";
    return arg;
  });
}

// Keeps scheme, host and path. Query strings and credentials can carry secrets.
export function safeUrl(raw: string): { url?: string; host?: string } {
  try {
    const u = new URL(raw);
    return { url: `${u.protocol}//${u.host}${u.pathname}`, host: u.host };
  } catch {
    return {};
  }
}

// true/false only for package runners; undefined when not applicable.
export function isPinned(command: string | undefined, args: readonly string[] | undefined): boolean | undefined {
  if (!command) return undefined;
  const exe = path.basename(command);
  if (!RUNNERS.has(exe)) return undefined;
  const positional = (args ?? []).filter((a) => !a.startsWith("-"));
  const pkg = exe === "pipx" && positional[0] === "run" ? positional[1] : positional[0];
  if (!pkg) return false;
  if (exe === "uvx" || exe === "pipx") return /==\d/.test(pkg) || /@\d/.test(pkg);
  return NPM_EXACT.test(pkg);
}

// Accepts `{ mcpServers: {...} }` or a bare server map. Builds each record field by
// field so env/header values can never be copied into the output.
export function normalizeServers(value: unknown, source: string): McpServer[] {
  const map = isObject(value) && isObject(value.mcpServers) ? value.mcpServers : isObject(value) ? value : {};
  const out: McpServer[] = [];
  for (const [name, raw] of Object.entries(map)) {
    if (!isObject(raw)) continue;
    const command = str(raw.command);
    const args = Array.isArray(raw.args) ? redactArgs(raw.args.map(String)) : undefined;
    const { url, host } = typeof raw.url === "string" ? safeUrl(raw.url) : {};
    const server: McpServer = {
      source,
      name,
      transport: str(raw.type) ?? (typeof raw.url === "string" ? "http" : "stdio"),
      envKeys: isObject(raw.env) ? Object.keys(raw.env).sort(compare) : [],
      headerKeys: isObject(raw.headers) ? Object.keys(raw.headers).sort(compare) : [],
    };
    if (command) server.command = command;
    if (args) server.args = args;
    if (url) server.url = url;
    if (host) server.urlHost = host;
    const pinned = isPinned(command, args);
    if (pinned !== undefined) server.pinned = pinned;
    out.push(server);
  }
  return out.sort((a, b) => compare(a.name, b.name));
}
