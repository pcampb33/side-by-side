"use client";

import type { Component } from "@/agent/catalog";
import type { CompanyInput } from "@/agent/prompt";
import { formatTick, formatValue } from "@/lib/format";
import { fiscalYearOf, valueDef, type ValueKey } from "@/lib/values";
import { Cited, lookup, SERIES, Value, type Looked } from "./cited";
import { TextTiles, type Morph } from "./text-tiles";
import { Legend, TrendLine } from "./trend-line";

// One renderer per catalog component. The model chose the metric keys and
// years; every number here is looked up in the companies' normalized data.

export function ComponentView({ component, companies, morph }: { component: Component; companies: CompanyInput[]; morph?: Morph }) {
  if (component.name === "takeaways") return <Takeaways items={component.input.items} />;
  const { title, caption } = component.input;
  // Text components morph in from the pills instead (text-tiles.tsx), which
  // measures where each subject lands: no scale animation under it.
  const text = component.name === "risk_themes" || component.name === "business_overlap";
  return (
    <article className={`card p-5 @xl:p-6 ${text ? "" : "pop-in"}`}>
      <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
      {caption && <p className="mt-1 text-sm text-muted">{caption}</p>}
      <div className="mt-4">
        {component.name === "metric_cards" && <MetricCards items={component.input.items} companies={companies} />}
        {component.name === "trend_line" && <TrendLine metric={component.input.key} companies={companies} />}
        {component.name === "grouped_bars" && <GroupedBars metrics={component.input.keys} year={component.input.year} companies={companies} />}
        {component.name === "ratio_gauge" && <RatioGauge metric={component.input.key} year={component.input.year} companies={companies} />}
        {component.name === "cost_breakdown" && <CostBreakdown year={component.input.year} companies={companies} />}
        {component.name === "risk_themes" && <TextTiles rows={component.input.rows} companies={companies} what="risk themes" morph={morph} />}
        {component.name === "business_overlap" && <TextTiles rows={component.input.rows} companies={companies} what="business areas" morph={morph} />}
      </div>
    </article>
  );
}

type Year = number | "latest";
const fyLabel = (c: CompanyInput, year: Year) => `FY${fiscalYearOf(c.financials, year)}`;

