import { z } from "zod";
import type { LensSlug } from "../lib/lenses.ts";
import { FONTS, THEME } from "../lib/theme.ts";
import { LENS_GUIDANCE } from "./lenses.ts";
import { checkKitCharts, KIT_PROMPT, kitUsed, type KitPiece } from "./kit.ts";
import { headlineNote, userPrompt, type CompanyInput } from "./prompt.ts";
import { ComparisonError, type Backend, type ModelId, type ToolSpec, type Usage } from "./run.ts";
import { recordCalls, type TraceCall } from "./trace.ts";

// Freeform mode: from the same data, Claude writes one self-contained HTML
// page, which the site shows in <iframe srcdoc sandbox="allow-scripts">. The
// page can't reach anything outside itself: checkPage refuses external loads
// and links so the model can fix them, and the frame adds a CSP that blocks
// whatever the check misses (app/compare/[pair]/[lens]/freeform-frame.tsx).

const MAX_HTML = 120_000;

// Why the page can't be shown, or null when it can.
export function checkPage(html: string): string | null {
  if (!/<head[\s>]/i.test(html) || !/<\/html>\s*$/i.test(html)) return "Submit one complete HTML document, with a <head>, ending in </html>.";
  const external: [RegExp, string][] = [
    [/<(?:link|base|iframe|object|embed|frame)\b/i, "<link>, <base>, <iframe>, <object> or <embed>"],
    [/\b(?:src|srcset|action|poster|data|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//i, "an external src"],
    [/\bhref\s*=\s*["']?\s*(?!["']?#)/i, "an href other than a #fragment (links can't open from the page)"],
    [/url\(\s*["']?\s*(?:https?:)?\/\//i, "an external url()"],
    [/@import\b/i, "@import"],
    [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|\bimport\s*\(/, "a network request"],
  ];
  const found = external.filter(([re]) => re.test(html)).map(([, what]) => what);
  return found.length ? `The page must be self-contained, but it has ${found.join(", ")}. Inline everything and submit again.` : null;
}

const tokenList = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--${k} ${v}`)
    .join(", ");

export function freeformSystemPrompt(lens: LensSlug): string {
  const { question, guidance } = LENS_GUIDANCE[lens];
  return `You write one self-contained HTML page comparing two public companies, shown on a comparison site under each company's name, industry and headquarters and ${headlineNote(lens)} (don't feature those again as standalone figures; charts and tables still include every year).

Lens: ${question}
Guidance written for the site's component mode, which names its own components; treat it as what to show, in whatever form serves the reader: ${guidance}

The page:
- Submit it with submit_page exactly once, then reply "done". If the tool returns an error, fix the page and submit again.
- One complete document (<!doctype html>, <head>, <body>, ending in </html>), under ${MAX_HTML / 1000}KB. Inline CSS and JavaScript only. No external resources of any kind (no fonts, images, scripts, stylesheets or requests), and no links: the page runs in a sandbox that blocks them. Draw any chart the kit can't with inline SVG or canvas.
- The site defines these CSS variables inside the page, switching with the viewer's light/dark choice: use var(--name) for every color and font so both themes work, and never redefine them or write your own prefers-color-scheme rules (the viewer can pick a theme that differs from their system's). Light: ${tokenList(THEME.light)}. Dark: ${tokenList(THEME.dark)}. Fonts: --font-sans (${FONTS.sans}), --font-serif (${FONTS.serif}; headings). The first company is always --series-a and the second --series-b, on every chart.
- Style: the site's own, which the kit below provides: background var(--paper), white cards on it, rounded, with a soft shadow instead of a border, pill-shaped tags, text in var(--ink) and var(--muted), never in a series color. body margin 0. Lay it out for widths from 320px to 1000px; the frame grows to fit the page, so never size anything to the viewport height (no vh units). At 320px nothing may be wider than the page: wide tables scroll sideways inside their own container (overflow-x: auto; give every grid and flex child min-width: 0 so that container can shrink), and charts redraw to their container's width.
- Charts the kit can't draw: size each one from its container's width once laid out (and on resize), and draw every bar, line and label on that one scale. Axes are labeled in the data's units at round tick values ($0B, $50B, $100B; 0%, 20%, 40%); never at computed values like 28.3%. Lay chart cards out so none sits alone in a row.
- Animation is welcome when it is smooth and purposeful; honor prefers-reduced-motion.
- Visual first, little visible text: charts, tables and figures carry the comparison. Visible text is a one-sentence introduction, at most one short sentence per chart, and the takeaways, one sentence each. Any longer explanation goes in a <details> element, closed by default, with a short <summary> naming what it holds (e.g. "How the fiscal years line up"). Never restate in words what a chart already shows.

${KIT_PROMPT}

Grounding:
- Every number you write must appear in the data tables exactly as shown there, with its company and fiscal year. Never compute, round or estimate a new number.
- "n/r" means the filing does not report it and "n/m" means the ratio is not meaningful; say so rather than working around it.
- Say where numbers come from in plain text (e.g. "From each company's 10-K filings, FY2021 to FY2025"). Quotes from the annual reports, if you use them, are copied exactly as given, with their section (10-K, Item 1A).
- End with 3 to 5 neutral takeaways: differences, never a winner, a recommendation or a prediction. Add the line "Not financial advice."`;
}

export async function generatePage(opts: {
  lens: LensSlug;
  companies: CompanyInput[];
  backend: Backend;
  signal: AbortSignal;
  onCall?: (call: Omit<TraceCall, "ms">) => void;
  model?: ModelId;
}): Promise<{ html: string; usage: Usage; model: ModelId; prompt: { system: string; user: string }; offered: string[]; kit: KitPiece[] }> {
  if (LENS_GUIDANCE[opts.lens].needsFilings && opts.companies.some((c) => !c.filing)) {
    throw new Error(`The ${opts.lens} lens needs each company's condensed annual report.`);
  }
  let html: string | undefined;
  const shape = { html: z.string().min(200).max(MAX_HTML).describe("The complete HTML document") };
  const submit: ToolSpec = {
    name: "submit_page",
    description: "Submit the finished HTML page.",
    shape,
    handle(input) {
      if (html) return { ok: false, text: "Already submitted. Reply done." };
      const parsed = z.object(shape).safeParse(input);
      if (!parsed.success) return { ok: false, text: `Invalid input:\n${z.prettifyError(parsed.error)}` };
      const page = parsed.data.html.trim();
      const problem = checkPage(page) ?? checkKitCharts(page, opts.companies);
      if (problem) return { ok: false, text: problem };
      html = page;
      return { ok: true, text: "Shown." };
    },
  };
  const prompt = { system: freeformSystemPrompt(opts.lens), user: userPrompt(opts.companies, { quotes: true }) };
  const model = opts.model ?? "claude-sonnet-5-5";
  const usage = await opts.backend({
    model,
    ...prompt,
    tools: opts.onCall ? recordCalls([submit], opts.onCall) : [submit],
    signal: opts.signal,
  });
  if (!html) throw new ComparisonError("The model finished without writing a page.");
  return { html, usage, model, prompt, offered: [submit.name], kit: kitUsed(html) };
}
