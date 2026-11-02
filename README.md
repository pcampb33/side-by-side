# side-by-side

Pick two US public companies and a lens; Claude builds the comparison from their SEC filings. Every number on the
page links to the filing it came from.

**Live:** https://side-by-side-jet.vercel.app

![A live generation: pick two companies and a lens, then watch Claude build the page and the panel record each step](docs/demo.gif)

- **Five lenses:** Profitability, Growth, Balance-sheet risk, Risk exposure, Where they compete.
- **Two modes.** *Components*: Claude composes the page from a fixed set of charts and cards through tool calls.
  *Freeform*: Claude writes a whole HTML page, shown in a sandboxed iframe.
- **Grounded.** Claude never writes a chart or card number: it names a metric and years, and the page looks the
  values up in the normalized filing data. Hover or tap any number for its filing (form, fiscal year, filed date)
  and a link to it on SEC.gov.
- **Neutral.** Takeaways describe differences, never a winner. Not financial advice.
- **Shows its work.** Beside every comparison, a panel shows how Claude built that page: the
  [five steps](#how-each-page-is-made), each tool call, and everything Claude was given.

| Components | Freeform |
|---|---|
| ![KO vs PEP, profitability, components](docs/components.png) | ![AMD vs NVDA, growth, freeform, dark](docs/freeform.png) |

| Risk exposure: the themes each 10-K names, shared and not | Phone, dark |
|---|---|
| ![AAPL vs MSFT risk themes in overlapping panels](docs/risk-venn.png) | <img src="docs/mobile.png" alt="F vs GM on a phone, dark" width="300"> |

## How each page is made

<img src="docs/process.png" alt="The panel beside AAPL vs MSFT, risk exposure: five steps, each tool call, the checks" width="320" align="right">

Every comparison goes through the same five steps, and the panel beside it (a strip under it on narrower screens)
shows this run's numbers for each:

1. **SEC data.** Each company's reported financials, read from its SEC XBRL filings: about 16 metrics over five
   fiscal years, each value keeping the filing it came from. A metric a company doesn't report stays
   `not reported`.
2. **10-Ks read** (Risk exposure, Where they compete). Claude Haiku condenses the latest annual report's business
   and risk sections into themes; code checks every quote word for word against the filing.
3. **Lens brief.** What the lens asks and which components usually answer it. Claude chooses; the lens steers.
4. **Claude composes.** Claude Sonnet calls components, naming metrics and years but never writing numbers. In
   Freeform it writes the whole page, with the site's cards and a chart helper that looks each value up. A call
   that breaks a rule goes back with the reason, and Claude fixes it.
5. **Checks.** Code reads the finished page: every number must appear in the filings, nothing not reported may show
   as a value, every quote must match, and a freeform page may load nothing from outside itself.

Below the steps, the panel holds everything Claude was given and followed for that page: the lens brief, the
components offered and excluded, the rules each call is checked against, the design tokens (and the kit pieces a
freeform page used), the full trace with timings and token counts, and the exact prompt as sent. Each trace is
recorded at generation time and stored with the result; `/compare/<pair>/<lens>/process` opens it as its own page
([AAPL vs MSFT, risk exposure](https://side-by-side-jet.vercel.app/compare/AAPL-vs-MSFT/risk-exposure/process)).
<br clear="right">

## How it works

```mermaid
flowchart LR
  A[Two tickers + lens] --> B[SEC EDGAR<br/>companyfacts, submissions]
  B --> C[lib/normalize<br/>~16 metrics x 5 FY,<br/>each value with its source]
  B --> D[lib/filings<br/>latest 10-K → Haiku summary,<br/>quotes verified verbatim]
  C --> E[agent/<br/>Sonnet: tool calls<br/>or one HTML page]
  D --> E
  E --> F[Page: components render<br/>values from the data,<br/>with citations]
```

| Folder | What it does |
|---|---|
| `lib/sec` | SEC client: ticker search, company facts, submissions, filing text. Server only. |
| `lib/normalize` | XBRL facts → revenue, margins, cash flow, debt… for the last five fiscal years, with fallback tags. Ratios are derived in code, never by the model; a missing metric is `not reported`, never 0. |
| `lib/filings` | The latest 10-K, condensed once per filing by Claude Haiku 5.5 (business, themed risks with quotes). Every quote is checked against the filing text. |
| `lib/cache` | One interface: a local `.cache/` folder, or Upstash Redis when deployed. |
| `agent/` | Lens + mode + data → components or an HTML page. No Next.js imports. [Its README](agent/README.md). |
| `evals/` | Code checks on real output: every number in prose appears in the data, no `not reported` shown as a value, valid components, self-contained freeform pages. |
| `featured/` | Five comparisons generated ahead of time and committed, so they open with no Claude or SEC calls. |
| `app/` | Next.js App Router: pages, the streaming `/api/compare` route, sign-in. |

A new comparison streams: a headline strip drawn in code (~1s), then each component as Claude shows it, while the
panel lights up step by step. Results are cached per pair, lens and mode, with their trace.

## Run it locally

Needs Node 24 and two values: an Anthropic API key and a User-Agent the SEC accepts (your name and email).

```sh
npm ci
cp .env.example .env.local   # set ANTHROPIC_API_KEY and SEC_USER_AGENT
npm run dev                  # http://localhost:3000
```

Locally there is no sign-in and no limit. Featured comparisons cost nothing; a new one runs Claude Sonnet 5.5 on
your key, plus Claude Haiku 5.5 once per 10-K the first time a text lens reads it.

| Command | |
|---|---|
| `npm run lint && npm run typecheck && npm test` | What CI runs. Never calls Claude or the SEC. |
| `npm run eval -- [--model sonnet\|opus] [--only <case>]` | Generates the eval cases and scores them (`evals/out/`). Calls Claude. |
| `npm run featured -- [--only <case>] [--mode freeform]` | Regenerates featured comparisons, keeping only runs that pass every check (`--mode freeform`: only the freeform pages). Review each page by eye before committing it. |
| `npm run eval:fixtures` | Rebuilds the eval fixtures from the SEC. |

## Deploy

The live site adds Google sign-in for generating (viewing saved and featured comparisons stays open), 5 new
comparisons per account per day, and a monthly budget tracked as actual token spend.

1. **Anthropic:** in the Console, create a workspace for this app, set its monthly spend limit a little above your
   budget (e.g. $6 for $5), and create an API key in it.
2. **Upstash:** create a Redis database; copy its REST URL and token. (Added through the Vercel marketplace, it
   injects them as `KV_REST_API_URL`/`_TOKEN`; set the `UPSTASH_REDIS_REST_*` names below as well.)
3. **Google:** in Google Cloud → APIs & Services, set up the OAuth consent screen (email and profile scopes) and
   create an OAuth client ID of type *Web application* with the redirect URI
   `https://<your-domain>/api/auth/callback/google`. Until the app is published, only listed test users can sign
   in; publishing asks for home, privacy and terms links on the Branding page (`/`, `/privacy`, `/terms`).
4. **Vercel:** import the repo, set the variables below, deploy. Generation routes run up to 300 seconds.

| Variable | Needed | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | always | The workspace key from step 1 |
| `SEC_USER_AGENT` | always | e.g. `side-by-side jane@example.com` |
| `REQUIRE_SIGN_IN` | deployed | `true`: sign-in, limits, spend tracking and logs |
| `AUTH_SECRET` | with sign-in | Random secret, e.g. `openssl rand -base64 33` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | with sign-in | The OAuth client from step 3 |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | with sign-in | Cache, limits, spend and logs |
| `OWNER_EMAIL` | optional | This account skips the daily limit (not the budget) |
| `MONTHLY_BUDGET_USD` | optional | Default 5. New generation stops once the month's spend reaches it |
| `CLAUDE_AUTH` | optional | `login` runs Claude on a local Claude Code login instead of a key (development only; refused with sign-in on) |

A missing or invalid value stops the server at startup with the variable's name. With sign-in on, each new
comparison is logged (email, time, pair, lens, mode, tokens, cost, IP) for 14 days; the footer says so.

## License

[MIT](LICENSE)
