import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ComparisonError, type Backend } from "../agent/run.ts";
import type { CacheBackend } from "./cache/cache.ts";
import { runComparison, type CompareEvent } from "./compare.ts";
import { normalize } from "./normalize/normalize.ts";

const shared = vi.hoisted(() => ({ cache: undefined as unknown as CacheBackend, dir: "" }));

vi.mock("./cache/cache.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cache/cache.ts")>();
  shared.dir = fs.mkdtempSync(path.join(os.tmpdir(), "company-compare-run-"));
  shared.cache = actual.fsCache(shared.dir);
  return { ...actual, getCache: () => shared.cache };
});

vi.mock("./data.ts", () => {
  const facts = (ticker: string) => normalize(JSON.parse(fs.readFileSync(new URL(`./normalize/fixtures/${ticker}.json`, import.meta.url), "utf8")));
  return {
    findTicker: async (ticker: string) => ({ ticker, name: ticker, cik: ticker }),
    getFinancials: async (cik: string) => facts(cik),
    getAnnualReport: vi.fn(),
    getCondensedFiling: vi.fn(),
    condensedFilingKey: (accn: string) => accn,
  };
});

afterAll(() => fs.rmSync(shared.dir, { recursive: true, force: true }));

const takeaways = { items: ["Apple's fiscal year ends in September.", "Microsoft's ends in June.", "Both report R&D."] };
// A model that shows takeaways once `go` resolves, or fails then.
const model = (go: Promise<void> = Promise.resolve(), fail = false) =>
  vi.fn<Backend>(async (run) => {
    await go;
    if (fail) throw new ComparisonError("The model failed.");
    run.tools.find((t) => t.name === "takeaways")!.handle(takeaways);
    return { inputTokens: 1, outputTokens: 1 };
  });

const request = (pair: [string, string], backend: Backend, events: CompareEvent[]) =>
  runComparison({ tickers: pair, lens: "profitability", mode: "components", regenerate: false, signal: new AbortController().signal, emit: (e) => events.push(e), backend });

// Resolves once the second request has found the first one's claim.
async function secondIsWaiting(claim: ReturnType<typeof vi.spyOn>) {
  await vi.waitFor(async () => expect(await claim.mock.results[1]?.value).toBe(false));
}

describe("runComparison while the same comparison is running", () => {
  it("waits for the running request and shows its result, running the model once", async () => {
    const claim = vi.spyOn(shared.cache, "claim");
    let release!: () => void;
    const first = model(new Promise((resolve) => (release = resolve)));
    const second = model();
    const a: CompareEvent[] = [];
    const b: CompareEvent[] = [];
    const runA = request(["AAPL", "MSFT"], first, a);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    const runB = request(["AAPL", "MSFT"], second, b);
    await secondIsWaiting(claim);
    release();
    await Promise.all([runA, runB]);
    expect(second).not.toHaveBeenCalled();
    expect(a.at(-1)).toEqual({ type: "done", cached: false });
    expect(b.at(-1)).toEqual({ type: "done", cached: true });
    expect(b.filter((e) => e.type === "component")).toEqual(a.filter((e) => e.type === "component"));
    claim.mockRestore();
  });

  it("runs the model itself when the running request saves nothing", async () => {
    const claim = vi.spyOn(shared.cache, "claim");
    let release!: () => void;
    const first = model(
      new Promise((resolve) => (release = resolve)),
      true,
    );
    const second = model();
    const a: CompareEvent[] = [];
    const b: CompareEvent[] = [];
    const runA = request(["KO", "NVDA"], first, a);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    const runB = request(["KO", "NVDA"], second, b);
    await secondIsWaiting(claim);
    release();
    await Promise.all([runA, runB]);
    expect(a.at(-1)).toEqual({ type: "error", message: "The model failed." });
    expect(second).toHaveBeenCalledOnce();
    expect(b.at(-1)).toEqual({ type: "done", cached: false });
    claim.mockRestore();
  });
});
