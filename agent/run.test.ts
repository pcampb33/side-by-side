import fs from "node:fs";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { normalize } from "../lib/normalize/normalize.ts";
import { apiBackend } from "./backends/api.ts";
import type { Component } from "./catalog.ts";
import type { CompanyInput } from "./prompt.ts";
import { ComparisonError, componentTools, generateComparison, type Backend } from "./run.ts";

const company = (ticker: string, name: string): CompanyInput => ({
  ticker,
  name,
  financials: normalize(JSON.parse(fs.readFileSync(new URL(`../lib/normalize/fixtures/${ticker}.json`, import.meta.url), "utf8"))),
});
const companies = [company("AAPL", "Apple Inc."), company("MSFT", "Microsoft Corp")];
const quote = { text: "A passage the filing really contains.", section: "Item 1A" as const };
const filing = (area: string, risk: string) => ({
  report: { accn: "0000000000-26-000001", filed: "2026-01-30", periodEnd: "2025-12-31", document: "10k.htm" },
  overview: "What the company does.",
  areas: [{ id: "a1", name: area, description: "What it sells.", quotes: [quote] }],
  risks: [{ id: "r1", theme: risk, summary: "What could go wrong.", quotes: [quote] }],
  droppedQuotes: 0,
  fiscalYear: 2025,
});
const withFilings = [
  { ...companies[0], filing: filing("iPhone", "Supply chain") },
  { ...companies[1], filing: filing("Cloud", "Competition") },
];
const takeaways = { items: ["Apple's fiscal year ends in September.", "Microsoft's ends in June.", "Both report R&D."] };
const signal = new AbortController().signal;

const call = (tools: ReturnType<typeof componentTools>, name: string, input: unknown) => tools.find((t) => t.name === name)!.handle(input);

describe("componentTools", () => {
  it("shows a valid call and returns problems to the model instead of showing them", () => {
    const shown: Component[] = [];
    const tools = componentTools(companies, (c) => shown.push(c));
    expect(call(tools, "trend_line", { title: "Revenue", key: "revenue" })).toEqual({ ok: true, text: "Shown." });
    expect(call(tools, "trend_line", { title: "Revenue", key: "revenu" }).ok).toBe(false);
    expect(call(tools, "grouped_bars", { title: "Mixed", keys: ["revenue", "grossMargin"], year: "latest" }).text).toMatch(/Mixed units/);
    expect(call(tools, "metric_cards", { title: "Old", items: [{ key: "revenue", year: 1999 }, { key: "cash", year: 1999 }] }).text).toMatch(/No value/);
    expect(shown.map((c) => c.name)).toEqual(["trend_line"]);
  });

  it("allows one takeaways and nothing after it", () => {
    const shown: Component[] = [];
    const tools = componentTools(companies, (c) => shown.push(c));
    expect(call(tools, "takeaways", takeaways).ok).toBe(true);
    expect(call(tools, "takeaways", takeaways).ok).toBe(false);
    expect(call(tools, "trend_line", { title: "Revenue", key: "revenue" }).ok).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it("accepts text rows only with ids that exist and are of the right kind", () => {
    const shown: Component[] = [];
    const tools = componentTools(withFilings, (c) => shown.push(c));
    const rows = (refs: string[][]) => ({ title: "Risks", rows: refs.map((r, i) => ({ label: `Row ${i}`, refs: r })) });
    expect(call(tools, "risk_themes", rows([["AAPL-r1", "MSFT-r1"], ["MSFT-r9"]])).text).toMatch(/Unknown risk ids: MSFT-r9/);
    expect(call(tools, "risk_themes", rows([["AAPL-a1"], ["MSFT-r1"]])).text).toMatch(/Unknown risk ids: AAPL-a1/);
    expect(call(tools, "business_overlap", rows([["AAPL-a1", "MSFT-a1"], ["AAPL-a1"]])).ok).toBe(true);
    expect(call(tools, "risk_themes", rows([["AAPL-r1", "MSFT-r1"], ["AAPL-r1"]])).ok).toBe(true);
    expect(shown.map((c) => c.name)).toEqual(["business_overlap", "risk_themes"]);
  });

  it("caps components at the maximum but still accepts takeaways", () => {
    const tools = componentTools(companies, () => {});
    for (let i = 0; i < 8; i++) expect(call(tools, "trend_line", { title: `Revenue ${i}`, key: "revenue" }).ok).toBe(true);
    expect(call(tools, "trend_line", { title: "One more", key: "revenue" }).text).toMatch(/Call takeaways now/);
    expect(call(tools, "takeaways", takeaways).ok).toBe(true);
  });
});

describe("generateComparison", () => {
  const usage = { inputTokens: 1, outputTokens: 1 };

  it("won't run a text lens without the condensed annual reports", async () => {
    let called = false;
    const backend: Backend = async () => ((called = true), usage);
    await expect(generateComparison({ lens: "risk-exposure", companies, backend, signal, onComponent: () => {} })).rejects.toThrow(/condensed annual report/);
    expect(called).toBe(false);
  });

  it("gives the model each company's annual-report ids for a text lens", async () => {
    let user = "";
    const backend: Backend = async (run) => {
      user = run.user;
      run.tools.find((t) => t.name === "takeaways")!.handle(takeaways);
      return usage;
    };
    await generateComparison({ lens: "risk-exposure", companies: withFilings, backend, signal, onComponent: () => {} });
    expect(user).toMatch(/AAPL-r1 \| Supply chain \| /);
    expect(user).toMatch(/MSFT-a1 \| Cloud \| /);
  });

  it("is an error, not an empty comparison, when the model shows nothing", async () => {
    const backend: Backend = async () => usage;
    await expect(generateComparison({ lens: "growth", companies, backend, signal, onComponent: () => {} })).rejects.toThrow(ComparisonError);
  });
});

describe("apiBackend (mock model)", () => {
  const finish = (unified: "stop" | "tool-calls" | "content-filter"): LanguageModelV3StreamPart => ({
    type: "finish",
    finishReason: { unified, raw: undefined },
    usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
  });
  const step = (...chunks: LanguageModelV3StreamPart[]) => ({ stream: simulateReadableStream({ chunks }) });
  const toolCall = (id: string, toolName: string, input: unknown): LanguageModelV3StreamPart => ({ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) });
  const text = (t: string): LanguageModelV3StreamPart[] => [
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: t },
    { type: "text-end", id: "t" },
  ];

  it("runs tool calls through the catalog, feeds errors back, and sums usage", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        step(toolCall("1", "trend_line", { title: "Revenue", key: "revenu" }), finish("tool-calls")),
        step(toolCall("2", "trend_line", { title: "Revenue", key: "revenue" }), toolCall("3", "takeaways", takeaways), finish("tool-calls")),
        step(...text("done"), finish("stop")),
      ],
    });
    const shown: Component[] = [];
    const result = await generateComparison({ lens: "growth", companies, backend: apiBackend(model), signal, onComponent: (c) => shown.push(c) });
    expect(shown.map((c) => c.name)).toEqual(["trend_line", "takeaways"]);
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 30 });
    // The invalid first call came back to the model as an error result.
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toMatch(/Invalid input/);
  });

  it("reports a refusal as an error", async () => {
    const model = new MockLanguageModelV3({ doStream: [step(finish("content-filter"))] });
    await expect(generateComparison({ lens: "growth", companies, backend: apiBackend(model), signal, onComponent: () => {} })).rejects.toThrow(/declined/);
  });
});
