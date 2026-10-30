import type { Submissions } from "./client.ts";

// The fixed company header: facts from the SEC's submissions record, never
// generated.
export interface CompanyProfile {
  cik: number;
  tickers: { ticker: string; exchange: string | null }[];
  industry: string | null;
  fiscalYearEndMonth: number | null; // 1-12
  incorporatedIn: string | null;
  headquarters: string | null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function toProfile(s: Submissions): CompanyProfile {
  const month = Number(s.fiscalYearEnd?.slice(0, 2));
  const { city, stateOrCountry } = s.addresses.business;
  return {
    cik: Number(s.cik),
    tickers: s.tickers.map((ticker, i) => ({ ticker, exchange: s.exchanges[i] ?? null })),
    industry: s.sicDescription || null,
    fiscalYearEndMonth: month >= 1 && month <= 12 ? month : null,
    incorporatedIn: s.stateOfIncorporation || null,
    headquarters: city ? [titleCase(city), stateOrCountry].filter(Boolean).join(", ") : null,
  };
}

export const edgarCompanyUrl = (cik: number) => `https://www.sec.gov/edgar/browse/?CIK=${cik}`;
