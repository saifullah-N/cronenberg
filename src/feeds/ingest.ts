import { matchBrand } from "../brands/match";
import { loadBrands, type Brand } from "../brands/repository";
import { log } from "../lib/log";
import { domainInfo, normalizeUrl } from "../lib/url";
import { fetchOpenPhish } from "./openphish";
import { fetchPhishTank } from "./phishtank";
import { countNew, finishRun, startRun, upsertFeedEntries, type FeedEntryRow } from "./repository";
import type { FeedEntry, FeedSource, Fetcher } from "./types";

interface SourceDef {
  source: FeedSource;
  fetchEntries: () => Promise<FeedEntry[]>;
}

export interface SourceSummary {
  source: FeedSource;
  fetched: number;
  unique: number;
  skipped: number;
  newRows: number;
}

const defaultFetcher: Fetcher = (input, init) => fetch(input, init);

export async function ingestFeeds(
  env: Env,
  fetcher: Fetcher = defaultFetcher,
  now: () => Date = () => new Date(),
): Promise<SourceSummary[]> {
  // Awaited inside runSource so a bad brand config is recorded in ingest_runs like any other failure.
  const brands = loadBrands(env.DB);
  brands.catch(() => {});

  const sources: SourceDef[] = [
    { source: "openphish", fetchEntries: () => fetchOpenPhish(fetcher, env.USER_AGENT) },
  ];
  // The PhishTank dump doesn't fit the Free plan's 10 ms CPU budget, so it is opt-in.
  const appKey = env.PHISHTANK_APP_KEY;
  if (env.PHISHTANK_ENABLED !== "true") {
    log("feed.phishtank.skipped", { reason: "PHISHTANK_ENABLED is not \"true\"" });
  } else if (!appKey) {
    log("feed.phishtank.skipped", { reason: "PHISHTANK_APP_KEY not set" });
  } else {
    sources.push({
      source: "phishtank",
      fetchEntries: () => fetchPhishTank(fetcher, appKey, env.USER_AGENT),
    });
  }

  const results = await Promise.allSettled(sources.map((s) => runSource(env.DB, s, brands, now)));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      "feed ingest failed",
    );
  }
  return results.map((r) => (r as PromiseFulfilledResult<SourceSummary>).value);
}

async function runSource(
  db: D1Database,
  def: SourceDef,
  brands: Promise<readonly Brand[]>,
  now: () => Date,
): Promise<SourceSummary> {
  const started = now();
  const seenAt = started.toISOString();
  const runId = await startRun(db, def.source, seenAt);
  let fetched: number | null = null;

  try {
    const entries = await def.fetchEntries();
    fetched = entries.length;
    const rows = toRows(entries, await brands);
    await upsertFeedEntries(db, rows, seenAt);
    const newRows = await countNew(db, def.source, seenAt);
    const finished = now();
    await finishRun(db, runId, {
      finishedAt: finished.toISOString(),
      fetched: entries.length,
      newRows,
      error: null,
    });

    const summary: SourceSummary = {
      source: def.source,
      fetched: entries.length,
      unique: rows.length,
      skipped: entries.length - rows.length,
      newRows,
    };
    log("feed.ingest.done", { ...summary, ms: finished.getTime() - started.getTime() });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await finishRun(db, runId, {
        finishedAt: now().toISOString(),
        fetched,
        newRows: null,
        error: message,
      });
    } catch (recordErr) {
      log("feed.ingest.record_failed", { source: def.source, error: String(recordErr) });
    }
    log("feed.ingest.failed", { source: def.source, error: message });
    throw err;
  }
}

// Normalizes, dedupes by url, and tags brand. Unusable URLs are dropped.
// No per-URL hashing: it dominated CPU time and the Free plan allows 10 ms per run.
function toRows(entries: readonly FeedEntry[], brands: readonly Brand[]): FeedEntryRow[] {
  const rows = new Map<string, FeedEntryRow>();
  for (const entry of entries) {
    const url = normalizeUrl(entry.url);
    if (!url || rows.has(url)) continue;

    const { hostname, registrableDomain } = domainInfo(url);
    const brand = matchBrand(brands, { url, registrableDomain, sourceTarget: entry.sourceTarget });
    rows.set(url, {
      source: entry.source,
      url,
      hostname,
      registrableDomain,
      brandId: brand?.id ?? null,
      sourceFirstSeenAt: entry.sourceFirstSeenAt ?? null,
      sourceTarget: entry.sourceTarget ?? null,
    });
  }
  return [...rows.values()];
}
