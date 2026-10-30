import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parsePair } from "@/lib/compare-url";
import { findTicker, getFinancials, getProfile } from "@/lib/data";
import { findLens } from "@/lib/lenses";
import { NoAnnualDataError } from "@/lib/normalize/normalize";
import { CompanyHeader } from "./company-header";

export default function ComparePage({ params }: PageProps<"/compare/[pair]/[lens]">) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Suspense fallback={<ComparisonSkeleton />}>
        <Comparison params={params} />
      </Suspense>
    </main>
  );
}

async function Comparison({ params }: Pick<PageProps<"/compare/[pair]/[lens]">, "params">) {
  const { pair, lens: lensSlug } = await params;
  const tickers = parsePair(pair);
  const lens = findLens(lensSlug);
  if (!tickers || !lens) notFound();
  const entries = await Promise.all(tickers.map((t) => findTicker(t)));
  const companies = await Promise.all(
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

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          {companies[0].entry.ticker} <span className="text-muted italic">vs</span> {companies[1].entry.ticker}
          <span className="text-muted">: {lens.label}</span>
        </h1>
        <Link href="/" className="text-sm text-accent hover:underline">
          New comparison
        </Link>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {companies.map((c) => (
          <CompanyHeader key={c.entry.cik} {...c} />
        ))}
      </div>
      <section className="mt-8 rounded-lg border border-dashed border-rule px-6 py-10 text-center text-muted">
        The {lens.label.toLowerCase()} comparison is not built yet.
      </section>
    </>
  );
}

function ComparisonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading companies">
      <div className="h-10 w-2/3 animate-pulse rounded bg-rule" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-lg bg-rule/60" />
        ))}
      </div>
    </div>
  );
}
