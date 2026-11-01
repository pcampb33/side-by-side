# agent/

Turns a lens, a mode and two companies' data into a comparison. It has no Next.js imports, so the app, the eval
harness and the featured script all run the same code.

```
lens + companies (normalized financials, condensed 10-Ks) ──► Backend runs Claude with tools ──► components | HTML
```

| File | |
|---|---|
| `run.ts` | `generateComparison` (Components mode), the `Backend` contract, `componentTools` |
| `freeform.ts` | `generatePage` (Freeform mode) and `checkPage`, which refuses anything that would load from outside the page |
| `catalog.ts` | The component catalog: one zod schema per component, plus `checkComponent` (metric keys exist, risk ids exist, a risk in one row only…) |
| `lenses.ts` | What each lens is for, which components usually serve it, which it never offers, and its headline values |
| `prompt.ts` | System and user prompts; the user prompt carries the data as metric keys and values, never as chart numbers to copy |
| `backends/api.ts` | The Anthropic API through the Vercel AI SDK (deployed) |
| `backends/login.ts` | A local Claude Code login through the Claude Agent SDK (`CLAUDE_AUTH=login`, development only) |

## Components mode

Each catalog entry becomes a tool. Claude calls them in order; a call that passes its schema and
`checkComponent` is shown at once (`onComponent`), and anything else goes back to Claude as an error to fix. Takeaways
come once, last. Components carry metric keys and years, not values: the renderer looks values up, so a chart can't
show a number that isn't in the filings.

## Freeform mode

One tool, `submit_page`, takes a complete HTML document. `checkPage` refuses external loads, links and network
calls; the app also renders the page in `<iframe srcdoc sandbox="allow-scripts">` under a CSP. Numbers in a
freeform page are model-written, so the evals check each one against the data.

## Backends

```ts
type Backend = (run: { model: ModelId; system: string; user: string; tools: ToolSpec[]; signal: AbortSignal }) => Promise<Usage>;
```

A backend runs Claude until it stops, executing tools through `ToolSpec.handle`. It throws `ComparisonError` on a
refusal, the step limit (12) or an API failure, and returns token usage. Sonnet 5.5 generates; Haiku 5.5 condenses
10-Ks (`lib/filings`). Tool choice stays `auto`, steered by the prompt.

## Use it from a script

Scripts run on plain Node (type stripping only), so relative imports carry `.ts`:

```ts
import { apiBackend } from "./agent/backends/api.ts";
import { generateComparison } from "./agent/run.ts";
import { loadCompany } from "./lib/compare.ts";

const companies = await Promise.all(["AAPL", "MSFT"].map(loadCompany));
const { components, usage } = await generateComparison({
  lens: "profitability",
  companies,
  backend: apiBackend(),
  signal: new AbortController().signal,
  onComponent: (c) => console.log(c.name),
});
```

Text lenses (`risk-exposure`, `where-they-compete`) also need each company's condensed 10-K: call `attachFiling`
from `lib/compare.ts` first. `npm run eval` and `npm run featured` (`scripts/`) are full examples.
