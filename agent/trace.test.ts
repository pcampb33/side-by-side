import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolSpec } from "./run.ts";
import { recordCalls, traceCall, type TraceCall } from "./trace.ts";

describe("recordCalls", () => {
  it("reports every call with its result, and leaves the result unchanged", () => {
    const tool: ToolSpec = { name: "echo", description: "", shape: { n: z.number() }, handle: (input) => ((input as { n: number }).n > 0 ? { ok: true, text: "Shown." } : { ok: false, text: "n must be positive." }) };
    const calls: Omit<TraceCall, "ms">[] = [];
    const [wrapped] = recordCalls([tool], (c) => calls.push(c));
    expect(wrapped.handle({ n: -1 })).toEqual({ ok: false, text: "n must be positive." });
    expect(wrapped.handle({ n: 2 })).toEqual({ ok: true, text: "Shown." });
    expect(calls).toEqual([
      { tool: "echo", input: { n: -1 }, ok: false, message: "n must be positive." },
      { tool: "echo", input: { n: 2 }, ok: true, message: "Shown." },
    ]);
  });
});

describe("traceCall", () => {
  it("keeps a submitted page's size, not the page", () => {
    expect(traceCall({ tool: "submit_page", input: { html: "<html>…</html>" }, ok: true, message: "Shown." }, 1200).input).toEqual({ html: "14 characters" });
    expect(traceCall({ tool: "trend_line", input: { key: "revenue" }, ok: true, message: "Shown." }, 5).input).toEqual({ key: "revenue" });
  });
});
