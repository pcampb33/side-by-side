"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CompanyInput } from "@/agent/prompt";
import { formatTick, formatValue } from "@/lib/format";
import { valueDef, type ValueKey } from "@/lib/values";
import { lookup, SERIES, Value } from "./cited";

// Measured, not a scaled viewBox, so text stays the same size on a phone.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= Math.ceil(max / step) * step + step / 2; t += step) ticks.push(+t.toPrecision(12));
  return ticks;
}

const HEIGHT = 240;
const M = { top: 12, right: 24, bottom: 28, left: 52 };

export function TrendLine({ metric, companies }: { metric: ValueKey; companies: CompanyInput[] }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  // useId can contain characters a url(#id) reference would need escaped.
  const gradient = `area${useId().replace(/[^\w-]/g, "")}`;
  const { unit } = valueDef(metric);
  // The union of both companies' fiscal-year labels: their years need not match.
  const years = [...new Set(companies.flatMap((c) => c.financials.fiscalYears))].sort();
  const series = companies.map((c) => years.map((fy) => lookup(c, metric, fy)));
  const values = series.flat().flatMap((l) => (l.kind === "value" ? [l.value] : []));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const [lo, hi] = [ticks[0], ticks.at(-1)!];

  const innerW = Math.max(width - M.left - M.right, 1);
  const innerH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (years.length === 1 ? innerW / 2 : (i * innerW) / (years.length - 1));
  const y = (v: number) => M.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  // "FY2024" needs about 48px; on a phone the labels shorten to "FY24".
  const yearLabel = (fy: number) => (innerW / Math.max(years.length - 1, 1) < 56 ? `FY${String(fy).slice(2)}` : `FY${fy}`);

  // A missing year breaks the line rather than bridging it.
  const path = (s: typeof series[number]) =>
    s.map((l, i) => (l.kind === "value" ? `${i > 0 && s[i - 1].kind === "value" ? "L" : "M"}${x(i)},${y(l.value)}` : "")).join("");
  // The same runs, closed down to zero: a soft fill under each line.
  const area = (s: typeof series[number]) => {
    const runs: number[][] = [];
    s.forEach((l, i) => (l.kind !== "value" ? null : i > 0 && s[i - 1].kind === "value" ? runs.at(-1)!.push(i) : runs.push([i])));
    const base = y(Math.max(lo, Math.min(0, hi)));
    return runs
      .filter((r) => r.length > 1)
      .map((r) => `M${x(r[0])},${base}${r.map((i) => `L${x(i)},${y((s[i] as { value: number }).value)}`).join("")}L${x(r.at(-1)!)},${base}Z`)
      .join("");
  };
  const lastIndex = (s: typeof series[number]) => s.findLastIndex((l) => l.kind === "value");

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - M.left;
    setActive(Math.max(0, Math.min(years.length - 1, Math.round((rel / innerW) * (years.length - 1)))));
  };

  return (
    <div>
      <Legend companies={companies} kind="line" />
      <div ref={ref} className="relative mt-3">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${valueDef(metric).label} by fiscal year; values in the table below`}
            tabIndex={0}
            className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(years.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? 0) - 1));
              if (e.key === "ArrowRight") setActive((a) => Math.min(years.length - 1, (a ?? 0) + 1));
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {formatTick(t, unit)}
                </text>
              </g>
            ))}
            {years.map((fy, i) => (
              <text key={fy} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[11px] tabular-nums">
                {yearLabel(fy)}
              </text>
            ))}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} stroke="var(--muted)" strokeWidth={1} />}
            <defs>
              {SERIES.map((color, si) => (
                <linearGradient key={si} id={`${gradient}-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: color, stopOpacity: 0.12 }} />
                  <stop offset="0.85" style={{ stopColor: color, stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>
            {series.map((s, si) => (
              <path key={si} d={area(s)} fill={`url(#${gradient}-${si})`} />
            ))}
            {series.map((s, si) => (
              <g key={si}>
                <path d={path(s)} fill="none" stroke={SERIES[si]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {s.map((l, i) =>
                  l.kind === "value" && (i === lastIndex(s) || i === active) ? (
                    <circle key={i} cx={x(i)} cy={y(l.value)} r={4.5} fill={SERIES[si]} stroke="var(--surface)" strokeWidth={2} />
                  ) : null,
                )}
              </g>
            ))}
          </svg>
        )}
        {active !== null && width > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-xl border border-rule bg-surface px-3 py-2 text-xs shadow-md"
            style={x(active) > width / 2 ? { right: width - x(active) + 10 } : { left: x(active) + 10 }}
          >
            <div className="text-muted">FY{years[active]}</div>
            {companies.map((c, si) => {
              const l = series[si][active];
              return (
                <div key={c.ticker} className="mt-1 flex items-center gap-2 whitespace-nowrap">
                  <span className="h-0.5 w-3 rounded" style={{ background: SERIES[si] }} />
                  <span className="font-semibold tabular-nums">{l.kind === "value" ? formatValue(l.value, unit) : l.text}</span>
                  <span className="text-muted">{c.ticker}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <TableView>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 text-left font-normal" />
              {years.map((fy) => (
                <th key={fy} className="px-2 py-1 text-right font-normal">
                  FY{fy}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map((c, si) => (
              <tr key={c.ticker} className="border-t border-rule">
                <th className="py-1.5 pr-3 text-left font-medium">{c.ticker}</th>
                {series[si].map((l, i) => (
                  <td key={years[i]} className="px-2 py-1.5 text-right">
                    <Value looked={l} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </div>
  );
}

export function Legend({ companies, kind }: { companies: CompanyInput[]; kind: "line" | "box" }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {companies.map((c, si) => (
        <li key={c.ticker} className="flex items-center gap-2">
          <span className={kind === "line" ? "h-0.5 w-4 rounded" : "size-3 rounded-sm"} style={{ background: SERIES[si] }} />
          <span>
            {c.ticker} <span className="text-muted">{c.name}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TableView({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted hover:text-ink">Table view</summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}
