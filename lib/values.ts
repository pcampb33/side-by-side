import { METRICS, type MetricKey } from "./normalize/metrics.ts";
import { DERIVED, type DerivedKey, type NormalizedFinancials, type Source } from "./normalize/normalize.ts";

// One lookup for every number on a page, reported or derived, so the prompt,
// the renderer and the citations all read the same value the same way.

export type ValueKey = MetricKey | DerivedKey;
export type Unit = "usd" | "usdPerShare" | "shares" | "percent" | "multiple" | "years";

const METRIC_UNITS: Record<string, Unit> = { USD: "usd", "USD/shares": "usdPerShare", shares: "shares" };
const DERIVED_UNITS: Record<DerivedKey, Unit> = {
  grossMargin: "percent",
  operatingMargin: "percent",
  netMargin: "percent",
  revenueGrowth: "percent",
  freeCashFlow: "usd",
  debtToEquity: "multiple",
  rndToRevenue: "percent",
  cashRunwayYears: "years",
};

export const VALUE_KEYS = [...Object.keys(METRICS), ...Object.keys(DERIVED)] as [ValueKey, ...ValueKey[]];

export const isDerived = (key: ValueKey): key is DerivedKey => key in DERIVED;

export function valueDef(key: ValueKey): { label: string; unit: Unit; formula?: string } {
  if (isDerived(key)) return { label: DERIVED[key].label, unit: DERIVED_UNITS[key], formula: DERIVED[key].formula };
  return { label: METRICS[key].label, unit: METRIC_UNITS[METRICS[key].unit] };
}

export type Value =
  | { status: "value"; value: number; sources: Source[] }
  | { status: "not_reported" }
  | { status: "not_meaningful" }
  | { status: "no_such_year" };

// `fy` is a fiscal-year label (2025), or "latest" for the company's own latest year.
export function valueAt(f: NormalizedFinancials, key: ValueKey, fy: number | "latest"): Value {
  const i = fy === "latest" ? f.fiscalYears.length - 1 : f.fiscalYears.indexOf(fy);
  if (i < 0) return { status: "no_such_year" };
  if (!isDerived(key)) {
    const v = f.metrics[key][i];
    return v.status === "reported" ? { status: "value", value: v.value, sources: [v.source] } : { status: "not_reported" };
  }
  const v = f.derived[key][i];
  if (v.status !== "computed") return { status: v.status };
  // A derived value cites the filings of its inputs (and, for growth, the prior year's revenue).
  const sources = DERIVED[key].inputs.flatMap((input) => {
    const m = f.metrics[input][i];
    return m.status === "reported" ? [m.source] : [];
  });
  const prior = key === "revenueGrowth" && i > 0 ? f.metrics.revenue[i - 1] : undefined;
  if (prior?.status === "reported") sources.push(prior.source);
  return { status: "value", value: v.value, sources };
}

export const fiscalYearOf = (f: NormalizedFinancials, fy: number | "latest") => (fy === "latest" ? f.fiscalYears.at(-1)! : fy);
