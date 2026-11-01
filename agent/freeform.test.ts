import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { normalize } from "../lib/normalize/normalize.ts";
import { checkPage, generatePage } from "./freeform.ts";
import type { CompanyInput } from "./prompt.ts";
import type { Backend } from "./run.ts";

const company = (ticker: string, name: string): CompanyInput => ({
  ticker,
  name,
  financials: normalize(JSON.parse(fs.readFileSync(new URL(`../lib/normalize/fixtures/${ticker}.json`, import.meta.url), "utf8"))),
});
const companies = [company("AAPL", "Apple Inc."), company("MSFT", "Microsoft Corp")];
const signal = new AbortController().signal;
const page = (body: string, head = "") =>
  `<!doctype html><html><head><meta charset="utf-8">${head}<title>Apple vs Microsoft</title><style>body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans)}h1{font-family:var(--font-serif)}</style></head><body>${body}<p>Not financial advice.</p></body></html>`;

describe("checkPage", () => {
  it("accepts a self-contained page with inline SVG, scripts and #fragment links", () => {
    expect(checkPage(page('<svg><use href="#dot"/></svg><a href="#notes">Notes</a><script>document.title="x"</script>'))).toBeNull();
  });

  it("refuses anything that isn't one complete document", () => {
    expect(checkPage("<div>Revenue</div>")).toMatch(/complete HTML document/);
    expect(checkPage(page("<p>cut off").replace("</html>", ""))).toMatch(/complete HTML document/);
  });

  it.each([
    ['<img src="https://example.com/a.png">', /external src/],
    ['<script src="//cdn.example.com/x.js"></script>', /external src/],
    ['<a href="https://www.sec.gov/">SEC</a>', /href other than/],
    ["<div style=\"background:url('https://example.com/a.png')\"></div>", /external url/],
    ["<script>fetch('/api/compare')</script>", /network request/],
  ])("refuses %s", (body, problem) => {
    expect(checkPage(page(body))).toMatch(problem);
  });

  it("refuses external loads in the head too", () => {
    expect(checkPage(page("", '<link rel="stylesheet" href="https://fonts.example.com/a.css">'))).toMatch(/<link>/);
    expect(checkPage(page("", "<style>@import 'x.css';</style>"))).toMatch(/@import/);
  });
});

describe("generatePage", () => {
  const usage = { inputTokens: 1, outputTokens: 1 };

  it("returns problems to the model, keeps the first good page, and refuses a second", async () => {
    const replies: string[] = [];
    const backend: Backend = async ({ tools }) => {
      const submit = tools.find((t) => t.name === "submit_page")!;
      replies.push(submit.handle({ html: page('<img src="https://example.com/logo.png">') }).text);
      replies.push(submit.handle({ html: `  ${page("<h1>Apple and Microsoft</h1>")}\n` }).text);
      replies.push(submit.handle({ html: page("<h1>Again</h1>") }).text);
      return usage;
    };
    const result = await generatePage({ lens: "growth", companies, backend, signal });
    expect(replies).toEqual([expect.stringMatching(/external src/), "Shown.", "Already submitted. Reply done."]);
    expect(result.html).toBe(page("<h1>Apple and Microsoft</h1>"));
  });

  it("is an error when the model never submits a page", async () => {
    await expect(generatePage({ lens: "growth", companies, backend: async () => usage, signal })).rejects.toThrow(/without writing a page/);
  });
});
