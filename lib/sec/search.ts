import type { TickerEntry } from "./client.ts";

// Ticker matches beat name matches. Ties keep index order, which the SEC
// publishes roughly largest company first. One row per company: JPM's
// preferred-share tickers (JPM-PC, JPM-PD, ...) would otherwise fill the list.
export function searchTickers(index: TickerEntry[], query: string, limit = 8): TickerEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { entry: TickerEntry; score: number }[] = [];
  for (const entry of index) {
    const ticker = entry.ticker.toLowerCase();
    const name = entry.name.toLowerCase();
    const score =
      ticker === q ? 0
      : ticker.startsWith(q) ? 1
      : name.startsWith(q) ? 2
      : name.split(/[\s.,&-]+/).some((word) => word.startsWith(q)) ? 3
      : -1;
    if (score >= 0) scored.push({ entry, score });
  }
  const seen = new Set<number>();
  return scored
    .sort((a, b) => a.score - b.score)
    .filter(({ entry }) => !seen.has(entry.cik) && seen.add(entry.cik))
    .slice(0, limit)
    .map((s) => s.entry);
}
