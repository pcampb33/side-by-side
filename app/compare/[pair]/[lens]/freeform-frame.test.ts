import { describe, expect, it, vi } from "vitest";
import { framePage } from "./freeform-frame.tsx";

// Vitest doesn't resolve the "@/" alias; the frame's other inputs don't matter here.
vi.mock("@/agent/kit", () => ({ kitHead: () => "<style>/* kit */</style>" }));
vi.mock("@/lib/theme", () => ({ themeCss: () => "" }));
vi.mock("@/app/theme-switch", () => ({ useTheme: () => "system" }));

// A meta CSP only governs what comes after it, so it must precede everything the model wrote.
const csp = (html: string) => html.indexOf('http-equiv="Content-Security-Policy"');

describe("framePage", () => {
  it("puts the CSP before a script the page places ahead of its <head>", () => {
    const html = framePage("<!doctype html><html><script>x()</script><head></head><body></body></html>", []);
    expect(csp(html)).toBeGreaterThan(-1);
    expect(csp(html)).toBeLessThan(html.indexOf("<script>x()"));
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("doesn't put the CSP inside a comment that mentions <head>", () => {
    const html = framePage("<!doctype html><html><!-- <head> --><head></head><body></body></html>", []);
    expect(csp(html)).toBeGreaterThan(-1);
    expect(csp(html)).toBeLessThan(html.indexOf("<!--"));
  });
});
