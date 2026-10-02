import { parse } from "tldts";

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface DomainInfo {
  hostname: string;
  registrableDomain: string | null;
  isIp: boolean;
}

// Returns a canonical http(s) URL string, or null if the input can't be used.
// Hostnames stay in their ASCII (xn--) form; decoding for confusable checks happens later.
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;

  url.hash = "";
  return url.href;
}

// Private PSL suffixes (web.app, github.io, pages.dev, ...) count as public, so each tenant on a
// shared host gets its own registrable domain instead of collapsing into the platform's.
export function domainInfo(url: string): DomainInfo {
  const parsed = parse(url, { allowPrivateDomains: true });
  return {
    hostname: parsed.hostname ?? "",
    registrableDomain: parsed.isIp ? null : (parsed.domain ?? null),
    isIp: parsed.isIp ?? false,
  };
}
