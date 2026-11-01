import { z } from "zod";
import { runComparison, type CompareEvent } from "@/lib/compare";
import { MODES, parsePair } from "@/lib/compare-url";
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
      await runComparison({ tickers, lens: lens.slug, mode: parsed.data.mode, regenerate: parsed.data.regenerate, signal: abort.signal, emit });
      clearInterval(heartbeat);
      if (!abort.signal.aborted) controller.close();
    },
    cancel: () => abort.abort(),
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
