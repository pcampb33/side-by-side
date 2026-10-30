import { cached, getCache } from "./cache/cache.ts";
import { NORMALIZE_VERSION, normalize } from "./normalize/normalize.ts";
import { fetchCompanyFacts, fetchTickerIndex } from "./sec/client.ts";

const DAY = 86_400;

export function getTickerIndex(backend = getCache()) {
  return cached("tickers:v1", DAY, fetchTickerIndex, backend);
}

// Raw companyfacts runs to several MB for large filers; only the normalized
// result (a few KB) is cached.
export function getFinancials(cik: number, backend = getCache()) {
  return cached(`financials:v${NORMALIZE_VERSION}:${cik}`, DAY, async () => normalize(await fetchCompanyFacts(cik)), backend);
}
