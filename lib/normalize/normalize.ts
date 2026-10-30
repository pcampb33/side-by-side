import type { CompanyFacts, FactEntry } from "../sec/client.ts";
import { METRICS, type MetricKey } from "./metrics.ts";

export const YEARS = 5;
// Part of the cache key: bump it when the output shape or a tag choice
// changes, so payloads cached by the old code are not served.
export const NORMALIZE_VERSION = 1;

export interface Source {
  accn: string;
  form: string;
  filingFy: number; // the filing's own fiscal year; a 10-K also restates prior years
  filed: string;
  periodEnd: string;
  tag: string;
}

export type MetricValue = { status: "reported"; value: number; source: Source } | { status: "not_reported" };

// not_reported: an input is not reported. not_meaningful: the inputs exist
// but the ratio would mislead (e.g. debt-to-equity with negative equity).
export type DerivedValue = { status: "computed"; value: number } | { status: "not_reported" } | { status: "not_meaningful" };

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const MAX_RUNWAY_YEARS = 10;

// Computed in code, never by the model. Ratios are fractions (0.25 = 25%).
export const DERIVED = {
  grossMargin: {
    label: "Gross margin",
    formula: "Gross profit ÷ revenue",
    inputs: ["grossProfit", "revenue"],
    compute: (m) => ratio(m.grossProfit, m.revenue),
  },
  operatingMargin: {
    label: "Operating margin",
    formula: "Operating income ÷ revenue",
    inputs: ["operatingIncome", "revenue"],
    compute: (m) => ratio(m.operatingIncome, m.revenue),
  },
  netMargin: { label: "Net margin", formula: "Net income ÷ revenue", inputs: ["netIncome", "revenue"], compute: (m) => ratio(m.netIncome, m.revenue) },
  revenueGrowth: {
    label: "Revenue growth (YoY)",
    formula: "Revenue vs the prior fiscal year",
    inputs: ["revenue"],
    compute: (m, prior) => (prior.revenue === undefined ? undefined : ratio(m.revenue - prior.revenue, prior.revenue)),
  },
  freeCashFlow: {
    label: "Free cash flow",
    formula: "Operating cash flow − capital expenditure",
    inputs: ["operatingCashFlow", "capex"],
    compute: (m) => m.operatingCashFlow - m.capex,
  },
  debtToEquity: {
    label: "Long-term debt to equity",
    formula: "Long-term debt ÷ shareholders' equity",
    inputs: ["longTermDebt", "equity"],
    compute: (m) => ratio(m.longTermDebt, m.equity),
  },
  rndToRevenue: { label: "R&D % of revenue", formula: "R&D ÷ revenue", inputs: ["rnd", "revenue"], compute: (m) => ratio(m.rnd, m.revenue) },
  // Years of cash at the current burn rate. Only meaningful while burning
  // cash fast enough for it to matter: F's FY2022 burn of $13M against $25B
  // of cash would otherwise read as a 1,933-year runway.
  cashRunwayYears: {
    label: "Cash runway (years)",
    formula: "Cash ÷ annual cash burn (capex − operating cash flow), shown only up to 10 years",
    inputs: ["cash", "operatingCashFlow", "capex"],
    compute: (m) => {
      const burn = m.capex - m.operatingCashFlow;
      const years = burn > 0 ? m.cash / burn : Infinity;
      return years <= MAX_RUNWAY_YEARS ? years : null;
    },
  },
} as const satisfies Record<
  string,
  {
    label: string;
    formula: string;
    inputs: readonly MetricKey[];
    // null = not meaningful, undefined = not reported (prior year missing)
    compute: (m: Record<MetricKey, number>, prior: Partial<Record<MetricKey, number>>) => number | null | undefined;
  }
>;

export type DerivedKey = keyof typeof DERIVED;

export interface NormalizedFinancials {
  cik: number;
  name: string;
  fiscalYears: number[]; // ascending; every series below is aligned with it
  periodEnds: string[];
  metrics: Record<MetricKey, MetricValue[]>;
  derived: Record<DerivedKey, DerivedValue[]>;
}

export class NoAnnualDataError extends Error {
  readonly cik: number;
  constructor(cik: number) {
    super(`No 10-K financial data for CIK ${cik} (not a US GAAP annual filer?)`);
    this.cik = cik;
  }
}

const isAnnualForm = (form: string) => form === "10-K" || form === "10-K/A";

function isAnnualDuration(e: FactEntry): boolean {
  if (!e.start) return false;
  const days = (Date.parse(e.end) - Date.parse(e.start)) / 86_400_000;
  return days >= 350 && days <= 380; // 52/53-week years included
}