function MetricCards({ items, companies }: { items: { key: ValueKey; year: Year }[]; companies: CompanyInput[] }) {
  return (
    <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">
      {items.map((item) => (
        <div key={`${item.key}-${item.year}`} className="rounded-xl bg-paper px-4 py-3">
          <div className="text-sm text-muted">{valueDef(item.key).label}</div>
          <dl className="mt-2 space-y-1.5">
            {companies.map((c, si) => (
              <div key={c.ticker} className="flex items-baseline justify-between gap-3">
                <dt className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: SERIES[si] }} />
                  {c.ticker} <span className="text-xs text-muted">{fyLabel(c, item.year)}</span>
                </dt>
                <dd className="text-lg font-semibold">
                  <Value looked={lookup(c, item.key, item.year)} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function YearNote({ companies, year }: { companies: CompanyInput[]; year: Year }) {
  return <p className="mt-1 text-xs text-muted">{companies.map((c) => `${c.ticker} ${fyLabel(c, year)}`).join(" · ")}</p>;
}

// Horizontal so long metric names and value labels fit on a phone.
function GroupedBars({ metrics, year, companies }: { metrics: ValueKey[]; year: Year; companies: CompanyInput[] }) {
  const rows = metrics.map((key) => ({ key, looked: companies.map((c) => lookup(c, key, year)) }));
  const values = rows.flatMap((r) => r.looked.flatMap((l) => (l.kind === "value" ? [l.value] : [])));
  const lo = Math.min(0, ...values);
  const span = Math.max(0, ...values) - lo || 1;
  const pct = (v: number) => `${(Math.abs(v) / span) * 100}%`;
  const zero = `${(-lo / span) * 100}%`;
  return (
    <div>
      <Legend companies={companies} kind="box" />
      <YearNote companies={companies} year={year} />
      <div className="mt-4 space-y-4">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="text-sm">{valueDef(row.key).label}</div>
            <div className="mt-1.5 space-y-0.5">
              {row.looked.map((l, si) => (
                <div key={si} className="flex items-center gap-2">
                  {/* the track keeps 6rem free for the value label */}
                  <div className="relative h-5 flex-1">
                    {l.kind === "value" && (
                      <div
                        className={`absolute inset-y-0 ${l.value < 0 ? "rounded-l-full" : "rounded-r-full"}`}
                        style={{ background: SERIES[si], width: pct(l.value), ...(l.value < 0 ? { right: `calc(100% - ${zero})` } : { left: zero }) }}
                      />
                    )}
                    <div className="absolute inset-y-[-2px] w-px bg-muted/60" style={{ left: zero }} />
                  </div>
                  <div className="w-24 shrink-0 text-sm">
                    <Value looked={l} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RatioGauge({ metric, year, companies }: { metric: ValueKey; year: Year; companies: CompanyInput[] }) {
  return (
    <div className="space-y-4">
      {companies.map((c, si) => {
        const l = lookup(c, metric, year);
        const fill = l.kind === "value" ? Math.max(0, Math.min(1, l.value)) : 0;
        return (
          <div key={c.ticker}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>
                {c.ticker} <span className="text-xs text-muted">{fyLabel(c, year)}</span>
              </span>
              <span className="text-lg font-semibold">
                <Value looked={l} />
              </span>
            </div>
            <div
              className="mt-1.5 h-2.5 overflow-hidden rounded-full"
              style={{ background: `color-mix(in oklab, ${SERIES[si]} 22%, var(--surface))` }}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fill * 100)}
              aria-label={`${c.ticker} ${valueDef(metric).label}`}
            >
              <div className="h-full rounded-full" style={{ width: `${fill * 100}%`, background: SERIES[si] }} />
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-xs text-muted">
        <span>{formatTick(0, "percent")}</span>
        <span>{formatTick(1, "percent")}</span>
      </div>
    </div>
  );
}

interface Segment {
  label: string;
  value: number;
  color: string;
  citation: Extract<Looked, { kind: "value" }>["citation"];
}

// Revenue split into cost of revenue, R&D, other operating expense and
// operating income. Missing lines fold into a broader one rather than
// being guessed at; an operating loss is a sentence, not a bar.
function breakdown(c: CompanyInput, year: Year, si: number): { revenue: number; segments: Segment[] } | string {
  const [rev, gp, rnd, oi] = (["revenue", "grossProfit", "rnd", "operatingIncome"] as const).map((k) => lookup(c, k, year));
  if (rev.kind !== "value" || oi.kind !== "value") return "Revenue or operating income is not reported for this year.";
  if (oi.value < 0) return `Operating loss of ${formatValue(-oi.value, "usd")}: operating costs exceeded revenue.`;
  const cite = (formula: string, ...from: Looked[]) => ({
    cik: c.financials.cik,
    formula,
    sources: from.flatMap((l) => (l.kind === "value" ? l.citation.sources : [])),
  });
  const segments: Segment[] = [];
  let rest = rev.value - oi.value;
  if (gp.kind === "value") {
    segments.push({ label: "Cost of revenue", value: rev.value - gp.value, color: "var(--seg-1)", citation: cite("Revenue − gross profit", rev, gp) });
    rest -= rev.value - gp.value;
  }
  if (rnd.kind === "value" && rnd.value <= rest) {
    segments.push({ label: "R&D", value: rnd.value, color: "var(--seg-2)", citation: rnd.citation });
    rest -= rnd.value;
  }
  const otherLabel = segments.length ? "Other operating expense" : "Operating costs";
  const otherFormula = segments.length ? `Revenue − operating income − ${segments.map((s) => s.label.toLowerCase()).join(" − ")}` : "Revenue − operating income";
  if (rest > 0) segments.push({ label: otherLabel, value: rest, color: "var(--seg-3)", citation: cite(otherFormula, rev, oi, gp, rnd) });
  segments.push({ label: "Operating income", value: oi.value, color: SERIES[si], citation: oi.citation });
  return { revenue: rev.value, segments };
}

function CostBreakdown({ year, companies }: { year: Year; companies: CompanyInput[] }) {
  return (
    <div className="space-y-6">
      {companies.map((c, si) => {
        const b = breakdown(c, year, si);
        return (
          <div key={c.ticker}>
            <div className="text-sm">
              {c.ticker} <span className="text-xs text-muted">{fyLabel(c, year)}</span>
            </div>
            {typeof b === "string" ? (
              <p className="mt-1.5 text-sm text-muted">{b}</p>
            ) : (
              <>
                <div className="mt-1.5 flex h-5 gap-0.5 overflow-hidden rounded-full">
                  {b.segments.map((s) => (
                    <div key={s.label} title={`${s.label}: ${formatValue(s.value, "usd")}`} style={{ width: `${(s.value / b.revenue) * 100}%`, background: s.color }} />
                  ))}
                </div>
                <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm @xl:grid-cols-2">
                  {b.segments.map((s) => (
                    <li key={s.label} className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="flex-1">{s.label}</span>
                      <span className="text-muted tabular-nums">{formatValue(s.value / b.revenue, "percent")}</span>
                      <Cited text={formatValue(s.value, "usd")} citation={s.citation} className="w-16 text-right" />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Takeaways({ items }: { items: string[] }) {
  return (
    <article className="card pop-in p-5 @xl:p-6">
      <h3 className="font-display text-xl font-semibold tracking-tight">Key differences</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed marker:text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">Written by Claude from the comparison above. Neutral differences, not a recommendation.</p>
    </article>
  );
}
