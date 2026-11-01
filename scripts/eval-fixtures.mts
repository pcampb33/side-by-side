// npm run eval:fixtures — saves each eval company's payload as the app builds
// it (financials, plus the condensed 10-K for text lenses) to evals/fixtures/,
// so evals run against a fixed snapshot. Reads through the cache: SEC calls
// and Haiku only for what isn't cached.
import fs from "node:fs";
import path from "node:path";
import { CASES, NEEDS_FILING } from "../evals/cases.ts";
import { attachFiling, defaultBackend, loadCompany } from "../lib/compare.ts";

const outDir = path.join(import.meta.dirname, "..", "evals", "fixtures");
const backend = await defaultBackend();
fs.mkdirSync(outDir, { recursive: true });
for (const ticker of new Set(CASES.flatMap((c) => c.tickers))) {
  const company = await loadCompany(ticker);
  if (NEEDS_FILING.has(ticker)) await attachFiling(company, backend, new AbortController().signal);
  const file = path.join(outDir, `${ticker}.json`);
  fs.writeFileSync(file, JSON.stringify(company, null, 1) + "\n");
  console.log(`${ticker}: FY${company.financials.fiscalYears.join(", ")}${company.filing ? `, 10-K ${company.filing.report.accn}` : ""}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
