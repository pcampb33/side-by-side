import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { savedComparison } from "@/lib/compare";
import { parseMode, parsePair } from "@/lib/compare-url";
import { findFeatured } from "@/lib/featured";
import { findLens } from "@/lib/lenses";
import { STEP_ABOUT, STEP_NAMES, type ProcessInput, type StepId } from "../process-model";
import { ProcessPanel } from "../process-panel";

// /compare/<pair>/<lens>/process opened from a link (README, shared, refresh):
// how the saved comparison was made, on a page of its own (SPEC §4a).
export default function ProcessPage(props: PageProps<"/compare/[pair]/[lens]/process">) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-rule/60" aria-busy="true" aria-label="Loading" />}>
        <Process {...props} />
      </Suspense>
    </main>
  );
}

async function Process({ params, searchParams }: PageProps<"/compare/[pair]/[lens]/process">) {
  const { pair, lens: slug } = await params;
  const mode = parseMode([(await searchParams).mode].flat()[0] ?? null);
  const tickers = parsePair(pair);
  const lens = findLens(slug);
  if (!tickers || !lens) notFound();
  const comparison = `/compare/${pair}/${lens.slug}${mode === "freeform" ? "?mode=freeform" : ""}`;
  const title = `${tickers[0]} vs ${tickers[1]}: ${lens.label}`;

  const featured = findFeatured(tickers, lens.slug);
  const saved = featured
    ? {
        companies: featured.companies.map(({ ticker, name, financials, filing }) => ({ ticker, name, financials, filing })),
        result: mode === "freeform" ? { html: featured.html, trace: featured.traces?.freeform } : { components: featured.components, trace: featured.traces?.components },
      }
    : await savedComparison(tickers, lens.slug, mode);
  const { companies, result } = saved;
  const input: ProcessInput | null = result && {
    lens: lens.slug,
    mode,
    status: "done",
    step: "checking",
    companies,
    shown: "html" in result ? 1 : result.components.length,
    calls: [],
    trace: result.trace ?? null,
  };

  return (
    <>
      <Link href={comparison} className="text-sm text-accent hover:underline">
        ← {title}
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-balance">How Claude built {title}</h1>
      <div className="card mt-6 px-5 sm:px-6">
        {input ? (
          <ProcessPanel input={input} variant="page" />
        ) : (
          <div className="grid gap-4 py-5">
            <p className="rounded-xl bg-paper px-3 py-2 text-sm text-muted">
              Still generating, or not generated yet. This run&apos;s record appears here once it finishes; the <Link href={comparison} className="text-accent hover:underline">comparison page</Link> shows it live.
            </p>
            <ol className="grid gap-3 text-sm">
              {(Object.keys(STEP_NAMES) as StepId[]).map((id, i) => (
                <li key={id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                  <span className="font-mono text-xs text-muted">{i + 1}</span>
                  <span>
                    <b className="font-semibold">{STEP_NAMES[id]}</b> <span className="text-muted">{STEP_ABOUT[id]}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </>
  );
}
