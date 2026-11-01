import type { Browser } from "playwright";
import { checkPage } from "../agent/freeform.ts";
import { themeCss } from "../lib/theme.ts";
import type { Finding } from "./checks.ts";

// Check 5: a freeform page passes the same check the app applies, then runs
// in headless Chromium with every request blocked. Any request it attempts,
// any script error, and horizontal overflow at 320px are findings. Returns
// the text a reader sees once scroll-triggered content has drawn in, minus
// axis ticks, for the number and quote checks (tooltips drawn only on hover
// are not in it).
export async function renderPage(browser: Browser, html: string): Promise<{ text: string; findings: Finding[] }> {
  const findings: Finding[] = [];
  const add = (detail: string) => findings.push({ check: "page", detail });
  const problem = checkPage(html);
  if (problem) add(problem);

  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  try {
    await page.route("**/*", (route) => {
      add(`Requested ${route.request().url().slice(0, 120)}`);
      return route.abort();
    });
    page.on("pageerror", (err) => add(`Script error: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") add(`Console error: ${msg.text().slice(0, 200)}`);
    });
    // The site's theme variables, as the frame adds them.
    await page.setContent(html.replace(/<head(\s[^>]*)?>/i, (tag) => `${tag}<style>${themeCss("light")}</style>`));
    const scrollThrough = () =>
      page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 300) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
      });
    await scrollThrough();
    await page.waitForTimeout(1500);
    // Axis ticks ($40B, 25%) are a chart's scale, not values from the data:
    // whole numbers alone in an SVG <text> are hidden from the text. A label
    // with decimals ($416.2B) is a value, and stays.
    // Text in a closed <details> is still text the page states: open them all.
    const text = await page.evaluate(() => {
      for (const d of document.querySelectorAll("details")) d.open = true;
      for (const t of document.querySelectorAll<SVGTextElement>("svg text")) {
        if (/^[−-]?\$?\d+[TBMK]?[%×]?$/.test((t.textContent ?? "").trim())) t.style.display = "none";
      }
      return document.body.innerText;
    });

    await page.setViewportSize({ width: 320, height: 800 });
    await scrollThrough();
    await page.waitForTimeout(500);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > 320) add(`Wider than the page at 320px: ${width}px`);
    return { text, findings };
  } finally {
    await page.close();
  }
}
