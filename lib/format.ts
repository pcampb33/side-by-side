import type { Unit } from "./values.ts";

// The prompt shows the model numbers in exactly this form, so prose it writes
// can be checked against the same strings the page displays.

function compact(n: number, prefix: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${prefix}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${prefix}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  return `${sign}${prefix}${Math.round(abs).toLocaleString("en-US")}`;
}

export function formatValue(value: number, unit: Unit): string {
  switch (unit) {
    case "usd":
      return compact(value, "$");
    case "usdPerShare":
      return `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
    case "shares":
      return compact(value, "");
    case "percent":
      return `${value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
    case "multiple":
      return `${value.toFixed(2)}×`;
    case "years":
      return `${value.toFixed(1)} yrs`;
  }
}

// Short axis ticks: $400B, 40%.
export function formatTick(value: number, unit: Unit): string {
  if (unit === "percent") return `${Math.round(value * 100)}%`;
  if (unit === "multiple") return `${value.toFixed(1)}×`;
  if (unit === "years") return `${value.toFixed(0)}`;
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const prefix = unit === "shares" ? "" : "$";
  if (abs >= 1e12) return `${sign}${prefix}${+(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${prefix}${+(abs / 1e9).toFixed(0)}B`;
  if (abs >= 1e6) return `${sign}${prefix}${+(abs / 1e6).toFixed(0)}M`;
  return `${sign}${prefix}${abs}`;
}
