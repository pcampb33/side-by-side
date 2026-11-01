import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { LENS_GUIDANCE } from "@/agent/lenses";
import { parsePair, titleTransitionName } from "@/lib/compare-url";
import { findTicker, getFinancials, getProfile } from "@/lib/data";
import { findFeatured } from "@/lib/featured";
import { findLens } from "@/lib/lenses";
import { NoAnnualDataError } from "@/lib/normalize/normalize";
import { CompanyHeader } from "./company-header";
import { ComparisonStream } from "./comparison-stream";
import { ProcessAside, ProcessStrip } from "./process-views";
import { ShareButton } from "./share-button";

// The tab title and the text a shared link unfolds with (its image: opengraph-image.tsx).
export async function generateMetadata({ params }: PageProps<"/compare/[pair]/[lens]">): Promise<Metadata> {
  const { pair, lens: slug } = await params;
  const tickers = parsePair(pair);
  const lens = findLens(slug);
  if (!tickers || !lens) return {};
  const title = `${tickers[0]} vs ${tickers[1]}: ${lens.label} · side-by-side`;
  const description = `${LENS_GUIDANCE[lens.slug].question} Built from their SEC filings.`;
  return { title, description, openGraph: { title, description } };
}

export default function ComparePage({ params }: PageProps<"/compare/[pair]/[lens]">) {
  return (
    // From ~1100px the process panel sits beside the comparison, which lays
    // itself out by its own width (container queries), not the viewport's.
    <main data-wide className="mx-auto max-w-5xl px-4 py-10 sm:px-6 min-[1100px]:grid min-[1100px]:max-w-[90rem] min-[1100px]:grid-cols-[minmax(0,1fr)_auto] min-[1100px]:items-start min-[1100px]:gap-6">
      <div className="@container min-w-0">
        {/* The skeleton rises in, then fades out as the comparison rises in its place. */}
        <Suspense
          fallback={
            <ViewTransition enter="vt-rise" exit="vt-out" default="none">
              <ComparisonSkeleton />
            </ViewTransition>
          }
        >
          <ViewTransition enter="vt-rise" default="none">
            <div>
              <Comparison params={params} />
            </div>
          </ViewTransition>
        </Suspense>
      </div>
      <ProcessAside />
    </main>
  );
}

async function Comparison({ params }: Pick<PageProps<"/compare/[pair]/[lens]">, "params">) {
  const { pair, lens: lensSlug } = await params;
  const tickers = parsePair(pair);
  const lens = findLens(lensSlug);
  if (!tickers || !lens) notFound();
  const featured = findFeatured(tickers, lens.slug);
  const companies = featured
    ? featured.companies.map((c) => ({ entry: { cik: c.financials.cik, ticker: c.ticker, name: c.name }, profile: c.profile, financials: c.financials }))
    : await loadCompanies(tickers);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <ViewTransition name={titleTransitionName(companies[0].entry.ticker, companies[1].entry.ticker, lens.slug)} share="morph" default="none">
          <h1 className="font-display text-3xl font-semibold tracking-tight @xl:text-4xl">
            {companies[0].entry.ticker} <span className="text-muted">vs</span> {companies[1].entry.ticker}
            <span className="text-muted">: {lens.label}</span>
          </h1>
        </ViewTransition>
        <div className="flex items-center gap-4">
          <ShareButton />
          <Link href="/" className="text-sm text-accent hover:underline">
            New comparison
          </Link>
        </div>
      </div>
      <div className="mt-8 grid gap-4 @2xl:grid-cols-2">
        {companies.map((c) => (
          <CompanyHeader key={c.entry.cik} {...c} />
        ))}
      </div>
      {companies.every((c) => c.financials) ? (
        <>
          <ComparisonStream pair={pair} lens={lens.slug} />
          <ProcessStrip />
        </>
      ) : (
        <section className="mt-8 rounded-2xl border border-dashed border-rule px-6 py-10 text-center text-muted">
          A comparison needs 10-K financial statements for both companies.
        </section>
      )}
    </>
  );
}

async function loadCompanies(tickers: [string, string]) {
  const entries = await Promise.all(tickers.map((t) => findTicker(t)));
  return Promise.all(
    entries.map(async (entry) => {
      if (!entry) notFound();
      const [profile, financials] = await Promise.all([
        getProfile(entry.cik),
        // No 10-K data is a fact about the filer (e.g. a 20-F filer), not a failure.
        getFinancials(entry.cik).catch((err) => {
          if (err instanceof NoAnnualDataError) return null;
          throw err;
        }),
      ]);
      return { entry, profile, financials };
    }),
  );
}

function ComparisonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading companies">
      <div className="h-10 w-2/3 animate-pulse rounded bg-rule" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl bg-rule/60" />
        ))}
      </div>
    </div>
  );
}
