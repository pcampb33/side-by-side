import { formatValue } from "../lib/format.ts";
import type { LensSlug } from "../lib/lenses.ts";
import type { NormalizedFinancials } from "../lib/normalize/normalize.ts";
import { VALUE_KEYS, valueAt, valueDef } from "../lib/values.ts";
import { MAX_COMPONENTS } from "./catalog.ts";
import { LENS_GUIDANCE } from "./lenses.ts";

export interface CompanyInput {
  ticker: string;
  name: string;
  financials: NormalizedFinancials;
}

export function systemPrompt(lens: LensSlug): string {
  const { question, guidance } = LENS_GUIDANCE[lens];
  return `You build a comparison of two public companies by calling UI component tools. The page already shows each company's name, industry and headquarters.

Lens: ${question}
${guidance}

Rules:
- Respond only through tool calls, in the order the reader should see them: usually 3 to 6 components, at most ${MAX_COMPONENTS}, then takeaways last. When takeaways succeeds, reply "done".
- Components take metric keys and fiscal years, never numbers. The page looks every value up and cites its filing.
- Takeaways are neutral differences, never a winner, a recommendation or a prediction. Any number you write must appear in the data tables exactly as shown.
- "n/r" means the filing does not report it and "n/m" means the ratio is not meaningful (e.g. negative equity). Never estimate around them; say they are not reported when it matters.
- The two companies may have different fiscal year ends; "latest" picks each company's own latest year.
- If a tool returns an error, fix the call and try again.`;
}

function table(c: CompanyInput): string {
  const f = c.financials;
  const header = ["key", "label", ...f.fiscalYears.map((fy) => `FY${fy}`)].join(" | ");
  const rows = VALUE_KEYS.map((key) => {
    const { label, unit } = valueDef(key);
    const cells = f.fiscalYears.map((fy) => {
      const v = valueAt(f, key, fy);
      return v.status === "value" ? formatValue(v.value, unit) : v.status === "not_meaningful" ? "n/m" : "n/r";
    });
    return [key, label, ...cells].join(" | ");
  });
  return `${c.ticker}: ${c.name} (fiscal years end ${f.periodEnds.at(-1)!.slice(5)}; latest FY${f.fiscalYears.at(-1)})\n${header}\n${rows.join("\n")}`;
}

export function userPrompt(companies: CompanyInput[]): string {
  return `Compare ${companies.map((c) => c.ticker).join(" and ")}.\n\n${companies.map(table).join("\n\n")}`;
}
