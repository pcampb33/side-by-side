import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { CompanyFacts, FactEntry } from "../sec/client.ts";
import { METRICS, type MetricKey } from "./metrics.ts";
import { NoAnnualDataError, normalize, type MetricValue } from "./normalize.ts";

// Fixtures are real SEC filings saved by `npm run fixtures:sec`. Refreshing
// them after a new 10-K shifts the fiscal years asserted here.
const load = (ticker: string) =>
  normalize(JSON.parse(fs.readFileSync(new URL(`./fixtures/${ticker}.json`, import.meta.url), "utf8")));

const reported = (v: MetricValue) => {
  if (v.status !== "reported") throw new Error(`expected a reported value, got ${v.status}`);
  return v;
};

describe("normalize on the six R2 filers", () => {
  const cases: { ticker: string; years: number[]; notReported: MetricKey[] }[] = [
    { ticker: "AAPL", years: [2021, 2022, 2023, 2024, 2025], notReported: [] },
    { ticker: "MSFT", years: [2022, 2023, 2024, 2025, 2026], notReported: [] },
    { ticker: "NVDA", years: [2022, 2023, 2024, 2025, 2026], notReported: [] },
    // KO files no R&D line and no total-liabilities tag.
    { ticker: "KO", years: [2021, 2022, 2023, 2024, 2025], notReported: ["rnd", "totalLiabilities"] },
    // F has no gross profit line; its long-term debt is only in Ford-specific tags.
    { ticker: "F", years: [2021, 2022, 2023, 2024, 2025], notReported: ["grossProfit", "longTermDebt"] },
    // A bank: no gross profit, operating income, R&D or capex.
    { ticker: "JPM", years: [2021, 2022, 2023, 2024, 2025], notReported: ["grossProfit", "operatingIncome", "rnd", "capex"] },
  ];

  it.each(cases)("$ticker: every metric is reported with a source or explicitly not reported", ({ ticker, years, notReported }) => {
    const n = load(ticker);
    expect(n.fiscalYears).toEqual(years);
    for (const key of Object.keys(METRICS) as MetricKey[]) {
      const series = n.metrics[key];
      expect(series).toHaveLength(years.length);
      series.forEach((v, i) => {
        if (notReported.includes(key)) {
          expect(v, `${ticker} ${key} FY${years[i]}`).toEqual({ status: "not_reported" });
          return;
        }
        const { value, source } = reported(v);
        expect(Number.isFinite(value)).toBe(true);
        expect(METRICS[key].tags).toContain(source.tag);
        expect(source.accn).toMatch(/^\d{10}-\d{2}-\d{6}$/);
        expect(source.form).toMatch(/^10-K/);
        expect(source.periodEnd).toBe(n.periodEnds[i]);
        expect(source.filingFy).toBeGreaterThanOrEqual(years[i]);
      });
    }
  });

  it("derives AAPL FY2025 ratios matching a hand calculation from the 10-K", () => {
    const n = load("AAPL");
    const i = n.fiscalYears.indexOf(2025);
    // Revenue 416,161 · gross profit 195,201 · operating income 133,050 · net income 112,010
    // R&D 34,550 · OCF 111,482 · capex 12,715 · LT debt 78,328 · equity 73,733 ($M);
    // FY2024 revenue 391,035.
    expect(reported(n.metrics.revenue[i]).value).toBe(416_161_000_000);
    const d = (key: keyof typeof n.derived) => {
      const v = n.derived[key][i];
      if (v.status !== "computed") throw new Error(`${key} is ${v.status}`);
      return v.value;
    };
    expect(d("grossMargin")).toBeCloseTo(0.46905, 5);
    expect(d("operatingMargin")).toBeCloseTo(0.31971, 5);
    expect(d("netMargin")).toBeCloseTo(0.26915, 5);
    expect(d("revenueGrowth")).toBeCloseTo(0.06426, 5);
    expect(d("freeCashFlow")).toBe(98_767_000_000);
    expect(d("debtToEquity")).toBeCloseTo(1.06232, 5);
    expect(d("rndToRevenue")).toBeCloseTo(0.08302, 5);
    expect(n.derived.cashRunwayYears[i]).toEqual({ status: "not_meaningful" });
  });

  it("cites the latest filing for a restated prior year", () => {
    const n = load("AAPL");
    const { source } = reported(n.metrics.revenue[n.fiscalYears.indexOf(2024)]);
    expect(source).toMatchObject({ accn: "0000320193-25-000079", filingFy: 2025, periodEnd: "2024-09-28" });
  });

  it("gives the oldest shown year YoY growth from the year before it", () => {
    expect(load("AAPL").derived.revenueGrowth[0].status).toBe("computed");
  });

  it("falls back per year when a filer switches tags", () => {
    const ko = load("KO");
    expect(ko.metrics.longTermDebt.map((v) => reported(v).source.tag)).toEqual([
      "LongTermDebtNoncurrent",
      "LongTermDebtNoncurrent",
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligations",
      "LongTermDebtAndCapitalLeaseObligations",
    ]);
    const f = load("F");
    const fy2025 = f.fiscalYears.indexOf(2025);
    expect(reported(f.metrics.revenue[fy2025])).toMatchObject({
      value: 187_267_000_000,
      source: { tag: "RevenueFromContractWithCustomerExcludingAssessedTax" },
    });
    expect(reported(f.metrics.netIncome[fy2025])).toMatchObject({
      value: -8_182_000_000,
      source: { tag: "NetIncomeLossAvailableToCommonStockholdersBasic" },
    });
  });

  it("labels fiscal years the way the filer does", () => {
    const nvda = load("NVDA");
    expect(nvda.periodEnds.at(-1)).toBe("2026-01-25"); // NVIDIA's fiscal 2026
  });

  it("propagates not reported into derived values", () => {
    const jpm = load("JPM");
    expect(jpm.derived.grossMargin.every((v) => v.status === "not_reported")).toBe(true);
    expect(jpm.derived.freeCashFlow.every((v) => v.status === "not_reported")).toBe(true);
    expect(load("F").derived.debtToEquity.every((v) => v.status === "not_reported")).toBe(true);
  });

  it("does not report a runway for a negligible burn", () => {
    const f = load("F");
    // FY2022: free cash flow -$13M against $25.1B of cash.
    expect(f.derived.cashRunwayYears[f.fiscalYears.indexOf(2022)]).toEqual({ status: "not_meaningful" });
  });
});

