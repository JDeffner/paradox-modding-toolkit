/**
 * Perf bench (perf campaign §A3): the two field recipes, measured headlessly
 * against the packaged server. The heavy runs take many minutes and read the
 * whole game tree plus the AGOT corpus, so they are gated on PX_PERF_BENCH=1
 * (on top of the usual dev-paths gate) and never run in `pnpm test`. What runs
 * everywhere is the cheap check below: the recorded numbers in
 * `test/perf/baseline.json` must stay inside their budgets.
 *
 * Record (Git Bash, after `pnpm run compile`):
 *   PX_PERF_BENCH=1 npx vitest run packages/server/test/perfBench.test.ts
 *
 * The budgets are the measured numbers with headroom (G3.4 discipline). They
 * are deliberately BAD numbers right now: Phase A only makes the symptoms
 * visible, and Phase D tightens each one to what the fixes achieve.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { devPath } from "../../../scripts/devPaths";
import {
  machineStamp,
  recipeMountedVanilla,
  recipeTwoCorpora,
  runRecipe,
  type BenchMetrics,
} from "./perf/benchHarness";

const BASELINE = path.join(__dirname, "perf", "baseline.json");
const SERVER_BUNDLE = path.join(__dirname, "..", "dist", "server.js");
const BENCH = process.env.PX_PERF_BENCH === "1";
const GAME = devPath("gamePath");
const CORPUS = devPath("corpusPath");

interface BaselineFile {
  recordedAt: string;
  machine: Record<string, string | number>;
  note: string;
  recipes: Record<string, BenchMetrics>;
}

function readBaseline(): BaselineFile {
  return JSON.parse(fs.readFileSync(BASELINE, "utf8")) as BaselineFile;
}

/** PX_PERF_TRACE_DIR: keep each run's full `perf …` timeline for reading. */
function traceSink(name: string): ((line: string) => void) | undefined {
  const dir = process.env.PX_PERF_TRACE_DIR;
  if (!dir) return undefined;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  fs.writeFileSync(file, "");
  return (line) => fs.appendFileSync(file, line + "\n");
}

function record(metrics: BenchMetrics): void {
  const existing: BaselineFile = fs.existsSync(BASELINE)
    ? readBaseline()
    : { recordedAt: "", machine: {}, note: "", recipes: {} };
  existing.recordedAt = new Date().toISOString().slice(0, 10);
  existing.machine = machineStamp();
  existing.note =
    "Recorded by `PX_PERF_BENCH=1 npx vitest run packages/server/test/perfBench.test.ts`. " +
    "Extra roots are directory junctions, not copies; the edited file is always a synthetic mod. " +
    "Wall clock varies with disk cache and interactive load, so the budgets carry headroom.";
  existing.recipes[metrics.recipe] = metrics;
  fs.writeFileSync(BASELINE, JSON.stringify(existing, null, 2) + "\n", "utf8");
  console.log(`${metrics.recipe}: ${JSON.stringify(metrics, null, 2)}`);
}

/**
 * Recorded-with-headroom budgets over the numbers in baseline.json (measured
 * 2026-08-07 on a Ryzen 7 5800X / 32 GB / NVMe, warm file cache). The headroom
 * is wide on purpose: wall clock here moves with interactive load, and the
 * during-indexing completion p95 of recipe 2 is a starved request measured in
 * tens of seconds. A phase that improves a number lowers its budget here in
 * the same commit.
 *
 *                              measured    budget   was (before §C)
 *  r1 time-to-indexed             20.5s       90s   17.7s
 *  r1 save p50 / p95          11 / 12ms 100/150ms   13 / 15ms
 *  r1 heap (post-gc)             383MB     600MB    1391MB
 *  r1 rss                       1024MB    1800MB    2194MB
 *  r1 completion p95 indexing    1459ms        5s   1281ms
 *  r1 refreshes while indexing        2         4   2
 *  r2 time-to-indexed            450.7s      15min  534.0s
 *  r2 save p50 / p95          33 / 42ms 300/1000ms  27 / 43ms
 *  r2 heap (post-gc)            1461MB    2000MB    3160MB (client cap 4096)
 *  r2 rss                       1926MB    2800MB    3865MB
 *  r2 completion p95 indexing     79.3s      180s   81.1s
 *  r2 refreshes while indexing        2         4   2
 *
 * §C2 (string sharing) is what moved heap and rss; nothing in §C touched the
 * during-indexing completion p95, and that is now the whole story of recipe 2's
 * time-to-indexed: 7 completion requests served between scan batches ate 304 s
 * of the 319 s that the second AGOT root's reference scan appears to take.
 */
