export const LENSES = [
  { slug: "profitability", label: "Profitability" },
  { slug: "growth", label: "Growth" },
  { slug: "balance-sheet-risk", label: "Balance-sheet risk" },
  { slug: "risk-exposure", label: "Risk exposure" },
  { slug: "where-they-compete", label: "Where they compete" },
] as const;

export type LensSlug = (typeof LENSES)[number]["slug"];

export const findLens = (slug: string) => LENSES.find((l) => l.slug === slug);
