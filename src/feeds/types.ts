export type FeedSource = "openphish" | "phishtank";

export interface FeedEntry {
  source: FeedSource;
  url: string;
  sourceFirstSeenAt?: string;
  sourceTarget?: string;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
