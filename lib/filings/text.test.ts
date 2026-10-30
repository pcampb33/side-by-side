import { describe, expect, it } from "vitest";
import { annualReportSections, canonical, htmlToText, quoteAppearsIn } from "./text.ts";

describe("htmlToText", () => {
  it("drops the hidden XBRL header, decodes entities and keeps split headings on one line", () => {
    const html = `<html><head><title>10-K</title></head><body><ix:header><ix:hidden>dei:EntityName</ix:hidden></ix:header>
      <table><tr><td>Item&#160;1A.</td><td>Risk&nbsp;Factors</td></tr></table>
      <p>The Company&#8217;s results &amp; outlook</p><div>can <b>change</b>.</div></body></html>`;
    expect(htmlToText(html)).toBe("Item 1A. Risk Factors\nThe Company’s results & outlook\ncan change.");
  });
});

describe("annualReportSections", () => {
  // Every 10-K's table of contents names the same headings as the body.
  const filing = [
    "Table of Contents",
    "Item 1. Business 1",
    "Item 1A. Risk Factors 9",
    "Item 1B. Unresolved Staff Comments 20",
    "PART I",
    "ITEM 1. BUSINESS",
    "We make widgets for hospitals.",
    "ITEM 1A. RISK FACTORS",
    "Widget demand could fall.",
    "ITEM 1B. UNRESOLVED STAFF COMMENTS",
    "None.",
  ].join("\n");

  it("takes the body sections, not the table of contents", () => {
    expect(annualReportSections(filing)).toEqual({
      business: "ITEM 1. BUSINESS\nWe make widgets for hospitals.",
      risks: "ITEM 1A. RISK FACTORS\nWidget demand could fall.",
    });
  });

  it("reports a section it can't find as null, not empty", () => {
    expect(annualReportSections("Part I\nOur business is banking.\nRisk management")).toEqual({ business: null, risks: null });
  });
});

describe("quoteAppearsIn", () => {
  const text = canonical("The Company’s products\ncompete in markets characterized by aggressive price competition.");

  it("tolerates typography and line breaks", () => {
    expect(quoteAppearsIn("The Company's products compete in markets", text)).toBe(true);
  });

  it("rejects changed words, elisions and changed case", () => {
    expect(quoteAppearsIn("The Company's products compete in markets with aggressive price competition", text)).toBe(false);
    expect(quoteAppearsIn("The Company's products ... aggressive price competition", text)).toBe(false);
    expect(quoteAppearsIn("the company's products compete in markets", text)).toBe(false);
  });
});
