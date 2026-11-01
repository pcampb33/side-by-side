import { z } from "zod";
import { CATALOG, checkComponent, type Component, type ComponentName } from "../agent/catalog.ts";
import type { CompanyInput } from "../agent/prompt.ts";
import { canonical } from "../lib/filings/text.ts";
import type { LensSlug } from "../lib/lenses.ts";
import { VALUE_KEYS, valueAt, valueDef, type Unit, type ValueKey } from "../lib/values.ts";

// The code-only eval checks (SPEC §7). Each returns findings, one per
// problem, with enough of the text around it to judge it by eye.

export type CheckName = "numbers" | "quotes" | "notReported" | "components" | "lens" | "page";
export interface Finding {
  check: CheckName;
  detail: string;
}

// The prose a model wrote in components mode: every string it chose.
export function componentProse(components: Component[]): string[] {
  return components.flatMap((c) => {
    const input = c.input as { title?: string; caption?: string; rows?: { label: string }[]; items?: unknown[] };
    if (c.name === "takeaways") return c.input.items;
    return [input.title, input.caption, ...(input.rows ?? []).map((r) => r.label)].filter((s): s is string => !!s);
  });
}

// --- 1. Numbers ---------------------------------------------------------

type Kind = "usd" | "shares" | "percent" | "multiple" | "years";
const KIND: Record<Unit, Kind> = { usd: "usd", usdPerShare: "usd", shares: "shares", percent: "percent", multiple: "multiple", years: "years" };
const SCALE: Record<string, number> = { T: 1e12, trillion: 1e12, B: 1e9, billion: 1e9, M: 1e6, million: 1e6, K: 1e3, thousand: 1e3 };

// One reading of a written number, in the payload's own units (dollars,
// shares, a fraction for percentages). `step` is its written precision, so a
// match "within rounding" is a known value within half a step.
interface Reading {
  kind: Kind;
  value: number;
  step: number;
}
interface NumberToken {
  text: string;
  at: number;
  readings: Reading[];
}

// $416.2B, 16.4B, 33.3%, −2.8%, 1.73×, 2.3 yrs, $6.11, 164,000. Plain
// integers below 1,000 (counts, "Item 1A", "10-K") and years are skipped;
// fiscal-year labels are checked on their own.
const NUMBER = /(?<![\w.,])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(T|B|M|K)\b|\s(trillion|billion|million|thousand)\b)?(\s?%|\s?×|x\b|\spercent\b|\s(?:yrs|years)\b)?/g;

export function numberTokens(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const [whole, dollar, int, frac = "", short, long, unitRaw] = m;
    const unit = unitRaw?.trim();
    const n = Number(int.replace(/,/g, "") + frac);
    const decimals = Math.max(frac.length - 1, 0);
    const scale = SCALE[short ?? long ?? ""] ?? 1;
    const step = 10 ** -decimals * scale;
    const plainInt = !dollar && !frac && !short && !long && !unit;
    if (plainInt && (n < 1000 || (/^\d{4}$/.test(int) && n >= 1900 && n < 2100))) continue;
    // "5 years" is a count; a runway is written with a decimal.
    if ((unit === "years" || unit === "yrs") && !frac) continue;
    let readings: Reading[];
    if (unit === "%" || unit === "percent") readings = [{ kind: "percent", value: n / 100, step: step / 100 }];
    else if (unit === "×" || unit === "x") readings = [{ kind: "multiple", value: n, step }];
    else if (unit) readings = [{ kind: "years", value: n, step }];
    else if (dollar) readings = [{ kind: "usd", value: n * scale, step }];
    else if (scale > 1) readings = (["usd", "shares"] as const).map((kind) => ({ kind, value: n * scale, step }));
    // A bare number: any unit as the payload table writes it, or dollars or
    // shares in millions, billions or trillions (a chart titled "Capex, $B").
    else
      readings = [
        { kind: "percent", value: n / 100, step: step / 100 },
        ...(["usd", "shares", "multiple", "years"] as const).map((kind) => ({ kind, value: n, step })),
        ...[1e6, 1e9, 1e12].flatMap((s) => (["usd", "shares"] as const).map((kind) => ({ kind, value: n * s, step: step * s }))),
      ];
    tokens.push({ text: whole.trim(), at: m.index, readings });
  }
  return tokens;
}

