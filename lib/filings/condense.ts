import { z } from "zod";
import { ComparisonError, type Backend, type ToolSpec } from "../../agent/run.ts";
import type { Submissions } from "../sec/client.ts";
import { annualReportSections, canonical, quoteAppearsIn } from "./text.ts";

// One annual report, condensed once by Haiku into business areas and risk
// themes. Every quote is checked against the filing's own text and dropped
// if it isn't there, so a quote shown on the page is one the company wrote.

export interface AnnualReport {
  accn: string;
  filed: string;
  periodEnd: string;
  document: string; // primary document file name
}

// The newest original 10-K. Amendments (10-K/A) usually carry only Part III.
export function latestAnnualReport(s: Submissions): AnnualReport | null {
  const r = s.filings.recent;
  const i = r.form.indexOf("10-K");
  return i < 0 ? null : { accn: r.accessionNumber[i], filed: r.filingDate[i], periodEnd: r.reportDate[i], document: r.primaryDocument[i] };
}

export interface Quote {
  text: string;
  section: "Item 1" | "Item 1A";
}

export interface CondensedFiling {
  report: AnnualReport;
  overview: string;
  areas: { id: string; name: string; description: string; quotes: Quote[] }[];
  risks: { id: string; theme: string; summary: string; quotes: Quote[] }[];
  droppedQuotes: number; // quotes Haiku wrote that are not in the filing
}

// Part of the cache key, like NORMALIZE_VERSION.
export const CONDENSE_VERSION = 2;

const quote = z
  .string()
  .min(30)
  .max(400)
  .describe("Copied word for word from the text: one contiguous passage, no ellipses, brackets or changed words");
const quotes = z.array(quote).min(1).max(2);

const SUMMARY_SHAPE = {
  overview: z.string().min(20).max(400).describe("What the company does, in one or two plain sentences"),
  areas: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        description: z.string().min(10).max(280).describe("What it sells there and to whom, and the competitors the filing names for it, if any"),
        quotes,
      }),
    )
    .min(4)
    .max(10)
    .describe("Product lines and markets from Item 1, at the level a comparison with another company needs: split a broad reporting segment into its main product lines"),
  risks: z
    .array(
      z.object({
        theme: z.string().min(3).max(60),
        summary: z.string().min(10).max(280),
        quotes,
      }),
    )
    .min(5)
    .max(12)
    .describe("The main risk themes from Item 1A, most significant first"),
};

const SYSTEM = `You condense one US company's annual report (Form 10-K) for a side-by-side comparison with another company. You get Item 1 (Business) and Item 1A (Risk Factors).

Call submit_summary exactly once, then reply "done".
- Every quote is copied word for word from the text: one contiguous passage of one or two sentences, with no ellipses, brackets, or changes to wording, punctuation or capitalization. Quotes that are not found in the filing are discarded.
- Write neutral, plain summaries in your own words. Don't add numbers that are not in the text.
- Risk themes group the filing's risk factors by subject (for example supply chain, regulation, competition, cybersecurity); prefer what is specific to this company over boilerplate.`;

export async function condenseAnnualReport(opts: {
  name: string;
  report: AnnualReport;
  text: string; // htmlToText of the primary document
  backend: Backend;
  signal: AbortSignal;
}): Promise<CondensedFiling> {
  const { business, risks } = annualReportSections(opts.text);
  // Item 1 ends at the Item 1A heading, so without that heading neither is found.
  if (!business || !risks) {
    throw new ComparisonError(`Couldn't find the ${risks ? "Business (Item 1)" : "Risk Factors (Item 1A)"} section in ${opts.name}'s latest 10-K.`);
  }
  const sections = { "Item 1": canonical(business), "Item 1A": canonical(risks) } as const;
  let dropped = 0;
  const verify = (texts: string[]): Quote[] =>
    texts.flatMap((text) => {
      const section = (Object.keys(sections) as Quote["section"][]).find((s) => quoteAppearsIn(text, sections[s]));
      if (!section) dropped++;
      return section ? [{ text, section }] : [];
    });

  let result: CondensedFiling | undefined;
  const submit: ToolSpec = {
    name: "submit_summary",
    description: "Submit the condensed annual report.",
    shape: SUMMARY_SHAPE,
    handle(input) {
      if (result) return { ok: false, text: "Already submitted. Reply done." };
      const parsed = z.object(SUMMARY_SHAPE).safeParse(input);
      if (!parsed.success) return { ok: false, text: `Invalid input:\n${z.prettifyError(parsed.error)}` };
      const s = parsed.data;
      // An area or risk with no verified quote has nothing to cite, so it goes too.
      const areas = s.areas.map((a) => ({ name: a.name, description: a.description, quotes: verify(a.quotes) })).filter((a) => a.quotes.length);
      const riskList = s.risks.map((r) => ({ theme: r.theme, summary: r.summary, quotes: verify(r.quotes) })).filter((r) => r.quotes.length);
      result = {
        report: opts.report,
        overview: s.overview,
        areas: areas.map((a, i) => ({ id: `a${i + 1}`, ...a })),
        risks: riskList.map((r, i) => ({ id: `r${i + 1}`, ...r })),
        droppedQuotes: dropped,
      };
      return { ok: true, text: "Submitted." };
    },
  };

  await opts.backend({
    model: "claude-haiku-5-5",
    system: SYSTEM,
    user: `${opts.name}, 10-K for the fiscal year ended ${opts.report.periodEnd}.\n\n${business}\n\n${risks}`,
    tools: [submit],
    signal: opts.signal,
  });
  if (!result) throw new ComparisonError(`Reading ${opts.name}'s annual report finished without a summary.`);
  if (!result.areas.length || !result.risks.length) {
    throw new ComparisonError(`None of the quotes drawn from ${opts.name}'s annual report matched the filing, so it can't be cited.`);
  }
  return result;
}
