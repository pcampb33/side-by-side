"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { valueDef, type ValueKey } from "@/lib/values";

// A note that opens on hover (mouse), focus or tap, pins on click, and closes
// on Escape, an outside tap or scroll. Used by every cited number and every
// info button.

export function Popover({ trigger, label, className = "", width = 256, children }: { trigger: ReactNode; label?: string; className?: string; width?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  // Fixed to the viewport, so a scrolling table can't clip it.
  const show = () => {
    const rect = ref.current!.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setAt(rect.bottom + 200 < window.innerHeight ? { top: rect.bottom + 6, left } : { bottom: window.innerHeight - rect.top + 6, left });
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && hide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-block"
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && !pinned && setOpen(false)}
      onBlur={(e) => !ref.current?.contains(e.relatedTarget) && hide()}
    >
      <button type="button" aria-expanded={open} aria-label={label} onFocus={show} onClick={() => (pinned ? hide() : (setPinned(true), show()))} className={className}>
        {trigger}
      </button>
      {open && (
        <span
          role="note"
          className="popover-in fixed z-30 block rounded-xl border border-rule bg-surface p-3 text-left font-sans text-xs leading-relaxed font-normal tracking-normal text-ink shadow-lg"
          style={{ ...at, width }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

// A small (i) that opens a note: what a metric means, or how the modes differ.
export function Info({ label, width, children }: { label: string; width?: number; children: ReactNode }) {
  return (
    <Popover
      label={label}
      width={width}
      className="info-btn ml-1.5 inline-grid size-[1.15em] cursor-help place-items-center rounded-full align-[-0.1em] text-muted transition-colors hover:text-ink"
      trigger={
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-full" aria-hidden>
          <circle cx="8" cy="8" r="6.6" />
          <path d="M8 7.2v4" />
          <circle cx="8" cy="4.9" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      }
    >
      {children}
    </Popover>
  );
}

// What each metric on a chart or label means, with the formula for a derived one.
export function MetricInfo({ keys, lead }: { keys: ValueKey[]; lead?: string }) {
  const defs = keys.map(valueDef);
  return (
    <Info label={`What ${defs.map((d) => d.label).join(", ")} means`}>
      {lead && <span className="mb-2 block">{lead}</span>}
      {defs.map((d) => (
        <span key={d.label} className="block not-first:mt-2">
          <span className="block font-medium">{d.label}</span>
          <span className="block">{d.about}</span>
          {d.formula && <span className="mt-0.5 block text-muted">{d.formula}</span>}
        </span>
      ))}
    </Info>
  );
}
