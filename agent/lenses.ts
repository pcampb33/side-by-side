import type { LensSlug } from "../lib/lenses.ts";

// What each lens is for and which components usually serve it. The agent
// chooses; the lens steers.
export const LENS_GUIDANCE: Record<LensSlug, { question: string; guidance: string; needsFilings: boolean }> = {
  profitability: {
    question: "How much of each dollar of revenue does each company keep, and how has that changed?",
    guidance:
      "Margins are the core: gross, operating and net margin, as a trend_line or ratio_gauge. A cost_breakdown shows where revenue goes. Free cash flow and diluted EPS add context. Use absolute dollars only next to the ratios they explain.",
    needsFilings: false,
  },
  growth: {
    question: "How fast is each company growing, and what is funding it?",
    guidance:
      "Revenue and its year-over-year growth over five years are the core (trend_line). R&D, R&D % of revenue and capital expenditure show reinvestment; free cash flow shows whether growth pays for itself.",
    needsFilings: false,
  },
  "balance-sheet-risk": {
    question: "How much financial cushion does each company have against a bad year?",
    guidance:
      "Cash, long-term debt, shareholders' equity, total assets and liabilities, and long-term debt to equity are the core. Cash runway only where it is reported. Dividends and buybacks show cash leaving. Note when a metric is not reported rather than working around it.",
    needsFilings: false,
  },
  "risk-exposure": {
    question: "What risks does each company say could hurt it most?",
    guidance:
      "Built from each company's 10-K risk factors (the risk themes listed for each company). risk_themes is the core: rows for the subjects both companies name, then subjects only one names. Cash and long-term debt can add context where a risk is financial. Compare what each company says, never how likely a risk is.",
    needsFilings: true,
  },
  "where-they-compete": {
    question: "Where do the two businesses overlap, and where do they not?",
    guidance:
      "Built from each company's 10-K business description (the business areas listed for each company). business_overlap is the core: rows for the markets both serve, then each company's ground the other doesn't cover. Revenue and R&D can add scale. Describe overlap only as the filings state it; never infer market share.",
    needsFilings: true,
  },
};
