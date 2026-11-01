import type { Mode } from "../lib/compare-url.ts";
import type { LensSlug } from "../lib/lenses.ts";
import type { KitPiece } from "./kit.ts";
import type { ModelId, ToolSpec, Usage } from "./run.ts";

// What one run did, recorded as it happens and stored with its result (cache
// and featured JSON), so the page can show how it was made (SPEC §4a).

export type BackendName = "api" | "login";

export interface TraceCall {
  tool: string;
  input: unknown;
  ok: boolean; // false: sent back to the model with `message`
  message: string;
  ms: number; // since composing started
}

export type CheckId = "numbers" | "notReported" | "quotes" | "components" | "page";
export interface CheckResult {
  check: CheckId;
  checked?: number; // numbers and quotes: how many the check read
  findings: string[];
}

export interface Trace {
  v: 1;
  mode: Mode;
  lens: LensSlug;
  model: ModelId;
  backend: BackendName; // login runs carry Claude Code's own prompt in their token counts
  at: string; // ISO time the run started
  ms: { fetching: number; reading: number | null; composing: number; checks: number };
  usage: Usage;
  offered: string[]; // the tools Claude was given
  kit?: KitPiece[]; // freeform: the kit pieces the page used (absent before the kit)
  prompt: { system: string; user: string }; // exactly as sent
  calls: TraceCall[];
  checks: CheckResult[];
}

// A call as the trace keeps it: the freeform page is in the result, so its
// submission keeps only its size.
export function traceCall(call: Omit<TraceCall, "ms">, ms: number): TraceCall {
  const html = call.tool === "submit_page" ? (call.input as { html?: unknown } | null)?.html : undefined;
  return { ...call, input: typeof html === "string" ? { html: `${html.length} characters` } : call.input, ms };
}

// Wraps each tool so every call that reaches its handler is reported, shown or sent back.
export function recordCalls(tools: ToolSpec[], onCall: (call: Omit<TraceCall, "ms">) => void): ToolSpec[] {
  return tools.map((t) => ({
    ...t,
    handle(input) {
      const result = t.handle(input);
      onCall({ tool: t.name, input, ok: result.ok, message: result.text });
      return result;
    },
  }));
}
