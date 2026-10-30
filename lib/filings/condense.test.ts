import { describe, expect, it } from "vitest";
import { ComparisonError, type Backend } from "../../agent/run.ts";
import { condenseAnnualReport, latestAnnualReport } from "./condense.ts";
import type { Submissions } from "../sec/client.ts";

const text = [
  "ITEM 1. BUSINESS",
  "We make widgets for hospitals and clinics in North America.",
  "Our widgets compete with products from larger device makers.",
  "ITEM 1A. RISK FACTORS",
  "A shortage of sensors from our single supplier could halt production.",
  "New privacy rules could raise the cost of selling to hospitals.",
  "ITEM 2. PROPERTIES",
].join("\n");
const report = { accn: "0000000000-26-000001", filed: "2026-01-30", periodEnd: "2025-12-31", document: "10k.htm" };
const signal = new AbortController().signal;
const usage = { inputTokens: 1, outputTokens: 1 };

// A backend that answers with one fixed summary.
const answering = (summary: unknown): Backend => async (run) => {
  expect(run.model).toBe("claude-haiku-5-5");
  expect(run.tools[0].handle(summary).ok).toBe(true);
  return usage;
};
const area = (name: string, quotes: string[]) => ({ name, description: `${name}, sold to hospitals.`, quotes });
const risk = (theme: string, quotes: string[]) => ({ theme, summary: `${theme} could hurt results.`, quotes });

describe("condenseAnnualReport", () => {
  it("keeps verified quotes with their section and drops invented ones", async () => {
    const summary = {
      overview: "Makes widgets for hospitals.",
      areas: [
        area("Widgets", ["We make widgets for hospitals and clinics in North America."]),
        area("Services", ["We also service every widget we sell, worldwide."]), // not in the filing
        area("Competition", ["Our widgets compete with products from larger device makers."]),
        area("Repairs", ["We repair every widget we sell within a single day."]), // not in the filing
      ],
      risks: [
        risk("Supply", ["A shortage of sensors from our single supplier could halt production.", "Sensors have been scarce across the industry for years."]),
        risk("Privacy", ["New privacy rules could raise the cost of selling to hospitals."]),
        risk("Competition", ["Our widgets compete with products from larger device makers."]),
        risk("Tariffs", ["Tariffs on imported components could raise our costs."]),
        risk("Cyber", ["Attackers could take our widget network offline for weeks."]),
      ],
    };
    const result = await condenseAnnualReport({ name: "Widget Co", report, text, backend: answering(summary), signal });
    expect(result.areas.map((a) => [a.id, a.name])).toEqual([["a1", "Widgets"], ["a2", "Competition"]]);
    expect(result.risks.map((r) => [r.id, r.theme, r.quotes.length])).toEqual([["r1", "Supply", 1], ["r2", "Privacy", 1], ["r3", "Competition", 1]]);
    expect(result.risks[2].quotes[0].section).toBe("Item 1");
    expect(result.risks[0].quotes[0].section).toBe("Item 1A");
    expect(result.droppedQuotes).toBe(5);
  });

  it("is an error when no quote verifies, never an empty summary", async () => {
    const fake = (s: string) => [`${s} is a passage that is nowhere in it.`];
    const summary = {
      overview: "Makes widgets for hospitals.",
      areas: ["Alpha", "Beta", "Gamma", "Delta"].map((n) => area(n, fake(n))),
      risks: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map((n) => risk(n, fake(n))),
    };
    await expect(condenseAnnualReport({ name: "Widget Co", report, text, backend: answering(summary), signal })).rejects.toThrow(/None of the quotes/);
  });

  it("names the missing section instead of reading a filing without it", async () => {
    let called = false;
    const backend: Backend = async () => ((called = true), usage);
    const noRisks = text.replace("ITEM 1A. RISK FACTORS", "Risks");
    await expect(condenseAnnualReport({ name: "Widget Co", report, text: noRisks, backend, signal })).rejects.toThrow(ComparisonError);
    await expect(condenseAnnualReport({ name: "Widget Co", report, text: noRisks, backend, signal })).rejects.toThrow(/Risk Factors \(Item 1A\)/);
    expect(called).toBe(false);
  });

  it("is an error when the model never submits", async () => {
    await expect(condenseAnnualReport({ name: "Widget Co", report, text, backend: async () => usage, signal })).rejects.toThrow(/without a summary/);
  });
});

describe("latestAnnualReport", () => {
  const recent = (forms: string[]) =>
    ({
      filings: {
        recent: {
          form: forms,
          accessionNumber: forms.map((_, i) => `acc-${i}`),
          filingDate: forms.map((_, i) => `2026-0${i + 1}-01`),
          reportDate: forms.map(() => "2025-12-31"),
          primaryDocument: forms.map((_, i) => `doc${i}.htm`),
        },
      },
    }) as unknown as Submissions;

  it("takes the newest original 10-K, skipping amendments and other forms", () => {
    expect(latestAnnualReport(recent(["8-K", "10-K/A", "10-Q", "10-K", "10-K"]))?.accn).toBe("acc-3");
  });

  it("is null for a company that files no 10-K", () => {
    expect(latestAnnualReport(recent(["20-F", "6-K"]))).toBeNull();
  });
});
