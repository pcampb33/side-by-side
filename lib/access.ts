import type { Redis } from "@upstash/redis";
import { ComparisonError, type Backend, type ModelId, type Usage } from "../agent/run.ts";

// Limits, spend and logs (SPEC §1, §5), on only when REQUIRE_SIGN_IN=true.
// The gate wraps the backend, so it acts the first time a request is about
// to run Claude: a cached or featured comparison never reaches it, and
// neither does a request that fails before generating. Days and months are UTC.

export const DAILY_LIMIT = 5;
const DAY = 86_400;
const LOG_TTL = 14 * DAY;

// $ per million tokens, input and output (Anthropic list prices, 2026-10).
// Haiku costs more on a prompt over 100K tokens; usage is summed over a run's
// steps, so this can overcount, which is the safe side of a budget.
const PRICE: Record<ModelId, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function costUsd(model: ModelId, usage: Usage): number {
  const [input, output] = model === "claude-haiku-5-5" && usage.inputTokens > 100_000 ? [0.5, 2.5] : PRICE[model];
  return (usage.inputTokens * input + usage.outputTokens * output) / 1e6;
}

export type BlockReason = "sign-in" | "daily" | "budget";

export class Blocked extends Error {
  reason: BlockReason;
  constructor(reason: BlockReason) {
    super(`Generation blocked: ${reason}`);
    this.reason = reason;
  }
}

export type Store = Pick<Redis, "get" | "set" | "incr" | "incrbyfloat" | "expire">;

export function accessGate(opts: {
  store: Store;
  email: string | null; // null: not signed in
  ownerEmail?: string;
  budgetUsd: number;
  request: { pair: string; lens: string; mode: string; ip: string | null };
  now?: Date;
}) {
  const { store, email } = opts;
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const spendKey = `spend:${day.slice(0, 7)}`;
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let started: Promise<void> | undefined;
  let ran = false;

  async function start() {
    if (!email) throw new Blocked("sign-in");
    // The owner is exempt from the daily count, not from the budget.
    if (Number((await store.get(spendKey)) ?? 0) >= opts.budgetUsd) throw new Blocked("budget");
    if (email.toLowerCase() !== opts.ownerEmail?.toLowerCase()) {
      // Count first, then compare, so two requests at once can't both pass.
      const key = `count:${day}:${email.toLowerCase()}`;
      const count = await store.incr(key);
      if (count === 1) await store.expire(key, 2 * DAY);
      if (count > DAILY_LIMIT) throw new Blocked("daily");
    }
    ran = true;
  }

  return {
    wrap(backend: Backend): Backend {
      return async (run) => {
        // A visitor who left while the data loaded isn't charged a comparison.
        if (run.signal.aborted) throw new ComparisonError("The request was cancelled.");
        // A text lens reads two annual reports at once: one count per request.
        started ??= start();
        await started;
        const usage = await backend(run);
        const cost = costUsd(run.model, usage);
        totals.inputTokens += usage.inputTokens;
        totals.outputTokens += usage.outputTokens;
        totals.costUsd += cost;
        await store.incrbyfloat(spendKey, cost);
        await store.expire(spendKey, 62 * DAY);
        return usage;
      };
    },
    // One entry per request that ran Claude, kept 14 days.
    async log() {
      if (!ran) return;
      const entry = { email, time: now.toISOString(), ...opts.request, ...totals };
      await store.set(`log:${entry.time}:${crypto.randomUUID()}`, entry, { ex: LOG_TTL });
    },
  };
}
