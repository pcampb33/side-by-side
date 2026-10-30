import { describe, expect, it } from "vitest";
import { canonicalComparePath, comparePath, parsePair } from "./compare-url.ts";

describe("compare URLs", () => {
  it("orders a pair alphabetically", () => {
    expect(comparePath("msft", "AAPL", "growth")).toBe("/compare/AAPL-vs-MSFT/growth");
  });

  it("keeps tickers that contain a hyphen", () => {
    expect(parsePair("BRK-B-vs-AAPL")).toEqual(["BRK-B", "AAPL"]);
  });

  it("rejects a malformed or same-company pair", () => {
    expect(parsePair("AAPL")).toBeNull();
    expect(parsePair("AAPL-vs-AAPL")).toBeNull();
    expect(parsePair("AAPL-vs-MSFT-vs-NVDA")).toBeNull();
    expect(parsePair("AA PL-vs-MSFT")).toBeNull();
  });

  it("canonicalizes order and case, and leaves the canonical form alone", () => {
    expect(canonicalComparePath("/compare/msft-vs-aapl/Growth")).toBe("/compare/AAPL-vs-MSFT/growth");
    expect(canonicalComparePath("/compare/AAPL-vs-MSFT/growth")).toBe("/compare/AAPL-vs-MSFT/growth");
    expect(canonicalComparePath("/compare/nonsense/growth")).toBeNull();
  });
});
