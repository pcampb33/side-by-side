import type { LensSlug } from "../lib/lenses.ts";
import type { ValueKey } from "../lib/values.ts";
import type { ComponentName } from "./catalog.ts";

// What each lens is for and which components usually serve it. The agent
// chooses; the lens steers. `headline` is what the page shows at ~1s, before
// Claude starts: each company's latest value for these keys. `excluded` are
// components the lens never offers: each text component belongs to its own
// lens, so two lenses never show the same tiles.
export const LENS_GUIDANCE: Record<LensSlug, { question: string; guidance: string; needsFilings: boolean; headline: ValueKey[]; excluded: ComponentName[] }> = {
  profitability: {
    question: "How much of each dollar of revenue does each company keep, and how has that changed?",
    guidance:
      "Margins are the core: gross, operating and net margin, as a trend_line or ratio_gauge. A cost_breakdown shows where revenue goes. Free cash flow and diluted EPS add context. Use absolute dollars only next to the ratios they explain.",
    needsFilings: false,
    headline: ["grossMargin", "operatingMargin", "netMargin", "freeCashFlow"],
    excluded: ["risk_themes", "business_overlap"],
  },
  growth: {
    question: "How fast is each company growing, and what is funding it?",
    guidance:
      "Revenue and its year-over-year growth over five years are the core (trend_line). R&D, R&D % of revenue and capital expenditure show reinvestment; free cash flow shows whether growth pays for itself.",
    needsFilings: false,
    headline: ["revenue", "revenueGrowth", "rndToRevenue", "freeCashFlow"],
    excluded: ["risk_themes", "business_overlap"],
  },
  "balance-sheet-risk": {
    question: "How much financial cushion does each company have against a bad year?",
    guidance:
      "Always show cash (a trend_line): it is the first cushion against a bad year. Long-term debt, shareholders' equity, total assets and liabilities, and long-term debt to equity are the rest of the core. Cash runway only where it is reported. Dividends and buybacks show cash leaving. Note when a metric is not reported rather than working around it.",
    needsFilings: false,
    headline: ["cash", "longTermDebt", "equity", "debtToEquity"],
    excluded: ["risk_themes", "business_overlap"],
  },
  "risk-exposure": {
    question: "What risks does each company say could hurt it most?",
    guidance:
      "Built from each company's 10-K risk factors (the risk themes listed for each company). risk_themes is the core: one component with a row for every subject, those both companies name and those only one names. Cash and long-term debt can add context where a risk is financial. Compare what each company says, never how likely a risk is.",
    needsFilings: true,
    headline: ["revenue", "operatingMargin", "cash", "longTermDebt"],
    excluded: ["business_overlap"],
  },
  "where-they-compete": {
    question: "Where do the two businesses overlap, and where do they not?",
    guidance:
      "Built from each company's 10-K business description (the business areas listed for each company). business_overlap is the core: one component with a row for every market, those both serve and each company's ground the other doesn't cover. Revenue and R&D can add scale. Describe overlap only as the filings state it; never infer market share.",
    needsFilings: true,
    headline: ["revenue", "rnd", "rndToRevenue", "operatingMargin"],
    excluded: ["risk_themes"],
  },
};
