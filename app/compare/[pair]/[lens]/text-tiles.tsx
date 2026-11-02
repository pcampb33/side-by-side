"use client";

import {
  AppWindow, BadgeCheck, Banknote, Car, Clapperboard, Cloud, Copyright, Cpu, Factory, Gamepad2, Gavel, Globe, Handshake, HeartPulse, Landmark,
  Leaf, Lock, Megaphone, Receipt, Server, Shapes, ShoppingCart, Smartphone, Sparkles, Swords, TrendingDown, Truck, Users, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { findTextRef, type RowIcon } from "@/agent/catalog";
import type { CompanyInput } from "@/agent/prompt";
import { Cited, quoteCitation, SERIES } from "./cited";
import { useProcess } from "./process-context";
import { playMorph, reducedMotion, type PillSnapshot } from "./morph";
import { tileGroups, type TileKind } from "./tile-groups";

// The text lenses: each 10-K's own themes as pills while Claude groups them,
// then the overlap: each company's 10-K an outlined panel, subjects both name
// where the panels cross. Tapping a pill or a subject shows the filing's own
// words: in the panel beside the comparison on desktop, else in a dialog
// (a bottom sheet on phones).

const ICONS: Record<RowIcon, LucideIcon> = {
  competition: Swords, trade: Globe, "supply-chain": Truck, security: Lock, regulation: Gavel, "intellectual-property": Copyright, tax: Receipt,
  ai: Sparkles, devices: Smartphone, software: AppWindow, quality: Wrench, people: Users, cloud: Cloud, advertising: Megaphone, retail: ShoppingCart,
  finance: Landmark, manufacturing: Factory, energy: Zap, automotive: Car, health: HeartPulse, climate: Leaf, economy: TrendingDown, currency: Banknote,
  chips: Cpu, infrastructure: Server, media: Clapperboard, gaming: Gamepad2, partnerships: Handshake, reputation: BadgeCheck, other: Shapes,
};

export type TextKind = "risks" | "areas";
type Item = { id: string; name: string; text: string; quotes: { text: string; section: string }[] };
const items = (c: CompanyInput, kind: TextKind): Item[] =>
  !c.filing
    ? []
    : kind === "risks"
      ? c.filing.risks.map((r) => ({ id: r.id, name: r.theme, text: r.summary, quotes: r.quotes }))
      : c.filing.areas.map((a) => ({ id: a.id, name: a.name, text: a.description, quotes: a.quotes }));
const toItem = (i: NonNullable<ReturnType<typeof findTextRef>>["item"]): Item =>
  "theme" in i ? { id: i.id, name: i.theme, text: i.summary, quotes: i.quotes } : { id: i.id, name: i.name, text: i.description, quotes: i.quotes };

export type ThemeContent = { title: string; Icon?: LucideIcon; parts: { company: CompanyInput; si: number; items: Item[] }[]; what: string };

// Where a tapped subject shows: the desktop panel (where "How Claude built this"
// lives) from 1100px, matching its CSS; below that, a dialog. Tapping the shown
// subject again closes it; leaving (a mode switch, the tiles replacing the
// pills) clears the panel.
export const PANEL_QUERY = "(min-width: 1100px)";
function useShowTheme() {
  const { theme, setTheme } = useProcess();
  const [sheet, setSheet] = useState<ThemeContent | null>(null);
  useEffect(() => () => setTheme(null), [setTheme]);
  const show = (key: string, content: ThemeContent) => {
    if (!window.matchMedia(PANEL_QUERY).matches) return setSheet(content);
    setTheme(theme?.key === key ? null : { key, content });
  };
  const dialog = sheet && <Sheet content={sheet} onClosed={() => setSheet(null)} />;
  return { show, selected: theme?.key ?? null, dialog };
}

export interface Morph {
  stage: RefObject<HTMLElement | null>;
  pills: RefObject<PillSnapshot[] | null>; // set when the pills unmount; cleared when the morph finishes
}

// ---- While Claude groups: each 10-K's own list ----

export function FilingPills({ companies, kind, freeform }: { companies: CompanyInput[]; kind: TextKind; freeform?: boolean }) {
  const { show, selected, dialog } = useShowTheme();
  const what = kind === "risks" ? "risk themes" : "business areas";
  return (
    <article className="card p-5 @xl:p-6">
      <h3 className="font-display text-xl font-semibold tracking-tight">{kind === "risks" ? "Risk themes" : "Business areas"} in each 10-K</h3>
      <p className="mt-1 text-sm text-muted">
        {!companies.every((c) => c.filing)
          ? "Each list appears as its annual report is read."
          : freeform
            ? "Claude is writing a page from these."
            : "Claude is lining these up into shared and one-company subjects."}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 @xl:gap-x-12">
        {companies.map((c, si) => (
          <div key={c.ticker} className="grid min-w-0 content-start gap-1.5">
            <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SERIES[si] }} />
              {c.ticker}
            </div>
            {c.filing
              ? items(c, kind).map((item, j) => (
                  <button
                    key={item.id}
                    type="button"
                    data-pill={`${c.ticker}-${item.id}`}
                    data-side={si}
                    data-selected={selected === `pill-${c.ticker}-${item.id}` || undefined}
                    onClick={() => show(`pill-${c.ticker}-${item.id}`, { title: item.name, parts: [{ company: c, si, items: [item] }], what })}
                    className="pill-in max-w-full justify-self-start rounded-full border border-rule bg-surface px-3 py-1.5 text-left text-[13px] leading-snug hover:border-muted"
                    style={{ animationDelay: `${j * 55}ms` }}
                  >
                    {item.name}
                  </button>
                ))
              : [82, 64, 90, 70, 58, 76].map((w, j) => <div key={j} aria-hidden className="shimmer h-8 rounded-full" style={{ width: `${w}%` }} />)}
          </div>
        ))}
      </div>
      {dialog}
    </article>
  );
}

