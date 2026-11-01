// npm run eval -- [--model sonnet|opus] [--only <text>] [--score-only] [--out <dir>]
// Generates every eval case (evals/cases.ts) in both modes from the saved
// fixtures, runs the code-only checks (evals/checks.ts) and prints a
// scorecard. Each run is saved to evals/out/<model>/, so --score-only
// rescores the saved runs without calling Claude. --only keeps the cases whose
// id contains the text (e.g. KO-PEP, freeform). --out saves to evals/out/<dir>
// instead (repeat runs, to see variance). Run by hand; never in CI.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser } from "playwright";
import type { Component } from "../agent/catalog.ts";
import { generatePage } from "../agent/freeform.ts";
import { LENS_GUIDANCE } from "../agent/lenses.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import { generateComparison, type Backend, type Usage } from "../agent/run.ts";
import { defaultBackend } from "../lib/compare.ts";
import { CASES, caseId } from "../evals/cases.ts";
import { checkComponents, checkLens, checkNotReported, checkNumbers, checkQuotes, componentProse, type CheckName, type Finding } from "../evals/checks.ts";
import { renderPage } from "../evals/render.ts";

const MODELS = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" } as const;
const MODES = ["components", "freeform"] as const;
type Mode = (typeof MODES)[number];

const { values: args } = parseArgs({
  options: { model: { type: "string", default: "sonnet" }, only: { type: "string" }, "score-only": { type: "boolean", default: false }, out: { type: "string" } },
});
const model = MODELS[args.model as keyof typeof MODELS];
if (!model) throw new Error(`--model must be one of ${Object.keys(MODELS).join(", ")}`);
const root = path.join(import.meta.dirname, "..");
const outDir = path.join(root, "evals", "out", args.out ?? args.model!);

interface Run {
  id: string;
  model: string;
  components?: Component[];
  html?: string;
  error?: string;
  // Every tool call, so rejected calls (the model fixing itself) show up.
  calls: { name: string; ok: boolean; text: string }[];
  usage?: Usage;
  seconds: number;
}

function companiesFor(c: (typeof CASES)[number]): CompanyInput[] {
  return c.tickers.map((ticker) => {
    const company = JSON.parse(fs.readFileSync(path.join(root, "evals", "fixtures", `${ticker}.json`), "utf8")) as CompanyInput;
    if (!LENS_GUIDANCE[c.lens].needsFilings) delete company.filing;
    return company;
  });
}

async function generate(id: string, c: (typeof CASES)[number], mode: Mode, companies: CompanyInput[]): Promise<Run> {
  const calls: Run["calls"] = [];
  const inner = await defaultBackend();
  const backend: Backend = (run) =>
    inner({
      ...run,
      tools: run.tools.map((t) => ({
        ...t,
        handle(input: unknown) {
          const result = t.handle(input);
          calls.push({ name: t.name, ok: result.ok, text: result.ok ? "" : result.text });
          return result;
        },
      })),
    });
  const signal = new AbortController().signal;
  const start = performance.now();
  const seconds = () => Math.round((performance.now() - start) / 1000);
  try {
    if (mode === "freeform") {
      const { html, usage } = await generatePage({ lens: c.lens, companies, backend, signal, model });
      return { id, model, html, calls, usage, seconds: seconds() };
    }
    const { components, usage } = await generateComparison({ lens: c.lens, companies, backend, signal, model, onComponent: () => {} });
    return { id, model, components, calls, usage, seconds: seconds() };
  } catch (err) {
    return { id, model, error: err instanceof Error ? err.message : String(err), calls, seconds: seconds() };
  }
}

async function score(run: Run, c: (typeof CASES)[number], companies: CompanyInput[], browser: Browser) {
  if (run.error) return { findings: [] as Finding[], numbers: 0, quotes: 0 };
  let prose: string[];
  const findings: Finding[] = [];
  if (run.html) {
    const page = await renderPage(browser, run.html);
    findings.push(...page.findings);
    prose = [page.text];
  } else {
    findings.push(...checkComponents(run.components!, companies), ...checkLens(c.lens, run.components!, companies));
    prose = componentProse(run.components!);
  }
  const numbers = checkNumbers(prose, companies);
  const quotes = checkQuotes(prose, companies);
  findings.push(...numbers.findings, ...quotes.findings, ...checkNotReported(prose, companies));
  return { findings, numbers: numbers.checked, quotes: quotes.checked };
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const rows: string[] = [];
const details: string[] = [];
let ungrounded = 0;
try {
  for (const c of CASES) {
    for (const mode of MODES) {
      const id = `${caseId(c)}-${mode}`;
      if (args.only && !id.includes(args.only)) continue;
      const file = path.join(outDir, `${id}.json`);
      const companies = companiesFor(c);
      let run: Run;
      if (args["score-only"]) {
        if (!fs.existsSync(file)) continue;
        run = JSON.parse(fs.readFileSync(file, "utf8"));
      } else {
        console.error(`${id}: generating with ${model}…`);
        run = await generate(id, c, mode, companies);
        fs.writeFileSync(file, JSON.stringify(run, null, 1));
      }
      const s = await score(run, c, companies, browser);
      const count = (check: CheckName) => s.findings.filter((f) => f.check === check).length;
      const cell = (check: CheckName, applies = true) => (!applies ? "–" : count(check) ? `✗ ${count(check)}` : "✓");
      ungrounded += count("numbers");
      const rejected = run.calls.filter((call) => !call.ok).length;
      rows.push(
        run.error
          ? `| ${caseId(c)} | ${mode} | error: ${run.error} | | | | | | ${rejected} | ${run.seconds}s | |`
          : `| ${caseId(c)} | ${mode} | ${count("numbers") ? `✗ ${count("numbers")}/${s.numbers}` : `✓ ${s.numbers}`} | ${count("quotes") ? `✗ ${count("quotes")}/${s.quotes}` : `✓ ${s.quotes}`} | ${cell("notReported")} | ${cell("components", mode === "components")} | ${cell("lens", mode === "components")} | ${cell("page", mode === "freeform")} | ${rejected} | ${run.seconds}s | ${run.usage?.outputTokens ?? ""} |`,
      );
      if (s.findings.length || rejected) {
        details.push(`\n### ${id}`);
        for (const f of s.findings) details.push(`- **${f.check}** ${f.detail}`);
        for (const call of run.calls.filter((x) => !x.ok)) details.push(`- *rejected ${call.name}:* ${call.text.replace(/\s+/g, " ").slice(0, 200)}`);
      }
    }
  }
} finally {
  await browser.close();
}

const scorecard = [
  `## Scorecard: ${model}`,
  "",
  "Numbers and quotes: ungrounded / checked. Rejected: tool calls the run refused and the model then fixed. Tokens: output (login runs add Claude Code overhead to input, so input is not shown).",
  "",
  "| case | mode | numbers | quotes | not reported | components | lens | page | rejected | time | tokens |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  `Ungrounded numbers: ${ungrounded}`,
  ...details,
].join("\n");
console.log(scorecard);
fs.writeFileSync(path.join(outDir, "scorecard.md"), scorecard + "\n");
