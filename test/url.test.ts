import { describe, expect, it } from "vitest";
import { domainInfo, normalizeUrl } from "../src/lib/url";

describe("normalizeUrl", () => {
  it("adds a scheme and lowercases the host", () => {
    expect(normalizeUrl("Example.com/a")).toBe("http://example.com/a");
  });

  it("drops the fragment and keeps the query", () => {
    expect(normalizeUrl("https://example.com/a?x=1#frag")).toBe("https://example.com/a?x=1");
  });

  it("returns null for unusable input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("http://")).toBeNull();
    expect(normalizeUrl("ftp://example.com/file")).toBeNull();
  });

  it("keeps punycode hostnames in ASCII form", () => {
    expect(normalizeUrl("http://exämple.com/")).toBe("http://xn--exmple-cua.com/");
  });
});

describe("domainInfo", () => {
  it("extracts the registrable domain across multi-part suffixes", () => {
    expect(domainInfo("https://a.b.example.co.uk/x")).toEqual({
      hostname: "a.b.example.co.uk",
      registrableDomain: "example.co.uk",
      isIp: false,
    });
  });

  it("keeps tenants on shared hosting platforms apart", () => {
    expect(domainInfo("https://evil-login.web.app/x").registrableDomain).toBe("evil-login.web.app");
  });

  it("returns a null registrable domain for IP hosts", () => {
    expect(domainInfo("http://1.2.3.4/login")).toEqual({
      hostname: "1.2.3.4",
      registrableDomain: null,
      isIp: true,
    });
  });
});
