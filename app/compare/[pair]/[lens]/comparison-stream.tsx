"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import type { Component } from "@/agent/catalog";
import { LENS_GUIDANCE } from "@/agent/lenses";
import type { LensSlug } from "@/lib/lenses";
import type { CompanyInput } from "@/agent/prompt";
import type { CompareEvent } from "@/lib/compare";
import { parseMode, type Mode } from "@/lib/compare-url";
import { FreeformFrame } from "./freeform-frame";
import { HeadlineStrip } from "./headline-strip";
import { snapshotPills, type PillSnapshot } from "./morph";
import { ComponentView } from "./renderers";
import { FilingPills, type TextKind } from "./text-tiles";

// Reads POST /api/compare's event stream: progress steps first, then each
// component as the model shows it. On a text lens, each 10-K's own list shows
// as soon as it is read, then morphs into the grouped tiles. In freeform mode
// (?mode=freeform) the model's one page replaces the components.

const TEXT_KIND: Partial<Record<LensSlug, TextKind>> = { "risk-exposure": "risks", "where-they-compete": "areas" };
const isText = (c: Component) => c.name === "risk_themes" || c.name === "business_overlap";

type State = {
  status: "loading" | "error" | "done";
  step: "fetching" | "reading" | "building";
  companies: CompanyInput[] | null;
  components: Component[];
  html: string | null;
  cached: boolean;
  featured: string | null; // generation date
  error?: string;
};

const initial: State = { status: "loading", step: "fetching", companies: null, components: [], html: null, cached: false, featured: null };

function reduce(state: State, event: CompareEvent | { type: "closed" } | { type: "restart" }): State {
  switch (event.type) {
    case "restart":
      return initial;
    case "heartbeat":
      return state;
    case "progress":
      return { ...state, step: event.step };
    case "data":
      return { ...state, companies: event.companies };
    case "filing":
      return { ...state, companies: state.companies?.map((c) => (c.ticker === event.ticker ? { ...c, filing: event.filing } : c)) ?? null };
    case "component":
      return { ...state, components: [...state.components, event.component] };
    case "page":
      return { ...state, html: event.html };
    case "done":
      return { ...state, status: "done", cached: event.cached, featured: event.featured ?? null };
    case "error":
      return { ...state, status: "error", error: event.message };
    case "closed":
      // A stream that ends without done or error was cut off.
      return state.status === "loading" ? { ...state, status: "error", error: "The connection closed before the comparison finished." } : state;
  }
}

const STEPS = [
  { step: "fetching", label: "Fetching SEC data" },
  { step: "reading", label: "Reading annual reports" },
  { step: "building", label: "Building comparison" },
] as const;