describe("normalize edge cases", () => {
  // Filing "A" is the FY2024 10-K, "B" the FY2025 one; each is filed the February after.
  const filing = (accn: string, fy: number, end: string, val: number, start?: string): FactEntry => ({
    start,
    end,
    val,
    accn,
    fy,
    fp: "FY",
    form: "10-K",
    filed: `${fy + 1}-02-01`,
  });
  const annual = (accn: string, fy: number, year: number, val: number) =>
    filing(accn, fy, `${year}-12-31`, val, `${year}-01-01`);
  const instant = (accn: string, fy: number, year: number, val: number) => filing(accn, fy, `${year}-12-31`, val);
  const company = (tags: Record<string, FactEntry[]>): CompanyFacts => ({
    cik: 1,
    entityName: "Test Co",
    facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, list]) => [tag, { units: { USD: list } }])) },
  });

  it("prefers the latest filing's restated value and computes growth across it", () => {
    const n = normalize(
      company({
        Revenues: [
          annual("A", 2024, 2024, 100),
          annual("A", 2024, 2023, 90),
          annual("B", 2025, 2025, 120),
          annual("B", 2025, 2024, 105),
        ],
      }),
    );
    expect(n.fiscalYears).toEqual([2024, 2025]);
    expect(n.metrics.revenue.map((v) => reported(v).value)).toEqual([105, 120]);
    // No 10-K covers FY2023 as its own year, so FY2024 has no prior year.
    expect(n.derived.revenueGrowth[0]).toEqual({ status: "not_reported" });
    expect(n.derived.revenueGrowth[1]).toEqual({ status: "computed", value: (120 - 105) / 105 });
  });

  it("ignores a fourth-quarter value that ends on the fiscal year end", () => {
    const n = normalize(
      company({
        Revenues: [annual("A", 2024, 2024, 100), filing("A", 2024, "2024-12-31", 30, "2024-10-01")],
      }),
    );
    expect(reported(n.metrics.revenue[0]).value).toBe(100);
  });

  it("marks debt-to-equity not meaningful when equity is negative", () => {
    const n = normalize(
      company({
        Revenues: [annual("A", 2024, 2024, 100)],
        LongTermDebtNoncurrent: [instant("A", 2024, 2024, 50)],
        StockholdersEquity: [instant("A", 2024, 2024, -10)],
      }),
    );
    expect(n.derived.debtToEquity[0]).toEqual({ status: "not_meaningful" });
  });

  it("reports a runway while burning cash fast enough to matter", () => {
    const n = normalize(
      company({
        Revenues: [annual("A", 2024, 2024, 100)],
        CashAndCashEquivalentsAtCarryingValue: [instant("A", 2024, 2024, 300)],
        NetCashProvidedByUsedInOperatingActivities: [annual("A", 2024, 2024, -80)],
        PaymentsToAcquirePropertyPlantAndEquipment: [annual("A", 2024, 2024, 20)],
      }),
    );
    expect(n.derived.cashRunwayYears[0]).toEqual({ status: "computed", value: 3 });
  });

  it("throws instead of returning an empty result when there is no 10-K data", () => {
    expect(() => normalize({ cik: 42, entityName: "Foreign Filer", facts: {} })).toThrow(NoAnnualDataError);
  });
});
