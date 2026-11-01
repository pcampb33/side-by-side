// The site's color tokens for both themes, as in app/globals.css (a test keeps
// the two in step). Freeform pages get them in their prompt and as CSS
// variables inside the iframe, so a page Claude writes matches the site.

export const THEME = {
  light: {
    paper: "#f2f3f8",
    surface: "#ffffff",
    ink: "#191c28",
    muted: "#646a80",
    rule: "#e3e6ee",
    accent: "#2b5fd9",
    "accent-ink": "#ffffff",
    danger: "#c0362c",
    "series-a": "#5b5bd6",
    "series-b": "#0e9585",
    "seg-1": "#868ba3",
    "seg-2": "#c0c4d2",
    "seg-3": "#e0e2ea",
  },
  dark: {
    paper: "#0e1016",
    surface: "#181b24",
    ink: "#eceef6",
    muted: "#969cb2",
    rule: "#272b37",
    accent: "#86a8ff",
    "accent-ink": "#0e1016",
    danger: "#f08a7e",
    "series-a": "#8d8ef7",
    "series-b": "#2fd1bb",
    "seg-1": "#7b8099",
    "seg-2": "#4a4f62",
    "seg-3": "#2e3240",
  },
} as const;

// The site loads Plus Jakarta Sans with next/font; a sandboxed page can't
// fetch it, so it gets it only where it is installed. Headings use the same
// family: the name `serif` stays because committed freeform pages use
// var(--font-serif) for their headings.
const SANS = '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONTS = { sans: SANS, serif: SANS } as const;

const vars = (t: Record<string, string>) =>
  Object.entries(t)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");

// The viewer's choice in the header switch: "system" follows the OS setting.
// It is kept in localStorage and as <html data-theme> (absent for system).
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "theme";

// Runs in <head> before the first paint (app/layout.tsx), so a saved choice
// never flashes the other theme.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// :root variables for a freeform page. A chosen theme uses html:root, which
// outranks a page that redefines the variables under its own
// prefers-color-scheme query.
export function themeCss(choice: ThemeChoice = "system"): string {
  const fonts = `--font-sans:${FONTS.sans};--font-serif:${FONTS.serif};`;
  if (choice !== "system") return `html:root{${vars(THEME[choice])}${fonts}color-scheme:${choice}}`;
  return `:root{${vars(THEME.light)}${fonts}color-scheme:light}@media (prefers-color-scheme: dark){:root{${vars(THEME.dark)}color-scheme:dark}}`;
}
