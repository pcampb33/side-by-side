// /compare/AAPL-vs-MSFT/growth. Pairs are uppercase and alphabetical, so each
// pair has one URL and one cache entry; proxy.ts redirects the other forms.

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

export function parsePair(pair: string): [string, string] | null {
  const parts = decodeURIComponent(pair).toUpperCase().split("-VS-");
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!TICKER.test(a) || !TICKER.test(b) || a === b) return null;
  return [a, b];
}

export function comparePath(a: string, b: string, lens: string): string {
  const [first, second] = [a.toUpperCase(), b.toUpperCase()].sort();
  return `/compare/${first}-vs-${second}/${lens}`;
}

// The canonical form of a /compare/<pair>/<lens> path, or null when the pair
// can't be parsed (the page then 404s on its own).
export function canonicalComparePath(pathname: string): string | null {
  const match = /^\/compare\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const pair = parsePair(match[1]);
  return pair ? comparePath(pair[0], pair[1], match[2].toLowerCase()) : null;
}

// ?mode=freeform; components is the default and has no parameter.
export const MODES = ["components", "freeform"] as const;
export type Mode = (typeof MODES)[number];
export const parseMode = (value: string | null | undefined): Mode => (value === "freeform" ? "freeform" : "components");
