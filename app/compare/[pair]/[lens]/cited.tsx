"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyInput } from "@/agent/prompt";
import { formatValue } from "@/lib/format";
import type { Source } from "@/lib/normalize/normalize";
import { filingUrl } from "@/lib/sec/client";
import { fiscalYearOf, valueAt, valueDef, type ValueKey } from "@/lib/values";

// Every number on the page is a Cited: hover, focus or tap shows the filing
// it came from (and, for a derived value, how it was computed).

const POPOVER_WIDTH = 256;

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
  if (v.status === "value") return { kind: "value", value: v.value, text: formatValue(v.value, unit), citation: { cik: c.financials.cik, sources: v.sources, formula } };
  if (v.status === "not_meaningful") return { kind: "missing", text: "Not meaningful" };
  if (v.status === "no_such_year") return { kind: "missing", text: `No FY${fiscalYearOf(c.financials, fy)} data` };
  return { kind: "missing", text: "Not reported" };
}

export function Value({ looked, className = "" }: { looked: Looked; className?: string }) {
  return looked.kind === "value" ? (
    <Cited text={looked.text} citation={looked.citation} className={className} />
  ) : (
    <span className={`text-muted ${className}`}>{looked.text}</span>
  );
}

export function Cited({ text, citation, className = "" }: { text: string; citation: Citation; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  // Fixed to the viewport, so a scrolling table can't clip it.
  const show = () => {
    const rect = ref.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    setAt(rect.bottom + 200 < window.innerHeight ? { top: rect.bottom + 6, left } : { bottom: window.innerHeight - rect.top + 6, left });
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && hide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // One filing usually supplies every input; list each filing once.
  const filings = [...new Map(citation.sources.map((s) => [s.accn, s])).values()];

  return (
    <span
      ref={ref}
      className="relative inline-block"
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && !pinned && setOpen(false)}
      onBlur={(e) => !ref.current?.contains(e.relatedTarget) && hide()}
    >
      <button
        type="button"
        aria-expanded={open}
        onFocus={show}
        onClick={() => (pinned ? hide() : (setPinned(true), show()))}
        className={`cursor-help tabular-nums underline decoration-muted/50 decoration-dotted underline-offset-4 hover:decoration-ink ${className}`}
      >
        {text}
      </button>
      {open && (
        <span
          role="note"
          className="fixed z-30 block rounded-md border border-rule bg-surface p-3 text-left font-sans text-xs leading-relaxed font-normal text-ink shadow-lg"
          style={{ ...at, width: POPOVER_WIDTH }}
        >
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
        </span>
      )}
    </span>
  );
}
