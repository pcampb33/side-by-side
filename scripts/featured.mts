// npm run featured -- [--only <text>]
// Generates each featured comparison (evals/cases.ts) in both modes and saves
// it to featured/<pair>-<lens>.json with everything the page needs (profiles,
// financials, condensed 10-Ks, components, freeform page), so the site shows
// it with no Claude or SEC calls. A run is kept only when every eval check
// passes; up to three tries per mode. --only keeps the ids containing the text.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import type { Component } from "../agent/catalog.ts";
import { generatePage } from "../agent/freeform.ts";
import { LENS_GUIDANCE } from "../agent/lenses.ts";
import { generateComparison, type ModelId, type Usage } from "../agent/run.ts";
import { traceCall, type Trace, type TraceCall } from "../agent/trace.ts";
import { FEATURED } from "../evals/cases.ts";
import { checkResults } from "../evals/checks.ts";
import { scoreOutput } from "../evals/score.ts";
import { attachFiling, backendName, defaultBackend, loadCompany } from "../lib/compare.ts";
import { getProfile } from "../lib/data.ts";
import type { Featured } from "../lib/featured.ts";

const MODEL: ModelId = "claude-sonnet-5-5";
const TRIES = 3;
const { values: args } = parseArgs({ options: { only: { type: "string" } } });
const outDir = path.join(import.meta.dirname, "..", "featured");
const backend = await defaultBackend();
const signal = new AbortController().signal;
const browser = await chromium.launch();

type Generated = ({ components: Component[] } | { html: string }) & { usage: Usage; model: ModelId; prompt: Trace["prompt"]; offered: string[] };

// The first output whose checks all pass, with its trace (SPEC §4a) as the site records one.
async function passing<T extends Generated>(
  label: string,
  make: (onCall: (call: Omit<TraceCall, "ms">) => void) => Promise<T>,
  score: (out: T) => ReturnType<typeof scoreOutput>,
  base: Pick<Trace, "lens" | "at"> & { fetching: number; reading: number | null },
): Promise<{ out: T; trace: Trace }> {
  for (let i = 1; i <= TRIES; i++) {
    const start = performance.now();
    try {
      const calls: TraceCall[] = [];
      const out = await make((call) => calls.push(traceCall(call, Math.round(performance.now() - start))));
      const composing = Math.round(performance.now() - start);
      const { findings, numbers, quotes } = await score(out);
      const seconds = Math.round((performance.now() - start) / 1000);
      if (!findings.length) {
        console.log(`  ${label}: try ${i} passes (${seconds}s)`);
        const mode = "html" in out ? "freeform" : "components";
        const trace: Trace = {
          v: 1,
          mode,
          lens: base.lens,
          model: out.model,
          backend: backendName(),
          at: base.at,
          ms: { fetching: base.fetching, reading: base.reading, composing, checks: Math.round(performance.now() - start) - composing },
          usage: out.usage,
          offered: out.offered,
          prompt: out.prompt,
          calls,
          checks: checkResults(findings, { numbers, quotes }, mode),
        };
        return { out, trace };
      }
      console.log(`  ${label}: try ${i} has ${findings.length} finding(s): ${findings.map((f) => f.detail.slice(0, 120)).join(" | ")}`);
    } catch (err) {
      console.log(`  ${label}: try ${i} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(`${label}: no passing run in ${TRIES} tries`);
}

fs.mkdirSync(outDir, { recursive: true });
try {
  for (const { tickers, lens } of FEATURED) {
    const id = `${tickers.join("-vs-")}-${lens}`;
    if (args.only && !id.includes(args.only)) continue;
    console.log(id);
    const at = new Date().toISOString();
    let t = performance.now();
    const companies = await Promise.all(tickers.map(loadCompany));
    const fetching = Math.round(performance.now() - t);
    t = performance.now();
    if (LENS_GUIDANCE[lens].needsFilings) await Promise.all(companies.map((c) => attachFiling(c, backend, signal)));
    const reading = LENS_GUIDANCE[lens].needsFilings ? Math.round(performance.now() - t) : null;
    const base = { lens, at, fetching, reading };
    const profiles = await Promise.all(companies.map((c) => getProfile(c.financials.cik)));
    const score = (out: { components: Component[] } | { html: string }) => scoreOutput(out, lens, companies, browser);
    const comp = await passing("components", (onCall) => generateComparison({ lens, companies, backend, signal, model: MODEL, onCall, onComponent: () => {} }), score, base);
    const free = await passing("freeform", (onCall) => generatePage({ lens, companies, backend, signal, model: MODEL, onCall }), score, base);
    const featured: Featured = {
      tickers,
      lens,
      model: MODEL,
      generatedAt: new Date().toISOString().slice(0, 10),
      companies: companies.map((c, i) => ({ ...c, profile: profiles[i] })),
      components: comp.out.components,
      html: free.out.html,
      traces: { components: comp.trace, freeform: free.trace },
    };
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(featured, null, 1) + "\n");
  }
} finally {
  await browser.close();
}
