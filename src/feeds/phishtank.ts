import type { FeedEntry, Fetcher } from "./types";

// PhishTank sends "+00:00" offsets; store the same ISO-8601 UTC form as our own timestamps.
function toIsoUtc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export function parsePhishTank(data: unknown): FeedEntry[] {
  if (!Array.isArray(data)) throw new Error("phishtank: expected a JSON array");

  const entries: FeedEntry[] = [];
  for (const item of data as Array<Record<string, unknown>>) {
    if (typeof item?.url !== "string" || !item.url) continue;
    entries.push({
      source: "phishtank",
      url: item.url,
      sourceFirstSeenAt: toIsoUtc(item.submission_time),
      sourceTarget: typeof item.target === "string" ? item.target : undefined,
    });
  }
  return entries;
}

export async function fetchPhishTank(
  fetcher: Fetcher,
  appKey: string,
  userAgent: string,
): Promise<FeedEntry[]> {
  const url = `https://data.phishtank.com/data/${encodeURIComponent(appKey)}/online-valid.json.gz`;
  const res = await fetcher(url, { headers: { "user-agent": userAgent } });
  // Never include `url` in errors: it contains the app key.
  if (!res.ok) throw new Error(`phishtank HTTP ${res.status}`);
  if (!res.body) throw new Error("phishtank: empty body");

  // If the server sent Content-Encoding: gzip the runtime already decompressed it.
  const alreadyDecoded = (res.headers.get("content-encoding") ?? "").includes("gzip");
  const body = alreadyDecoded ? res.body : res.body.pipeThrough(new DecompressionStream("gzip"));
  return parsePhishTank(await new Response(body).json());
}
