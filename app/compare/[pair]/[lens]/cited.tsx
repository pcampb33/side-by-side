"use client";

import type { CompanyInput } from "@/agent/prompt";
import { formatValue } from "@/lib/format";
import type { Source } from "@/lib/normalize/normalize";
import { filingDocumentUrl, filingUrl } from "@/lib/sec/client";
import { fiscalYearOf, valueAt, valueDef, type ValueKey } from "@/lib/values";
import { Popover } from "./popover";

// Every number on the page is a Cited: hover, focus or tap shows the filing
// it came from (and, for a derived value, how it was computed).

export const SERIES = ["var(--series-a)", "var(--series-b)"];

export interface Citation {
  cik: number;
  sources: Source[];
  formula?: string;
  section?: string; // a quote's place in the filing ("Item 1A")
  url?: string; // the document itself, when known; else the filing's folder
}

export type Looked =
  | { kind: "value"; value: number; text: string; citation: Citation }
  | { kind: "missing"; text: string };

export function lookup(c: CompanyInput, key: ValueKey, fy: number | "latest"): Looked {
  const v = valueAt(c.financials, key, fy);
  const { unit, formula } = valueDef(key);
  if (v.status === "value") return { kind: "value", value: v.value, text: formatValue(v.value, unit), citation: { cik: c.financials.cik, sources: v.sources, formula: v.formula ?? formula } };
  if (v.status === "not_meaningful") return { kind: "missing", text: "Not meaningful" };
  if (v.status === "no_such_year") return { kind: "missing", text: `No FY${fiscalYearOf(c.financials, fy)} data` };
  return { kind: "missing", text: "Not reported" };
}

// A quote's citation: the 10-K it came from and its place in it.
export function quoteCitation(c: CompanyInput, section: string): Citation {
  const { report, fiscalYear } = c.filing!;
  const source = { accn: report.accn, form: "10-K", filingFy: fiscalYear, filed: report.filed, periodEnd: report.periodEnd, tag: "" };
  return { cik: c.financials.cik, sources: [source], section, url: filingDocumentUrl(c.financials.cik, report.accn, report.document) };
}

export function Value({ looked, className = "" }: { looked: Looked; className?: string }) {
  return looked.kind === "value" ? (
    <Cited text={looked.text} citation={looked.citation} className={className} />
  ) : (
    <span className={`text-muted ${className}`}>{looked.text}</span>
  );
}

export function Cited({ text, citation, className = "" }: { text: string; citation: Citation; className?: string }) {
  // One filing usually supplies every input; list each filing once.
  const filings = [...new Map(citation.sources.map((s) => [s.accn, s])).values()];
  return (
    <Popover trigger={text} className={`cursor-help tabular-nums underline decoration-muted/50 decoration-dotted underline-offset-4 hover:decoration-ink ${className}`}>
      {citation.formula && <span className="mb-2 block text-muted">{citation.formula}</span>}
      {filings.map((s) => (
        <span key={s.accn} className="block not-first:mt-2">
          <span className="block font-medium">
            {s.form} for FY{s.filingFy}
            {citation.section && `, ${citation.section}`}
          </span>
          <span className="block text-muted">Filed {s.filed}</span>
          <a href={citation.url ?? filingUrl(citation.cik, s.accn)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            View filing on SEC.gov ↗
          </a>
        </span>
      ))}
    </Popover>
  );
}
