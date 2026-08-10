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
 * The budgets are the measured numbers with headroom (G3.4 discipline), and
 * §D re-ran both recipes on the final tree to set them.
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
 * Recorded-with-headroom budgets over the numbers in baseline.json (§D re-run,
 * 2026-08-07, Ryzen 7 5800X / 32 GB / NVMe, warm file cache). The headroom is
 * wide on purpose: wall clock here moves with interactive load, and the
 * during-indexing completion p95 of recipe 2 is a starved request measured in
 * tens of seconds. A phase that improves a number lowers its budget here in
 * the same commit.
 *
 *                            §D measured   budget   §A (0.3.0 behaviour)
 *  r1 time-to-indexed             21.2s       90s   21.5s
 *  r1 save p50 / p95           6 / 13ms  60/100ms   144 / 183ms
 *  r1 heap (post-gc)             383MB     600MB    1392MB
 *  r1 rss                       1151MB    1800MB    2245MB
 *  r1 completion p95 indexing    1190ms        5s   1089ms
 *  r1 refreshes: indexing / save   2 / 2    4 / 2   16 / 2
 *  r2 time-to-indexed            546.8s      15min  580.7s
 *  r2 save p50 / p95          24 / 42ms 150/400ms   731 / 1275ms
 *  r2 heap (post-gc)            1461MB    2000MB    3161MB (client cap 4096)
 *  r2 rss                       2193MB    2800MB    3804MB
 *  r2 completion p95 indexing     78.9s      180s   89.6s
 *  r2 refreshes: indexing / save   2 / 2    4 / 2   10 / 2
 *
 * Run-to-run spread on this machine, over the recorded §B/§C/§D runs (rss from
 * the §C/§D ones, since §C is what moved it): recipe 1 rss 1024-1151 MB and
 * time-to-indexed 17.7-21.2 s, recipe 2 rss 1926-2193 MB, time-to-indexed
 * 451-547 s and completion p95 79-81 s. The wall-clock budgets are set well
 * outside that spread, the memory ones a third to a half above it.
 *
 * What did NOT improve, deliberately budgeted loose rather than tightened: the
 * during-indexing completion p95, which is one completion request on a 1.36M
 * definition index and belongs to the ranking/inference modules this campaign
 * was scoped out of. It is also the whole story of recipe 2's time-to-indexed
 * (in the §C trace, 7 completions served between scan batches account for 304 s
 * of the second AGOT root's 319 s reference-scan window, which itself measures
 * 31 s when nothing interrupts it).
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
    saveP50: 60,
    saveP95: 100,
    heapMb: 600,
    rssMb: 1800,
    completionP95: 5_000,
    refreshesWhileIndexing: 4,
  },
  "recipe2-game-plus-agot-x2": {
    timeToIndexedMs: 900_000,
    saveP50: 150,
    saveP95: 400,
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
      // §B4: one save = one fan-out = one semanticTokens + one inlayHint
      // refresh, whatever the index size (it was the same 2 before, and the
      // debounce that guarantees it is what §B3 leans on).
      expect(m.refreshes.perSave, `${name} refreshes per save`).toBeLessThanOrEqual(2);
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
