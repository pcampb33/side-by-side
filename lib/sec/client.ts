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

async function secFetch(url: string): Promise<Response> {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error("SEC_USER_AGENT is not set");
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new SecError(url, res.status);
  return res;
}

const secJson = async <T>(url: string) => (await (await secFetch(url)).json()) as T;

const padCik = (cik: number) => String(cik).padStart(10, "0");

export async function fetchTickerIndex(): Promise<TickerEntry[]> {
  const raw = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  return Object.values(raw).map((e) => ({ cik: e.cik_str, ticker: e.ticker, name: displayName(e.title) }));
}

const LEGAL_FORMS = new Set(["NV", "SA", "AG", "SE", "PLC", "LP", "LLC", "ADR"]);
const SMALL_WORDS = new Set(["CO", "INC", "LTD", "COM", "THE", "OF", "AND", "FOR", "NEW", "OIL", "GAS", "BIO", "TECH"]);

// EDGAR name (state suffix dropped) → how the company writes it.
const NAMES: Record<string, string> = {
  "AMAZON COM INC": "Amazon.com Inc",
  "ASML HOLDING NV": "ASML Holding NV",
  "ASTRAZENECA PLC": "AstraZeneca PLC",
  "CAPITAL ONE FINANCIAL CORP": "Capital One Financial Corp",
  "COCA COLA CO": "Coca-Cola Co",
  "CONOCOPHILLIPS": "ConocoPhillips",
  "CVS HEALTH Corp": "CVS Health Corp",
  "ELI LILLY & Co": "Eli Lilly & Co",
  "HDFC BANK LTD": "HDFC Bank Ltd",
  "HSBC HOLDINGS PLC": "HSBC Holdings PLC",
  "JPMORGAN CHASE & CO": "JPMorgan Chase & Co",
  "LAM RESEARCH CORP": "Lam Research Corp",
  "LOWES COMPANIES INC": "Lowe's Companies Inc",
  "MCDONALDS CORP": "McDonald's Corp",
  "MCKESSON CORP": "McKesson Corp",
  "NEXTERA ENERGY INC": "NextEra Energy Inc",
  "NVIDIA CORP": "NVIDIA Corp",
  "PEPSICO INC": "PepsiCo Inc",
  "PROCTER & GAMBLE Co": "Procter & Gamble Co",
  "RIO TINTO LTD": "Rio Tinto Ltd",
  "RIO TINTO PLC": "Rio Tinto PLC",
  "SCHWAB CHARLES CORP": "Charles Schwab Corp",
  "UNITEDHEALTH GROUP INC": "UnitedHealth Group Inc",
};

// A third of EDGAR names are all caps ("MICROSOFT CORP", "BANK OF AMERICA
// CORP /DE/"). Title-case those and drop the state suffix; mixed-case names
// are left as filed. Inner brand casing can't be recovered (JPMORGAN →
// Jpmorgan), and short unknown words stay upper on the guess they're acronyms,
// so well-known names whose rules come out wrong are kept by hand in NAMES.
export function displayName(title: string): string {
  // Without a space only two letters or NEW ("INC/DE", "CO/NEW"), so "A/S" stays.
  const name = title.replace(/(\s+\/[A-Z]{1,5}\/?|\/([A-Za-z]{2}|NEW)\/?|\/)+$/, "").trim();
  if (NAMES[name]) return NAMES[name];
  if (/[a-z]/.test(name)) return name;
  return name
    .split(" ")
    .map((word, i) => {
      const letters = word.replace(/[^A-Z]/g, "");
      if (LEGAL_FORMS.has(letters) || /[&\d]/.test(word)) return word;
      if (letters.length <= 3 && !SMALL_WORDS.has(letters)) return word;
      if (i > 0 && (letters === "OF" || letters === "AND" || letters === "THE" || letters === "FOR")) return word.toLowerCase();
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(" ");
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

export const filingDocumentUrl = (cik: number, accn: string, document: string) => `${filingUrl(cik, accn)}${document}`;

// A filing's primary document (HTML; up to ~13 MB for a large bank's 10-K).
export async function fetchFilingDocument(cik: number, accn: string, document: string): Promise<string> {
  return (await secFetch(filingDocumentUrl(cik, accn, document))).text();
}
