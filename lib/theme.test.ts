import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME } from "./theme.ts";

// The first :root block in globals.css is light; dark is written twice, under
// prefers-color-scheme (system) and for the header switch's choice.
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));

describe("THEME", () => {
  it("matches the tokens in globals.css for both themes", () => {
    const light = /:root\s*\{([^}]*)\}/.exec(css)![1];
    const systemDark = /prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/.exec(css)![1];
    const chosenDark = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)![1];
    expect(tokens(light)).toEqual(THEME.light);
    expect(tokens(systemDark)).toEqual(THEME.dark);
    expect(tokens(chosenDark)).toEqual(THEME.dark);
  });
});
