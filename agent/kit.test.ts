import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { formatValue } from "../lib/format.ts";
import { normalize } from "../lib/normalize/normalize.ts";
import { generatePage } from "./freeform.ts";
import { checkKitCharts, kitData, kitHead, kitUsed } from "./kit.ts";
import type { CompanyInput } from "./prompt.ts";
import type { Backend } from "./run.ts";

const company = (ticker: string, name: string): CompanyInput => ({
  ticker,
  name,
  financials: normalize(JSON.parse(fs.readFileSync(new URL(`../lib/normalize/fixtures/${ticker}.json`, import.meta.url), "utf8"))),
});
const companies = [company("AAPL", "Apple Inc."), company("JPM", "JPMorgan Chase & Co.")];
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}<p>Not financial advice.</p></body></html>`;

describe("kitData", () => {
  it("writes each value as the prompt's tables do, and marks what isn't reported", () => {
    const data = kitData(companies);
    const apple = companies[0].financials;
    const latest = apple.metrics.revenue.at(-1)!;
    expect(latest.status).toBe("reported");
    const [value, label] = data.metrics.revenue.values[0].at(-1) as [number, string];
    expect(label).toBe(formatValue(value, "usd"));
    expect(data.companies[1].years).toEqual(companies[1].financials.fiscalYears);
    // A bank reports no gross profit.
    expect(new Set(data.metrics.grossProfit.values[1])).toEqual(new Set(["n/r"]));
  });

  it("can't close the script it sits in", () => {
    const evil = [{ ...companies[0], name: "</script><script>alert(1)</script>" }, companies[1]];
    expect(kitHead(evil).match(/<\/script>/g)).toHaveLength(1);
  });

  it("is a script that parses", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(kitHead(companies))![1];
    expect(() => new Function(script)).not.toThrow();
  });
});

describe("kitUsed", () => {
  it("lists the pieces a page uses", () => {
    expect(kitUsed(page('<div class="kit-grid"><section class="kit-card"><div id="c"></div></section></div><script>kit.chart("#c",{type:"line",key:"revenue"})</script>'))).toEqual(["card", "grid", "chart"]);
    expect(kitUsed(page('<span class="kit-chip a">AAPL</span><div class="kit-stat b"></div>'))).toEqual(["stat", "chip"]);
    expect(kitUsed(page('<div class="card">no kit</div>'))).toEqual([]);
  });
});

describe("checkKitCharts", () => {
  const chart = (spec: string) => page(`<div id="c"></div><script>kit.chart(document.getElementById("c"), ${spec});</script>`);

  it("passes charts the data can draw", () => {
    expect(checkKitCharts(chart('{ type: "line", key: "revenue" }'), companies)).toBeNull();
    expect(checkKitCharts(chart("{type:'bars', key:'netIncome'}"), companies)).toBeNull();
    expect(checkKitCharts(chart('{ type: "bars", keys: ["operatingMargin", "netMargin"], year: "latest" }'), companies)).toBeNull();
  });

  it.each([
    ['{ type: "line", key: "revenu" }', /unknown metric key revenu/],
    ['{ type: "pie", key: "revenue" }', /"line" or "bars"/],
    ['{ type: "bars", keys: ["revenue", "netMargin"], year: 2024 }', /Mixed units/],
    ['{ type: "line", key: "revenue", year: "latest" }', /leave out year/],
    ['{ type: "bars", keys: ["revenue", "netIncome"] }', /give a year/],
    ['{ type: "bars", keys: ["revenue"], year: 1999 }', /No value for either company/],
  ])("sends back %s", (spec, problem) => {
    expect(checkKitCharts(chart(spec), companies)).toMatch(problem);
  });

  it("leaves a spec built in script to the helper", () => {
    expect(checkKitCharts(page("<script>const spec = pick(); kit.chart('#c', spec)</script>"), companies)).toBeNull();
  });

  it("is applied when the page is submitted", async () => {
    const replies: string[] = [];
    const backend: Backend = async ({ tools }) => {
      const submit = tools.find((t) => t.name === "submit_page")!;
      replies.push(submit.handle({ html: chart('{ type: "line", key: "profit" }') }).text);
      replies.push(submit.handle({ html: chart('{ type: "line", key: "revenue" }') }).text);
      return { inputTokens: 1, outputTokens: 1 };
    };
    const result = await generatePage({ lens: "growth", companies, backend, signal: new AbortController().signal });
    expect(replies).toEqual([expect.stringMatching(/unknown metric key profit/), "Shown."]);
    expect(result.kit).toEqual(["chart"]);
  });
});
