// SEC EDGAR client. Server-only: the SEC sends no CORS headers, requires a
// User-Agent with a name and an email, and allows at most 10 requests/second.

export interface TickerEntry {
  cik: number;
  ticker: string;
  name: string;
}

export interface Submissions {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string;
  sicDescription: string;
  fiscalYearEnd: string; // "MMDD"
  stateOfIncorporation: string;
  addresses: { business: { city: string | null; stateOrCountry: string | null } };
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      reportDate: string[];
      primaryDocument: string[];
    };
  };
}

export interface FactEntry {
  start?: string; // absent for point-in-time (balance sheet) values
  end: string;
  val: number;
  accn: string;
  fy: number | null; // fiscal year of the filing, not of the period
  fp: string | null;
  form: string;
  filed: string;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, FactEntry[]> }>>;
}

// No parameter properties here or in modules scripts load: Node's built-in
// TypeScript support only strips types and rejects them.
export class SecError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`SEC request failed with HTTP ${status}: ${url}`);
    this.url = url;
    this.status = status;
  }
}

// 8/s, not 10: Windows timers fire a few ms off, and the limit is the SEC's to measure.
const MIN_INTERVAL_MS = 125;
let nextSlot = 0;

async function secJson<T>(url: string): Promise<T> {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error("SEC_USER_AGENT is not set");
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new SecError(url, res.status);
  return (await res.json()) as T;
}

const padCik = (cik: number) => String(cik).padStart(10, "0");

export async function fetchTickerIndex(): Promise<TickerEntry[]> {
  const raw = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  return Object.values(raw).map((e) => ({ cik: e.cik_str, ticker: e.ticker, name: e.title }));
}

export function fetchSubmissions(cik: number): Promise<Submissions> {
  return secJson(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);
}

// Several MB for large filers: callers cache the normalized result, never this.
export function fetchCompanyFacts(cik: number): Promise<CompanyFacts> {
  return secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`);
}

export function filingUrl(cik: number, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replaceAll("-", "")}/`;
}
