import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { CompanyInput } from "../agent/prompt.ts";
import type { Backend } from "../agent/run.ts";
import { judge } from "./judge.ts";

const companies = ["AAPL", "MSFT"].map((t) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${t}.json`, import.meta.url), "utf8")) as CompanyInput);
const pass = { pass: true, reason: "Fine as is." };

describe("judge", () => {
  it("turns each failed rubric item into a finding, and sends the lens question with the page", async () => {
    let sent = "";
    const backend: Backend = async ({ user, model, tools }) => {
      sent = `${model}\n${user}`;
      const verdict = tools[0];
      expect(verdict.handle({ answersLens: pass }).ok).toBe(false); // incomplete: sent back to fix
      verdict.handle({ answersLens: pass, mergedSubjects: { pass: false, reason: "Row 'Supply' pairs AAA-r1 (chips) with BBB-r2 (labor)." }, claimsBeyondData: pass });
      expect(verdict.handle({ answersLens: pass, mergedSubjects: pass, claimsBeyondData: pass }).ok).toBe(false); // only once
      return { inputTokens: 1, outputTokens: 1 };
    };
    const { findings } = await judge({ lens: "growth", companies, page: { text: "A page." }, backend });
    expect(findings).toEqual([{ check: "judge", detail: "mergedSubjects: Row 'Supply' pairs AAA-r1 (chips) with BBB-r2 (labor)." }]);
    expect(sent).toMatch(/^claude-opus-5-5/);
    expect(sent).toContain("How fast is each company growing");
    expect(sent).toContain("Page text:\nA page.");
  });

  it("fails loudly when the grader never gives a verdict", async () => {
    const backend: Backend = async () => ({ inputTokens: 1, outputTokens: 1 });
    await expect(judge({ lens: "growth", companies, page: { text: "A page." }, backend })).rejects.toThrow(/without a verdict/);
  });
});
