import { describe, expect, it } from "vitest";
import { tileGroups } from "./tile-groups.ts";

describe("tileGroups", () => {
  const rows = [
    { label: "Competition", refs: ["AAPL-r1", "MSFT-r1"] },
    { label: "AI", refs: ["MSFT-r2", "MSFT-r5"] },
    { label: "One product", refs: ["AAPL-r4"] },
    { label: "Tax", refs: ["MSFT-r8", "AAPL-r10"] },
  ];

  it("groups rows by whose ids they hold, keeping each company's ids apart", () => {
    const g = tileGroups(rows, ["AAPL", "MSFT"]);
    expect(g.both.map((t) => t.row.label)).toEqual(["Competition", "Tax"]);
    expect(g.first.map((t) => t.row.label)).toEqual(["One product"]);
    expect(g.second.map((t) => t.row.label)).toEqual(["AI"]);
    expect(g.both[1].refs).toEqual([["AAPL-r10"], ["MSFT-r8"]]);
    expect(g.second[0].index).toBe(1);
  });

  it("reads the ticker before the last hyphen, so tickers with hyphens work", () => {
    const g = tileGroups([{ refs: ["BRK-B-r1", "AAPL-r2"] }], ["AAPL", "BRK-B"]);
    expect(g.both[0].refs).toEqual([["AAPL-r2"], ["BRK-B-r1"]]);
  });
});
