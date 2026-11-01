import type { Component } from "../agent/catalog.ts";
import { generatePage } from "../agent/freeform.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import { ComparisonError, generateComparison, type Backend } from "../agent/run.ts";
import { getCache } from "./cache/cache.ts";
import type { Mode } from "./compare-url.ts";
import { LENS_GUIDANCE } from "../agent/lenses.ts";
import { findTicker, getAnnualReport, getCondensedFiling, getFinancials } from "./data.ts";
import type { LensSlug } from "./lenses.ts";
import { NoAnnualDataError } from "./normalize/normalize.ts";

// One comparison request, as the events POST /api/compare streams: progress,
// both companies' financials (the page looks every value up in them), each
// condensed annual report as soon as it is read (text lenses), components as
// the model shows them (or, in freeform mode, the one page it writes), then
// done or error. The route adds a heartbeat every 15s, and serves a featured
// comparison (lib/featured.ts) itself.
export type CompareEvent =
  | { type: "progress"; step: "fetching" | "reading" | "building" }
  | { type: "data"; companies: CompanyInput[] }
  | { type: "filing"; ticker: string; filing: NonNullable<CompanyInput["filing"]> }
  | { type: "component"; component: Component }
  | { type: "page"; html: string }
  | { type: "done"; cached: boolean; featured?: string } // featured: its generation date, YYYY-MM-DD
  | { type: "error"; message: string }
  | { type: "heartbeat" };

// Components v2: text rows carry an icon. Freeform v2: Sonnet, minimal text.
const RESULT_VERSION: Record<Mode, number> = { components: 2, freeform: 2 };
const resultKey = (tickers: readonly string[], lens: LensSlug, mode: Mode) => `result:v${RESULT_VERSION[mode]}:${tickers.join("|")}|${lens}|${mode}`;
type Result = { components: Component[] } | { html: string };

export async function defaultBackend(): Promise<Backend> {
  if (process.env.CLAUDE_AUTH === "login") return (await import("../agent/backends/login.ts")).loginBackend;
  return (await import("../agent/backends/api.ts")).apiBackend();
}

// Also used by scripts/eval-fixtures.mts, so the evals see the same payload.
export async function loadCompany(ticker: string): Promise<CompanyInput> {
  const entry = await findTicker(ticker);
  if (!entry) throw new ComparisonError(`${ticker} is not in the SEC's company list.`);
  const financials = await getFinancials(entry.cik).catch((err) => {
    if (err instanceof NoAnnualDataError) throw new ComparisonError(`${ticker} has no 10-K financial statements to compare.`);
    throw err;
  });
  return { ticker, name: entry.name, financials };
}

// Reads the company's latest 10-K into c.filing (text lenses).
export async function attachFiling(c: CompanyInput, backend: Backend, signal: AbortSignal): Promise<void> {
  const cik = c.financials.cik;
  const report = await getAnnualReport(cik);
  if (!report) throw new ComparisonError(`${c.ticker} has no 10-K annual report to read.`);
  const filing = await getCondensedFiling({ cik, name: c.name, report, model: backend, signal });
  const i = c.financials.periodEnds.indexOf(report.periodEnd);
  c.filing = { ...filing, fiscalYear: i >= 0 ? c.financials.fiscalYears[i] : Number(report.periodEnd.slice(0, 4)) };
}

export async function runComparison(opts: {
  tickers: readonly [string, string]; // canonical (alphabetical) order
  lens: LensSlug;
  mode: Mode;
  regenerate: boolean;
  signal: AbortSignal;
  emit: (event: CompareEvent) => void;
  backend?: Backend;
}): Promise<void> {
  const { tickers, lens, mode, emit } = opts;
  try {
    emit({ type: "progress", step: "fetching" });
    const companies = await Promise.all(tickers.map(loadCompany));
    emit({ type: "data", companies: companies.map((c) => ({ ...c })) });
    const backend = opts.backend ?? (await defaultBackend());
    if (LENS_GUIDANCE[lens].needsFilings) {
      emit({ type: "progress", step: "reading" });
      await Promise.all(
        companies.map(async (c) => {
          await attachFiling(c, backend, opts.signal);
          emit({ type: "filing", ticker: c.ticker, filing: c.filing! });
        }),
      );
    }

    const cache = getCache();
    const key = resultKey(tickers, lens, mode);
    const show = (result: Result) => {
      if ("html" in result) emit({ type: "page", html: result.html });
      else for (const component of result.components) emit({ type: "component", component });
    };
    if (!opts.regenerate) {
      const hit = (await cache.get(key).catch((err) => console.error(`[compare] cache read failed for ${key}:`, err))) as Result | undefined;
      if (hit) {
        show(hit);
        emit({ type: "done", cached: true });
        return;
      }
    }

    emit({ type: "progress", step: "building" });
    let result: Result;
    if (mode === "freeform") {
      result = { html: (await generatePage({ lens, companies, backend, signal: opts.signal })).html };
      show(result);
    } else {
      const generated = await generateComparison({
        lens,
        companies,
        backend,
        signal: opts.signal,
        onComponent: (component) => emit({ type: "component", component }),
      });
      result = { components: generated.components };
    }
    // No TTL: a result is replaced only by Regenerate.
    await cache.set(key, result).catch((err) => console.error(`[compare] cache write failed for ${key}:`, err));
    emit({ type: "done", cached: false });
  } catch (err) {
    if (err instanceof ComparisonError) return emit({ type: "error", message: err.message });
    console.error("[compare] failed:", err);
    emit({ type: "error", message: "The comparison failed unexpectedly. Try again in a minute." });
  }
}
