"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { COMPONENT_NAMES } from "@/agent/catalog";
import { KIT_PIECES, type KitPiece } from "@/agent/kit";
import { LENS_GUIDANCE } from "@/agent/lenses";
import type { CompanyInput } from "@/agent/prompt";
import type { Trace, TraceCall } from "@/agent/trace";
import { findLens } from "@/lib/lenses";
import { METRICS } from "@/lib/normalize/metrics";
import { filingDocumentUrl } from "@/lib/sec/client";
import { valueAt } from "@/lib/values";
import { CHECK_NAMES, METRIC_KEYS, currentStep, findingCount, processSteps, reportItems, type ProcessInput, type StepId, type StepView } from "./process-model";

// How Claude built this comparison (SPEC §4a): the five steps, each opening
// to this run's record, then everything Claude was given. One body for the
// desktop side panel, the overlay below ~1100px and the standalone page.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MODEL_NAMES: Record<string, string> = { "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-opus-5-5": "Claude Opus 5.5", "claude-haiku-5-5": "Claude Haiku 5.5" };
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const tokens = (trace: Trace) =>
  trace.backend === "api" ? `${kilo(trace.usage.inputTokens)} in / ${kilo(trace.usage.outputTokens)} out` : "local login run (token counts come with the API key)";

export function runSummary(trace: Trace): string {
  return `${MODEL_NAMES[trace.model] ?? trace.model} · ${seconds(trace.ms.composing)} · ${tokens(trace)}`;
}

// The run's clock while it generates.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{seconds(Math.max(0, now - since))}</span>;
}

// How long a step took in a watched run: from the previous step's finish to its own.
function stepTime(doneAt: Partial<Record<StepId, number>>, id: StepId): number | undefined {
  const at = doneAt[id];
  if (at === undefined) return undefined;
  return at - Math.max(0, ...Object.values(doneAt).filter((t) => t < at));
}

export function CheckIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

// The numbered dot every step view uses (strip, panel, rail).
export function StepDot({ step, n, size = "md" }: { step: StepView; n: number; size?: "sm" | "md" }) {
  return (
    <span className={`step-dot ${size === "sm" ? "size-6 text-[11px]" : "size-8 text-xs"}`} data-state={step.state} data-backs={step.backs > 0 || undefined}>
      {step.state === "done" ? <CheckIcon /> : n}
    </span>
  );
}

const PanelIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[17px]" aria-hidden>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M15 3v18" />
    <path d={open ? "m10 15-3-3 3-3" : "m8 9 3 3-3 3"} />
  </svg>
);

