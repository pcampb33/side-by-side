"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { comparePath } from "@/lib/compare-url";
import { LENSES, type LensSlug } from "@/lib/lenses";
import type { TickerEntry } from "@/lib/sec/client";
import { TickerSearch } from "./ticker-search";

export function CompareForm() {
  const router = useRouter();
  const [a, setA] = useState<TickerEntry | null>(null);
  const [b, setB] = useState<TickerEntry | null>(null);
  const [lens, setLens] = useState<LensSlug>("profitability");
  const same = a !== null && b !== null && a.cik === b.cik;

  return (
    <form
      className="mt-10 space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (a && b && !same) router.push(comparePath(a.ticker, b.ticker, lens));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <TickerSearch id="company-a" label="First company" value={a} onChange={setA} />
        <span className="hidden pt-9 font-serif text-lg text-muted italic sm:block">vs</span>
        <TickerSearch id="company-b" label="Second company" value={b} onChange={setB} />
      </div>
      {same && <p className="text-sm text-danger">Pick two different companies.</p>}

      <fieldset>
        <legend className="text-sm font-medium">Lens</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {LENSES.map((l) => (
            <label
              key={l.slug}
              className="cursor-pointer rounded-full border border-rule px-4 py-1.5 text-sm transition-colors has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="lens"
                value={l.slug}
                checked={lens === l.slug}
                onChange={() => setLens(l.slug)}
                className="sr-only"
              />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={!a || !b || same}
        className="w-full rounded-md bg-accent px-6 py-3 font-medium text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
      >
        Compare
      </button>
    </form>
  );
}
