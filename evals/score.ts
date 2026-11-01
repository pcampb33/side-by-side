import type { Browser } from "playwright";
import type { Component } from "../agent/catalog.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import type { LensSlug } from "../lib/lenses.ts";
import { checkComponents, checkLens, checkNotReported, checkNumbers, checkQuotes, componentProse, type Finding } from "./checks.ts";
import { renderPage } from "./render.ts";

// Every code-only check on one generated comparison: components, or a
// freeform page (rendered in the browser first). Used by npm run eval and by
// npm run featured, which keeps only a run with no findings.
export async function scoreOutput(
  output: { components: Component[] } | { html: string },
  lens: LensSlug,
  companies: CompanyInput[],
  browser: Browser,
): Promise<{ findings: Finding[]; numbers: number; quotes: number }> {
  let prose: string[];
  const findings: Finding[] = [];
  if ("html" in output) {
    const page = await renderPage(browser, output.html);
    findings.push(...page.findings);
    prose = [page.text];
  } else {
    findings.push(...checkComponents(output.components, companies), ...checkLens(lens, output.components, companies));
    prose = componentProse(output.components);
  }
  const numbers = checkNumbers(prose, companies);
  const quotes = checkQuotes(prose, companies);
  findings.push(...numbers.findings, ...quotes.findings, ...checkNotReported(prose, companies));
  return { findings, numbers: numbers.checked, quotes: quotes.checked };
}