export function ComparisonStream({ pair, lens }: { pair: string; lens: string }) {
  const mode = parseMode(useSearchParams().get("mode"));
  // The URL is the toggle's state, so Back switches modes too.
  const choose = (next: Mode) => {
    const url = new URL(window.location.href);
    if (next === "freeform") url.searchParams.set("mode", "freeform");
    else url.searchParams.delete("mode");
    window.history.pushState(null, "", url);
  };
  return (
    <>
      <div className="mt-8 flex justify-end">
        <ModeSwitch mode={mode} onChange={choose} />
      </div>
      <Stream key={mode} pair={pair} lens={lens} mode={mode} />
    </>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const modes = [
    { mode: "components", label: "Components" },
    { mode: "freeform", label: "Freeform" },
  ] as const;
  return (
    <div role="radiogroup" aria-label="How Claude builds the comparison" className="mode-switch relative grid grid-cols-2 rounded-full border border-rule bg-surface p-1 text-sm">
      <span aria-hidden className="mode-thumb absolute inset-y-1 left-1 rounded-full bg-ink" data-second={mode === "freeform" || undefined} />
      {modes.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={mode === m.mode}
          onClick={() => mode !== m.mode && onChange(m.mode)}
          className={`relative z-10 rounded-full px-4 py-1.5 transition-colors duration-300 ${mode === m.mode ? "text-paper" : "text-muted hover:text-ink"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function Stream({ pair, lens, mode }: { pair: string; lens: string; mode: Mode }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [run, setRun] = useState({ n: 0, regenerate: false });
  const stage = useRef<HTMLElement>(null);
  const pills = useRef<PillSnapshot[] | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pair, lens, mode, regenerate: run.regenerate }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = (buffer + value).split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line) continue;
            const event = JSON.parse(line) as CompareEvent;
            // The pills are about to unmount: remember where each one was.
            if (event.type === "component" && isText(event.component) && stage.current) pills.current = snapshotPills(stage.current);
            dispatch(event);
          }
        }
        dispatch({ type: "closed" });
      } catch {
        if (!abort.signal.aborted) dispatch({ type: "error", message: "Couldn't reach the server. Check your connection and try again." });
      }
    })();
    return () => abort.abort();
  }, [pair, lens, mode, run]);

  const restart = (regenerate: boolean) => {
    dispatch({ type: "restart" });
    setRun((r) => ({ n: r.n + 1, regenerate }));
  };
  const steps = STEPS.filter((s) => s.step !== "reading" || LENS_GUIDANCE[lens as LensSlug]?.needsFilings);
  const currentStep = steps.findIndex((s) => s.step === state.step);
  const textKind = TEXT_KIND[lens as LensSlug];
  const firstText = state.components.findIndex(isText);
  const showPills = textKind && state.companies && state.status === "loading" && firstText < 0 && !state.html;

  return (
    <section ref={stage} className="relative mt-4 space-y-4" aria-live="polite" aria-busy={state.status === "loading"}>
      {state.companies && <HeadlineStrip lens={lens as LensSlug} companies={state.companies} />}

      {state.status === "loading" && (
        <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={s.step} className={`flex items-center gap-2 ${i > currentStep ? "text-muted" : ""}`}>
              {i < currentStep ? (
                <span aria-hidden>✓</span>
              ) : i === currentStep ? (
                <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : (
                <span aria-hidden className="size-3 rounded-full border border-rule" />
              )}
              {s.label}
              {i === currentStep && <span className="sr-only">(in progress)</span>}
            </li>
          ))}
        </ol>
      )}

      {state.companies &&
        state.components.map((c, i) => <ComponentView key={i} component={c} companies={state.companies!} morph={i === firstText ? { stage, pills } : undefined} />)}

      {state.html && (
        <>
          <FreeformFrame html={state.html} />
          <p className="text-sm text-muted">
            Claude wrote this page itself from the same filing data. Its numbers aren&apos;t linked to their filings; Components cites each one.
          </p>
        </>
      )}

      {showPills && <FilingPills companies={state.companies!} kind={textKind} freeform={mode === "freeform"} />}

      {state.status === "loading" && state.step === "building" && !showPills && !state.html && (
        <div className="h-32 animate-pulse rounded-lg border border-rule bg-surface" aria-hidden />
      )}

      {state.status === "error" && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-5 py-4">
          <p className="text-danger">{state.error}</p>
          <button type="button" onClick={() => restart(false)} className="mt-3 text-sm text-accent hover:underline">
            Try again
          </button>
        </div>
      )}

      {state.status === "done" && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>
            {state.featured
              ? `Featured comparison, generated by Claude on ${state.featured}.`
              : state.cached
                ? "Saved comparison, generated earlier by Claude."
                : "Generated by Claude just now."}
          </span>
          {/* A featured comparison is fixed; the other lenses of the pair can be generated. */}
          {!state.featured && (
            <button type="button" onClick={() => restart(true)} className="rounded-md border border-rule px-3 py-1.5 text-ink hover:bg-paper">
              Regenerate
            </button>
          )}
        </div>
      )}
    </section>
  );
}
