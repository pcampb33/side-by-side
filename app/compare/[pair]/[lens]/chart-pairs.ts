// Which components take a full row when the comparison is wide enough for two
// charts side by side (comparison-stream.tsx). Charts pair up in the order
// Claude showed them; everything else, and a chart left over from an odd run,
// spans the row. While Claude may still add a pair for the newest chart, it
// stays half width (the loading card sits beside it), so nothing jumps.

const CHARTS = new Set(["trend_line", "grouped_bars", "ratio_gauge", "cost_breakdown"]);

export function fullWidth(names: string[], loading: boolean): boolean[] {
  const full = names.map((n) => !CHARTS.has(n));
  for (let start = 0; start < names.length; ) {
    if (full[start]) {
      start++;
      continue;
    }
    let end = start;
    while (end < names.length && !full[end]) end++;
    if ((end - start) % 2 === 1 && !(loading && end === names.length)) full[end - 1] = true;
    start = end;
  }
  return full;
}

// The loading card: half width beside an unpaired newest chart, else a full row.
export const loadingCardFull = (names: string[], loading: boolean) => {
  const full = fullWidth(names, loading);
  let run = 0;
  for (let i = names.length - 1; i >= 0 && !full[i]; i--) run++;
  return run % 2 === 0;
};
