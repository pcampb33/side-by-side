import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFinancials } from "../financials.ts";
import { cached, fsCache, upstashCache, type CacheBackend } from "./cache.ts";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "company-compare-cache-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fsCache", () => {
  it("round-trips a value and misses an unknown key", async () => {
    const cache = fsCache(dir);
    await cache.set("financials:v1:320193", { a: [1, 2] }, 60);
    expect(await cache.get("financials:v1:320193")).toEqual({ a: [1, 2] });
    expect(await cache.get("financials:v1:1")).toBeUndefined();
  });

  it("expires after the TTL and keeps an entry without one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = fsCache(dir);
    await cache.set("short", 1, 60);
    await cache.set("forever", 2);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await cache.get("short")).toBeUndefined();
    expect(await cache.get("forever")).toBe(2);
  });
});

describe("upstashCache", () => {
  it("maps a Redis null to a miss and passes the TTL as EX", async () => {
    const store = new Map<string, unknown>();
    const set = vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK" as const;
    });
    const cache = upstashCache({ get: (async (key: string) => store.get(key) ?? null) as never, set: set as never });
    expect(await cache.get("k")).toBeUndefined();
    await cache.set("k", { v: 1 }, 30);
    expect(set).toHaveBeenCalledWith("k", { v: 1 }, { ex: 30 });
    expect(await cache.get("k")).toEqual({ v: 1 });
  });
});

describe("cached", () => {
  it("does not store a failure, so the next call tries again", async () => {
    const cache = fsCache(dir);
    const produce = vi.fn().mockRejectedValueOnce(new Error("SEC down")).mockResolvedValueOnce("data");
    await expect(cached("k", 60, produce, cache)).rejects.toThrow("SEC down");
    expect(await cache.get("k")).toBeUndefined();
    expect(await cached("k", 60, produce, cache)).toBe("data");
    expect(await cached("k", 60, produce, cache)).toBe("data");
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("serves real data when the cache itself is unreachable", async () => {
    const broken: CacheBackend = {
      get: async () => {
        throw new Error("redis unreachable");
      },
      set: async () => {
        throw new Error("redis unreachable");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await cached("k", 60, async () => "data", broken)).toBe("data");
  });
});

describe("getFinancials", () => {
  const appleFacts = fs.readFileSync(new URL("../normalize/fixtures/AAPL.json", import.meta.url), "utf8");

  it("reads the second call from the cache and never caches a failed fetch", async () => {
    vi.stubEnv("SEC_USER_AGENT", "company-compare test@example.com");
    const responses = [new Response("busy", { status: 503 }), new Response(appleFacts)];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    const cache = fsCache(dir);

    await expect(getFinancials(320193, cache)).rejects.toMatchObject({ status: 503 });
    const first = await getFinancials(320193, cache);
    const second = await getFinancials(320193, cache);

    expect(fetchMock).toHaveBeenCalledTimes(2); // the 503, then one successful fetch
    expect(second).toEqual(first);
    expect(first.name).toBe("Apple Inc.");
  });
});