// A 10-K's own fiscal year ends at the latest annual-duration period it
// reports (the rest are prior-year comparatives); that pins each period-end
// date to the company's fiscal-year label, and each filing to its own year.
function fiscalCalendar(entries: FactEntry[]) {
  const filings = new Map<string, { end: string; fy: number | null; filed: string }>();
  for (const e of entries) {
    if (!isAnnualDuration(e)) continue;
    const f = filings.get(e.accn);
    if (!f || e.end > f.end) filings.set(e.accn, { end: e.end, fy: e.fy, filed: e.filed });
  }
  const endByFy = new Map<number, string>();
  const fyByEnd = new Map<string, number>();
  for (const f of [...filings.values()].sort((a, b) => a.filed.localeCompare(b.filed))) {
    const fy = f.fy ?? Number(f.end.slice(0, 4));
    if (endByFy.has(fy) || fyByEnd.has(f.end)) continue; // amendments repeat the original's year
    endByFy.set(fy, f.end);
    fyByEnd.set(f.end, fy);
  }
  const fyByAccn = new Map([...filings].map(([accn, f]) => [accn, fyByEnd.get(f.end)]));
  return { endByFy, fyByAccn };
}

export function normalize(facts: CompanyFacts): NormalizedFinancials {
  const gaap = facts.facts["us-gaap"] ?? {};
  const entriesByMetric = Object.fromEntries(
    Object.entries(METRICS).map(([key, def]) => [
      key,
      def.tags.map((tag) => ({
        tag,
        entries: (gaap[tag]?.units[def.unit] ?? []).filter((e) => isAnnualForm(e.form)),
      })),
    ]),
  ) as Record<MetricKey, { tag: string; entries: FactEntry[] }[]>;

  const { endByFy, fyByAccn } = fiscalCalendar(
    Object.values(entriesByMetric).flatMap((tags) => tags.flatMap((t) => t.entries)),
  );
  if (endByFy.size === 0) throw new NoAnnualDataError(facts.cik);

  // One extra year so the oldest shown year still gets YoY growth.
  const allYears = [...endByFy.keys()].sort((a, b) => a - b).slice(-(YEARS + 1));

  const lookup = (key: MetricKey, end: string): MetricValue => {
    for (const { tag, entries } of entriesByMetric[key]) {
      let best: FactEntry | undefined;
      for (const e of entries) {
        if (e.end !== end || (e.start && !isAnnualDuration(e))) continue;
        if (!best || e.filed > best.filed) best = e; // latest filing carries restatements
      }
      if (best) {
        return {
          status: "reported",
          value: best.val,
          source: {
            accn: best.accn,
            form: best.form,
            filingFy: fyByAccn.get(best.accn) ?? best.fy ?? Number(best.filed.slice(0, 4)),
            filed: best.filed,
            periodEnd: end,
            tag,
          },
        };
      }
    }
    return { status: "not_reported" };
  };

  const allMetrics = Object.fromEntries(
    (Object.keys(METRICS) as MetricKey[]).map((key) => [key, allYears.map((fy) => lookup(key, endByFy.get(fy)!))]),
  ) as Record<MetricKey, MetricValue[]>;

  const valuesAt = (i: number): Partial<Record<MetricKey, number>> => {
    const out: Partial<Record<MetricKey, number>> = {};
    if (i < 0) return out;
    for (const key of Object.keys(allMetrics) as MetricKey[]) {
      const v = allMetrics[key][i];
      if (v.status === "reported") out[key] = v.value;
    }
    return out;
  };

  const shown = allYears.slice(-YEARS);
  const offset = allYears.length - shown.length;

  const derived = Object.fromEntries(
    (Object.keys(DERIVED) as DerivedKey[]).map((key) => {
      const def = DERIVED[key];
      const series = shown.map((fy, j): DerivedValue => {
        const i = j + offset;
        const current = valuesAt(i);
        if (def.inputs.some((input) => current[input] === undefined)) return { status: "not_reported" };
        const prior = allYears[i - 1] === fy - 1 ? valuesAt(i - 1) : {};
        const value = def.compute(current as Record<MetricKey, number>, prior);
        if (value === undefined) return { status: "not_reported" };
        if (value === null || !Number.isFinite(value)) return { status: "not_meaningful" };
        return { status: "computed", value };
      });
      return [key, series];
    }),
  ) as Record<DerivedKey, DerivedValue[]>;

  return {
    cik: facts.cik,
    name: facts.entityName,
    fiscalYears: shown,
    periodEnds: shown.map((fy) => endByFy.get(fy)!),
    metrics: Object.fromEntries(
      Object.entries(allMetrics).map(([key, series]) => [key, series.slice(offset)]),
    ) as Record<MetricKey, MetricValue[]>,
    derived,
  };
}
