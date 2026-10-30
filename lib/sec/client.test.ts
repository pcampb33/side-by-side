import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanyFacts, fetchTickerIndex, filingUrl, SecError } from "./client.ts";
import { searchTickers } from "./search.ts";

const UA = "company-compare test@example.com";

describe("SEC client", () => {
  const calls: { url: string; userAgent: string | null; at: number }[] = [];
  let respond: (url: string) => Response;

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("SEC_USER_AGENT", UA);
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, userAgent: new Headers(init.headers).get("User-Agent"), at: Date.now() });
      return respond(url);
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the User-Agent to a zero-padded CIK URL", async () => {
    respond = () => Response.json({ cik: 320193, entityName: "Apple Inc.", facts: {} });
    await fetchCompanyFacts(320193);
    expect(calls[0]).toMatchObject({ url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json", userAgent: UA });
  });

  it("throws on an HTTP error instead of returning nothing", async () => {
    respond = () => new Response("not found", { status: 404 });
    const err = await fetchCompanyFacts(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecError);
    expect(err).toMatchObject({ status: 404 });
  });

  it("refuses to call the SEC without a User-Agent", async () => {
    vi.stubEnv("SEC_USER_AGENT", "");
    await expect(fetchCompanyFacts(1)).rejects.toThrow("SEC_USER_AGENT");
    expect(calls).toHaveLength(0);
  });

  it("spaces requests to stay under 10 per second", async () => {
    respond = () => Response.json({});
    await Promise.all([fetchCompanyFacts(1), fetchCompanyFacts(2), fetchCompanyFacts(3)]);
    const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(100);
  });

  it("maps the ticker index", async () => {
    respond = () => Response.json({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
    expect(await fetchTickerIndex()).toEqual([{ cik: 320193, ticker: "AAPL", name: "Apple Inc." }]);
  });

  it("builds a filing link from an accession number", () => {
    expect(filingUrl(320193, "0000320193-25-000079")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/");
  });
});

describe("searchTickers", () => {
  const index = [
    { cik: 1, ticker: "MSFT", name: "Microsoft Corp" },
    { cik: 2, ticker: "AAPL", name: "Apple Inc." },
    { cik: 3, ticker: "APLE", name: "Apple Hospitality REIT, Inc." },
    { cik: 4, ticker: "PNAP", name: "Pineapple Holdings" },
    { cik: 5, ticker: "A", name: "Agilent Technologies" },
  ];

  it("finds a company by name, larger filers first", () => {
    expect(searchTickers(index, "apple").map((e) => e.ticker)).toEqual(["AAPL", "APLE"]);
  });

  it("ranks an exact ticker above prefixes and names", () => {
    expect(searchTickers(index, "a").map((e) => e.ticker)).toEqual(["A", "AAPL", "APLE"]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchTickers(index, "  ")).toEqual([]);
  });
});
