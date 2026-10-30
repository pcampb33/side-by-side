import { z } from "zod";
import { runComparison, type CompareEvent } from "@/lib/compare";
import { parsePair } from "@/lib/compare-url";
import { findLens } from "@/lib/lenses";

// A generation streams for 20-40 seconds (SPEC R4).
export const maxDuration = 60;

const body = z.object({ pair: z.string(), lens: z.string(), regenerate: z.boolean().default(false) });

// Streams newline-delimited JSON CompareEvents.
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  const tickers = parsed.success ? parsePair(parsed.data.pair) : null;
  const lens = parsed.success ? findLens(parsed.data.lens) : undefined;
  if (!parsed.success || !tickers || !lens || tickers.join() !== [...tickers].sort().join()) {
    return Response.json({ error: "Expected { pair: 'AAPL-vs-MSFT', lens, regenerate? } with the pair in alphabetical order." }, { status: 400 });
  }

  // The client going away (including React strict mode's double mount in
  // development) aborts the model run.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: CompareEvent) => !abort.signal.aborted && controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      await runComparison({ tickers, lens: lens.slug, regenerate: parsed.data.regenerate, signal: abort.signal, emit });
      if (!abort.signal.aborted) controller.close();
    },
    cancel: () => abort.abort(),
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