// Text the model was given that may contain numbers of its own: the
// condensed annual reports (text lenses only).
function filingTexts(companies: CompanyInput[]): string[] {
  return companies.flatMap((c) =>
    c.filing
      ? [
          c.filing.overview,
          ...c.filing.areas.flatMap((a) => [a.name, a.description, ...a.quotes.map((q) => q.text)]),
          ...c.filing.risks.flatMap((r) => [r.theme, r.summary, ...r.quotes.map((q) => q.text)]),
        ]
      : [],
  );
}

function knownValues(companies: CompanyInput[]): Reading[] {
  const known: Reading[] = [];
  for (const { financials: f } of companies) {
    for (const key of VALUE_KEYS) {
      const kind = KIND[valueDef(key).unit];
      for (const fy of f.fiscalYears) {
        const v = valueAt(f, key, fy);
        if (v.status === "value") known.push({ kind, value: v.value, step: 0 });
      }
    }
  }
  for (const text of filingTexts(companies)) for (const t of numberTokens(text)) known.push(...t.readings);
  return known;
}

const snippet = (text: string, at: number, length: number) =>
  `…${text.slice(Math.max(0, at - 50), at + length + 30).replace(/\s+/g, " ")}…`;

export function checkNumbers(texts: string[], companies: CompanyInput[]): { checked: number; findings: Finding[] } {
  const known = knownValues(companies);
  const years = new Set(companies.flatMap((c) => c.financials.fiscalYears));
  // 100% is a reference point ("each bar is 100% of revenue"), not a value.
  const grounded = (r: Reading) => (r.kind === "percent" && r.value === 1) || known.some((k) => k.kind === r.kind && Math.abs(Math.abs(k.value) - r.value) <= r.step / 2 + 1e-9 * Math.max(1, r.value));
  const findings: Finding[] = [];
  let checked = 0;
  for (const text of texts) {
    for (const t of numberTokens(text)) {
      checked++;
      if (!t.readings.some(grounded)) findings.push({ check: "numbers", detail: `${t.text} in ${snippet(text, t.at, t.text.length)}` });
    }
    for (const m of text.matchAll(/\bFY\s?(\d{4})\b/g)) {
      checked++;
      if (!years.has(Number(m[1]))) findings.push({ check: "numbers", detail: `${m[0]} is not a fiscal year in the data: ${snippet(text, m.index, m[0].length)}` });
    }
  }
  return { checked, findings };
}

// --- Quotes -------------------------------------------------------------

// A quoted passage of six or more words must be copied from a quote the
// condensed annual reports verified against the filing. An ellipsis splits
// it into parts, each checked.
export function checkQuotes(texts: string[], companies: CompanyInput[]): { checked: number; findings: Finding[] } {
  const quotes = canonical(companies.flatMap((c) => (c.filing ? [...c.filing.areas, ...c.filing.risks].flatMap((i) => i.quotes.map((q) => q.text)) : [])).join("\n"));
  const findings: Finding[] = [];
  let checked = 0;
  for (const text of texts) {
    for (const m of text.matchAll(/[“"]([^“”"]+)[”"]/g)) {
      if (m[1].trim().split(/\s+/).length < 6) continue;
      checked++;
      const parts = m[1].split(/\s*(?:…|\.\.\.)\s*/).filter((p) => p.trim().length > 0);
      if (!parts.every((p) => quotes.includes(canonical(p)))) findings.push({ check: "quotes", detail: `Not in the verified quotes: "${m[1].slice(0, 160)}"` });
    }
  }
  return { checked, findings };
}

// --- 3. Not reported ----------------------------------------------------

// A sentence that names a company, names a metric that company never
// reports (or has no meaningful value for) in any year shown, and states a
// number, without saying it is not reported. A heuristic: it lists
// sentences to read, and can flag one whose number belongs to the other company.
export function checkNotReported(texts: string[], companies: CompanyInput[]): Finding[] {
  const missing = companies.flatMap((c) => {
    const names = [c.ticker, c.name, c.name.split(/\s+/)[0]].map((n) => n.toLowerCase());
    const keys = VALUE_KEYS.filter((k) => c.financials.fiscalYears.every((fy) => valueAt(c.financials, k, fy).status !== "value"));
    return keys.map((k) => ({ ticker: c.ticker, names, key: k, label: valueDef(k).label.toLowerCase() }));
  });
  const findings: Finding[] = [];
  for (const sentence of texts.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/))) {
    const lower = sentence.toLowerCase();
    // "reported for Apple … but not for JPM" says it too.
    if (/n\/r|not meaningful|n\/m/.test(lower) || (lower.includes("report") && /\bnot\b|n't\b/.test(lower)) || numberTokens(sentence).length === 0) continue;
    for (const m of missing) {
      if (lower.includes(m.label) && m.names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower))) {
        findings.push({ check: "notReported", detail: `${m.ticker} ${m.key} is not reported, but: "${sentence.trim().slice(0, 200)}"` });
      }
    }
  }
  return findings;
}

