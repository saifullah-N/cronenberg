import { describe, expect, it } from "vitest";
import { fetchOpenPhish, parseOpenPhish } from "../src/feeds/openphish";
import { fetchPhishTank, parsePhishTank } from "../src/feeds/phishtank";
import type { Fetcher } from "../src/feeds/types";

function gzip(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
}

describe("parseOpenPhish", () => {
  it("keeps URLs and drops blank and comment lines", () => {
    expect(parseOpenPhish("# header\nhttp://a.xyz/\n\n  http://b.xyz/x  \r\n")).toEqual([
      { source: "openphish", url: "http://a.xyz/" },
      { source: "openphish", url: "http://b.xyz/x" },
    ]);
  });

  it("returns an empty list for an empty feed", () => {
    expect(parseOpenPhish("")).toEqual([]);
  });
});

describe("fetchOpenPhish", () => {
  it("throws with the status on non-2xx responses", async () => {
    const fetcher: Fetcher = async () => new Response("nope", { status: 503 });
    await expect(fetchOpenPhish(fetcher, "ua")).rejects.toThrow("openphish HTTP 503");
  });
});

describe("parsePhishTank", () => {
  it("maps fields and skips items without a url", () => {
    expect(
      parsePhishTank([
        { url: "http://a.xyz/", submission_time: "2026-09-30T10:00:00+00:00", target: "Example Bank" },
        {},
        { url: 42 },
      ]),
    ).toEqual([
      {
        source: "phishtank",
        url: "http://a.xyz/",
        sourceFirstSeenAt: "2026-09-30T10:00:00.000Z",
        sourceTarget: "Example Bank",
      },
    ]);
  });

  it("rejects non-array payloads", () => {
    expect(() => parsePhishTank({})).toThrow("expected a JSON array");
  });
});

describe("fetchPhishTank", () => {
  it("gunzips the dump when the body is raw gzip", async () => {
    const payload = JSON.stringify([{ url: "http://a.xyz/", target: "Other" }]);
    const fetcher: Fetcher = async () => new Response(gzip(payload));
    expect(await fetchPhishTank(fetcher, "key", "ua")).toEqual([
      { source: "phishtank", url: "http://a.xyz/", sourceFirstSeenAt: undefined, sourceTarget: "Other" },
    ]);
  });

  it("does not leak the app key in errors", async () => {
    const fetcher: Fetcher = async () => new Response("forbidden", { status: 403 });
    const err = await fetchPhishTank(fetcher, "SECRET-KEY", "ua").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("phishtank HTTP 403");
    expect((err as Error).message).not.toContain("SECRET-KEY");
  });
});
