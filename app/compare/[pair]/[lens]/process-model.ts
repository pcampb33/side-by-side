import { COMPONENT_NAMES } from "../../../../agent/catalog.ts";
import { LENS_GUIDANCE } from "../../../../agent/lenses.ts";
import type { CompanyInput } from "../../../../agent/prompt.ts";
import type { CheckId, Trace, TraceCall } from "../../../../agent/trace.ts";
import type { Mode } from "../../../../lib/compare-url.ts";
import type { LensSlug } from "../../../../lib/lenses.ts";
import { METRICS, type MetricKey } from "../../../../lib/normalize/metrics.ts";
import { valueAt } from "../../../../lib/values.ts";

// How a comparison was made, as the five steps every page shows (SPEC §4a):
// from a live stream (progress, calls, then the trace) or a stored trace. A
// result without a trace shows the general explanation for the last three.

export type StepId = "data" | "reports" | "brief" | "compose" | "checks";
// wait: not reached; run: happening now; done: finished, with this run's
// numbers; skip: not needed for this lens; none: no record (saved before traces).
export type StepState = "wait" | "run" | "done" | "skip" | "none";

export interface ProcessInput {
  lens: LensSlug;
  mode: Mode;
  status: "loading" | "error" | "done" | "blocked";
  step: "fetching" | "reading" | "building" | "checking";
  companies: CompanyInput[] | null;
  shown: number; // components (or the page) on screen
  calls: TraceCall[]; // live, before the trace arrives
  trace: Trace | null;
}

export interface StepView {
  id: StepId;
  name: string;
  about: string; // the general explanation, the same on every page
  state: StepState;
  count: string;
  backs: number; // calls sent back (compose only)
}

export const STEP_NAMES: Record<StepId, string> = {
  data: "SEC data",
  reports: "10-Ks read",
  brief: "Lens brief",
  compose: "Claude composes",
  checks: "Checks",
};

export const STEP_ABOUT: Record<StepId, string> = {
  data: "Each company's reported financials, read from its SEC XBRL filings. Every value keeps the filing it came from, so the page can cite it.",
  reports: "Claude Haiku condensed each annual report's business and risk sections into themes; code checked every quote word for word against the filing.",
  brief: "What this lens asks and which components usually answer it. Claude chooses; the lens steers.",
  compose:
    "Claude Sonnet builds the page by calling components, naming metrics and years but never writing numbers. A call that breaks a rule goes back with the reason, and Claude fixes it.",
  checks: "Code reads the finished page: every number must appear in the filings, nothing not reported may show as a value, every quote must match.",
};

export const FREEFORM_COMPOSE_ABOUT =
  "Claude Sonnet writes the whole page itself, from the same data. A page that loads anything from outside goes back with the reason, and Claude fixes it.";

