import fs from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";

// One interface, two backends: a gitignored .cache/ folder locally, Upstash
// Redis when deployed. getCache() is the only place that chooses.
export interface CacheBackend {
  get(key: string): Promise<unknown>; // undefined on a miss
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  claim(key: string, ttlSeconds: number): Promise<boolean>; // sets the key unless it exists; true if it did
  delete(key: string): Promise<void>;
}

export function fsCache(dir: string): CacheBackend {
  const file = (key: string) => path.join(dir, `${encodeURIComponent(key)}.json`);
  return {
    async get(key) {
      let raw: string;
      try {
        raw = await fs.readFile(file(key), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
      const entry = JSON.parse(raw) as { expiresAt: number | null; value: unknown };
      return entry.expiresAt === null || entry.expiresAt > Date.now() ? entry.value : undefined;
    },
    async set(key, value, ttlSeconds) {
      await fs.mkdir(dir, { recursive: true });
      // Write-then-rename so a concurrent reader never sees half a file.
      const tmp = `${file(key)}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null, value }));
      await fs.rename(tmp, file(key));
    },
    // Check-then-set: not atomic, which is fine for one local server.
    async claim(key, ttlSeconds) {
      if ((await this.get(key)) !== undefined) return false;
      await this.set(key, true, ttlSeconds);
      return true;
    },
    async delete(key) {
      await fs.rm(file(key), { force: true });
    },
  };
}

export function upstashCache(redis: Pick<Redis, "get" | "set" | "del">): CacheBackend {
  return {
    async get(key) {
      const value = await redis.get(key);
      return value === null ? undefined : value;
    },
    async set(key, value, ttlSeconds) {
      await (ttlSeconds ? redis.set(key, value, { ex: ttlSeconds }) : redis.set(key, value));
    },
    async claim(key, ttlSeconds) {
      return (await redis.set(key, true, { nx: true, ex: ttlSeconds })) === "OK";
    },
    async delete(key) {
      await redis.del(key);
    },
  };
}

let selected: CacheBackend | undefined;

export function getCache(): CacheBackend {
  if (!selected) {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
    selected = url && token ? upstashCache(new Redis({ url, token })) : fsCache(path.join(process.cwd(), ".cache"));
  }
  return selected;
}

// Only a value `produce` returns is stored: when it throws, the error
// propagates and the next call tries again, so a failed fetch is never
// cached as an empty result. An unreachable cache is logged and bypassed;
// the caller still gets real data, only slower.
export async function cached<T>(
  key: string,
  ttlSeconds: number | undefined,
  produce: () => Promise<T>,
  backend: CacheBackend = getCache(),
): Promise<T> {
  let hit: unknown;
  try {
    hit = await backend.get(key);
  } catch (err) {
    console.error(`[cache] read failed for ${key}:`, err);
  }
  if (hit !== undefined) return hit as T;
  const value = await produce();
  try {
    await backend.set(key, value, ttlSeconds);
  } catch (err) {
    console.error(`[cache] write failed for ${key}:`, err);
  }
  return value;
}
