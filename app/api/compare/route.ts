import { Redis } from "@upstash/redis";
import { z } from "zod";
import { auth } from "@/auth";
import { accessGate } from "@/lib/access";
import { defaultBackend, runComparison, type CompareEvent } from "@/lib/compare";
import { MODES, parsePair } from "@/lib/compare-url";
import { parseEnv } from "@/lib/env";
import { featuredEvents, findFeatured } from "@/lib/featured";
import { findLens } from "@/lib/lenses";

// A freeform page or an uncached text lens takes up to ~100 seconds; Hobby
// with Fluid compute allows 300 (SPEC R4).
export const maxDuration = 300;

const body = z.object({ pair: z.string(), lens: z.string(), mode: z.enum(MODES).default("components"), regenerate: z.boolean().default(false) });

// Streams newline-delimited JSON CompareEvents.
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  const tickers = parsed.success ? parsePair(parsed.data.pair) : null;
  const lens = parsed.success ? findLens(parsed.data.lens) : undefined;
  if (!parsed.success || !tickers || !lens || tickers.join() !== [...tickers].sort().join()) {
    return Response.json({ error: "Expected { pair: 'AAPL-vs-MSFT', lens, mode?, regenerate? } with the pair in alphabetical order." }, { status: 400 });
  }

  const headers = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };
  // A featured comparison is fixed: served as committed, Regenerate or not.
  const featured = findFeatured(tickers, lens.slug);
  if (featured) return new Response(featuredEvents(featured, parsed.data.mode).map((e) => JSON.stringify(e) + "\n").join(""), { headers });

  // With sign-in on, generating needs an account and stays within the limits
  // (lib/access.ts); viewing a saved comparison needs neither.
  const env = parseEnv(process.env);
  const gate = env.REQUIRE_SIGN_IN
    ? accessGate({
        store: Redis.fromEnv(),
        email: (await auth())?.user?.email ?? null,
        ownerEmail: env.OWNER_EMAIL,
        budgetUsd: env.MONTHLY_BUDGET_USD,
        request: { pair: parsed.data.pair, lens: lens.slug, mode: parsed.data.mode, ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() || null },
      })
    : undefined;
  const backend = gate?.wrap(await defaultBackend());

  // The client going away (including React strict mode's double mount in
  // development) aborts the model run.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: CompareEvent) => !abort.signal.aborted && controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      // Clients and proxies may close a connection that stays idle while the
      // model works.
      const heartbeat = setInterval(() => emit({ type: "heartbeat" }), 15_000);
      await runComparison({ tickers, lens: lens.slug, mode: parsed.data.mode, regenerate: parsed.data.regenerate, signal: abort.signal, emit, backend, admit: gate?.admit });
      clearInterval(heartbeat);
      await gate?.log().catch((err) => console.error("[compare] log write failed:", err));
      if (!abort.signal.aborted) controller.close();
    },
    cancel: () => abort.abort(),
  });
  return new Response(stream, { headers });
}
