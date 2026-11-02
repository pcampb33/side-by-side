import { describe, expect, it } from "vitest";
import { ComparisonError, type Backend } from "../agent/run.ts";
import { accessGate, Blocked, costUsd, DAILY_LIMIT, type Store } from "./access.ts";

// The four Redis commands the gate uses, in memory, with TTLs recorded.
function memoryStore() {
  const data = new Map<string, unknown>();
  const ttl = new Map<string, number>();
  const store = {
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: unknown, opts?: { ex: number }) => {
      data.set(key, value);
      if (opts) ttl.set(key, opts.ex);
      return "OK";
    },
    incr: async (key: string) => {
      const n = Number(data.get(key) ?? 0) + 1;
      data.set(key, n);
      return n;
    },
    incrbyfloat: async (key: string, by: number) => {
      const n = Number(data.get(key) ?? 0) + by;
      data.set(key, n);
      return n;
    },
    expire: async (key: string, seconds: number) => {
      ttl.set(key, seconds);
      return 1;
    },
  };
  return { store: store as unknown as Store, data, ttl };
}

const run = (model: Parameters<Backend>[0]["model"] = "claude-sonnet-5-5") => ({ model, system: "", user: "", tools: [], signal: new AbortController().signal });
const sonnet: Backend = async () => ({ inputTokens: 100_000, outputTokens: 10_000 }); // $0.30
const request = { pair: "AAPL-vs-MSFT", lens: "growth", mode: "components", ip: "203.0.113.7" };
const now = new Date("2026-11-01T12:00:00Z");

function gate(store: Store, email: string | null, extra: { budgetUsd?: number; now?: Date } = {}) {
  return accessGate({ store, email, ownerEmail: "Owner@example.com", budgetUsd: extra.budgetUsd ?? 5, request, now: extra.now ?? now });
}

// One request: the gate wraps the backend, which may run several times.
async function oneRequest(store: Store, email: string | null, calls = 1) {
  const g = gate(store, email);
  const backend = g.wrap(sonnet);
  try {
    await Promise.all(Array.from({ length: calls }, () => backend(run())));
    return "ran";
  } catch (err) {
    if (err instanceof Blocked) return err.reason;
    throw err;
  } finally {
    await g.log();
  }
}

describe("accessGate", () => {
  it("prices each model's tokens, with Haiku's higher tier over 100K input", () => {
    expect(costUsd("claude-sonnet-5-5", { inputTokens: 1e6, outputTokens: 1e6 })).toBe(12);
    expect(costUsd("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 0 })).toBeCloseTo(0.01);
    expect(costUsd("claude-haiku-5-5", { inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(0.1);
  });

  it("needs sign-in before running Claude", async () => {
    const { store, data } = memoryStore();
    expect(await oneRequest(store, null)).toBe("sign-in");
    expect(data.size).toBe(0);
  });

  it(`stops a non-owner account at request ${DAILY_LIMIT + 1} of the day`, async () => {
    const { store } = memoryStore();
    const results = [];
    for (let i = 0; i < DAILY_LIMIT + 1; i++) results.push(await oneRequest(store, "visitor@example.com"));
    expect(results).toEqual([...Array(DAILY_LIMIT).fill("ran"), "daily"]);
    expect(await oneRequest(store, "other@example.com")).toBe("ran");
    // The next UTC day starts a new count.
    const tomorrow = gate(store, "visitor@example.com", { now: new Date("2026-11-02T00:00:01Z") });
    await expect(tomorrow.wrap(sonnet)(run())).resolves.toBeDefined();
  });

  it("counts a request once, however many model runs it makes", async () => {
    const { store, data } = memoryStore();
    expect(await oneRequest(store, "visitor@example.com", 3)).toBe("ran");
    expect(data.get("count:2026-11-01:visitor@example.com")).toBe(1);
    expect(data.get("spend:2026-11")).toBeCloseTo(0.9);
  });

  it("lets the owner past the daily count, in any letter case", async () => {
    const { store } = memoryStore();
    for (let i = 0; i < DAILY_LIMIT + 2; i++) expect(await oneRequest(store, "owner@EXAMPLE.com")).toBe("ran");
  });

  it("stops everyone, the owner too, once the month's spend reaches the budget", async () => {
    const { store, data } = memoryStore();
    data.set("spend:2026-11", 5);
    expect(await oneRequest(store, "visitor@example.com")).toBe("budget");
    expect(await oneRequest(store, "owner@example.com")).toBe("budget");
    // A blocked request isn't counted against the day.
    expect(data.has("count:2026-11-01:visitor@example.com")).toBe(false);
    data.set("spend:2026-10", 99);
    data.set("spend:2026-11", 4.99);
    expect(await oneRequest(store, "visitor@example.com")).toBe("ran");
  });

  it("charges nothing to a visitor who left before Claude started", async () => {
    const { store, data } = memoryStore();
    const abort = new AbortController();
    abort.abort();
    await expect(gate(store, "visitor@example.com").wrap(sonnet)({ ...run(), signal: abort.signal })).rejects.toThrow("cancelled");
    expect(data.size).toBe(0);
  });

  it("charges the tokens a failed or cancelled run had already used", async () => {
    const { store, data } = memoryStore();
    const g = gate(store, "visitor@example.com");
    const cancelled: Backend = async () => {
      throw new ComparisonError("The request was cancelled.", { inputTokens: 100_000, outputTokens: 10_000 });
    };
    await expect(g.wrap(cancelled)(run())).rejects.toThrow("cancelled");
    await g.log();
    expect(data.get("spend:2026-11")).toBeCloseTo(0.3);
    const [key] = [...data.keys()].filter((k) => k.startsWith("log:"));
    expect(data.get(key)).toMatchObject({ inputTokens: 100_000, outputTokens: 10_000 });
  });

  it("logs each request that ran Claude for 14 days, and nothing else", async () => {
    const { store, data, ttl } = memoryStore();
    await oneRequest(store, null);
    expect([...data.keys()].filter((k) => k.startsWith("log:"))).toEqual([]);
    await oneRequest(store, "visitor@example.com", 2);
    const [key] = [...data.keys()].filter((k) => k.startsWith("log:"));
    expect(ttl.get(key)).toBe(14 * 86_400);
    expect(data.get(key)).toEqual({
      email: "visitor@example.com",
      time: "2026-11-01T12:00:00.000Z",
      ...request,
      inputTokens: 200_000,
      outputTokens: 20_000,
      costUsd: expect.closeTo(0.6),
    });
  });
});
