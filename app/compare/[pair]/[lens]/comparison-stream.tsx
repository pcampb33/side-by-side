"use client";

import { useSearchParams } from "next/navigation";
import { addTransitionType, startTransition, useEffect, useReducer, useRef, useState, ViewTransition } from "react";
import type { Component } from "@/agent/catalog";
import type { BlockReason } from "@/lib/access";
import type { LensSlug } from "@/lib/lenses";
import type { CompanyInput } from "@/agent/prompt";
import type { Trace, TraceCall } from "@/agent/trace";
import type { CompareEvent } from "@/lib/compare";
import { parseMode, parsePair, type Mode } from "@/lib/compare-url";
import { findLens } from "@/lib/lenses";
import { BlockedPanel } from "./blocked-panel";
import { fullWidth, loadingCardFull } from "./chart-pairs";
import { FreeformFrame } from "./freeform-frame";
import { useProcess } from "./process-context";
import { processSteps, type ProcessInput, type StepId } from "./process-model";
import { HeadlineStrip } from "./headline-strip";
import { Info } from "./popover";
import { snapshotPills, type PillSnapshot } from "./morph";
import { ComponentView } from "./renderers";
import { YearLink } from "./trend-line";
import { FilingPills, type TextKind } from "./text-tiles";

// Reads POST /api/compare's event stream: progress steps first, then each
// component as the model shows it. On a text lens, each 10-K's own list shows
// as soon as it is read, then morphs into the grouped tiles. In freeform mode
// (?mode=freeform) the model's one page replaces the components.

const TEXT_KIND: Partial<Record<LensSlug, TextKind>> = { "risk-exposure": "risks", "where-they-compete": "areas" };
const isText = (c: Component) => c.name === "risk_themes" || c.name === "business_overlap";

type State = {
  status: "loading" | "error" | "done" | "blocked";
  step: "fetching" | "reading" | "building" | "checking";
  companies: CompanyInput[] | null;
  components: Component[];
  calls: TraceCall[]; // live: every tool call as it is made
  trace: Trace | null;
  html: string | null;
  cached: boolean;
  featured: string | null; // generation date
  error?: string;
  blocked?: BlockReason;
};

const initial: State = { status: "loading", step: "fetching", companies: null, components: [], calls: [], trace: null, html: null, cached: false, featured: null };

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
    case "call":
      return { ...state, calls: [...state.calls, event.call] };
    case "trace":
      return { ...state, trace: event.trace };
    case "done":
      return { ...state, status: "done", cached: event.cached, featured: event.featured ?? null };
    case "error":
      return { ...state, status: "error", error: event.message };
    case "blocked":
      return { ...state, status: "blocked", blocked: event.reason };
    case "closed":
      // A stream that ends without done or error was cut off.
      return state.status === "loading" ? { ...state, status: "error", error: "The connection closed before the comparison finished." } : state;
  }
}

export function ComparisonStream({ pair, lens }: { pair: string; lens: string }) {
  const mode = parseMode(useSearchParams().get("mode"));
  // The URL is the toggle's state, so Back switches modes too.
  const choose = (next: Mode) => {
    const url = new URL(window.location.href);
    if (next === "freeform") url.searchParams.set("mode", "freeform");
    else url.searchParams.delete("mode");
    // A transition, so the old mode slides out the way the toggle moves and the new one in.
    startTransition(() => {
      addTransitionType(next === "freeform" ? "mode-next" : "mode-prev");
      window.history.pushState(null, "", url);
    });
  };
  const toggleRow = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={toggleRow} className="mt-8 flex scroll-mt-4 flex-wrap-reverse items-center justify-end gap-x-6 gap-y-3">
        <ModeNote key={mode} mode={mode} />
        <ModeSwitch mode={mode} onChange={choose} />
      </div>
      <CompactHeader pair={pair} lens={lens} toggleRow={toggleRow}>
        {/* Back to the toggle first: the new mode starts there (and would otherwise load short and clamp the scroll). */}
        <ModeSwitch compact mode={mode} onChange={(next) => (toggleRow.current!.scrollIntoView({ block: "start" }), choose(next))} />
      </CompactHeader>
      <ViewTransition key={mode} enter={MODE_SLIDE.enter} exit={MODE_SLIDE.exit} default="none">
        <Stream pair={pair} lens={lens} mode={mode} />
      </ViewTransition>
    </>
  );
}

// Once the mode toggle scrolls away, the title and the toggle slide down in a bar
// that stays at the top of the comparison's column (so never over the panel).
function CompactHeader({ pair, lens, toggleRow, children }: { pair: string; lens: string; toggleRow: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setOn(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(toggleRow.current!);
    return () => observer.disconnect();
  }, [toggleRow]);
  const tickers = parsePair(pair);
  return (
    <div className="sticky top-0 z-30 h-0">
      <div className="compact-bar card" data-on={on || undefined} inert={!on}>
        <span className="min-w-0 truncate font-display font-semibold tracking-tight">
          {tickers?.[0]} <span className="text-muted">vs</span> {tickers?.[1]}
          <span className="hidden font-normal text-muted sm:inline"> · {findLens(lens)?.label}</span>
        </span>
        {children}
      </div>
    </div>
  );
}

// Switching modes: Freeform is to the right of Components on the toggle.
const MODE_SLIDE = {
  enter: { "mode-next": "vt-from-right", "mode-prev": "vt-from-left", default: "none" },
  exit: { "mode-next": "vt-to-left", "mode-prev": "vt-to-right", default: "none" },
};

const MODE_NOTE: Record<Mode, string> = {
  components: "Claude picks from the site's charts and cards; every number is looked up and links to its filing.",
  freeform: "Claude writes the whole page itself from the same data; its numbers are checked but not linked.",
};