const BUDGETS: Record<
  string,
  {
    timeToIndexedMs: number;
    saveP50: number;
    saveP95: number;
    heapMb: number;
    rssMb: number;
    completionP95: number;
    refreshesWhileIndexing: number;
  }
> = {
  "recipe1-vanilla-x3-plus-20-mods": {
    timeToIndexedMs: 90_000,
    saveP50: 100,
    saveP95: 150,
    heapMb: 600,
    rssMb: 1800,
    completionP95: 5_000,
    refreshesWhileIndexing: 4,
  },
  "recipe2-game-plus-agot-x2": {
    timeToIndexedMs: 900_000,
    saveP50: 300,
    saveP95: 1_000,
    heapMb: 2000,
    rssMb: 2800,
    completionP95: 180_000,
    refreshesWhileIndexing: 4,
  },
};

describe("perf bench baseline (§A3)", () => {
  it("the recorded numbers exist and stay inside their budgets", () => {
    const baseline = readBaseline();
    const names = Object.keys(BUDGETS);
    expect(Object.keys(baseline.recipes).sort()).toEqual(names.sort());
    for (const name of names) {
      const m = baseline.recipes[name];
      const budget = BUDGETS[name];
      expect(m.definitions, `${name} definitions`).toBeGreaterThan(100_000);
      expect(m.timeToIndexedMs, `${name} time-to-indexed`).toBeLessThan(budget.timeToIndexedMs);
      expect(m.saveRoundTripMs.p50, `${name} save p50`).toBeLessThan(budget.saveP50);
      expect(m.saveRoundTripMs.p95, `${name} save p95`).toBeLessThan(budget.saveP95);
      // §B4: the only global refresh a build may ask for is its final one
      // (semanticTokens + inlayHint = 2 requests).
      expect(m.refreshes.indexing, `${name} refreshes while indexing`).toBeLessThanOrEqual(
        budget.refreshesWhileIndexing
      );
      expect(m.duringIndexing.samples, `${name} probe samples`).toBeGreaterThan(5);
      expect(m.duringIndexing.completionP95, `${name} completion p95 while indexing`).toBeLessThan(
        budget.completionP95
      );
      expect(m.indexHeapMb, `${name} heap`).not.toBeNull();
      expect(m.indexHeapMb!, `${name} heap`).toBeLessThan(budget.heapMb);
      // §C1: RSS is what k windows multiply, so it carries its own budget.
      expect(m.indexRssMb, `${name} rss`).not.toBeNull();
      expect(m.indexRssMb!, `${name} rss`).toBeLessThan(budget.rssMb);
      // A run that killed the server is a finding, not a baseline.
      expect(m.serverExit, `${name} server exit`).toBeUndefined();
    }
  });
});

describe.skipIf(!BENCH)("perf bench runs (PX_PERF_BENCH=1)", () => {
  it("the packaged bundle is built", () => {
    expect(fs.existsSync(SERVER_BUNDLE), "run `pnpm run compile` first").toBe(true);
  });

  it.skipIf(!GAME)("recipe 1: the game mounted 3x plus 20 small mods", { timeout: 30 * 60_000 }, async () => {
    const recipe = recipeMountedVanilla(GAME!);
    try {
      record(await runRecipe(recipe, { onLog: traceSink(recipe.name) }));
    } finally {
      recipe.dispose();
    }
  });

  it.skipIf(!GAME || !CORPUS)(
    "recipe 2: the game plus the AGOT corpus twice",
    { timeout: 30 * 60_000 },
    async () => {
      const recipe = recipeTwoCorpora(GAME!, CORPUS!);
      try {
        record(await runRecipe(recipe, { onLog: traceSink(recipe.name) }));
      } finally {
        recipe.dispose();
      }
    }
  );
});