// ---- Grouped: the overlap ----

export function TextTiles({ rows, companies, what, morph }: { rows: { label: string; icon: RowIcon; refs: string[] }[]; companies: CompanyInput[]; what: string; morph?: Morph }) {
  const { show, selected, dialog } = useShowTheme();
  const root = useRef<HTMLDivElement>(null);
  const tickers = [companies[0].ticker, companies[1].ticker] as const;
  const groups = tileGroups(rows, tickers);
  // Tapping or hovering a company's name keeps its panel lit and fades the other's.
  const [focus, setFocus] = useState<0 | 1 | null>(null);
  const unit = what.split(" ").at(-1)!; // "themes" | "areas"
  const named = [groups.first.length + groups.both.length, groups.second.length + groups.both.length];

  useLayoutEffect(() => {
    const pills = morph?.pills.current;
    const stage = morph?.stage.current;
    if (!pills?.length || !stage || !root.current || reducedMotion()) return;
    const tileOf = new Map<string, HTMLElement>();
    root.current.querySelectorAll<HTMLElement>("[data-tile]").forEach((el) => rows[Number(el.dataset.tile)].refs.forEach((r) => tileOf.set(r, el)));
    // Strict mode runs this twice in development: the cancel restores the
    // layout and the second run starts the morph again.
    return playMorph({
      stage,
      root: root.current,
      pills,
      tileFor: (ref) => tileOf.get(ref) ?? null,
      onDone: () => (morph!.pills.current = null),
    });
    // Runs once, when the tiles first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (index: number) => {
    const row = rows[index];
    const found = row.refs.flatMap((ref) => findTextRef(companies, ref) ?? []);
    show(`tile-${index}`, {
      title: row.label,
      Icon: ICONS[row.icon] ?? Shapes,
      what,
      parts: companies.map((company, si) => ({ company, si, items: found.filter((f) => f.company === company).map((f) => toItem(f.item)) })),
    });
  };

  const chip = ({ row, index }: (typeof groups)[TileKind][number]) => {
    const Icon = ICONS[row.icon] ?? Shapes;
    return (
      <button key={index} type="button" data-tile={index} data-selected={selected === `tile-${index}` || undefined} onClick={() => open(index)} className="venn-chip">
        <Icon aria-hidden size={18} strokeWidth={1.75} />
        <span data-reveal>{row.label}</span>
      </button>
    );
  };
  const heading = (kind: TileKind, label: string) => (
    <h4 data-reveal className="flex items-center gap-1.5 text-xs font-semibold text-muted">
      {kind !== "second" && <span className="size-2 shrink-0 rounded-full" style={{ background: SERIES[0] }} />}
      {kind !== "first" && <span className="size-2 shrink-0 rounded-full" style={{ background: SERIES[1] }} />}
      {label}
      <span data-count={groups[kind].length} className="ml-auto text-ink tabular-nums">
        {groups[kind].length}
      </span>
    </h4>
  );
  const none = <p className="text-xs text-muted">None</p>;

  return (
    <div className="venn-wrap">
      <p className="venn-key mb-4">
        <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden className="shrink-0">
          <circle cx="10" cy="9" r="7.5" fill="none" stroke="var(--series-a)" strokeWidth="2" />
          <circle cx="20" cy="9" r="7.5" fill="none" stroke="var(--series-b)" strokeWidth="2" />
        </svg>
        Left panel: {tickers[0]}&apos;s 10-K ({named[0]} {unit}). Right panel: {tickers[1]}&apos;s ({named[1]}). The {groups.both.length} in the middle are in both.
      </p>
      <div ref={root} className="venn" data-focus={focus ?? undefined}>
        <span aria-hidden className="venn-panel venn-a" />
        <span aria-hidden className="venn-panel venn-b" />
        {([0, 1] as const).map((si) => (
          <button
            key={si}
            type="button"
            aria-pressed={focus === si}
            className={`venn-tab ${si === 0 ? "venn-tab-a" : "venn-tab-b"}`}
            onMouseEnter={() => setFocus(si)}
            onMouseLeave={() => setFocus(null)}
            onFocus={() => setFocus(si)}
            onBlur={() => setFocus(null)}
            onClick={() => setFocus((f) => (f === si ? null : si))}
          >
            <span className="size-2 rounded-full" style={{ background: SERIES[si] }} />
            {tickers[si]}&apos;s 10-K <small>{named[si]} {unit}</small>
          </button>
        ))}
        <section className="venn-col venn-only-0">
          {heading("first", `Only ${tickers[0]}`)}
          {groups.first.length ? groups.first.map(chip) : none}
        </section>
        <section className="venn-col venn-mid">
          {heading("both", "Both name these")}
          {groups.both.length ? groups.both.map(chip) : none}
        </section>
        <section className="venn-col venn-only-1">
          {heading("second", `Only ${tickers[1]}`)}
          {groups.second.length ? groups.second.map(chip) : none}
        </section>
      </div>
      {dialog}
    </div>
  );
}

// ---- The filing's own words: a dialog (bottom sheet on phones), or the desktop panel ----

function Sheet({ content, onClosed }: { content: ThemeContent; onClosed: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => {
    const d = ref.current;
    if (!d) return;
    if (reducedMotion()) return d.close();
    d.dataset.closing = "";
    // Closes when the slide-down ends, or after its duration if no animation runs.
    const done = () => d.open && d.close();
    d.addEventListener("animationend", done, { once: true });
    setTimeout(done, 300);
  };

  // Phones: the top of the sheet follows a finger down; a long pull or a flick
  // closes it (the slide-down starts from where it is), a short one springs back.
  const drag = useRef<{ startY: number; lastY: number; lastT: number; v: number } | null>(null);
  const grab = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!matchMedia("(width < 640px)").matches || (e.target as HTMLElement).closest("button")) return;
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    ref.current!.dataset.dragging = "";
  };
  const follow = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    g.v = (e.clientY - g.lastY) / Math.max(1, e.timeStamp - g.lastT);
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
    const d = ref.current!;
    const dy = e.clientY - g.startY;
    const y = dy > 0 ? dy : dy / 4; // upward: resists
    d.style.transform = `translateY(${y}px)`;
    d.style.setProperty("--sheet-drag", String(Math.max(0, y) / d.offsetHeight));
  };
  const release = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    const d = ref.current!;
    delete d.dataset.dragging;
    const flick = e.timeStamp - g.lastT < 100 && g.v > 0.6; // px/ms, still moving when let go
    if (e.type === "pointerup" && (e.clientY - g.startY > d.offsetHeight * 0.3 || flick)) return close();
    d.style.transform = "";
    d.style.setProperty("--sheet-drag", "0");
  };

  const { Icon } = content;
  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-title"
      className="sheet"
      onClose={onClosed}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === ref.current && close()}
    >
      <div className="px-5 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:px-6">
        <div className="sheet-grip -mx-5 -mt-2 px-5 pt-2 pb-1" onPointerDown={grab} onPointerMove={follow} onPointerUp={release} onPointerCancel={release}>
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule sm:invisible" />
          <div className="flex items-center justify-between gap-3">
            <h3 id="sheet-title" className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight">
              {Icon && <Icon aria-hidden size={22} strokeWidth={1.75} className="shrink-0 text-muted" />}
              {content.title}
            </h3>
            <button type="button" onClick={close} aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-full bg-paper hover:bg-rule">
              <svg viewBox="0 0 16 16" aria-hidden className="size-4">
                <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <ThemeBody content={content} />
      </div>
      <div aria-hidden className="sheet-fade" />
    </dialog>
  );
}

// Each company's summary and quotes for one subject.
export function ThemeBody({ content }: { content: ThemeContent }) {
  return content.parts.map(({ company, si, items: its }) => (
    <section key={company.ticker} className="mt-3 border-t border-rule pt-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: SERIES[si] }} />
        {company.ticker}
      </h4>
      {its.length === 0 && <p className="mt-1.5 text-sm text-muted italic">Not among the {content.what} drawn from its 10-K.</p>}
      {its.map((item) => (
        <ItemBody key={item.id} item={item} company={company} showName={content.parts.length > 1} />
      ))}
    </section>
  ));
}

function ItemBody({ item, company, showName }: { item: Item; company: CompanyInput; showName: boolean }): ReactNode {
  return (
    <div className="mt-2">
      <p className="text-sm">
        {showName && <span className="font-medium">{item.name}. </span>}
        <span className="text-muted">{item.text}</span>
      </p>
      {item.quotes.map((q) => (
        <blockquote key={q.text} className="mt-2 font-display text-[15px] leading-relaxed">
          “{q.text}” <Cited text={`10-K, ${q.section}`} citation={quoteCitation(company, q.section)} className="font-sans text-xs text-muted" />
        </blockquote>
      ))}
    </div>
  );
}
