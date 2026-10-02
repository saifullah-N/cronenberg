import type { FeedEntry, Fetcher } from "./types";

export const OPENPHISH_FEED_URL = "https://openphish.com/feed.txt";

export function parseOpenPhish(text: string): FeedEntry[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((url) => ({ source: "openphish", url }));
}

export async function fetchOpenPhish(fetcher: Fetcher, userAgent: string): Promise<FeedEntry[]> {
  const res = await fetcher(OPENPHISH_FEED_URL, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`openphish HTTP ${res.status}`);
  return parseOpenPhish(await res.text());
}
