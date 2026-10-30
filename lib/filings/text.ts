// A 10-K's primary document as plain text, its Item 1 and Item 1A sections,
// and the check that a quote really appears in it.

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Inline XBRL filings carry a hidden ix:header of machine-readable facts;
// block elements become line breaks and table cells become spaces, so a
// heading split across cells ("Item 1A." | "Risk Factors") stays on one line.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, "")
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<\/?(p|div|br|tr|li|h[1-6]|table|section)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ​]+/g, " ")
    .replace(/ ?\n[\s]*/g, "\n")
    .trim();
}

const SEP = String.raw`\s*[.:\-–—]?\s*`;
const HEADINGS = {
  business: new RegExp(String.raw`^\s*item\s*1${SEP}business\b`, "gim"),
  risks: new RegExp(String.raw`^\s*item\s*1a${SEP}risk\s+factors\b`, "gim"),
  afterRisks: new RegExp(String.raw`^\s*item\s*(1b|1c|2)${SEP}(unresolved|cybersecurity|properties)\b`, "gim"),
};

const starts = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m.index);

// The longest span from a start heading to the next end heading. The table
// of contents names every heading too, but its spans are a line long.
function longestSpan(text: string, start: RegExp, end: RegExp): string | null {
  const ends = starts(text, end);
  let best: [number, number] | null = null;
  for (const s of starts(text, start)) {
    const e = ends.find((i) => i > s);
    if (e !== undefined && (!best || e - s > best[1] - best[0])) best = [s, e];
  }
  return best ? text.slice(best[0], best[1]).trim() : null;
}

// Item 1 (Business) and Item 1A (Risk Factors). Either is null when the
// filing doesn't use the standard headings (some banks file an index of
// cross-references instead); the caller decides what to do then.
export function annualReportSections(text: string): { business: string | null; risks: string | null } {
  return {
    business: longestSpan(text, HEADINGS.business, HEADINGS.risks),
    risks: longestSpan(text, HEADINGS.risks, HEADINGS.afterRisks),
  };
}

// Typography and whitespace may differ between a quote and the filing
// (curly vs straight quotes, line breaks); the words, case and punctuation
// may not.
export const canonical = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export const quoteAppearsIn = (quote: string, canonicalText: string) => canonicalText.includes(canonical(quote));
