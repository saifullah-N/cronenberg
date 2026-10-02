import path from "node:path";
import type { Severity } from "../types.ts";

export type PatternRule = "fetch-and-run" | "obfuscated-payload" | "exfiltration" | "concealment";

export interface PatternMatch {
  rule: PatternRule;
  severity: Severity;
  offset: number;
  length: number;
  message: string;
  quoted?: boolean; // match sits inside quotes, e.g. an example being warned about
}

// A URL or hostname must appear, so prose like "reject `curl … | sh`" doesn't match.
const TARGET = String.raw`(?:https?:\/\/|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b)`;

// Bounded quantifiers throughout to avoid catastrophic backtracking on large files.
const FETCH_AND_RUN = [
  new RegExp(String.raw`\b(?:curl|wget)\b(?=[^\n|]{0,300}?${TARGET})[^\n|]{0,300}\|\s{0,5}(?:sudo\s+)?(?:ba|z|da|k)?sh\b`, "gi"),
  new RegExp(String.raw`\b(?:bash|sh|zsh)\s+<\(\s{0,5}(?:curl|wget)\b(?=[^)\n]{0,300}?${TARGET})`, "gi"),
  new RegExp(String.raw`\b(?:eval|source)\s+"?\$\(\s{0,5}(?:curl|wget)\b(?=[^)\n]{0,300}?${TARGET})`, "gi"),
  /\b(?:iex|Invoke-Expression)\b(?=[^\n]{0,300}https?:\/\/)[^\n]{0,200}\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b/gi,
  /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b(?=[^\n|]{0,300}https?:\/\/)[^\n|]{0,300}\|\s{0,5}(?:iex|Invoke-Expression)\b/gi,
  // python -c that fetches *and* executes; a plain urlopen (e.g. a healthcheck) only fetches.
  /\bpython3?\s+-c\s+["'](?=[^\n]{0,400}\burlopen\b)(?=[^\n]{0,400}\b(?:exec|eval)\s*\()[^\n]{0,400}/gi,
];

const QUOTES = new Set(['"', "'", "`", "\u{201C}", "\u{2018}"]);
const CITATION_CUE = /(?:e\.g\.|i\.e\.|such as|for example|example:|like|says?|writes?|:)\s*$/i;

// True when the match is in quotes right after a citation cue, e.g. `(e.g. "ignore previous
// instructions")`. A bare quoted string in code is not enough: it may be the payload itself.
function isCited(text: string, offset: number): boolean {
  const quoteAt = text[offset - 1] === " " ? offset - 2 : offset - 1;
  if (!QUOTES.has(text[quoteAt] ?? "")) return false;
  return CITATION_CUE.test(text.slice(Math.max(0, quoteAt - 20), quoteAt));
}

const LOWER: Record<Severity, Severity> = { critical: "high", high: "medium", medium: "low", low: "info", info: "info" };

const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}/g;
const DECODE_OR_EXEC =
  /\batob\s*\(|Buffer\.from\([^)]{0,200}['"]base64['"]|\bb64decode\b|\bbase64\s+(?:-d|--decode)\b|\beval\s*\(|\bnew\s+Function\s*\(|(?<![.\w])exec\s*\(/;
const ESCAPE_RUNS = [/(?:\\x[0-9a-fA-F]{2}){40,}/g, /(?:\\u[0-9a-fA-F]{4}){40,}/g];
const LOCKFILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "npm-shrinkwrap.json"]);

