import Link from "next/link";
import { ViewTransition } from "react";
import { LENS_GUIDANCE } from "@/agent/lenses";
import { comparePath, titleTransitionName } from "@/lib/compare-url";
import { FEATURED } from "@/lib/featured";
import { findLens } from "@/lib/lenses";

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
          return (
            <li key={`${f.tickers.join()}-${f.lens}`} className={`featured-in ${i === 0 ? "sm:col-span-2" : ""}`} style={{ animationDelay: `${120 + i * 70}ms` }}>
              <Link
                href={comparePath(f.tickers[0], f.tickers[1], f.lens)}
                // The whole page, not just the shell: it arrives with the click, so the title can morph.
                prefetch={true}
                className="featured-card group flex h-full flex-col gap-2 card p-5 outline-accent focus-visible:outline-2"
              >
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
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