export function ProcessPanel({
  input,
  variant,
  focus,
  onCollapse,
  onClose,
}: {
  input: ProcessInput;
  variant: "aside" | "overlay" | "page";
  focus?: StepId | null;
  onCollapse?: () => void;
  onClose?: () => void;
}) {
  const steps = processSteps(input);
  const live = input.status === "loading";
  const running = currentStep(steps);
  // Following: the running step is open and the last one folds. It ends at
  // the first touch inside the panel, or when the run does, where a watched
  // run leaves its last step (checks) open and a saved one opens composing.
  const [follow, setFollow] = useState(live);
  const [picked, setPicked] = useState<Set<StepId> | null>(focus ? new Set([focus]) : null);
  const runningId = running >= 0 ? steps[running].id : null;
  const following = follow && live && !picked;
  const settled: StepId = input.calls.length ? "checks" : input.trace ? "compose" : "data";
  const open = picked ?? new Set<StepId>([following && runningId ? runningId : live ? (runningId ?? "data") : settled]);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useRef<Partial<Record<StepId, HTMLLIElement | null>>>({});

  // Keep the running step in view, once its body has opened.
  useEffect(() => {
    if (!following || !runningId || variant === "page") return;
    const timer = setTimeout(() => {
      const el = items.current[runningId];
      scroller.current?.scrollTo({ top: (el?.offsetTop ?? 0) - 64, behavior: "smooth" });
    }, 460);
    return () => clearTimeout(timer);
  }, [following, runningId, variant]);

  const halt = (e: { target: EventTarget }) => {
    if (following && !(e.target as HTMLElement).closest("[data-keep]")) setPicked(open);
  };
  const resume = () => {
    setPicked(null);
    setFollow(true);
  };
  const toggle = (id: StepId) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const trace = input.trace;
  const timing = input.timing;
  const meta = live
    ? timing
      ? <>Generating · <Elapsed since={timing.startedAt} /> · {MODEL_NAMES["claude-sonnet-5-5"]}</>
      : `Generating now · ${MODEL_NAMES["claude-sonnet-5-5"]}`
    : trace && timing
      ? `Done in ${seconds(Math.max(0, ...Object.values(timing.doneAt)))} · ${MODEL_NAMES[trace.model] ?? trace.model} · ${tokens(trace)}`
      : trace
        ? `${input.mode === "freeform" ? "Freeform" : "Components"} · ${runSummary(trace)}`
        : input.status === "done"
          ? "Saved before runs were recorded: the general steps, with this page's data."
          : "";

  return (
    <div
      ref={scroller}
      className={`relative ${variant === "page" ? "" : "min-h-0 flex-1 overflow-y-auto overscroll-contain"} [scrollbar-width:thin]`}
      onWheel={halt}
      onTouchStart={halt}
      onPointerDown={halt}
      onKeyDown={halt}
    >
      <div className={`sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface pt-4 pb-1.5 ${variant === "page" ? "sr-only" : "px-4"}`}>
        <h2 className="font-display text-[15px] font-semibold">How Claude built this</h2>
        <span className="flex items-center gap-1.5">
          {onCollapse && (
            <button type="button" data-keep onClick={onCollapse} className="icon-button" aria-label="Collapse the panel" title="Collapse the panel">
              <PanelIcon open={false} />
            </button>
          )}
          {onClose && (
            <button type="button" data-keep onClick={onClose} className="rounded-full px-3 py-1 text-sm text-accent hover:bg-paper">
              Close
            </button>
          )}
        </span>
      </div>
      <div className={`grid gap-3 pb-4 ${variant === "page" ? "pt-5" : "px-4"}`}>
        <div className="-mt-1 flex items-center justify-between gap-2 text-[12.5px] text-muted">
          <span>{meta}</span>
          {live && (
            <button
              type="button"
              data-keep
              onClick={resume}
              className="follow-chip"
              data-on={following || undefined}
              aria-pressed={following}
            >
              {following ? "Following live" : "Follow live"}
            </button>
          )}
        </div>

        <ol className="grid">
          {steps.map((step, i) => (
            <li key={step.id} ref={(el) => void (items.current[step.id] = el)} className="process-step relative grid" data-state={step.state} data-open={open.has(step.id) || undefined}>
              <button type="button" onClick={() => toggle(step.id)} aria-expanded={open.has(step.id)} className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 text-left">
                <StepDot step={step} n={i + 1} />
                <span>
                  <b className="block text-sm font-semibold">{step.name}</b>
                  <small key={step.count} className="tick-in block text-xs text-muted">
                    {step.backs ? (
                      <>
                        {step.count.replace(/ · \d+ sent back$/, "")} · <span className="font-semibold text-back">{step.backs} sent back</span>
                      </>
                    ) : (
                      step.count
                    )}
                    {timing && stepTime(timing.doneAt, step.id) !== undefined && <span className="tabular-nums"> · {seconds(stepTime(timing.doneAt, step.id)!)}</span>}
                  </small>
                </span>
                <span aria-hidden className="step-chevron text-lg leading-none text-muted">
                  ›
                </span>
              </button>
              <div className="step-body">
                <div className="min-h-0 overflow-hidden">
                  <div className="grid gap-2.5 pt-0.5 pb-3.5 pl-[2.6rem] text-[12.5px]">
                    <p className="text-muted">{step.about}</p>
                    <StepContent step={step} input={input} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <Guidelines input={input} />
      </div>
    </div>
  );
}

// The collapsed panel: five dots that still light up, and the way back.
export function ProcessRail({ input, onExpand }: { input: ProcessInput; onExpand: (step?: StepId) => void }) {
  const steps = processSteps(input);
  return (
    <div className="grid justify-items-center gap-4 py-3">
      <button type="button" onClick={() => onExpand()} className="icon-button" aria-label="Open the panel" title="Open the panel">
        <PanelIcon open />
      </button>
      <ol className="rail-dots relative grid gap-3">
        {steps.map((step, i) => (
          <li key={step.id}>
            <button type="button" onClick={() => onExpand(step.id)} aria-label={`${step.name}: ${step.count}`} title={`${step.name}: ${step.count}`}>
              <StepDot step={step} n={i + 1} size="sm" />
            </button>
          </li>
        ))}
      </ol>
      <span className="text-xs font-semibold whitespace-nowrap text-muted [writing-mode:vertical-rl]">How Claude built this</span>
    </div>
  );
}

function Tag({ i, children }: { i: number; children: ReactNode }) {
  return <span className={`inline-block rounded-full border-[1.5px] bg-surface px-2 py-px text-[11px] font-semibold ${i ? "border-series-b text-series-b" : "border-series-a text-series-a"}`}>{children}</span>;
}

function StepContent({ step, input }: { step: StepView; input: ProcessInput }) {
  const { companies, trace } = input;
  switch (step.id) {
    case "data":
      return companies ? <DataGrid companies={companies} /> : null;
    case "reports":
      if (step.state === "skip") {
        return (
          <p className="rounded-xl border-[1.5px] border-dashed border-rule p-3 text-muted">
            Not needed: {findLens(input.lens)?.label} is built from the numbers alone. Risk exposure and Where they compete read each 10-K.
          </p>
        );
      }
      return companies?.every((c) => c.filing) ? <Reports companies={companies} input={input} /> : null;
    case "brief":
      return <Brief input={input} />;
    case "compose": {
      const calls = trace?.calls ?? input.calls;
      if (!calls.length) return step.state === "none" ? <p className="text-muted">This page was saved before runs were recorded; the next regeneration records its calls.</p> : null;
      return <CallList calls={calls} />;
    }
    case "checks":
      return trace ? <Checks trace={trace} /> : null;
  }
}

function DataGrid({ companies }: { companies: CompanyInput[] }) {
  return (
    <>
      <div className="grid gap-1 text-xs text-muted">
        {companies.map((c, i) => {
          const f = c.financials;
          const month = MONTHS[Number(f.periodEnds.at(-1)!.slice(5, 7)) - 1];
          return (
            <span key={c.ticker}>
              <Tag i={i}>{c.ticker}</Tag> FY{f.fiscalYears[0]}–FY{f.fiscalYears.at(-1)} · year ends in {month}
            </span>
          );
        })}
      </div>
      <div className="grid">
        {METRIC_KEYS.map((key, r) => {
          const missing = companies.map((c) => c.financials.fiscalYears.every((fy) => valueAt(c.financials, key, fy).status !== "value"));
          return (
            <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-rule py-[3px] text-[11.5px]">
              <span className={missing.some(Boolean) ? "text-back" : ""}>
                {METRICS[key].label}
                {missing.some(Boolean) && " · not reported"}
              </span>
              {companies.map((c, i) => (
                <span key={c.ticker} className="flex gap-1">
                  {c.financials.fiscalYears.map((fy, y) => (
                    <i
                      key={fy}
                      className={`dot-in block size-[7px] rounded-full ${valueAt(c.financials, key, fy).status === "value" ? (i ? "bg-series-b" : "bg-series-a") : "shadow-[inset_0_0_0_1.5px_var(--back)]"}`}
                      style={{ animationDelay: `${r * 18 + y * 25}ms` }}
                      title={`${c.ticker} FY${fy}`}
                    />
                  ))}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] text-muted">One dot per fiscal year. Hollow: not in the filings; the page says not reported and never shows a number. Eight ratios (margins, growth, free cash flow…) are derived from these in code.</p>
    </>
  );
}

function Reports({ companies, input }: { companies: CompanyInput[]; input: ProcessInput }) {
  return (
    <>
      {companies.map((c, i) => {
        const f = c.filing!;
        const items = reportItems(input.lens, c);
        return (
          <div key={c.ticker} className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag i={i}>{c.ticker}</Tag>
              <a href={filingDocumentUrl(c.financials.cik, f.report.accn, f.report.document)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                10-K, {input.lens === "where-they-compete" ? "Item 1" : "Item 1A"} · filed {f.report.filed} ↗
              </a>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((t, j) => (
                <span key={t.name} className="pill-in rounded-full bg-paper px-2.5 py-1 text-[11.5px]" style={{ animationDelay: `${j * 30}ms` }}>
                  {t.name}
                  <sup className="ml-1 font-mono text-[10px] text-muted">{t.quotes}</sup>
                </span>
              ))}
            </div>
            <p className="text-[11.5px] text-muted">
              {items.length} themes, {items.reduce((n, t) => n + t.quotes, 0)} quotes kept
              {f.droppedQuotes ? `; ${f.droppedQuotes} dropped because ${f.droppedQuotes === 1 ? "it wasn't" : "they weren't"} found word for word.` : ", none dropped."}
            </p>
          </div>
        );
      })}
    </>
  );
}

function Brief({ input, chips = true }: { input: ProcessInput; chips?: boolean }) {
  const { question, guidance } = LENS_GUIDANCE[input.lens];
  return (
    <>
      <blockquote className="border-l-[3px] border-series-a pl-3 text-muted">
        <b className="mb-1 block font-semibold text-ink">{question}</b>
        {guidance}
      </blockquote>
      {chips && input.mode === "components" && <ComponentChips input={input} />}
    </>
  );
}

function ComponentChips({ input }: { input: ProcessInput }) {
  const calls = input.trace?.calls ?? input.calls;
  const used = new Set(calls.filter((c) => c.ok).map((c) => c.tool));
  const excluded = new Set(input.trace ? COMPONENT_NAMES.filter((n) => !input.trace!.offered.includes(n)) : LENS_GUIDANCE[input.lens].excluded);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {COMPONENT_NAMES.map((name) => (
          <span
            key={name}
            className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${used.has(name) ? "bg-[color-mix(in_srgb,var(--series-a)_16%,var(--surface))]" : excluded.has(name) ? "text-muted line-through shadow-[inset_0_0_0_1px_var(--rule)]" : "bg-paper"}`}
          >
            {name}
          </span>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">Shaded: used on this page. Plain: offered, not used. Struck: not offered in this lens.</p>
    </>
  );
}

// The freeform kit (agent/kit.ts), shaded where this page used a piece.
function KitChips({ used }: { used?: KitPiece[] }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {KIT_PIECES.map((p) => (
          <span key={p} className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${used?.includes(p) ? "bg-[color-mix(in_srgb,var(--series-a)_16%,var(--surface))]" : "bg-paper"}`}>
            {p === "chart" ? "kit.chart()" : `kit-${p}`}
          </span>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">The site&apos;s own pieces, added to the page by its frame; the chart helper looks every value up in the data.{used && " Shaded: used on this page."}</p>
    </>
  );
}

const callTitle = (call: TraceCall) => {
  const input = call.input as { title?: unknown; html?: unknown } | null;
  return typeof input?.title === "string" ? input.title : typeof input?.html === "string" ? `page, ${input.html}` : "";
};

function CallList({ calls, inputs = false }: { calls: TraceCall[]; inputs?: boolean }) {
  return (
    <ol className="grid border-t border-rule">
      {calls.map((call, i) => (
        <li key={i} className="pop-in grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 border-b border-rule py-2 text-[12.5px]">
          <span className="pt-px font-mono text-[11px] text-muted">{i + 1}</span>
          <span className="min-w-0">
            <code className="rounded-md bg-paper px-1.5 py-px font-mono text-[11.5px] font-medium">{call.tool}</code> {callTitle(call)} ·{" "}
            {call.ok ? <span className="font-semibold text-ok">shown</span> : <span className="font-semibold text-back">sent back</span>}
            {!call.ok && <span className="mt-1 block border-l-2 border-back pl-2 text-muted">{call.message}</span>}
            {inputs && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11.5px] text-accent">Input</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-paper p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(call.input, null, 1)}</pre>
              </details>
            )}
          </span>
          <span className="pt-px font-mono text-[11px] whitespace-nowrap text-muted tabular-nums">{seconds(call.ms)}</span>
        </li>
      ))}
    </ol>
  );
}

function Checks({ trace }: { trace: Trace }) {
  return (
    <ol className="grid border-t border-rule">
      {trace.checks.map((c, i) => {
        const [name, about] = CHECK_NAMES[c.check];
        const ok = c.findings.length === 0;
        const result = !ok ? `${c.findings.length} found` : c.checked === 0 ? (c.check === "quotes" ? "no quotes" : "none") : c.checked !== undefined ? `${c.checked} checked` : "pass";
        return (
          <li key={c.check} className="pop-in grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 border-b border-rule py-2 text-[12.5px]" style={{ animationDelay: `${i * 50}ms` }}>
            <span className={ok ? "text-ok" : "text-back"}>{ok ? <CheckIcon className="size-4" /> : "!"}</span>
            <span>
              <b className="font-semibold">{name}</b>
              <span className="block text-muted">{about}</span>
              {c.findings.map((f) => (
                <span key={f} className="mt-1 block border-l-2 border-back pl-2 text-muted">
                  {f}
                </span>
              ))}
            </span>
            <span className={`font-mono text-[11px] whitespace-nowrap ${ok ? "text-ok" : "text-back"}`}>{result}</span>
          </li>
        );
      })}
    </ol>
  );
}

const RULES = {
  components: [
    "Components name metrics and years, never numbers; the page looks each value up and cites its filing.",
    "Quotes are referenced by id and must match the filing word for word.",
    "A risk sits in one row only; takeaways come once, last.",
    "Neutral differences, never a winner or a prediction.",
  ],
  freeform: [
    "Every number is copied exactly from the data tables, with its company and fiscal year; nothing computed or rounded.",
    "Not reported stays not reported; never estimated around.",
    "One self-contained page: no fonts, images, scripts or links from outside.",
    "Each kit chart names metric keys and years, checked against the data before the page is shown.",
    "Three to five neutral takeaways, never a winner or a prediction.",
  ],
};

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <details className="guideline border-t border-rule">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2.5 text-[13px] font-semibold">
        {title}
        <span className="flex items-center gap-2 text-xs font-normal text-muted">
          {note}
          <span aria-hidden className="step-chevron text-[17px] leading-none">
            ›
          </span>
        </span>
      </summary>
      <div className="pop-in mb-3 grid gap-2 text-[12.5px]">{children}</div>
    </details>
  );
}

function Guidelines({ input }: { input: ProcessInput }) {
  const { trace } = input;
  const calls = trace?.calls ?? input.calls;
  return (
    <div className="mt-1 grid">
      <h3 className="pb-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-muted uppercase">Everything Claude followed</h3>
      <Row title="Lens brief" note={findLens(input.lens)?.label}>
        <Brief input={input} chips={false} />
      </Row>
      {input.mode === "components" && (
        <Row title="Components" note={trace ? `${new Set(calls.filter((c) => c.ok).map((c) => c.tool)).size} used` : undefined}>
          <ComponentChips input={input} />
        </Row>
      )}
      <Row title="Rules each call is checked against" note={String(RULES[input.mode].length)}>
        <ul className="grid list-disc gap-1 pl-4">
          {RULES[input.mode].map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Row>
      <Row title="Design it draws with" note={input.mode === "freeform" && trace?.kit ? `tokens · ${trace.kit.length} kit pieces` : "tokens"}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {[
            ["var(--series-a)", input.companies?.[0]?.ticker ?? "first"],
            ["var(--series-b)", input.companies?.[1]?.ticker ?? "second"],
            ["var(--paper)", "page"],
            ["var(--surface)", "card"],
            ["var(--ink)", "text"],
          ].map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <i className="inline-block size-5 rounded-md shadow-[inset_0_0_0_1px_var(--rule)]" style={{ background: color }} />
              {label}
            </span>
          ))}
          <span>· Plus Jakarta Sans</span>
        </div>
        {input.mode === "freeform" && <KitChips used={trace?.kit} />}
      </Row>
      <Row title="Full trace" note={calls.length ? `${calls.length} call${calls.length === 1 ? "" : "s"}` : "not recorded"}>
        {calls.length ? <CallList calls={calls} inputs /> : <p className="text-muted">No calls recorded for this page.</p>}
        {trace && (
          <p className="text-[11.5px] text-muted">
            SEC data {seconds(trace.ms.fetching)}
            {trace.ms.reading !== null && ` · 10-Ks ${seconds(trace.ms.reading)}`} · composing {seconds(trace.ms.composing)} · checks {seconds(trace.ms.checks)} · {findingCount(trace)} findings · {trace.backend} backend · {trace.at.slice(0, 10)}
          </p>
        )}
      </Row>
      <Row title="Everything Claude received" note="as sent">
        {trace ? (
          <>
            <p className="text-muted">The system prompt and the data, stored with the run, so they stay true if the prompt changes later.</p>
            <pre className="max-h-80 overflow-auto rounded-lg bg-paper p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap">{trace.prompt.system}</pre>
            <pre className="max-h-80 overflow-auto rounded-lg bg-paper p-2.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap">{trace.prompt.user}</pre>
          </>
        ) : (
          <p className="text-muted">{input.status === "loading" ? "Stored when the run finishes." : "Not recorded for this page."}</p>
        )}
      </Row>
    </div>
  );
}