const SINKS = [
  /\bfetch\s*\(/g,
  /\baxios\b/g,
  /\bXMLHttpRequest\b/g,
  /\brequests\.(?:post|get|put)\s*\(/g,
  /\burlopen\s*\(/g,
  /\bhttps?\.request\s*\(/g,
  /\bcurl\b[^\n]{0,200}\s(?:-d|--data(?:-binary|-raw|-urlencode)?|-F|--form|--upload-file|-T)\b/g,
  /\bwget\b[^\n]{0,200}--post-(?:data|file)\b/g,
  /\/dev\/tcp\//g,
];
// Credential stores and bulk environment dumps. Reading one named variable for an API
// call (process.env.API_TOKEN) is normal and deliberately not a source.
const SOURCES = [
  /JSON\.stringify\(\s*process\.env\s*\)/,
  /Object\.(?:entries|keys|values)\(\s*process\.env\s*\)/,
  /\.\.\.process\.env\b/,
  /\bdict\(\s*os\.environ\s*\)|\bos\.environ\.copy\(\)|json\.dumps\(\s*(?:dict\()?\s*os\.environ/,
  /\bprintenv\b(?![ \t]+[A-Za-z_])/,
  /\benv\s*\|/,
  /\.ssh\/(?:id_|authorized_keys|config\b)|(?:~|\$HOME|homedir\(\))[^\n]{0,20}\.ssh\b/,
  /\bid_(?:rsa|ed25519|ecdsa)\b/,
  /\.aws\/credentials\b/,
  /\.npmrc\b/,
  /\.netrc\b/,
  /\.git-credentials\b/,
  /\bsecurity\s+find-(?:generic|internet)-password\b/,
  /\.claude\.json\b|\.claude\/\.credentials/,
  /\bLogin Data\b|Cookies\.binarycookies|cookies\.sqlite/,
];
const PROXIMITY_LINES = 5;

// Text from `lines` lines before the offset to `lines` lines after it.
function windowAround(text: string, offset: number, lines: number): string {
  let start = offset;
  for (let i = 0; i <= lines && start > 0; i++) start = text.lastIndexOf("\n", start - 1);
  let end = offset;
  for (let i = 0; i <= lines && end !== -1; i++) end = text.indexOf("\n", end + 1);
  return text.slice(Math.max(0, start), end === -1 ? text.length : end);
}

const CONCEALMENT = [
  /\b(?:do\s+not|don't|never)\s+(?:tell|mention|inform|reveal|show)\s+(?:this\s+)?(?:to\s+)?the\s+user\b/gi,
  /\bwithout\s+(?:telling|informing|notifying)\s+the\s+user\b/gi,
  /\b(?:hide|conceal)\s+(?:this|it)\s+from\s+the\s+user\b/gi,
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/gi,
  /\b(?:silently|secretly)\s+(?:run|execute|send|upload|copy)\b/gi,
];

function* allMatches(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

export function fetchAndRun(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const pattern of FETCH_AND_RUN) {
    for (const m of allMatches(pattern, text)) {
      out.push({
        rule: "fetch-and-run",
        severity: "high",
        offset: m.index,
        length: m[0].length,
        message: "Downloads code and executes it immediately",
      });
    }
  }
  return out;
}

export function obfuscation(text: string, file: string): PatternMatch[] {
  const base = path.posix.basename(file);
  if (LOCKFILES.has(base) || base.endsWith(".map")) return [];
  const out: PatternMatch[] = [];
  const decodesOrExecutes = DECODE_OR_EXEC.test(text);
  for (const m of allMatches(BASE64_RUN, text)) {
    if (/^[0-9a-fA-F]+$/.test(m[0])) continue; // long hex hashes, not base64 payloads
    if (text.slice(Math.max(0, m.index - 60), m.index).includes("base64,")) continue; // data: URI
    out.push({
      rule: "obfuscated-payload",
      severity: decodesOrExecutes ? "high" : "low",
      offset: m.index,
      length: m[0].length,
      message: decodesOrExecutes
        ? `Encoded blob (${m[0].length} chars) in a file that decodes or evaluates code`
        : `Long encoded blob (${m[0].length} chars)`,
    });
  }
  for (const pattern of ESCAPE_RUNS) {
    for (const m of allMatches(pattern, text)) {
      out.push({
        rule: "obfuscated-payload",
        severity: "medium",
        offset: m.index,
        length: m[0].length,
        message: "Long run of escaped characters hides readable text",
      });
    }
  }
  return out;
}

// A network call within a few lines of a credential store or bulk environment read.
export function exfiltration(text: string): PatternMatch[] {
  if (!SOURCES.some((re) => re.test(text))) return [];
  const out: PatternMatch[] = [];
  for (const pattern of SINKS) {
    for (const m of allMatches(pattern, text)) {
      const nearby = windowAround(text, m.index, PROXIMITY_LINES);
      const source = SOURCES.map((re) => re.exec(nearby)?.[0]).find((s) => s !== undefined);
      if (!source) continue;
      out.push({
        rule: "exfiltration",
        severity: "high",
        offset: m.index,
        length: m[0].length,
        message: `Network call within ${PROXIMITY_LINES} lines of \`${source}\``,
      });
    }
  }
  return out;
}

export function concealment(text: string): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const pattern of CONCEALMENT) {
    for (const m of allMatches(pattern, text)) {
      const quoted = isCited(text, m.index);
      out.push({
        rule: "concealment",
        severity: quoted ? LOWER.medium : "medium",
        offset: m.index,
        length: m[0].length,
        message: `Instruction to hide actions or override instructions: "${m[0]}"${quoted ? " (cited as an example)" : ""}`,
        ...(quoted ? { quoted } : {}),
      });
    }
  }
  return out;
}
