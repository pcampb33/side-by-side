// npm run fixtures:sec — refetches the R2 filers' companyfacts from the SEC
// and saves only what normalize() reads (metric tags, 10-K entries, recent
// years), so tests run offline against real filings at a few KB each.
import fs from "node:fs";
import path from "node:path";
import { fetchCompanyFacts, type CompanyFacts } from "../lib/sec/client.ts";
import { METRICS } from "../lib/normalize/metrics.ts";

const FILERS = { AAPL: 320193, MSFT: 789019, NVDA: 1045810, KO: 21344, F: 37996, JPM: 19617 };
const KEEP_YEARS = 8;
const outDir = path.join(import.meta.dirname, "..", "lib", "normalize", "fixtures");

fs.mkdirSync(outDir, { recursive: true });
for (const [ticker, cik] of Object.entries(FILERS)) {
  const facts = await fetchCompanyFacts(cik);
  const gaap = facts.facts["us-gaap"] ?? {};
  const kept: CompanyFacts["facts"][string] = {};
  const latestEnd = Object.values(gaap)
    .flatMap((t) => Object.values(t.units).flat())
    .filter((e) => e.form.startsWith("10-K"))
    .reduce((max, e) => (e.end > max ? e.end : max), "");
  const cutoff = `${Number(latestEnd.slice(0, 4)) - KEEP_YEARS}${latestEnd.slice(4)}`;
  for (const def of Object.values(METRICS)) {
    for (const tag of def.tags) {
      const entries = (gaap[tag]?.units[def.unit] ?? [])
        .filter((e) => e.form.startsWith("10-K") && e.end >= cutoff)
        .map(({ start, end, val, accn, fy, fp, form, filed }) => ({ start, end, val, accn, fy, fp, form, filed }));
      if (entries.length) kept[tag] = { units: { [def.unit]: entries } };
    }
  }
  const fixture: CompanyFacts = { cik: facts.cik, entityName: facts.entityName, facts: { "us-gaap": kept } };
  const file = path.join(outDir, `${ticker}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture) + "\n");
  console.log(`${ticker}: ${Object.keys(kept).length} tags, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
