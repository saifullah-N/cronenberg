import { chunks } from "../lib/chunks";
import type { FeedSource } from "./types";

export interface FeedEntryRow {
  source: FeedSource;
  url: string;
  hostname: string;
  registrableDomain: string | null;
  brandId: number | null;
  sourceFirstSeenAt: string | null;
  sourceTarget: string | null;
}

export interface RunResult {
  finishedAt: string;
  fetched: number | null;
  newRows: number | null;
  error: string | null;
}

const BATCH_SIZE = 100;

export async function upsertFeedEntries(
  db: D1Database,
  rows: readonly FeedEntryRow[],
  seenAt: string,
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO feed_entries
       (source, url, hostname, registrable_domain, brand_id,
        source_first_seen_at, source_target, first_seen_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT (source, url) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       brand_id = excluded.brand_id`,
  );
  for (const chunk of chunks(rows, BATCH_SIZE)) {
    await db.batch(
      chunk.map((r) =>
        stmt.bind(
          r.source,
          r.url,
          r.hostname,
          r.registrableDomain,
          r.brandId,
          r.sourceFirstSeenAt,
          r.sourceTarget,
          seenAt,
        ),
      ),
    );
  }
}

export async function countNew(db: D1Database, source: FeedSource, since: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM feed_entries WHERE source = ?1 AND first_seen_at >= ?2")
    .bind(source, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function startRun(db: D1Database, source: FeedSource, startedAt: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO ingest_runs (source, started_at) VALUES (?1, ?2) RETURNING id")
    .bind(source, startedAt)
    .first<{ id: number }>();
  if (!row) throw new Error(`failed to record ingest run for ${source}`);
  return row.id;
}

export async function finishRun(db: D1Database, id: number, result: RunResult): Promise<void> {
  await db
    .prepare(
      "UPDATE ingest_runs SET finished_at = ?2, fetched = ?3, new_rows = ?4, error = ?5 WHERE id = ?1",
    )
    .bind(id, result.finishedAt, result.fetched, result.newRows, result.error)
    .run();
}
