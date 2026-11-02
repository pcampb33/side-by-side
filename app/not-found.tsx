import type { Metadata } from "next";
import Link from "next/link";
import { comparePath } from "@/lib/compare-url";
import { FEATURED } from "@/lib/featured";
import { CompareForm } from "./compare-form";

export const metadata: Metadata = { title: "No comparison here · side-by-side" };

// A bad ticker, lens or address: stay in the site's look and offer a way on.
export default function NotFound() {
  // Each block rises a beat after the one before.
  const delay = (i: number) => ({ animationDelay: `${i * 70}ms` });
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 style={delay(0)} className="rise-in font-display text-4xl font-semibold tracking-tight">
        No comparison here
      </h1>
      <p style={delay(1)} className="rise-in mt-4 max-w-xl text-lg text-muted">
        Nothing on side-by-side matches this address. A ticker may be mistyped, or the company may not file with the SEC.
      </p>
      <div style={delay(2)} className="rise-in">
        <CompareForm />
      </div>
      <section style={delay(3)} className="rise-in mt-12" aria-labelledby="featured-heading">
        <h2 id="featured-heading" className="text-sm text-muted">
          Or open a featured comparison
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {FEATURED.map((f) => (
            <li key={`${f.tickers.join()}-${f.lens}`}>
              <Link href={comparePath(f.tickers[0], f.tickers[1], f.lens)} className="flex items-center gap-1.5 rounded-full bg-surface px-3.5 shadow-[var(--shadow)] py-1.5 text-sm font-semibold hover:text-accent">
                <span aria-hidden className="size-2 rounded-full bg-series-a" />
                {f.tickers[0]}
                <span className="font-normal text-muted">vs</span>
                <span aria-hidden className="size-2 rounded-full bg-series-b" />
                {f.tickers[1]}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
