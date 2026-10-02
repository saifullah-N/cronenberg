import { describe, expect, it } from "vitest";
import { matchBrand } from "../src/brands/match";
import type { Brand } from "../src/brands/repository";

const bank: Brand = {
  id: 1,
  slug: "examplebank",
  name: "Example Bank",
  keywords: ["examplebank"],
  legitDomains: ["examplebank.com"],
};

describe("matchBrand", () => {
  it("never matches the brand's own domain", () => {
    expect(
      matchBrand([bank], { url: "https://login.examplebank.com/", registrableDomain: "examplebank.com" }),
    ).toBeNull();
  });

  it("matches a keyword in a subdomain", () => {
    expect(
      matchBrand([bank], {
        url: "http://examplebank.secure-login.xyz/",
        registrableDomain: "secure-login.xyz",
      }),
    ).toBe(bank);
  });

  it("matches a keyword in the path", () => {
    expect(
      matchBrand([bank], { url: "http://host.xyz/ExampleBank/verify", registrableDomain: "host.xyz" }),
    ).toBe(bank);
  });

  it("matches the feed target name case-insensitively", () => {
    expect(
      matchBrand([bank], {
        url: "http://unrelated.xyz/",
        registrableDomain: "unrelated.xyz",
        sourceTarget: " example bank ",
      }),
    ).toBe(bank);
  });

  it("returns null when nothing matches", () => {
    expect(matchBrand([bank], { url: "http://other.xyz/", registrableDomain: "other.xyz" })).toBeNull();
  });
});
