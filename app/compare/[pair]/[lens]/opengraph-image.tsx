import { notFound } from "next/navigation";
import { LENS_GUIDANCE } from "@/agent/lenses";
import { parsePair } from "@/lib/compare-url";
import { findFeatured } from "@/lib/featured";
import { formatValue } from "@/lib/format";
import { findLens } from "@/lib/lenses";
import { valueAt, valueDef, type ValueKey } from "@/lib/values";
import type { NormalizedFinancials } from "@/lib/normalize/normalize";
import { Box, C, ogCard, OG_SIZE } from "../../../og-card";

// A featured comparison's card shows its first two headline numbers and a line
// of the first; any other pair gets the question instead (owner's choice:
// a preview never calls SEC).
export const alt = "Two companies compared side by side, from their SEC filings";
export const size = OG_SIZE;
export const contentType = "image/png";

const SERIES = [C.a, C.b];

export default async function Image({ params }: PageProps<"/compare/[pair]/[lens]">) {
  const { pair, lens: slug } = await params;
  const tickers = parsePair(pair);
  const lens = findLens(slug);
  if (!tickers || !lens) notFound();
  const guide = LENS_GUIDANCE[lens.slug];
  const featured = findFeatured(tickers, lens.slug);
  const fins = featured?.companies.map((c) => c.financials);

  const main = (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 24, fontSize: 80, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3 }}>
        <div style={{ display: "flex", gap: 22 }}>
          {tickers[0]}
          <span style={{ color: C.muted, fontWeight: 400 }}>vs</span>
        </div>
        <div style={{ display: "flex" }}>{tickers[1]}</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 38, color: C.muted }}>{lens.label}</div>
      {fins && <Line fins={fins} metric={guide.headline[0]} />}
    </div>
  );

  const side =
    fins ? (
      guide.headline.slice(0, 2).map((key) => (
        <Box key={key} label={valueDef(key).label}>
          {fins.map((f, si) => {
            const v = valueAt(f, key, "latest");
            return (
              <div key={si} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 6, background: SERIES[si] }} />
                  {tickers[si]} FY{f.fiscalYears.at(-1)}
                </div>
                {v.status === "value" ? (
                  <span style={{ fontSize: 32, fontWeight: 700 }}>{formatValue(v.value, valueDef(key).unit)}</span>
                ) : (
                  <span style={{ color: C.muted }}>n/r</span>
                )}
              </div>
            );
          })}
        </Box>
      ))
    ) : (
      <Box label="The question">
        <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.3 }}>{guide.question}</div>
      </Box>
    );

  return ogCard({ main, side });
}

// Both companies' values across the fiscal years; a missing year breaks the line.
function Line({ fins, metric }: { fins: NormalizedFinancials[]; metric: ValueKey }) {
  const [w, h] = [560, 96];
  const years = [...new Set(fins.flatMap((f) => f.fiscalYears))].sort();
  const series = fins.map((f) => years.map((fy) => valueAt(f, metric, fy)).map((v) => (v.status === "value" ? v.value : null)));
  const all = series.flat().filter((v) => v !== null);
  const [lo, hi] = [Math.min(0, ...all), Math.max(0, ...all)];
  const x = (i: number) => 6 + (i * (w - 12)) / Math.max(years.length - 1, 1);
  const y = (v: number) => 6 + (h - 12) * (1 - (v - lo) / (hi - lo || 1));
  const d = (s: (number | null)[]) => s.map((v, i) => (v === null ? "" : `${i > 0 && s[i - 1] !== null ? "L" : "M"}${x(i)},${y(v)}`)).join("");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: "auto", flexShrink: 0 }}>
      {series.map((s, si) => (
        <path key={si} d={d(s)} fill="none" stroke={SERIES[si]} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
