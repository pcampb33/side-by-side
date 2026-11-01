import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CompanyInput } from "../../../../agent/prompt.ts";
import type { Trace, TraceCall } from "../../../../agent/trace.ts";
import { currentStep, notReported, processSteps, type ProcessInput } from "./process-model.ts";

const fixture = (ticker: string): CompanyInput => JSON.parse(fs.readFileSync(path.join(process.cwd(), "evals", "fixtures", `${ticker}.json`), "utf8"));
const apple = [fixture("AAPL"), fixture("MSFT")];
const call = (tool: string, ok: boolean, ms: number): TraceCall => ({ tool, input: {}, ok, message: ok ? "Shown." : "Fix it.", ms });
const base: ProcessInput = { lens: "growth", mode: "components", status: "loading", step: "fetching", companies: null, shown: 0, calls: [], trace: null };
const trace = (over: Partial<Trace> = {}): Trace => ({
  v: 1,
  mode: "components",
  lens: "growth",
  model: "claude-sonnet-5-5",
  backend: "api",
  at: "2026-11-01T12:00:00.000Z",
  ms: { fetching: 800, reading: null, composing: 30_000, checks: 4 },
  usage: { inputTokens: 30_000, outputTokens: 3_000 },
  offered: ["metric_cards", "trend_line", "grouped_bars", "ratio_gauge", "cost_breakdown", "takeaways"],
  prompt: { system: "s", user: "u" },
  calls: [call("trend_line", true, 3000), call("trend_line", false, 6000), call("trend_line", true, 9000), call("takeaways", true, 20_000)],
  checks: [
    { check: "numbers", checked: 12, findings: [] },
    { check: "notReported", findings: [] },
    { check: "quotes", checked: 0, findings: [] },
    { check: "components", findings: [] },
  ],
  ...over,
});
const view = (p: Partial<ProcessInput>) => processSteps({ ...base, ...p }).map((s) => [s.id, s.state, s.count]);

describe("processSteps", () => {
  it("starts with the SEC data running and skips the 10-Ks on a number lens", () => {
    expect(view({})).toEqual([
      ["data", "run", "fetching"],
      ["reports", "skip", "not needed"],
      ["brief", "wait", "what the lens asks"],
      ["compose", "wait", "waiting"],
      ["checks", "wait", "waiting"],
    ]);
  });

  it("counts shown and sent-back calls live, and follows the running step", () => {
    const steps = processSteps({ ...base, step: "building", companies: apple, calls: [call("trend_line", true, 1), call("trend_line", false, 2)] });
    expect(steps.map((s) => [s.id, s.state, s.count])).toEqual([
      ["data", "done", "16 metrics × 5 yrs"],
      ["reports", "skip", "not needed"],
      ["brief", "done", "6 of 8 offered"],
      ["compose", "run", "1 shown · 1 sent back"],
      ["checks", "wait", "waiting"],
    ]);
    expect(currentStep(steps)).toBe(3);
    expect(view({ step: "building", companies: apple })[3]).toEqual(["compose", "run", "thinking"]);
    expect(view({ step: "checking", companies: apple, calls: [call("takeaways", true, 1)] }).slice(3)).toEqual([
      ["compose", "done", "1 shown"],
      ["checks", "run", "checking"],
    ]);
  });

  it("reads a finished run from its trace", () => {
    expect(view({ status: "done", step: "checking", companies: apple, shown: 3, trace: trace() }).slice(2)).toEqual([
      ["brief", "done", "6 of 8 offered"],
      ["compose", "done", "3 shown · 1 sent back"],
      ["checks", "done", "all pass"],
    ]);
    const found = trace({ checks: [{ check: "numbers", checked: 12, findings: ["$1.0B in …"] }] });
    expect(view({ status: "done", companies: apple, trace: found })[4]).toEqual(["checks", "done", "1 finding"]);
  });

  it("shows a result saved before traces with no record for the last three steps", () => {
    expect(view({ status: "done", companies: apple, shown: 6 }).slice(2)).toEqual([
      ["brief", "none", "what the lens asks"],
      ["compose", "none", "6 components"],
      ["checks", "none", "not recorded"],
    ]);
    expect(view({ status: "done", mode: "freeform", companies: apple, shown: 1 })[3]).toEqual(["compose", "none", "one page"]);
  });

  it("counts a text lens's themes and quotes once both 10-Ks are read", () => {
    const withFilings = apple.filter((c) => c.filing);
    expect(withFilings).toHaveLength(2);
    const risks = withFilings.reduce((n, c) => n + c.filing!.risks.length, 0);
    const quotes = withFilings.reduce((n, c) => n + c.filing!.risks.reduce((q, r) => q + r.quotes.length, 0), 0);
    expect(view({ lens: "risk-exposure", step: "reading", companies: withFilings })[1]).toEqual(["reports", "done", `${risks} themes · ${quotes} quotes`]);
    expect(view({ lens: "risk-exposure", step: "reading", companies: withFilings.map((c) => ({ ...c, filing: undefined })) })[1]).toEqual(["reports", "run", "reading"]);
  });

  it("says which steps a blocked request never ran", () => {
    const noFilings = apple.map((c) => ({ ...c, filing: undefined }));
    expect(view({ lens: "risk-exposure", status: "blocked", step: "reading", companies: noFilings })).toEqual([
      ["data", "done", "16 metrics × 5 yrs"],
      ["reports", "wait", "not run"],
      ["brief", "wait", "not run"],
      ["compose", "wait", "not run"],
      ["checks", "wait", "not run"],
    ]);
    expect(view({ status: "blocked", step: "building", companies: apple })[1]).toEqual(["reports", "skip", "not needed"]);
  });
});

describe("notReported", () => {
  it("lists metrics a company reports in no year", () => {
    expect(notReported(fixture("KO"))).toContain("rnd");
  });
});
