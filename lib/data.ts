import { cached, getCache } from "./cache/cache.ts";
import { NORMALIZE_VERSION, normalize } from "./normalize/normalize.ts";
import { fetchCompanyFacts, fetchSubmissions, fetchTickerIndex } from "./sec/client.ts";
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
