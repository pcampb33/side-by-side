import { describe, expect, it } from "vitest";
import type { Submissions } from "./client.ts";
import { toProfile } from "./profile.ts";

const submissions = (overrides: Partial<Submissions> = {}): Submissions => ({
  cik: "0000019617",
  name: "JPMORGAN CHASE & CO",
  tickers: ["JPM", "JPM-PC"],
  exchanges: ["NYSE", "NYSE"],
  sic: "6021",
  sicDescription: "National Commercial Banks",
  fiscalYearEnd: "1231",
  stateOfIncorporation: "DE",
  addresses: { business: { city: "NEW YORK", stateOrCountry: "NY" } },
  filings: { recent: { accessionNumber: [], form: [], filingDate: [], reportDate: [], primaryDocument: [] } },
  ...overrides,
});

describe("toProfile", () => {
  it("maps the submissions record", () => {
    expect(toProfile(submissions())).toEqual({
      cik: 19617,
      tickers: [
        { ticker: "JPM", exchange: "NYSE" },
        { ticker: "JPM-PC", exchange: "NYSE" },
      ],
      industry: "National Commercial Banks",
      fiscalYearEndMonth: 12,
      incorporatedIn: "DE",
      headquarters: "New York, NY",
    });
  });

  it("leaves missing fields empty rather than inventing them", () => {
    const p = toProfile(
      submissions({ sicDescription: "", fiscalYearEnd: "", stateOfIncorporation: "", addresses: { business: { city: null, stateOrCountry: null } } }),
    );
    expect(p).toMatchObject({ industry: null, fiscalYearEndMonth: null, incorporatedIn: null, headquarters: null });
  });
});
