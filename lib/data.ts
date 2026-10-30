import type { Backend } from "../agent/run.ts";
import { cached, getCache } from "./cache/cache.ts";
import { CONDENSE_VERSION, condenseAnnualReport, latestAnnualReport, type AnnualReport } from "./filings/condense.ts";
import { htmlToText } from "./filings/text.ts";
import { NORMALIZE_VERSION, normalize } from "./normalize/normalize.ts";
import { fetchCompanyFacts, fetchFilingDocument, fetchSubmissions, fetchTickerIndex } from "./sec/client.ts";
import { toProfile } from "./sec/profile.ts";

const DAY = 86_400;

export function getTickerIndex(backend = getCache()) {
  return cached("tickers:v2", DAY, fetchTickerIndex, backend);
}

export async function findTicker(ticker: string, backend = getCache()) {
  const index = await getTickerIndex(backend);
  return index.find((e) => e.ticker === ticker.toUpperCase());
}

export function getProfile(cik: number, backend = getCache()) {
  return cached(`profile:v1:${cik}`, DAY, async () => toProfile(await fetchSubmissions(cik)), backend);
}

// Raw companyfacts runs to several MB for large filers; only the normalized
// result (a few KB) is cached.
export function getFinancials(cik: number, backend = getCache()) {
  return cached(`financials:v${NORMALIZE_VERSION}:${cik}`, DAY, async () => normalize(await fetchCompanyFacts(cik)), backend);
}

// null: the company has filed no 10-K.
export function getAnnualReport(cik: number, backend = getCache()) {
  return cached(`annual-report:v1:${cik}`, DAY, async () => latestAnnualReport(await fetchSubmissions(cik)), backend);
}

// Condensed once per filing: a filing never changes, and a newer 10-K has a
// new accession number.
export function getCondensedFiling(opts: { cik: number; name: string; report: AnnualReport; model: Backend; signal: AbortSignal }, backend = getCache()) {
  const { cik, report } = opts;
  return cached(
    `filing:v${CONDENSE_VERSION}:${report.accn}`,
    undefined,
    async () =>
      condenseAnnualReport({
        name: opts.name,
        report,
        text: htmlToText(await fetchFilingDocument(cik, report.accn, report.document)),
        backend: opts.model,
        signal: opts.signal,
      }),
    backend,
  );
}