// One line on what the selected mode means (it fades in on each switch), and both modes side by side on demand.
function ModeNote({ mode }: { mode: Mode }) {
  return (
    <p className="mode-note min-w-0 flex-1 basis-72 text-sm text-muted">
      {MODE_NOTE[mode]}
      <Info label="How Components and Freeform differ" width={300}>
        <span className="block font-medium">Components</span>
        <span className="block">
          Claude builds the page from a fixed set of tested charts and cards, naming metrics and years. The site looks every value up, so each number cites its filing.
        </span>
        <span className="mt-2 block font-medium">Freeform</span>
        <span className="block">
          Claude writes a page of its own HTML, with the site&apos;s cards and a chart helper that looks values up. Layouts vary more; the numbers it writes are checked against the
          filings afterwards, but aren&apos;t linked.
        </span>
        <span className="mt-2 block text-muted">Both use the same data, rules and checks.</span>
      </Info>
    </p>
  );
}

// `compact`: the smaller one in the compact header, which never shrinks.
function ModeSwitch({ mode, onChange, compact = false }: { mode: Mode; onChange: (mode: Mode) => void; compact?: boolean }) {
  const modes = [
    { mode: "components", label: "Components" },
    { mode: "freeform", label: "Freeform" },
  ] as const;
  return (
    <div role="radiogroup" aria-label="How Claude builds the comparison" className={`mode-switch relative grid grid-cols-2 rounded-full border border-rule bg-surface p-1 ${compact ? "flex-none text-xs" : "text-sm"}`}>
      <span aria-hidden className="mode-thumb absolute inset-y-1 left-1 rounded-full bg-ink" data-second={mode === "freeform" || undefined} />
      {modes.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={mode === m.mode}
          onClick={() => mode !== m.mode && onChange(m.mode)}
          className={`relative z-10 rounded-full ${compact ? "px-3 py-1" : "px-4 py-1.5"} transition-colors duration-(--dur-base) ${mode === m.mode ? "text-paper" : "text-muted hover:text-ink"}`}
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
  const { setInput } = useProcess();
  const timing = useRef<{ startedAt: number; doneAt: Partial<Record<StepId, number>> }>({ startedAt: 0, doneAt: {} });

  // A new run's clock starts (declared first, so the effect below never reads the old one).
  useEffect(() => {
    timing.current = { startedAt: Date.now(), doneAt: {} };
  }, [pair, lens, mode, run]);

  // The process panel, strip and overlay show this run as it happens.
  useEffect(() => {
    const input: ProcessInput = {
      lens: lens as LensSlug,
      mode,
      status: state.status,
      step: state.step,
      companies: state.companies,
      shown: state.html ? 1 : state.components.length,
      calls: state.calls,
      trace: state.trace,
    };
    // Each step's finish, timed here (the panel may mount mid-run); a saved result has no live timing.
    const { startedAt, doneAt } = timing.current;
    for (const step of processSteps(input)) if (step.state === "done" && doneAt[step.id] === undefined) doneAt[step.id] = Date.now() - startedAt;
    setInput({ ...input, timing: state.cached ? null : { startedAt, doneAt: { ...doneAt } } });
  }, [state, lens, mode, setInput]);

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
  const textKind = TEXT_KIND[lens as LensSlug];
  const firstText = state.components.findIndex(isText);
  const showPills = textKind && state.companies && state.status === "loading" && firstText < 0 && !state.html;
  const building = state.status === "loading" && state.step === "building" && !showPills && !state.html;
  const names = state.components.map((c) => c.name);
  const full = fullWidth(names, state.status === "loading");

  return (
    <section ref={stage} className="relative mt-4 space-y-4" aria-live="polite" aria-busy={state.status === "loading"}>
      {state.companies && <HeadlineStrip lens={lens as LensSlug} companies={state.companies} />}


      {/* Two charts side by side once the comparison is wide enough (chart-pairs.ts). */}
      {state.companies && (state.components.length > 0 || building) && (
        <YearLink>
          <div className="grid gap-4 @4xl:grid-cols-2">
            {state.components.map((c, i) => (
              <div key={i} className={`min-w-0 ${full[i] ? "@4xl:col-span-2" : ""}`}>
                <ComponentView component={c} companies={state.companies!} morph={i === firstText ? { stage, pills } : undefined} />
              </div>
            ))}
            {building && <div className={`card min-h-32 animate-pulse ${loadingCardFull(names, true) ? "@4xl:col-span-2" : ""}`} aria-hidden />}
          </div>
        </YearLink>
      )}

      {state.html && state.companies && (
        <>
          <FreeformFrame html={state.html} companies={state.companies} />
          <p className="text-sm text-muted">
            Claude wrote this page itself from the same filing data. Its numbers aren&apos;t linked to their filings; Components cites each one.
          </p>
        </>
      )}

      {showPills && <FilingPills companies={state.companies!} kind={textKind} freeform={mode === "freeform"} />}


      {state.status === "error" && (
        <div className="rounded-2xl border border-danger/40 bg-danger/5 px-5 py-4">
          <p className="text-danger">{state.error}</p>
          <button type="button" onClick={() => restart(false)} className="mt-3 text-sm text-accent hover:underline">
            Try again
          </button>
        </div>
      )}

      {state.status === "blocked" && <BlockedPanel reason={state.blocked!} />}

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
            <button type="button" onClick={() => restart(true)} className="rounded-full border border-rule px-4 py-1.5 text-ink hover:bg-paper">
              Regenerate
            </button>
          )}
        </div>
      )}
    </section>
  );
}
