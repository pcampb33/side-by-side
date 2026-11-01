"use client";

import { useEffect, useState } from "react";
import { LENS_GUIDANCE } from "@/agent/lenses";
import type { CompanyInput } from "@/agent/prompt";
import { formatValue } from "@/lib/format";
import type { LensSlug } from "@/lib/lenses";
import { valueDef, type ValueKey } from "@/lib/values";
import { Cited, lookup, SERIES, Value } from "./cited";
import { reducedMotion } from "./morph";
import { MetricInfo } from "./popover";

// The lens's headline numbers, drawn in code as soon as the financials arrive
// (~1s), before Claude starts. Both prompts say the page shows them.

const COUNT_MS = 700;

export function HeadlineStrip({ lens, companies }: { lens: LensSlug; companies: CompanyInput[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
      {LENS_GUIDANCE[lens].headline.map((key, i) => (
        <div key={key} className="pill-in card px-4 py-3" style={{ animationDelay: `${i * 70}ms` }}>
          <dt className="text-sm text-muted">
            {valueDef(key).label}
            <MetricInfo keys={[key]} />
          </dt>
          {companies.map((c, si) => (
            <dd key={c.ticker} className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <span className="size-2 shrink-0 rounded-full" style={{ background: SERIES[si] }} />
                {c.ticker}
                <span className="hidden @xl:inline">FY{c.financials.fiscalYears.at(-1)}</span>
              </span>
              <CountUp company={c} metric={key} />
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}

// Counts up from zero to the cited value, formatted the way it ends.
function CountUp({ company, metric }: { company: CompanyInput; metric: ValueKey }) {
  const looked = lookup(company, metric, "latest");
  const [k, setK] = useState(() => (reducedMotion() ? 1 : 0));
  useEffect(() => {
    if (k === 1) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / COUNT_MS);
      setK(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // Runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const className = "text-base font-semibold tabular-nums @xl:text-lg";
  if (looked.kind !== "value" || k === 1) return <Value looked={looked} className={className} />;
  return <Cited text={formatValue(looked.value * k, valueDef(metric).unit)} citation={looked.citation} className={className} />;
}
