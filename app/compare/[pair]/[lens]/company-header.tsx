import type { NormalizedFinancials } from "@/lib/normalize/normalize";
import type { TickerEntry } from "@/lib/sec/client";
import { edgarCompanyUrl, type CompanyProfile } from "@/lib/sec/profile";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Fixed facts from the SEC, never generated.
export function CompanyHeader({
  entry,
  profile,
  financials,
}: {
  entry: TickerEntry;
  profile: CompanyProfile;
  financials: NormalizedFinancials | null; // null: the filer has no 10-K financial data
}) {
  const exchange = profile.tickers.find((t) => t.ticker === entry.ticker)?.exchange;
  const facts: [string, string | null][] = [
    ["Industry", profile.industry],
    ["Headquarters", profile.headquarters],
    ["Fiscal year ends", profile.fiscalYearEndMonth ? MONTHS[profile.fiscalYearEndMonth - 1] : null],
    ["Latest 10-K", financials ? `FY${financials.fiscalYears.at(-1)}` : null],
  ];

  return (
    <article className="card p-5 sm:p-6">
      <p className="text-sm font-medium tracking-wide text-muted">
        {entry.ticker}
        {exchange && ` · ${exchange}`}
      </p>
      <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">{entry.name}</h2>
      {!financials && (
        <p className="mt-3 inline-block rounded bg-danger/10 px-2 py-1 text-sm text-danger">
          Limited data: no 10-K financial statements on file
        </p>
      )}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([term, detail]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd>{detail ?? <span className="text-muted">Not reported</span>}</dd>
          </div>
        ))}
      </dl>
      <a
        href={edgarCompanyUrl(profile.cik)}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-block text-sm text-accent hover:underline"
      >
        Filings on SEC.gov ↗
      </a>
    </article>
  );
}
