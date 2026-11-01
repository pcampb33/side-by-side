import { z } from "zod";
import type { LensSlug } from "../lib/lenses.ts";
import { CATALOG, COMPONENT_NAMES, MAX_COMPONENTS, checkComponent, type Component } from "./catalog.ts";
import { LENS_GUIDANCE } from "./lenses.ts";
import { systemPrompt, userPrompt, type CompanyInput } from "./prompt.ts";

// The one place a comparison is generated, whichever backend runs the model.
// Each catalog entry becomes a tool; a call that passes every check is shown
// (onComponent) and anything else goes back to the model as an error to fix.

export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handle(input: unknown): { ok: boolean; text: string };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

// Sonnet composes comparisons (chosen over Opus at step 8: as well grounded,
// two to three times faster); Haiku condenses annual reports (lib/filings).
export type ModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";

// A backend runs the model until it stops. It throws ComparisonError on a
// refusal, the step limit or an API failure, and returns token usage.
export type Backend = (run: { model: ModelId; system: string; user: string; tools: ToolSpec[]; signal: AbortSignal }) => Promise<Usage>;

export class ComparisonError extends Error {}

export const MAX_STEPS = 12;

export function componentTools(lens: LensSlug, companies: CompanyInput[], onComponent: (c: Component) => void): ToolSpec[] {
  const shown: Component[] = [];
  const offered = COMPONENT_NAMES.filter((name) => !LENS_GUIDANCE[lens].excluded.includes(name));
  return offered.map((name) => ({
    name,
    description: CATALOG[name].description,
    shape: CATALOG[name].shape,
    handle(input) {
      if (shown.some((c) => c.name === "takeaways")) return { ok: false, text: "Takeaways are already shown; the comparison is complete. Reply done." };
      if (name !== "takeaways" && shown.length >= MAX_COMPONENTS) return { ok: false, text: `${MAX_COMPONENTS} components are already shown. Call takeaways now.` };
      const schema: z.ZodType = z.object(CATALOG[name].shape);
      const parsed = schema.safeParse(input);
      if (!parsed.success) return { ok: false, text: `Invalid input:\n${z.prettifyError(parsed.error)}` };
      const component = { name, input: parsed.data } as Component;
      const problem = checkComponent(component, companies);
      if (problem) return { ok: false, text: problem };
      shown.push(component);
      onComponent(component);
      return { ok: true, text: "Shown." };
    },
  }));
}

export async function generateComparison(opts: {
  lens: LensSlug;
  companies: CompanyInput[];
  backend: Backend;
  signal: AbortSignal;
  onComponent: (c: Component) => void;
  model?: ModelId;
}): Promise<{ components: Component[]; usage: Usage }> {
  // The caller reads the annual reports for a text lens; without them the
  // model would have nothing to build from.
  if (LENS_GUIDANCE[opts.lens].needsFilings && opts.companies.some((c) => !c.filing)) {
    throw new Error(`The ${opts.lens} lens needs each company's condensed annual report.`);
  }
  const components: Component[] = [];
  const tools = componentTools(opts.lens, opts.companies, (c) => {
    components.push(c);
    opts.onComponent(c);
  });
  const usage = await opts.backend({ model: opts.model ?? "claude-sonnet-5-5", system: systemPrompt(opts.lens), user: userPrompt(opts.companies), tools, signal: opts.signal });
  if (components.length === 0) throw new ComparisonError("The model finished without building a comparison.");
  return { components, usage };
}
