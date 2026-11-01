// Which tile group each text row belongs in, read from its ids (never from
// the model's label): rows both companies' ids fall under, then rows only the
// first or only the second company's ids do.

export type TileKind = "both" | "first" | "second";

export interface TileRow<R> {
  row: R;
  index: number; // the row's position in the component, a stable key
  kind: TileKind;
  refs: [string[], string[]]; // each company's ids, in the order given
}

export function tileGroups<R extends { refs: string[] }>(rows: R[], tickers: readonly [string, string]): Record<TileKind, TileRow<R>[]> {
  const groups: Record<TileKind, TileRow<R>[]> = { both: [], first: [], second: [] };
  const owner = (ref: string) => ref.slice(0, ref.lastIndexOf("-"));
  rows.forEach((row, index) => {
    const refs: [string[], string[]] = [row.refs.filter((r) => owner(r) === tickers[0]), row.refs.filter((r) => owner(r) === tickers[1])];
    const kind: TileKind = refs[0].length && refs[1].length ? "both" : refs[0].length ? "first" : "second";
    groups[kind].push({ row, index, kind, refs });
  });
  return groups;
}
