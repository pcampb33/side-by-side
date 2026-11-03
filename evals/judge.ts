import { z } from "zod";
import type { Component } from "../agent/catalog.ts";
import { LENS_GUIDANCE } from "../agent/lenses.ts";
import { userPrompt, type CompanyInput } from "../agent/prompt.ts";
import type { Backend, ModelId, Usage } from "../agent/run.ts";
import type { LensSlug } from "../lib/lenses.ts";
import type { Finding } from "./checks.ts";

// Model-graded checks (SPEC §7), for what the code checks can't judge. Opus
// grades, so the model that wrote a page (Sonnet) doesn't grade its own work.
// Eval only (npm run eval -- --grade); never gates featured or the live site.

const RUBRIC = {
  answersLens: "The page answers the lens question, not just shows numbers near the topic.",
  mergedSubjects:
    "Every row or tile that pairs both companies is about the same subject in both filings (compare the ids' themes and descriptions in the data). Two different subjects under one shared label fail. Pass when nothing pairs both companies.",
  claimsBeyondData:
    "Every factual claim comes from the data given (figures, filing text, names). Facts from general knowledge fail: headquarters, employee counts, market share, products or events the data never mentions. Neutral explanation of what a metric means is fine.",
} as const;
export type JudgeItem = keyof typeof RUBRIC;

const judgement = z.object({ pass: z.boolean(), reason: z.string().min(5).max(500).describe("One or two sentences; on a fail, name the tile or sentence") });

// The site's own rules go in, or the grader fails pages for being neutral:
// calibration on the reviewed featured pages failed 4 of 10 that way.
const SYSTEM = `You grade a generated comparison of two companies against a rubric. You get the lens question with its guidance (what the lens is meant to show), the data the page was built from (the only allowed source of facts), and the page. Be strict and specific: a fail names what is wrong. Call verdict exactly once, then reply done.

The site never names a winner or draws conclusions: it lays each company's figures and filing text side by side, and takeaways state neutral differences. A page answers the lens when it puts the data that addresses each part of the question side by side, as the guidance describes. Don't fail it for not concluding, ranking, or judging.

${Object.entries(RUBRIC)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}`;

export async function judge(opts: {
  lens: LensSlug;
  companies: CompanyInput[];
  // Components as generated, or a freeform page's text as a reader sees it.
  page: { components: Component[] } | { text: string };
  backend: Backend;
  model?: ModelId;
}): Promise<{ findings: Finding[]; usage: Usage }> {
  let verdict: Record<JudgeItem, z.infer<typeof judgement>> | undefined;
  const shape = Object.fromEntries(Object.keys(RUBRIC).map((k) => [k, judgement])) as Record<JudgeItem, typeof judgement>;
  const page = "components" in opts.page ? `Components, in order (JSON):\n${JSON.stringify(opts.page.components, null, 1)}` : `Page text:\n${opts.page.text}`;
  const usage = await opts.backend({
    model: opts.model ?? "claude-opus-5-5",
    system: SYSTEM,
    user: `Lens question: ${LENS_GUIDANCE[opts.lens].question}\nLens guidance: ${LENS_GUIDANCE[opts.lens].guidance}\n\n# Data\n\n${userPrompt(opts.companies, { quotes: true })}\n\n# Page\n\n${page}`,
    tools: [
      {
        name: "verdict",
        description: "Your grade: pass or fail with a reason for each rubric item.",
        shape,
        handle(input) {
          if (verdict) return { ok: false, text: "Already recorded. Reply done." };
          const parsed = z.object(shape).safeParse(input);
          if (!parsed.success) return { ok: false, text: `Invalid input:\n${z.prettifyError(parsed.error)}` };
          verdict = parsed.data;
          return { ok: true, text: "Recorded." };
        },
      },
    ],
    signal: new AbortController().signal,
  });
  if (!verdict) throw new Error("The grader finished without a verdict.");
  const findings = Object.entries(verdict)
    .filter(([, v]) => !v.pass)
    .map(([k, v]) => ({ check: "judge" as const, detail: `${k}: ${v.reason}` }));
  return { findings, usage };
}
