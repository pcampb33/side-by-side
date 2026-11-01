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
import { generateComparison, type ModelId } from "../agent/run.ts";
import { FEATURED } from "../evals/cases.ts";
import { scoreOutput } from "../evals/score.ts";
import { attachFiling, defaultBackend, loadCompany } from "../lib/compare.ts";
import { getProfile } from "../lib/data.ts";
import type { Featured } from "../lib/featured.ts";

const MODEL: ModelId = "claude-sonnet-5-5";
const TRIES = 3;
const { values: args } = parseArgs({ options: { only: { type: "string" } } });
const outDir = path.join(import.meta.dirname, "..", "featured");
const backend = await defaultBackend();
const signal = new AbortController().signal;
const browser = await chromium.launch();

// The first output whose checks all pass.
async function passing<T extends { components: Component[] } | { html: string }>(label: string, make: () => Promise<T>, score: (out: T) => ReturnType<typeof scoreOutput>): Promise<T> {
  for (let i = 1; i <= TRIES; i++) {
    const start = performance.now();
    try {
      const out = await make();
      const { findings } = await score(out);
      const seconds = Math.round((performance.now() - start) / 1000);
      if (!findings.length) {
        console.log(`  ${label}: try ${i} passes (${seconds}s)`);
        return out;
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
    const companies = await Promise.all(tickers.map(loadCompany));
    if (LENS_GUIDANCE[lens].needsFilings) await Promise.all(companies.map((c) => attachFiling(c, backend, signal)));
    const profiles = await Promise.all(companies.map((c) => getProfile(c.financials.cik)));
    const score = (out: { components: Component[] } | { html: string }) => scoreOutput(out, lens, companies, browser);
    const { components } = await passing("components", () => generateComparison({ lens, companies, backend, signal, model: MODEL, onComponent: () => {} }), score);
    const { html } = await passing("freeform", () => generatePage({ lens, companies, backend, signal, model: MODEL }), score);
    const featured: Featured = {
      tickers,
      lens,
      model: MODEL,
      generatedAt: new Date().toISOString().slice(0, 10),
      companies: companies.map((c, i) => ({ ...c, profile: profiles[i] })),
      components,
      html,
    };
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(featured, null, 1) + "\n");
  }
} finally {
  await browser.close();
}
