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

  it("caps components at the maximum but still accepts takeaways", () => {
    const tools = componentTools(companies, () => {});
    for (let i = 0; i < 8; i++) expect(call(tools, "trend_line", { title: `Revenue ${i}`, key: "revenue" }).ok).toBe(true);
    expect(call(tools, "trend_line", { title: "One more", key: "revenue" }).text).toMatch(/Call takeaways now/);
    expect(call(tools, "takeaways", takeaways).ok).toBe(true);
  });
});

describe("generateComparison", () => {
  const usage = { inputTokens: 1, outputTokens: 1 };

  it("refuses a text lens honestly without calling the model", async () => {
    let called = false;
    const backend: Backend = async () => ((called = true), usage);
    await expect(generateComparison({ lens: "risk-exposure", companies, backend, signal, onComponent: () => {} })).rejects.toThrow(/annual-report reader/);
    expect(called).toBe(false);
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
