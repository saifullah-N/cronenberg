import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ingestFeeds } from "../src/feeds/ingest";
import type { Fetcher } from "../src/feeds/types";
import worker from "../src/index";

const FEED = [
  "http://examplebank-verify.xyz/login", // brand match
  "https://www.examplebank.com/help", // legit domain, never tagged
  "http://unrelated.xyz/",
  "http://unrelated.xyz/#dupe", // normalizes to the line above
].join("\n");

const T1 = new Date("2026-10-01T00:00:00.000Z");
const T2 = new Date("2026-10-01T06:00:00.000Z");

const feedFetcher: Fetcher = async () => new Response(FEED);

async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM labels"),
    env.DB.prepare("DELETE FROM feed_entries"),
    env.DB.prepare("DELETE FROM ingest_runs"),
    env.DB.prepare("DELETE FROM brands"),
    env.DB.prepare(
      `INSERT INTO brands (slug, name, keywords, legit_domains)
       VALUES ('examplebank', 'Example Bank', '["examplebank"]', '["examplebank.com"]')`,
    ),
  ]);
}

async function runs() {
  const { results } = await env.DB.prepare(
    "SELECT source, fetched, new_rows, error FROM ingest_runs ORDER BY id",
  ).all<{ source: string; fetched: number | null; new_rows: number | null; error: string | null }>();
  return results;
}

describe("ingestFeeds", () => {
  beforeEach(resetDb);

  it("stores deduped entries, tags brands, and records the run", async () => {
    const summary = await ingestFeeds(env, feedFetcher, () => T1);
    expect(summary).toEqual([{ source: "openphish", fetched: 4, unique: 3, skipped: 1, newRows: 3 }]);

    const { results } = await env.DB.prepare(
      "SELECT url, registrable_domain, brand_id, first_seen_at FROM feed_entries ORDER BY url",
    ).all<{ url: string; registrable_domain: string; brand_id: number | null; first_seen_at: string }>();
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.brand_id !== null).map((r) => r.url)).toEqual([
      "http://examplebank-verify.xyz/login",
    ]);
    expect(results.every((r) => r.first_seen_at === T1.toISOString())).toBe(true);

    expect(await runs()).toEqual([{ source: "openphish", fetched: 4, new_rows: 3, error: null }]);
  });

  it("counts nothing new on a repeat run but advances last_seen_at", async () => {
    await ingestFeeds(env, feedFetcher, () => T1);
    const [second] = await ingestFeeds(env, feedFetcher, () => T2);
    expect(second?.newRows).toBe(0);

    const row = await env.DB.prepare(
      "SELECT first_seen_at, last_seen_at FROM feed_entries WHERE url = 'http://unrelated.xyz/'",
    ).first<{ first_seen_at: string; last_seen_at: string }>();
    expect(row).toEqual({ first_seen_at: T1.toISOString(), last_seen_at: T2.toISOString() });
  });

  it("records the failure and rethrows as AggregateError on HTTP errors", async () => {
    const failing: Fetcher = async () => new Response("boom", { status: 500 });
    await expect(ingestFeeds(env, failing, () => T1)).rejects.toBeInstanceOf(AggregateError);

    const [run] = await runs();
    expect(run?.error).toContain("HTTP 500");
    expect(run?.fetched).toBeNull();
  });

  it("keeps OpenPhish results when PhishTank fails", async () => {
    const withKey: Env = {
      DB: env.DB,
      USER_AGENT: env.USER_AGENT,
      PHISHTANK_ENABLED: "true",
      PHISHTANK_APP_KEY: "k",
    };
    const mixed: Fetcher = async (input) =>
      String(input).includes("phishtank") ? new Response("down", { status: 502 }) : new Response(FEED);

    await expect(ingestFeeds(withKey, mixed, () => T1)).rejects.toBeInstanceOf(AggregateError);
    const bySource = Object.fromEntries((await runs()).map((r) => [r.source, r.error]));
    expect(bySource).toEqual({ openphish: null, phishtank: "phishtank HTTP 502" });

    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM feed_entries").first<{ n: number }>();
    expect(count?.n).toBe(3);
  });

  it("skips PhishTank unless explicitly enabled, even with a key", async () => {
    const keyOnly: Env = { DB: env.DB, USER_AGENT: env.USER_AGENT, PHISHTANK_APP_KEY: "k" };
    const fetched: string[] = [];
    const recording: Fetcher = async (input) => {
      fetched.push(String(input));
      return new Response(FEED);
    };

    await ingestFeeds(keyOnly, recording, () => T1);
    expect(fetched.some((u) => u.includes("phishtank"))).toBe(false);
    expect((await runs()).map((r) => r.source)).toEqual(["openphish"]);
  });

  it("ignores blank brand keywords instead of tagging every URL", async () => {
    await env.DB.prepare(`UPDATE brands SET keywords = '["examplebank", "", "  "]'`).run();
    await ingestFeeds(env, feedFetcher, () => T1);

    const tagged = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM feed_entries WHERE brand_id IS NOT NULL",
    ).first<{ n: number }>();
    expect(tagged?.n).toBe(1);
  });
});

describe("worker fetch", () => {
  it("serves /health and 404s everything else", async () => {
    const handler: ExportedHandler<Env> = worker;
    const ctx = createExecutionContext();
    const health = await handler.fetch!(new Request("http://w/health"), env, ctx);
    expect(await health.json()).toEqual({ ok: true });
    const other = await handler.fetch!(new Request("http://w/nope"), env, ctx);
    expect(other.status).toBe(404);
  });
});
