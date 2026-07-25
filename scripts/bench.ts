/**
 * Performance bench (rework plan Phase 6 budgets, used from Phase 2 on):
 * cold full-breadth vanilla scan time, definition counts, and process RSS with
 * the index resident.
 *
 * Run: npx esbuild scripts/bench.ts --bundle --platform=node --outfile=dist/bench.cjs && node dist/bench.cjs <gamePath>
 */
import { DefinitionIndex, scanRoot } from "../packages/server/src/index/indexer";
import { requireDevPath } from "./devPaths";

const gamePath = process.argv[2] ?? requireDevPath("gamePath", "bench");

const t0 = Date.now();
const defs = scanRoot(gamePath, "vanilla", { locLanguage: "english" });
const scanMs = Date.now() - t0;

const index = new DefinitionIndex();
index.addAll(defs);
const stats = index.stats();

global.gc?.();
const rss = process.memoryUsage().rss;

console.log(`cold vanilla scan: ${scanMs} ms`);
console.log(`definitions: ${stats.total} across ${stats.files} files`);
console.log(`rss with index resident: ${(rss / 1024 / 1024).toFixed(0)} MB`);
const byKind = Object.entries(stats.byKind).sort((a, b) => b[1] - a[1]);
console.log(
  "top kinds:",
  byKind
    .slice(0, 12)
    .map(([k, n]) => `${k}=${n}`)
    .join(" ")
);
