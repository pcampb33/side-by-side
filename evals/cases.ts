import type { LensSlug } from "../lib/lenses.ts";
import { LENS_GUIDANCE } from "../agent/lenses.ts";

// The featured comparisons (SPEC §1, npm run featured), each in its own lens,
// and what the evals generate: those plus one awkward filer. Tickers in
// canonical (alphabetical) order.
export const FEATURED: { tickers: [string, string]; lens: LensSlug }[] = [
  { tickers: ["AMD", "NVDA"], lens: "growth" },
  { tickers: ["KO", "PEP"], lens: "profitability" },
  { tickers: ["F", "GM"], lens: "balance-sheet-risk" },
  { tickers: ["AAPL", "MSFT"], lens: "risk-exposure" },
  { tickers: ["GOOGL", "META"], lens: "where-they-compete" },
];
export const CASES: { tickers: [string, string]; lens: LensSlug }[] = [
  ...FEATURED,
  // A bank: no gross profit, so no gross margin or cost breakdown.
  { tickers: ["AAPL", "JPM"], lens: "profitability" },
];

export const caseId = (c: (typeof CASES)[number]) => `${c.tickers.join("-")}-${c.lens}`;

// Tickers whose fixture carries the condensed annual report.
export const NEEDS_FILING = new Set(CASES.filter((c) => LENS_GUIDANCE[c.lens].needsFilings).flatMap((c) => c.tickers));
