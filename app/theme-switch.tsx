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

function choose(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {}
  // A crossfade between the two themes, where the browser has one.
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(() => setAttribute(choice));
  else setAttribute(choice);
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
          onClick={() => theme !== c && choose(c)}
          className="theme-option relative z-10 grid size-7 place-items-center rounded-full"
        >
          <Icon aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
