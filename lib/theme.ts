// The site's color tokens for both themes, as in app/globals.css (a test keeps
// the two in step). Freeform pages get them in their prompt and as CSS
// variables inside the iframe, so a page Claude writes matches the site.

export const THEME = {
  light: {
    paper: "#fbfaf7",
    surface: "#ffffff",
    ink: "#1b1a17",
    muted: "#66635c",
    rule: "#e3dfd6",
    accent: "#23439b",
    "accent-ink": "#ffffff",
    danger: "#a3261b",
    "series-a": "#2a78d6",
    "series-b": "#eb6834",
    "seg-1": "#8a857b",
    "seg-2": "#b3aea3",
    "seg-3": "#d5d0c5",
  },
  dark: {
    paper: "#131311",
    surface: "#1c1b18",
    ink: "#ecebe6",
    muted: "#a19e96",
    rule: "#34322d",
    accent: "#93a9f2",
    "accent-ink": "#10162b",
    danger: "#f08a7e",
    "series-a": "#3987e5",
    "series-b": "#d95926",
    "seg-1": "#77736a",
    "seg-2": "#5a5750",
    "seg-3": "#44423c",
  },
} as const;

// The site loads Inter and Source Serif 4 with next/font; a sandboxed page
// can't fetch them, so it gets them only where they are installed.
export const FONTS = {
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: '"Source Serif 4", "Source Serif Pro", Georgia, Cambria, serif',
} as const;

const vars = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");

// :root variables for both themes, following the viewer's system setting.
export function themeCss(): string {
  return `:root{${vars(THEME.light)}--font-sans:${FONTS.sans};--font-serif:${FONTS.serif};color-scheme:light}@media (prefers-color-scheme: dark){:root{${vars(THEME.dark)}color-scheme:dark}}`;
}