export const CHECK_NAMES: Record<CheckId, [string, string]> = {
  numbers: ["Numbers", "Every number on the page is a value in the filings, within rounding."],
  notReported: ["Not reported", "No missing metric is shown as a value or a zero."],
  quotes: ["Quotes", "Every quote matches its 10-K word for word."],
  components: ["Components", "Each call is valid, offered in this lens, and the page has what the lens needs."],
  page: ["Self-contained", "The page loads nothing from outside itself."],
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

// Metrics a company reports in none of its years.
export function notReported(c: CompanyInput): MetricKey[] {
  return METRIC_KEYS.filter((k) => c.financials.fiscalYears.every((fy) => valueAt(c.financials, k, fy).status !== "value"));
}

// The lens's annual-report items: risks or business areas.
export function reportItems(lens: LensSlug, c: CompanyInput) {
  if (!c.filing) return [];
  return lens === "where-they-compete" ? c.filing.areas.map((a) => ({ name: a.name, quotes: a.quotes.length })) : c.filing.risks.map((r) => ({ name: r.theme, quotes: r.quotes.length }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function findingCount(trace: Trace): number {
  return trace.checks.reduce((n, c) => n + c.findings.length, 0);
}

export function processSteps(p: ProcessInput): StepView[] {
  const { companies, trace } = p;
  const needsReports = LENS_GUIDANCE[p.lens].needsFilings;
  const loading = p.status === "loading";
  const calls = trace?.calls ?? p.calls;
  const backs = calls.filter((c) => !c.ok).length;
  const shownCalls = calls.length - backs;
  const composing = loading && p.step === "building";
  const checking = loading && p.step === "checking";
  const reportsDone = !!companies?.every((c) => c.filing);
  // A step is reached once the stream has moved past it.
  const order = ["fetching", "reading", "building", "checking"] as const;
  const reached = (s: (typeof order)[number]) => order.indexOf(p.step) >= order.indexOf(s);
  const until = (running: boolean, done: boolean): StepState => (done ? "done" : running && loading ? "run" : "wait");

  const missing = companies?.flatMap((c) => notReported(c).map((k) => `${c.ticker} ${METRICS[k].label}`)) ?? [];
  const years = companies ? Math.max(...companies.map((c) => c.financials.fiscalYears.length)) : 0;
  const data: StepView = {
    id: "data",
    name: STEP_NAMES.data,
    about: STEP_ABOUT.data,
    state: until(true, !!companies),
    count: companies ? (missing.length ? `${METRIC_KEYS.length} metrics · ${missing.length} not reported` : `${METRIC_KEYS.length} metrics × ${years} yrs`) : "fetching",
    backs: 0,
  };

  const items = companies?.flatMap((c) => reportItems(p.lens, c)) ?? [];
  const reports: StepView = {
    id: "reports",
    name: STEP_NAMES.reports,
    about: STEP_ABOUT.reports,
    state: needsReports ? until(reached("reading"), reportsDone) : "skip",
    count: !needsReports ? "not needed" : reportsDone ? `${plural(items.length, "theme")} · ${plural(items.reduce((n, i) => n + i.quotes, 0), "quote")}` : "reading",
    backs: 0,
  };

  // Generation started (or a trace says it did): the brief was given.
  const started = !!trace || composing || checking || calls.length > 0;
  const total = p.mode === "freeform" ? 1 : COMPONENT_NAMES.length;
  const brief: StepView = {
    id: "brief",
    name: STEP_NAMES.brief,
    about: STEP_ABOUT.brief,
    state: trace || started ? "done" : p.status === "done" ? "none" : "wait",
    count:
      trace || started
        ? p.mode === "freeform"
          ? "a page of its own"
          : `${trace?.offered.length ?? total - LENS_GUIDANCE[p.lens].excluded.length} of ${total} offered`
        : "what the lens asks",
    backs: 0,
  };

  let composeCount = "waiting";
  if (composing && !calls.length) composeCount = "thinking";
  else if (trace || composing || checking) composeCount = `${p.mode === "freeform" ? (shownCalls ? "page written" : "writing") : `${shownCalls} shown`}${backs ? ` · ${backs} sent back` : ""}`;
  else if (p.status === "done") composeCount = p.mode === "freeform" ? "one page" : plural(p.shown, "component");
  const compose: StepView = {
    id: "compose",
    name: STEP_NAMES.compose,
    about: p.mode === "freeform" ? FREEFORM_COMPOSE_ABOUT : STEP_ABOUT.compose,
    state: trace || checking ? "done" : composing ? "run" : p.status === "done" ? "none" : "wait",
    count: composeCount,
    backs,
  };

  const findings = trace ? findingCount(trace) : 0;
  const checks: StepView = {
    id: "checks",
    name: STEP_NAMES.checks,
    about: STEP_ABOUT.checks,
    state: trace ? "done" : checking ? "run" : p.status === "done" ? "none" : "wait",
    count: trace ? (findings ? plural(findings, "finding") : "all pass") : checking ? "checking" : p.status === "done" ? "not recorded" : "waiting",
    backs: 0,
  };

  return [data, reports, brief, compose, checks];
}

// The step a live run is on, for the panel to follow.
export function currentStep(steps: StepView[]): number {
  return steps.findIndex((s) => s.state === "run");
}
