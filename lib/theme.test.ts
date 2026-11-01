import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME } from "./theme.ts";

// The first :root block in globals.css is light; the one under
// prefers-color-scheme: dark is dark.
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));

describe("THEME", () => {
  it("matches the tokens in globals.css for both themes", () => {
    const light = /:root\s*\{([^}]*)\}/.exec(css)![1];
    const dark = /prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1];
    expect(tokens(light)).toEqual(THEME.light);
    expect(tokens(dark)).toEqual(THEME.dark);
  });
});
