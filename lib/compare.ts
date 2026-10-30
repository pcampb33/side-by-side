import type { Component } from "../agent/catalog.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import { ComparisonError, generateComparison, type Backend } from "../agent/run.ts";
import { getCache } from "./cache/cache.ts";
import { findTicker, getFinancials } from "./data.ts";
import type { LensSlug } from "./lenses.ts";
import { NoAnnualDataError } from "./normalize/normalize.ts";

// One comparison request, as the events POST /api/compare streams: progress,
// both companies' data (the page looks every value up in it), components as
// the model shows them, then done or error.
export type CompareEvent =
  | { type: "progress"; step: "fetching" | "building" }
  | { type: "data"; companies: CompanyInput[] }
  | { type: "component"; component: Component }
  | { type: "done"; cached: boolean }
  | { type: "error"; message: string };

const resultKey = (tickers: readonly string[], lens: LensSlug) => `result:v1:${tickers.join("|")}|${lens}|components`;

async function defaultBackend(): Promise<Backend> {
  if (process.env.CLAUDE_AUTH === "login") return (await import("../agent/backends/login.ts")).loginBackend;
  return (await import("../agent/backends/api.ts")).apiBackend();
}

export async function runComparison(opts: {
  tickers: readonly [string, string]; // canonical (alphabetical) order
  lens: LensSlug;
  regenerate: boolean;
  signal: AbortSignal;
  emit: (event: CompareEvent) => void;
  backend?: Backend;
}): Promise<void> {
  const { tickers, lens, emit } = opts;
  try {
    emit({ type: "progress", step: "fetching" });
    const companies = await Promise.all(
      tickers.map(async (ticker): Promise<CompanyInput> => {
        const entry = await findTicker(ticker);
        if (!entry) throw new ComparisonError(`${ticker} is not in the SEC's company list.`);
        const financials = await getFinancials(entry.cik).catch((err) => {
          if (err instanceof NoAnnualDataError) throw new ComparisonError(`${ticker} has no 10-K financial statements to compare.`);
          throw err;
        });
        return { ticker, name: entry.name, financials };
      }),
    );
    emit({ type: "data", companies });

    const cache = getCache();
    const key = resultKey(tickers, lens);
    if (!opts.regenerate) {
      const hit = (await cache.get(key).catch((err) => console.error(`[compare] cache read failed for ${key}:`, err))) as
        | { components: Component[] }
        | undefined;
      if (hit) {
        for (const component of hit.components) emit({ type: "component", component });
        emit({ type: "done", cached: true });
        return;
      }
    }

    emit({ type: "progress", step: "building" });
    const { components } = await generateComparison({
      lens,
      companies,
      backend: opts.backend ?? (await defaultBackend()),
      signal: opts.signal,
      onComponent: (component) => emit({ type: "component", component }),
    });
    // No TTL: a result is replaced only by Regenerate.
    await cache.set(key, { components }).catch((err) => console.error(`[compare] cache write failed for ${key}:`, err));
    emit({ type: "done", cached: false });
  } catch (err) {
    if (err instanceof ComparisonError) return emit({ type: "error", message: err.message });
    console.error("[compare] failed:", err);
    emit({ type: "error", message: "The comparison failed unexpectedly. Try again in a minute." });
  }
}
