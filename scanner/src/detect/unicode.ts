// Hidden-Unicode detection. Free of scanner types so the phishing hunter can reuse it.

export type UnicodeRule =
  | "unicode-tags"
  | "bidi-control"
  | "variation-selector-supplement"
  | "variation-selector-run"
  | "zero-width"
  | "zero-width-joiner"
  | "invisible-operator";

export interface UnicodeMatch {
  rule: UnicodeRule;
  offset: number; // UTF-16 offset of the run start
  length: number; // UTF-16 length of the run
  count: number; // code points in the run
  decoded?: string; // for unicode-tags: the hidden ASCII text
}

const CANDIDATE = /[\u{180E}\u{200B}-\u{200D}\u{202A}-\u{202E}\u{2060}-\u{2069}\u{FEFF}\u{FE00}-\u{FE0F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_MODIFIER = /\p{Emoji_Modifier}/u;
// Scripts where ZWJ/ZWNJ legitimately shape letters.
const JOINING_SCRIPT =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]/u;
const KEYCAP_BASE = /[0-9#*]/;

const isVs = (cp: number | undefined) => cp !== undefined && cp >= 0xfe00 && cp <= 0xfe0f;
const charOf = (cp: number | undefined) => (cp === undefined ? "" : String.fromCodePoint(cp));

function prevCodePoint(text: string, offset: number): number | undefined {
  if (offset <= 0) return undefined;
  const low = text.charCodeAt(offset - 1);
  if (low >= 0xdc00 && low <= 0xdfff && offset >= 2) return text.codePointAt(offset - 2);
  return text.codePointAt(offset - 1);
}

function joiningScriptAround(prev: number | undefined, next: number | undefined): boolean {
  return JOINING_SCRIPT.test(charOf(prev)) && JOINING_SCRIPT.test(charOf(next));
}

// Returns the rule for one candidate code point, or null when its context makes it legitimate.
function classify(text: string, offset: number, cp: number, width: number): UnicodeRule | null {
  if (cp >= 0xe0000 && cp <= 0xe007f) return "unicode-tags";
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return "bidi-control";
  if (cp >= 0xe0100 && cp <= 0xe01ef) return "variation-selector-supplement";

  const prev = prevCodePoint(text, offset);
  const next = text.codePointAt(offset + width);

  if (isVs(cp)) {
    if (isVs(prev) || isVs(next)) return "variation-selector-run";
    const base = charOf(prev);
    const legit = PICTOGRAPHIC.test(base) || KEYCAP_BASE.test(base) || (prev !== undefined && prev >= 0x2000);
    return legit ? null : "variation-selector-run";
  }
  if (cp === 0x200d) {
    const prevOk = PICTOGRAPHIC.test(charOf(prev)) || EMOJI_MODIFIER.test(charOf(prev)) || prev === 0xfe0f;
    if ((prevOk && PICTOGRAPHIC.test(charOf(next))) || joiningScriptAround(prev, next)) return null;
    return "zero-width-joiner";
  }
  if (cp === 0x200c) return joiningScriptAround(prev, next) ? null : "zero-width";
  if (cp === 0xfeff) return offset === 0 ? null : "zero-width";
  if (cp === 0x200b || cp === 0x2060 || cp === 0x180e) return "zero-width";
  if ((cp >= 0x2061 && cp <= 0x2064) || cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0) {
    return "invisible-operator";
  }
  return null; // other U+2065–2069 range members are handled above; anything else is not flagged
}

// One match per contiguous run of the same rule.
export function findHiddenUnicode(text: string): UnicodeMatch[] {
  const matches: UnicodeMatch[] = [];
  const re = new RegExp(CANDIDATE.source, "gu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const cp = m[0].codePointAt(0) ?? 0;
    const rule = classify(text, m.index, cp, m[0].length);
    if (!rule) continue;
    const last = matches.at(-1);
    if (last && last.rule === rule && last.offset + last.length === m.index) {
      last.length += m[0].length;
      last.count += 1;
    } else {
      matches.push({ rule, offset: m.index, length: m[0].length, count: 1 });
    }
    if (rule === "unicode-tags") {
      const current = matches.at(-1) as UnicodeMatch;
      const ascii = cp - 0xe0000;
      if (ascii >= 0x20 && ascii <= 0x7e) current.decoded = (current.decoded ?? "") + String.fromCharCode(ascii);
    }
  }
  return matches;
}
