import fs from "node:fs";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { normalize } from "../lib/normalize/normalize.ts";
import { apiBackend } from "./backends/api.ts";
import type { Component } from "./catalog.ts";
import type { CompanyInput } from "./prompt.ts";
import { systemPrompt, userPrompt } from "./prompt.ts";
import { ComparisonError, componentTools, generateComparison, type Backend } from "./run.ts";
import type { TraceCall } from "./trace.ts";

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
    const tools = componentTools("growth", companies, (c) => shown.push(c));
    expect(call(tools, "trend_line", { title: "Revenue", key: "revenue" })).toEqual({ ok: true, text: "Shown." });
    expect(call(tools, "trend_line", { title: "Revenue", key: "revenu" }).ok).toBe(false);
    expect(call(tools, "grouped_bars", { title: "Mixed", keys: ["revenue", "grossMargin"], year: "latest" }).text).toMatch(/Mixed units/);
    expect(call(tools, "metric_cards", { title: "Old", items: [{ key: "revenue", year: 1999 }, { key: "cash", year: 1999 }] }).text).toMatch(/No value/);
    expect(shown.map((c) => c.name)).toEqual(["trend_line"]);
  });

  it("allows one takeaways and nothing after it", () => {
    const shown: Component[] = [];
    const tools = componentTools("growth", companies, (c) => shown.push(c));
    expect(call(tools, "takeaways", takeaways).ok).toBe(true);
    expect(call(tools, "takeaways", takeaways).ok).toBe(false);
    expect(call(tools, "trend_line", { title: "Revenue", key: "revenue" }).ok).toBe(false);
    expect(shown).toHaveLength(1);
  });

  const rows = (refs: string[][]) => ({ title: "Rows", rows: refs.map((r, i) => ({ label: `Row ${i}`, icon: "other", refs: r })) });

  it("accepts risk rows only with risk ids that exist, each in one row", () => {
    const shown: Component[] = [];
    const tools = componentTools("risk-exposure", withFilings, (c) => shown.push(c));
    expect(call(tools, "risk_themes", rows([["AAPL-r1", "MSFT-r1"], ["MSFT-r9"]])).text).toMatch(/Unknown risk ids: MSFT-r9/);
    expect(call(tools, "risk_themes", rows([["AAPL-a1"], ["MSFT-r1"]])).text).toMatch(/Unknown risk ids: AAPL-a1/);
    expect(call(tools, "risk_themes", rows([["AAPL-r1", "MSFT-r1"], ["AAPL-r1"]])).text).toMatch(/AAPL-r1 is in more than one/);
    expect(call(tools, "risk_themes", rows([["AAPL-r1"], ["MSFT-r1"]])).ok).toBe(true);
    expect(shown.map((c) => c.name)).toEqual(["risk_themes"]);
  });

  it("lets a business area serve two markets", () => {
    const tools = componentTools("where-they-compete", withFilings, () => {});
    expect(call(tools, "business_overlap", rows([["AAPL-a1", "MSFT-a1"], ["AAPL-a1"]])).ok).toBe(true);
  });

  it("offers each text component only in its own lens", () => {
    const names = (lens: Parameters<typeof componentTools>[0]) => componentTools(lens, withFilings, () => {}).map((t) => t.name);
    expect(names("risk-exposure")).toContain("risk_themes");
    expect(names("risk-exposure")).not.toContain("business_overlap");
    expect(names("where-they-compete")).toContain("business_overlap");
    expect(names("where-they-compete")).not.toContain("risk_themes");
    expect(names("growth")).not.toContain("risk_themes");
    expect(names("growth")).not.toContain("business_overlap");
  });

  it("refuses a text row whose icon is not in the fixed set", () => {
    const tools = componentTools("risk-exposure", withFilings, () => {});
    const input = { title: "Risks", rows: [{ label: "Supply", icon: "rocket", refs: ["AAPL-r1"] }, { label: "Rivals", icon: "competition", refs: ["MSFT-r1"] }] };
    expect(call(tools, "risk_themes", input).ok).toBe(false);
    input.rows[0].icon = "supply-chain";
    expect(call(tools, "risk_themes", input).ok).toBe(true);
  });

  it("caps components at the maximum but still accepts takeaways", () => {
    const tools = componentTools("growth", companies, () => {});
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

  it("reports the tokens used before a run failed: finished steps, plus the step in flight", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        step(toolCall("1", "trend_line", { title: "Revenue", key: "revenue" }), finish("tool-calls")),
        step(
          { type: "raw", rawValue: { type: "message_start", message: { usage: { input_tokens: 150 } } } },
          { type: "tool-input-start", id: "2", toolName: "takeaways" },
          { type: "tool-input-delta", id: "2", delta: "x".repeat(30) },
          { type: "error", error: new Error("Overloaded") },
        ),
      ],
    });
    const err = await apiBackend(model)({ model: "claude-sonnet-5-5", system: "", user: "", tools: componentTools("growth", companies, () => {}), signal }).catch((e) => e);
    expect(err).toBeInstanceOf(ComparisonError);
    expect(err.message).toMatch(/Overloaded/);
    expect(err.usage).toEqual({ inputTokens: 250, outputTokens: 20 });
  });

  it("reports the tokens used before the visitor left", async () => {
    const abort = new AbortController();
    const chunks: LanguageModelV3StreamPart[] = [
      { type: "raw", rawValue: { type: "message_start", message: { usage: { input_tokens: 150 } } } },
      ...text("x".repeat(30)),
      ...text("never sent"),
      finish("stop"),
    ];
    // A chunk every 100 ms; the visitor leaves between the first text block's delta and its end.
    const model = new MockLanguageModelV3({ doStream: [{ stream: simulateReadableStream({ chunks, chunkDelayInMs: 100 }) }] });
    setTimeout(() => abort.abort(), 250);
    const err = await apiBackend(model)({ model: "claude-sonnet-5-5", system: "", user: "", tools: [], signal: abort.signal }).catch((e) => e);
    expect(err.message).toMatch(/cancelled/);
    expect(err.usage).toEqual({ inputTokens: 150, outputTokens: 10 });
  });
});

describe("generateComparison's trace", () => {
  it("reports each call, shown or sent back, and returns the prompt as sent and the tools offered", async () => {
    const backend: Backend = async ({ tools }) => {
      const run = (name: string, input: unknown) => tools.find((t) => t.name === name)!.handle(input);
      run("trend_line", { title: "Revenue", key: "revenu" });
      run("trend_line", { title: "Revenue", key: "revenue" });
      run("takeaways", takeaways);
      return { inputTokens: 10, outputTokens: 2 };
    };
    const calls: Omit<TraceCall, "ms">[] = [];
    const out = await generateComparison({ lens: "growth", companies, backend, signal, onComponent: () => {}, onCall: (c) => calls.push(c) });
    expect(calls.map((c) => [c.tool, c.ok])).toEqual([["trend_line", false], ["trend_line", true], ["takeaways", true]]);
    expect(calls[0].message).toMatch(/revenu/);
    expect(out.prompt).toEqual({ system: systemPrompt("growth"), user: userPrompt(companies) });
    expect(out.model).toBe("claude-sonnet-5-5");
    expect(out.offered).not.toContain("risk_themes");
    expect(out.offered).toContain("takeaways");
  });
});
