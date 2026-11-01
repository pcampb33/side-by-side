import { describe, expect, it } from "vitest";
import { fullWidth, loadingCardFull } from "./chart-pairs.ts";

describe("fullWidth", () => {
  it("pairs consecutive charts and gives a leftover chart the row", () => {
    expect(fullWidth(["metric_cards", "trend_line", "trend_line", "trend_line", "takeaways"], false)).toEqual([true, false, false, true, true]);
    expect(fullWidth(["trend_line", "risk_themes", "trend_line", "grouped_bars", "takeaways"], false)).toEqual([true, true, false, false, true]);
  });

  it("keeps the newest unpaired chart half width while Claude is still composing", () => {
    expect(fullWidth(["trend_line"], true)).toEqual([false]);
    expect(fullWidth(["trend_line", "trend_line", "trend_line"], true)).toEqual([false, false, false]);
    expect(fullWidth(["trend_line", "takeaways"], true)).toEqual([true, true]);
  });
});

describe("loadingCardFull", () => {
  it("sits beside an unpaired newest chart, else takes the row", () => {
    expect(loadingCardFull(["trend_line"], true)).toBe(false);
    expect(loadingCardFull(["trend_line", "trend_line"], true)).toBe(true);
    expect(loadingCardFull([], true)).toBe(true);
    expect(loadingCardFull(["metric_cards"], true)).toBe(true);
  });
});
