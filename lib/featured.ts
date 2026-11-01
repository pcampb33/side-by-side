import type { Component } from "../agent/catalog.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import type { Trace } from "../agent/trace.ts";
import amdNvda from "../featured/AMD-vs-NVDA-growth.json";
import koPep from "../featured/KO-vs-PEP-profitability.json";
import fGm from "../featured/F-vs-GM-balance-sheet-risk.json";
import aaplMsft from "../featured/AAPL-vs-MSFT-risk-exposure.json";
import googlMeta from "../featured/GOOGL-vs-META-where-they-compete.json";
import type { CompareEvent } from "./compare.ts";
import type { Mode } from "./compare-url.ts";
import type { LensSlug } from "./lenses.ts";
import type { CompanyProfile } from "./sec/profile.ts";

// The featured comparisons: generated ahead of time by npm run featured and
// committed, so they show with no Claude or SEC calls and never change for a
// visitor. App code only (the JSON imports need the bundler).
export interface Featured {
  tickers: [string, string];
  lens: LensSlug;
  model: string;
  generatedAt: string; // YYYY-MM-DD
  companies: (CompanyInput & { profile: CompanyProfile })[];
  components: Component[];
  html: string;
  traces?: Partial<Record<Mode, Trace>>; // from the step-11 regeneration on
}

// In the order the homepage lists them.
export const FEATURED = [amdNvda, koPep, fGm, aaplMsft, googlMeta] as unknown as Featured[];

export const findFeatured = (tickers: readonly string[], lens: string) => FEATURED.find((f) => f.lens === lens && f.tickers.join() === tickers.join());

// The events runComparison would send for a cached result, so the page
// behaves the same: data first, then each annual report, then the result.
export function featuredEvents(f: Featured, mode: Mode): CompareEvent[] {
  const companies: CompanyInput[] = f.companies.map(({ ticker, name, financials }) => ({ ticker, name, financials }));
  const filings = f.companies.flatMap((c): CompareEvent[] => (c.filing ? [{ type: "filing", ticker: c.ticker, filing: c.filing }] : []));
  const result: CompareEvent[] = mode === "freeform" ? [{ type: "page", html: f.html }] : f.components.map((component) => ({ type: "component", component }));
  const trace = f.traces?.[mode];
  return [{ type: "data", companies }, ...filings, ...result, ...(trace ? [{ type: "trace", trace } as const] : []), { type: "done", cached: true, featured: f.generatedAt }];
}
