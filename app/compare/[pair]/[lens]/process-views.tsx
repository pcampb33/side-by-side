"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useProcess, type Theme } from "./process-context";
import { processSteps, type StepId } from "./process-model";
import { ProcessPanel, ProcessRail, StepDot } from "./process-panel";
import { PANEL_QUERY, ThemeBody } from "./text-tiles";

// Where "How Claude built this" shows (SPEC §4a Placement): beside the
// comparison from ~1100px, collapsible to a rail and remembered; below that,
// a strip under the comparison whose steps open the overlay route.

const RAIL_KEY = "process-panel";
const railEvent = "process-panel-change";
const readRail = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === "rail";
  } catch {
    return false;
  }
};
const subscribeRail = (onChange: () => void) => {
  window.addEventListener(railEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(railEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
};
function saveRail(rail: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, rail ? "rail" : "open");
  } catch {
    // Private windows may refuse storage; the panel still works for this page.
  }
  window.dispatchEvent(new Event(railEvent));
}

export function ProcessAside() {
  const { input, theme, setTheme } = useProcess();
  const saved = useSyncExternalStore(subscribeRail, readRail, () => false);
  // A subject shown here opens a collapsed rail for as long as it shows.
  const rail = saved && !theme;
  const [expandAt, setExpandAt] = useState<{ step: StepId | null; n: number }>({ step: null, n: 0 });

  // Escape (unless a citation note is open) or narrowing the window below the panel closes the subject.
  useEffect(() => {
    if (!theme) return;
    const wide = window.matchMedia(PANEL_QUERY);
    const onChange = () => !wide.matches && setTheme(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="note"]') && setTheme(null);
    wide.addEventListener("change", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      wide.removeEventListener("change", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [theme, setTheme]);

  return (
    <aside className="process-aside sticky top-4 hidden self-start min-[1100px]:block" data-rail={rail || undefined} aria-label="How Claude built this">
      <div className="process-stack">
        <div className="process-full card flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden" inert={rail}>
          {/* Kept mounted under a subject, so its expanded steps and live follow survive. */}
          <div className={`${theme ? "hidden" : "flex"} theme-in min-h-0 flex-1 flex-col`}>
            {input && <ProcessPanel key={expandAt.n} input={input} variant="aside" focus={expandAt.step} onCollapse={() => saveRail(true)} />}
          </div>
          {theme && <ThemeView key={theme.key} theme={theme} onClose={() => setTheme(null)} />}
        </div>
        <div className="process-rail card w-14" inert={!rail}>
          {input && (
            <ProcessRail
              input={input}
              onExpand={(step) => {
                if (step) setExpandAt((e) => ({ step, n: e.n + 1 }));
                saveRail(false);
              }}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

// A text-lens subject in the panel's place: the filing's own words, with the way back to the steps.
function ThemeView({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { title, Icon } = theme.content;
  return (
    <div className="theme-in flex min-h-0 flex-1 flex-col" aria-live="polite">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-full py-1.5 pr-2 text-[13px] text-muted transition-colors hover:text-ink">
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5">
            <path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          How Claude built this
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full bg-paper hover:bg-rule">
          <svg viewBox="0 0 16 16" aria-hidden className="size-3.5">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-width:thin]">
        <h3 className="mt-2 flex items-center gap-2.5 font-display text-lg leading-snug font-semibold tracking-tight">
          {Icon && <Icon aria-hidden size={20} strokeWidth={1.75} className="shrink-0 text-muted" />}
          {title}
        </h3>
        <ThemeBody content={theme.content} />
        <div aria-hidden className="sheet-fade" />
      </div>
    </div>
  );
}

export function ProcessStrip() {
  const { input, openAt } = useProcess();
  const pathname = usePathname();
  // The comparison reads ?mode= from the URL: keeping it keeps the run going.
  const query = useSearchParams().toString();
  if (!input) return null;
  // Still mounted under the open overlay, where the path already ends in /process.
  const href = `${pathname.replace(/\/process$/, "")}/process${query ? `?${query}` : ""}`;
  return (
    <nav aria-label="How Claude built this" className="process-strip card mt-6 flex items-center gap-1 overflow-x-auto p-2 min-[1100px]:hidden">
      <span className="px-2 text-xs font-semibold whitespace-nowrap text-muted">How Claude built this</span>
      {processSteps(input).map((step, i) => (
        <Link
          key={step.id}
          href={href}
          scroll={false}
          onClick={() => openAt(step.id)}
          className="flex flex-none items-center gap-2 rounded-2xl bg-paper py-1.5 pr-3.5 pl-1.5 text-[13px] leading-tight transition-transform duration-(--dur-base) hover:-translate-y-px"
        >
          <StepDot step={step} n={i + 1} size="sm" />
          <span>
            <b className="block font-semibold">{step.name}</b>
            <small key={step.count} className="tick-in block text-xs text-muted">
              {step.count}
            </small>
          </span>
        </Link>
      ))}
    </nav>
  );
}

// The intercepted /process route: over the mounted comparison, so a live run
// keeps going underneath. Back (or Close, or Esc) returns to it.
export function ProcessOverlay() {
  const { input, focus, opened } = useProcess();
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && router.back();
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);
  if (!input) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={() => router.back()} className="process-scrim absolute inset-0 hidden bg-black/40 sm:block" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How Claude built this"
        className="process-overlay absolute inset-y-0 right-0 flex w-full flex-col bg-surface pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] shadow-2xl sm:w-[min(440px,100%)] sm:rounded-l-2xl"
      >
        <ProcessPanel key={opened} input={input} variant="overlay" focus={focus} onClose={() => router.back()} />
      </div>
    </div>
  );
}
