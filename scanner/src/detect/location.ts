const MAX_EVIDENCE = 160;
const CONTEXT_PAD = 40;
// Format characters (incl. tags, bidi, zero-width), variation selectors and fillers.
const INVISIBLE = /[\p{Cf}\u{180B}-\u{180F}\u{FE00}-\u{FE0F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{E0100}-\u{E01EF}]/gu;
const LONG_TOKEN = /[A-Za-z0-9_\-+/=]{32,}/g;

// Offsets where each line starts (LF-terminated; CRLF works because CR stays on its line).
export function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function locate(starts: readonly number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (starts[lo] ?? 0) + 1 };
}

// The match plus a little context, clipped to its line.
export function snippetAround(text: string, offset: number, length: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const newline = text.indexOf("\n", offset + length);
  const lineEnd = newline < 0 ? text.length : newline;
  return text.slice(Math.max(lineStart, offset - CONTEXT_PAD), Math.min(lineEnd, offset + length + CONTEXT_PAD));
}

// Makes invisible characters visible, redacts long tokens (keys, blobs) and truncates.
export function sanitizeEvidence(snippet: string): string {
  const visible = snippet
    .replace(INVISIBLE, (ch) => `<U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}>`)
    .replace(/\s+/g, " ")
    .trim()
    .replace(LONG_TOKEN, (token) => `${token.slice(0, 4)}…<redacted>`);
  return visible.length > MAX_EVIDENCE ? `${visible.slice(0, MAX_EVIDENCE - 1)}…` : visible;
}
