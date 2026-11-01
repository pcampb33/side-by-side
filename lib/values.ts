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

// What each value means, in plain words, for the info popovers beside chart titles and labels.
const ABOUT: Record<ValueKey, string> = {
  revenue: "Total sales of goods and services in the fiscal year, before any costs.",
  grossProfit: "Revenue minus the direct cost of making or delivering what was sold.",
  operatingIncome: "Profit from the core business after operating costs (cost of sales, R&D, selling and admin), before interest and taxes.",
  netIncome: "The bottom line: profit after every cost, interest and tax.",
  rnd: "Spending on research and development, as reported in the income statement.",
  cash: "Cash and cash equivalents (very short-term, liquid investments) at fiscal year end.",
  totalAssets: "Everything the company owns or is owed, at book value, at fiscal year end.",
  totalLiabilities: "Everything the company owes (debt, payables, deferred revenue and other obligations) at fiscal year end.",
  longTermDebt: "Long-term borrowings (bonds, notes and loans) at fiscal year end.",
  equity: "Book value: total assets minus total liabilities, the owners' stake on the balance sheet.",
  operatingCashFlow: "Cash the business generated from its operations in the year, after paying suppliers, staff and taxes.",
  capex: "Cash spent on property, plant and equipment (factories, data centers, stores) in the year.",
  dividendsPaid: "Cash paid to shareholders as dividends in the year.",
  buybacks: "Cash spent buying back the company's own shares in the year.",
  dilutedEps: "Net income per share, counting the extra shares that options and convertible securities could create.",
  sharesOutstanding: "The number of common shares, as reported.",
  grossMargin: "The share of revenue left after the direct cost of sales: a sign of pricing power and production cost.",
  operatingMargin: "The share of revenue left after all operating costs: how profitable the core business is.",
  netMargin: "The share of revenue kept as net income, after every cost, interest and tax.",
  revenueGrowth: "How much revenue changed from the prior fiscal year.",
  freeCashFlow: "Cash from operations left after capital spending: what can fund dividends, buybacks, debt repayment or savings.",
  debtToEquity: "Long-term debt per dollar of shareholders' equity: how much of the business is funded by borrowing.",
  rndToRevenue: "R&D spending as a share of revenue: how much of each sales dollar goes back into development.",
  cashRunwayYears: "Years the cash would last at the current burn, for a company whose operations don't cover its capital spending.",
};

export function valueDef(key: ValueKey): { label: string; unit: Unit; formula?: string; about: string } {
  if (isDerived(key)) return { label: DERIVED[key].label, unit: DERIVED_UNITS[key], formula: DERIVED[key].formula, about: ABOUT[key] };
  return { label: METRICS[key].label, unit: METRIC_UNITS[METRICS[key].unit], about: ABOUT[key] };
}

export type Value =
  | { status: "value"; value: number; sources: Source[]; formula?: string }
  | { status: "not_reported" }
  | { status: "not_meaningful" }
  | { status: "no_such_year" };

// `fy` is a fiscal-year label (2025), or "latest" for the company's own latest year.
export function valueAt(f: NormalizedFinancials, key: ValueKey, fy: number | "latest"): Value {
  const i = fy === "latest" ? f.fiscalYears.length - 1 : f.fiscalYears.indexOf(fy);
  if (i < 0) return { status: "no_such_year" };
  if (!isDerived(key)) {
    const v = f.metrics[key][i];
    return v.status === "reported" ? { status: "value", value: v.value, sources: v.sources, formula: v.formula } : { status: "not_reported" };
  }
  const v = f.derived[key][i];
  if (v.status !== "computed") return { status: v.status };
  // A derived value cites the filings of its inputs (and, for growth, the prior year's revenue).
  const sources = DERIVED[key].inputs.flatMap((input) => {
    const m = f.metrics[input][i];
    return m.status === "reported" ? m.sources : [];
  });
  const prior = key === "revenueGrowth" && i > 0 ? f.metrics.revenue[i - 1] : undefined;
  if (prior?.status === "reported") sources.push(...prior.sources);
  return { status: "value", value: v.value, sources };
}

export const fiscalYearOf = (f: NormalizedFinancials, fy: number | "latest") => (fy === "latest" ? f.fiscalYears.at(-1)! : fy);
