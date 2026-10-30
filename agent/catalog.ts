import { z } from "zod";
import type { NormalizedFinancials } from "../lib/normalize/normalize.ts";
import { VALUE_KEYS, valueAt, valueDef, type ValueKey } from "../lib/values.ts";

// The component catalog. Each component is a tool the model calls; its input
// names metric keys and fiscal years, never numbers, so a chart can only show
// values that exist in the normalized payload. (The company header is fixed,
// not generated, and is not in the catalog.)

const key = z.enum(VALUE_KEYS);
const percentKey = z.enum(["grossMargin", "operatingMargin", "netMargin", "rndToRevenue"]);
const year = z
  .union([z.literal("latest"), z.number().int()])
  .describe('"latest" (each company\'s own latest fiscal year) or a fiscal-year label such as 2024');
const title = z.string().min(3).max(80).describe("A short, neutral heading");
const caption = z.string().max(240).optional().describe("Optional one-sentence note. No verdicts");

export const CATALOG = {
  metric_cards: {
    description: "A row of stat tiles, each showing one metric for both companies in one fiscal year. Good for an opening overview.",
    shape: {
      title,
      items: z.array(z.object({ key, year })).min(2).max(6),
      caption,
    },
  },
  trend_line: {
    description: "A line chart of one metric for both companies across all five fiscal years.",
    shape: { title, key, caption },
  },
  grouped_bars: {
    description: "Bars comparing up to four metrics of the same unit (all dollar amounts, or all percentages) for both companies in one fiscal year.",
    shape: { title, keys: z.array(key).min(1).max(4), year, caption },
  },
  ratio_gauge: {
    description: "A pair of 0-100% meters for one margin-type ratio (gross, operating or net margin, or R&D % of revenue).",
    shape: { title, key: percentKey, year, caption },
  },
  cost_breakdown: {
    description: "How each company's revenue splits into cost of revenue, R&D, other operating expense and operating income in one fiscal year.",
    shape: { title, year, caption },
  },
  takeaways: {
    description: "Three to five neutral differences between the companies, in plain sentences. Call this last, exactly once. Never name a winner.",
    shape: {
      items: z.array(z.string().min(10).max(280)).min(3).max(5),
    },
  },
} as const;

export type ComponentName = keyof typeof CATALOG;
type Inputs = { [K in ComponentName]: z.infer<z.ZodObject<(typeof CATALOG)[K]["shape"]>> };
export type Component = { [K in ComponentName]: { name: K; input: Inputs[K] } }[ComponentName];

export const COMPONENT_NAMES = Object.keys(CATALOG) as ComponentName[];
export const MAX_COMPONENTS = 8;

// Checks the schema can't express. Returns null when the call is usable,
// otherwise a message the model sees as the tool result so it can correct.
export function checkComponent(component: Component, companies: NormalizedFinancials[]): string | null {
  const anyValue = (k: ValueKey, fy: number | "latest") => companies.some((f) => valueAt(f, k, fy).status === "value");
  const describe = (k: ValueKey, fy: number | "latest") => `${k} (${fy === "latest" ? "latest year" : `FY${fy}`})`;
  switch (component.name) {
    case "metric_cards": {
      const missing = component.input.items.filter((i) => !anyValue(i.key, i.year));
      return missing.length ? `No value for either company: ${missing.map((i) => describe(i.key, i.year)).join(", ")}. Pick other metrics.` : null;
    }
    case "trend_line": {
      const points = companies.map((f) => f.fiscalYears.filter((fy) => valueAt(f, component.input.key, fy).status === "value").length);
      return Math.max(...points) < 2 ? `${component.input.key} has fewer than two values for both companies; a trend needs at least two.` : null;
    }
    case "grouped_bars": {
      const units = new Set(component.input.keys.map((k) => valueDef(k).unit));
      if (units.size > 1) return `Mixed units (${[...units].join(", ")}). Every key in one grouped_bars must share a unit.`;
      const missing = component.input.keys.filter((k) => !anyValue(k, component.input.year));
      return missing.length ? `No value for either company: ${missing.map((k) => describe(k, component.input.year)).join(", ")}.` : null;
    }
    case "ratio_gauge":
      return anyValue(component.input.key, component.input.year) ? null : `No value for either company: ${describe(component.input.key, component.input.year)}.`;
    case "cost_breakdown":
      return companies.some(
        (f) => valueAt(f, "revenue", component.input.year).status === "value" && valueAt(f, "operatingIncome", component.input.year).status === "value",
      )
        ? null
        : "Neither company reports both revenue and operating income for that year.";
    case "takeaways":
      return null;
  }
}
