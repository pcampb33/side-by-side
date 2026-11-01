import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Component } from "../agent/catalog.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import { checkComponents, checkLens, checkNotReported, checkNumbers, checkQuotes, componentProse, numberTokens } from "./checks.ts";

const fixture = (ticker: string): CompanyInput => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", `${ticker}.json`), "utf8"));
const apple = [fixture("AAPL"), fixture("MSFT")];
const autos = [fixture("F"), fixture("GM")];

describe("numberTokens", () => {
  it("reads units and precision, and skips counts and years", () => {
    const text = (s: string) => numberTokens(s).map((t) => t.text);
    expect(text("Revenue $416.2B, growth −2.8%, 1.73× debt, 16.4B shares, EPS $6.11, 2.3 yrs")).toEqual(["$416.2B", "2.8%", "1.73×", "16.4B", "$6.11", "2.3 yrs"]);
    expect(text("In FY2024 and 2025, 14 risk themes over 5 years (10-K, Item 1A)")).toEqual([]);
    expect(text("$6.4 billion and 164,000 employees")).toEqual(["$6.4 billion", "164,000"]);
  });
});

describe("checkNumbers", () => {
  it("accepts the payload's numbers as the prompt writes them, or rounded", () => {
    // AAPL FY2025 revenue $416.2B and growth 6.4%; MSFT FY2026 capex $115.9B.
    const r = checkNumbers(["Apple's revenue was $416.2B (FY2025), up 6.4%; Microsoft spent $115.9B on capex.", "Apple: $416B.", "Capital expenditure, $B: 115.9"], apple);
    expect(r.findings).toEqual([]);
    expect(r.checked).toBe(6); // five numbers and FY2025
  });

  it("flags computed, rounded-away and invented numbers, and unknown fiscal years", () => {
    const r = checkNumbers(["Apple's revenue was about $400B, 84.4B more than Microsoft, in FY2019."], apple);
    expect(r.findings.map((f) => f.detail.split(" ")[0])).toEqual(["$400B", "84.4B", "FY2019"]);
    expect(checkNumbers(["Capital expenditure, $B: 123.4"], apple).findings).toHaveLength(1);
  });

  it("accepts numbers that appear in the condensed annual reports", () => {
    // MSFT's tax risk: "a final tax payment of $28.9 billion".
    expect(checkNumbers(["Microsoft notes a $28.9 billion tax payment."], apple).findings).toEqual([]);
  });
});

describe("checkQuotes", () => {
  it("accepts a verified quote or a part of one, and flags anything else", () => {
    const q = apple[0].filing!.risks[0].quotes[0].text;
    const words = q.split(" ");
    const part = words.slice(0, 8).join(" ");
    expect(checkQuotes([`Apple writes “${q}”`, `It notes "${part} … ${words.slice(-6).join(" ")}"`], apple)).toEqual({ checked: 2, findings: [] });
    expect(checkQuotes(['It says "we face intense competition in every market we serve"'], apple).findings).toHaveLength(1);
  });
});

describe("checkNotReported", () => {
  it("flags a number given for a metric the company doesn't report", () => {
    // Ford reports no consolidated long-term debt (SPEC §3).
    expect(checkNotReported(["Ford's long-term debt was $99.0B."], autos)).not.toEqual([]);
    expect(checkNotReported(["Ford's long-term debt is not reported; GM's was $99.0B."], autos)).toEqual([]);
    expect(checkNotReported(["Long-term debt is reported for GM ($99.0B) but not for Ford."], autos)).toEqual([]);
    expect(checkNotReported(["Ford's revenue was $185.0B."], autos)).toEqual([]);
  });
});

const takeaways: Component = { name: "takeaways", input: { items: ["One neutral difference.", "Another difference.", "A third difference."] } };

describe("checkComponents and checkLens", () => {
  it("passes a plausible profitability comparison", () => {
    const comps: Component[] = [{ name: "trend_line", input: { title: "Operating margin", key: "operatingMargin" } }, takeaways];
    expect(checkComponents(comps, apple)).toEqual([]);
    expect(checkLens("profitability", comps, apple)).toEqual([]);
    expect(componentProse(comps)).toEqual(["Operating margin", ...takeaways.input.items as string[]]);
  });

  it("flags a component the payload can't fill, and one that misses the lens", () => {
    const comps: Component[] = [{ name: "trend_line", input: { title: "Gross margin", key: "grossMargin" } }, takeaways];
    expect(checkComponents(comps, [fixture("JPM"), fixture("JPM")])).toHaveLength(1);
    expect(checkLens("growth", comps, apple).map((f) => f.detail)).toEqual(["None of revenue, revenueGrowth is shown."]);
    expect(checkLens("growth", [takeaways, comps[0]], apple)[0].detail).toBe("Takeaways must appear exactly once, last.");
  });

  it("requires every risk of both companies in exactly one row", () => {
    const ids = apple.flatMap((c) => c.filing!.risks.map((r) => `${c.ticker}-${r.id}`));
    const rows = (refs: string[][]) => refs.map((r, i) => ({ label: `Row ${i}`, icon: "other" as const, refs: r }));
    const chunks = Array.from({ length: Math.ceil(ids.length / 6) }, (_, i) => ids.slice(i * 6, i * 6 + 6));
    const all: Component = { name: "risk_themes", input: { title: "Risks", rows: rows(chunks) } };
    expect(checkLens("risk-exposure", [all, takeaways], apple)).toEqual([]);
    const some: Component = { name: "risk_themes", input: { title: "Risks", rows: rows([ids.slice(0, 2), ids.slice(1, 3)]) } };
    const details = checkLens("risk-exposure", [some, takeaways], apple).map((f) => f.detail);
    expect(details[0]).toBe(`Not placed in any row: ${ids.slice(3).join(", ")}.`);
    expect(details[1]).toBe(`In more than one row: ${ids[1]}.`);
  });
});
