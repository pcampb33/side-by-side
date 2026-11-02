import Link from "next/link";
import { ViewTransition } from "react";
import { LENS_GUIDANCE } from "@/agent/lenses";
import { comparePath, titleTransitionName } from "@/lib/compare-url";
import { FEATURED } from "@/lib/featured";
import { findLens, type LensSlug } from "@/lib/lenses";
import { valueAt, valueDef, type ValueKey } from "@/lib/values";
import { Sparkline } from "./sparkline";

// The line each card draws: one key metric per lens (owner, 2026-11-01).
const SPARK: Record<LensSlug, ValueKey> = {
  growth: "revenue",
  profitability: "operatingMargin",
  "balance-sheet-risk": "equity",
  "risk-exposure": "longTermDebt",
  "where-they-compete": "revenue",
};

// The featured comparisons: ready to open, no wait. No numbers here: a card
// is a link, and every number on the site opens its citation.
export function FeaturedList() {
  return (
    <section className="mt-20" aria-labelledby="featured-heading">
      <h2 id="featured-heading" className="font-display text-2xl font-semibold tracking-tight">
        Featured comparisons
      </h2>
      <p className="mt-1 text-muted">Generated ahead of time, so they open instantly.</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {FEATURED.map((f, i) => {
          const [a, b] = f.companies;
          const metric = SPARK[f.lens];
          // The union of both companies' fiscal years: their years need not match.
          const years = [...new Set(f.companies.flatMap((c) => c.financials.fiscalYears))].sort();
          const series = f.companies.map((c) =>
            years.map((fy) => {
              const v = valueAt(c.financials, metric, fy);
              return v.status === "value" ? v.value : null;
            }),
          );
          return (
            <li key={`${f.tickers.join()}-${f.lens}`} className={`featured-in ${i === 0 ? "sm:col-span-2" : ""}`} style={{ animationDelay: `${120 + i * 70}ms` }}>
              <Link
                href={comparePath(f.tickers[0], f.tickers[1], f.lens)}
                // The whole page, not just the shell: it arrives with the click, so the title can morph.
                prefetch={true}
                className={`featured-card group flex h-full flex-col gap-3 card p-5 outline-accent focus-visible:outline-2 ${i === 0 ? "sm:flex-row sm:gap-8" : ""}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-center justify-between text-sm text-muted">
                    {findLens(f.lens)?.label}
                    <span aria-hidden className="featured-arrow text-accent">→</span>
                  </span>
                  <ViewTransition name={titleTransitionName(a.ticker, b.ticker, f.lens)} share="morph" default="none">
                    <span className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
                      <span className="size-2.5 rounded-full bg-series-a" aria-hidden />
                      {a.ticker}
                      <span className="text-lg font-normal text-muted">vs</span>
                      <span className="size-2.5 rounded-full bg-series-b" aria-hidden />
                      {b.ticker}
                    </span>
                  </ViewTransition>
                  <span className="text-sm text-muted">
                    {a.name} and {b.name}
                  </span>
                  <span className="mt-auto pt-2 text-sm">{LENS_GUIDANCE[f.lens].question}</span>
                </span>
                <Sparkline series={series} caption={`${valueDef(metric).label}, FY${years[0]}–FY${years.at(-1)}`} delay={370 + i * 70}
                  // The wide first card has room beside the text.
                  className={i === 0 ? "spark-wide" : ""}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
