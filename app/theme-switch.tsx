"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";

// System / Light / Dark. <html data-theme> is the one source of truth: the
// CSS places the thumb from it (so it is right before hydration), and
// useTheme() reads it for the freeform frame.

const OPTIONS = [
  { choice: "system", label: "System theme", Icon: Monitor },
  { choice: "light", label: "Light theme", Icon: Sun },
  { choice: "dark", label: "Dark theme", Icon: Moon },
] as const;

const read = (): ThemeChoice => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
};
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
export const useTheme = () => useSyncExternalStore(subscribe, read, (): ThemeChoice => "system");

const setAttribute = (choice: ThemeChoice) => {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
};

function choose(choice: ThemeChoice, from: HTMLElement) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {}
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return setAttribute(choice);
  // The new theme spreads out in a circle from the button (globals.css), where
  // the browser has transition types; a crossfade where it has only the basics.
  if (!("types" in ViewTransition.prototype)) return document.startViewTransition(() => setAttribute(choice));
  const r = from.getBoundingClientRect();
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
  const style = document.documentElement.style;
  style.setProperty("--reveal-x", `${x}px`);
  style.setProperty("--reveal-y", `${y}px`);
  style.setProperty("--reveal-r", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  document.startViewTransition({ update: () => setAttribute(choice), types: ["theme"] });
}

export function ThemeSwitch() {
  const theme = useTheme();
  // Strict mode's development remount resets <html> to its JSX attributes,
  // dropping the one the head script set; put the saved choice back.
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setAttribute(saved);
    } catch {}
  }, []);

  return (
    <div role="radiogroup" aria-label="Theme" className="theme-switch relative grid grid-cols-3 rounded-full border border-rule bg-surface p-0.5">
      <span aria-hidden className="theme-thumb absolute inset-y-0.5 left-0.5 rounded-full bg-ink" />
      {OPTIONS.map(({ choice: c, label, Icon }) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={theme === c}
          aria-label={label}
          title={label}
          data-choice={c}
          onClick={(e) => theme !== c && choose(c, e.currentTarget)}
          className="theme-option relative z-10 grid size-7 place-items-center rounded-full"
        >
          <Icon aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
