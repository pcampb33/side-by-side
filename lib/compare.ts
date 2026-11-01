import type { Component } from "../agent/catalog.ts";
import { generatePage } from "../agent/freeform.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import { ComparisonError, generateComparison, type Backend } from "../agent/run.ts";
import { traceCall, type BackendName, type Trace, type TraceCall } from "../agent/trace.ts";
import { liveChecks } from "../evals/checks.ts";
import { Blocked, type BlockReason } from "./access.ts";
import { getCache } from "./cache/cache.ts";
import type { Mode } from "./compare-url.ts";
import { LENS_GUIDANCE } from "../agent/lenses.ts";
import { condensedFilingKey, findTicker, getAnnualReport, getCondensedFiling, getFinancials } from "./data.ts";
import type { CondensedFiling } from "./filings/condense.ts";
import type { LensSlug } from "./lenses.ts";
import { NoAnnualDataError } from "./normalize/normalize.ts";

// One comparison request, as the events POST /api/compare streams: progress,
// both companies' financials (the page looks every value up in them), each
// condensed annual report as soon as it is read (text lenses), components as
// the model shows them (or, in freeform mode, the one page it writes), then
// done or error, or blocked (sign-in or a limit, lib/access.ts) when it would
// have to run Claude and may not. A live run also sends each tool call as it
// is made and, before done, its trace (agent/trace.ts), which a saved result
// replays. The route adds a heartbeat every 15s, and serves a featured
// comparison (lib/featured.ts) itself.
export type CompareEvent =
  | { type: "progress"; step: "fetching" | "reading" | "building" | "checking" }
  | { type: "data"; companies: CompanyInput[] }
  | { type: "filing"; ticker: string; filing: NonNullable<CompanyInput["filing"]> }
  | { type: "component"; component: Component }
  | { type: "page"; html: string }
  | { type: "call"; call: TraceCall }
  | { type: "trace"; trace: Trace }
  | { type: "done"; cached: boolean; featured?: string } // featured: its generation date, YYYY-MM-DD
  | { type: "error"; message: string }
  | { type: "blocked"; reason: BlockReason }
  | { type: "heartbeat" };

// Components v2: text rows carry an icon. Freeform v2: Sonnet, minimal text.
const RESULT_VERSION: Record<Mode, number> = { components: 2, freeform: 2 };
const resultKey = (tickers: readonly string[], lens: LensSlug, mode: Mode) => `result:v${RESULT_VERSION[mode]}:${tickers.join("|")}|${lens}|${mode}`;
// A result saved before traces existed has none.
export type Result = ({ components: Component[] } | { html: string }) & { trace?: Trace };

export async function defaultBackend(): Promise<Backend> {
  if (process.env.CLAUDE_AUTH === "login") return (await import("../agent/backends/login.ts")).loginBackend;
  return (await import("../agent/backends/api.ts")).apiBackend();
}

export const backendName = (): BackendName => (process.env.CLAUDE_AUTH === "login" ? "login" : "api");

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

const withFiscalYear = (c: CompanyInput, filing: CondensedFiling) => {
  const i = c.financials.periodEnds.indexOf(filing.report.periodEnd);
  return { ...filing, fiscalYear: i >= 0 ? c.financials.fiscalYears[i] : Number(filing.report.periodEnd.slice(0, 4)) };
};

// Reads the company's latest 10-K into c.filing (text lenses).
export async function attachFiling(c: CompanyInput, backend: Backend, signal: AbortSignal): Promise<void> {
  const cik = c.financials.cik;
  const report = await getAnnualReport(cik);
  if (!report) throw new ComparisonError(`${c.ticker} has no 10-K annual report to read.`);
  c.filing = withFiscalYear(c, await getCondensedFiling({ cik, name: c.name, report, model: backend, signal }));
}

// A comparison as saved, for its standalone process page: never runs Claude.
// A 10-K that was never condensed stays unread.
export async function savedComparison(tickers: readonly [string, string], lens: LensSlug, mode: Mode): Promise<{ companies: CompanyInput[]; result: Result | null }> {
  const companies = await Promise.all(tickers.map(loadCompany));
  const cache = getCache();
  if (LENS_GUIDANCE[lens].needsFilings) {
    await Promise.all(
      companies.map(async (c) => {
        const report = await getAnnualReport(c.financials.cik);
        const filing = report && ((await cache.get(condensedFilingKey(report.accn))) as CondensedFiling | undefined);
        if (filing) c.filing = withFiscalYear(c, filing);
      }),
    );
  }
  return { companies, result: ((await cache.get(resultKey(tickers, lens, mode))) as Result | undefined) ?? null };
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
  const at = new Date().toISOString();
  let mark = performance.now();
  const lap = () => {
    const now = performance.now();
    const ms = Math.round(now - mark);
    mark = now;
    return ms;
  };
  try {
    emit({ type: "progress", step: "fetching" });
    const companies = await Promise.all(tickers.map(loadCompany));
    emit({ type: "data", companies: companies.map((c) => ({ ...c })) });
    const fetching = lap();
    const backend = opts.backend ?? (await defaultBackend());
    let reading: number | null = null;
    if (LENS_GUIDANCE[lens].needsFilings) {
      emit({ type: "progress", step: "reading" });
      await Promise.all(
        companies.map(async (c) => {
          await attachFiling(c, backend, opts.signal);
          emit({ type: "filing", ticker: c.ticker, filing: c.filing! });
        }),
      );
      reading = lap();
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
        if (hit.trace) emit({ type: "trace", trace: hit.trace });
        emit({ type: "done", cached: true });
        return;
      }
    }

    emit({ type: "progress", step: "building" });
    lap();
    const calls: TraceCall[] = [];
    const onCall = (call: Omit<TraceCall, "ms">) => {
      const recorded = traceCall(call, Math.round(performance.now() - mark));
      calls.push(recorded);
      emit({ type: "call", call: recorded });
    };
    const generated =
      mode === "freeform"
        ? await generatePage({ lens, companies, backend, signal: opts.signal, onCall })
        : await generateComparison({ lens, companies, backend, signal: opts.signal, onCall, onComponent: (component) => emit({ type: "component", component }) });
    const output = "html" in generated ? { html: generated.html } : { components: generated.components };
    if ("html" in output) show(output);
    const composing = lap();

    // A finding is shown with the trace; the page still displays.
    emit({ type: "progress", step: "checking" });
    const checks = liveChecks(output, lens, companies);
    const trace: Trace = {
      v: 1,
      mode,
      lens,
      model: generated.model,
      backend: backendName(),
      at,
      ms: { fetching, reading, composing, checks: lap() },
      usage: generated.usage,
      offered: generated.offered,
      prompt: generated.prompt,
      calls,
      checks,
    };
    emit({ type: "trace", trace });
    // No TTL: a result is replaced only by Regenerate.
    await cache.set(key, { ...output, trace } satisfies Result).catch((err) => console.error(`[compare] cache write failed for ${key}:`, err));
    emit({ type: "done", cached: false });
  } catch (err) {
    if (err instanceof Blocked) return emit({ type: "blocked", reason: err.reason });
    if (err instanceof ComparisonError) return emit({ type: "error", message: err.message });
    console.error("[compare] failed:", err);
    emit({ type: "error", message: "The comparison failed unexpectedly. Try again in a minute." });
  }
}
