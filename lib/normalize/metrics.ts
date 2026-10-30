// Each metric's us-gaap tags in fallback order. The first tag with a value
// for a given fiscal year wins, so a filer that switches tags between years
// (KO's long-term debt in 2024, F's revenue in 2025) keeps a continuous series.
// Order was set by surveying AAPL, MSFT, NVDA, KO, F and JPM; overlapping
// tags were checked to report identical values in the years both exist.
export const METRICS = {
  revenue: {
    label: "Revenue",
    unit: "USD",
    tags: [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "RevenuesNetOfInterestExpense",
      "SalesRevenueNet",
    ],
  },
  grossProfit: { label: "Gross profit", unit: "USD", tags: ["GrossProfit"] },
  operatingIncome: { label: "Operating income", unit: "USD", tags: ["OperatingIncomeLoss"] },
  netIncome: {
    label: "Net income",
    unit: "USD",
    tags: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  },
  rnd: {
    label: "R&D",
    unit: "USD",
    tags: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  },
  cash: {
    label: "Cash",
    unit: "USD",
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "CashAndDueFromBanks",
    ],
  },
  totalAssets: { label: "Total assets", unit: "USD", tags: ["Assets"] },
  totalLiabilities: { label: "Total liabilities", unit: "USD", tags: ["Liabilities"] },
  longTermDebt: {
    label: "Long-term debt",
    unit: "USD",
    tags: [
      "LongTermDebtNoncurrent",
      "LongTermDebtAndCapitalLeaseObligations",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    ],
  },
  equity: {
    label: "Shareholders' equity",
    unit: "USD",
    tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  },
  operatingCashFlow: {
    label: "Operating cash flow",
    unit: "USD",
    tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  },
  capex: {
    label: "Capital expenditure",
    unit: "USD",
    tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  },
  dividendsPaid: { label: "Dividends paid", unit: "USD", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"] },
  buybacks: { label: "Share buybacks", unit: "USD", tags: ["PaymentsForRepurchaseOfCommonStock"] },
  dilutedEps: { label: "Diluted EPS", unit: "USD/shares", tags: ["EarningsPerShareDiluted"] },
  sharesOutstanding: {
    label: "Shares outstanding",
    unit: "shares",
    tags: ["CommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
} as const satisfies Record<string, { label: string; unit: string; tags: readonly string[] }>;

export type MetricKey = keyof typeof METRICS;