// --- 2. Components ------------------------------------------------------

// Every component shown re-validates against its schema and the payload
// (the run already enforced both; this guards saved results and catalog changes).
export function checkComponents(components: Component[], companies: CompanyInput[]): Finding[] {
  return components.flatMap((c): Finding[] => {
    const parsed = z.object(CATALOG[c.name].shape).safeParse(c.input);
    if (!parsed.success) return [{ check: "components", detail: `${c.name}: ${z.prettifyError(parsed.error)}` }];
    const problem = checkComponent(c, companies);
    return problem ? [{ check: "components", detail: `${c.name}: ${problem}` }] : [];
  });
}

// --- 4. Plausible for the lens ------------------------------------------

const TEXT: ComponentName[] = ["risk_themes", "business_overlap"];
const LENS_RULES: Record<LensSlug, { needsAny?: (ValueKey | ComponentName)[]; needsOne?: "risk_themes" | "business_overlap"; forbid: ComponentName[] }> = {
  profitability: { needsAny: ["grossMargin", "operatingMargin", "netMargin", "cost_breakdown"], forbid: TEXT },
  growth: { needsAny: ["revenue", "revenueGrowth"], forbid: TEXT },
  "balance-sheet-risk": { needsAny: ["cash", "longTermDebt", "equity", "totalLiabilities", "debtToEquity"], forbid: TEXT },
  "risk-exposure": { needsOne: "risk_themes", forbid: ["business_overlap"] },
  "where-they-compete": { needsOne: "business_overlap", forbid: ["risk_themes"] },
};

function keysUsed(c: Component): ValueKey[] {
  switch (c.name) {
    case "metric_cards":
      return c.input.items.map((i) => i.key);
    case "trend_line":
    case "ratio_gauge":
      return [c.input.key];
    case "grouped_bars":
      return c.input.keys;
    default:
      return [];
  }
}

export function checkLens(lens: LensSlug, components: Component[], companies: CompanyInput[]): Finding[] {
  const rule = LENS_RULES[lens];
  const findings: Finding[] = [];
  const add = (detail: string) => findings.push({ check: "lens", detail });
  const names = components.map((c) => c.name);
  if (names.filter((n) => n === "takeaways").length !== 1 || names.at(-1) !== "takeaways") add("Takeaways must appear exactly once, last.");
  for (const n of rule.forbid) if (names.includes(n)) add(`${n} doesn't belong in the ${lens} lens.`);
  if (rule.needsAny) {
    const used = new Set<string>([...names, ...components.flatMap(keysUsed)]);
    if (!rule.needsAny.some((k) => used.has(k))) add(`None of ${rule.needsAny.join(", ")} is shown.`);
  }
  if (rule.needsOne) {
    const text = components.filter((c) => c.name === rule.needsOne);
    if (text.length !== 1) add(`Expected one ${rule.needsOne}, got ${text.length}.`);
    // Every risk (or business area) of both companies sits in a row; a risk
    // in only one, so none is counted twice. A business area may serve two
    // markets (Google Cloud sells AI models too).
    const prefix = rule.needsOne === "risk_themes" ? "r" : "a";
    const ids = companies.flatMap((c) => (c.filing ? [...c.filing.areas, ...c.filing.risks].filter((i) => i.id.startsWith(prefix)).map((i) => `${c.ticker}-${i.id}`) : []));
    const refs = text.flatMap((c) => (c.input as { rows: { refs: string[] }[] }).rows.flatMap((r) => r.refs));
    const unplaced = ids.filter((id) => !refs.includes(id));
    const twice = [...new Set(refs.filter((r, i) => refs.indexOf(r) !== i))];
    if (unplaced.length) add(`Not placed in any row: ${unplaced.join(", ")}.`);
    if (prefix === "r" && twice.length) add(`In more than one row: ${twice.join(", ")}.`);
  }
  return findings;
}
