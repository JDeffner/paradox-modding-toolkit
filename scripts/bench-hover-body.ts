/**
 * Hover cost bench for the definition-body slot.
 *
 * The hover used to do no file I/O at all. Showing a scripted trigger's source
 * means reading its file back, so this measures what that costs and whether the
 * cache earns its keep. Three cases, all against real vanilla files:
 *
 *   cold   every definition in a different file, cache always missing
 *   warm   the same definition repeatedly, which is what a real hover does
 *          (a hover re-fires on every mouse move inside the same word)
 *   spread a realistic mix: 32 files round-robin, i.e. the cache's own size
 *
 * Run: npx esbuild scripts/bench-hover-body.ts --bundle --platform=node \
 *        --outfile=dist/bench-hover-body.cjs && node dist/bench-hover-body.cjs
 */
import * as fs from "fs";
import * as path from "path";
import { clearDefinitionBodyCache, definitionBody } from "../packages/server/src/features/definitionBody";
import { requireDevPath } from "./devPaths";

const gamePath = process.argv[2] ?? requireDevPath("gamePath", "bench-hover-body");
const dir = path.join(gamePath, "common", "scripted_triggers");

/** Every `name = {` at column 0, i.e. what the index would have recorded. */
function definitions(): Array<{ file: string; line: number }> {
  const out: Array<{ file: string; line: number }> = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".txt"))) {
    const file = path.join(dir, f);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\{/.test(lines[i])) out.push({ file, line: i });
    }
  }
  return out;
}

function time(label: string, runs: number, fn: (i: number) => void): number {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn(i);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / runs;
  console.log(`${label.padEnd(34)} ${us.toFixed(1).padStart(8)} µs/hover`);
  return us;
}

const defs = definitions();
const files = [...new Set(defs.map((d) => d.file))];
console.log(`${defs.length} definitions across ${files.length} files in common/scripted_triggers`);
console.log();

// Cold: a fresh cache every call. The pathological case, never seen in practice.
const cold = time("cold (cache cleared each time)", 300, (i) => {
  clearDefinitionBodyCache();
  const d = defs[i % defs.length];
  definitionBody(d.file, d.line);
});

// Warm: the same definition over and over, which is what hovering one word does.
clearDefinitionBodyCache();
definitionBody(defs[0].file, defs[0].line);
const warm = time("warm (same definition)", 20000, () => {
  definitionBody(defs[0].file, defs[0].line);
});

// Spread: 32 distinct files round-robin, exactly the cache's capacity.
clearDefinitionBodyCache();
const spreadDefs = files.slice(0, 32).map((f) => defs.find((d) => d.file === f)!);
const spread = time("spread (32 files round-robin)", 5000, (i) => {
  const d = spreadDefs[i % spreadDefs.length];
  definitionBody(d.file, d.line);
});

const sizes = defs.map((d) => (definitionBody(d.file, d.line) ?? "").split("\n").length).sort((a, b) => a - b);
const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor((sizes.length * p) / 100))];
console.log();
console.log(`body lines  median=${pct(50)}  p90=${pct(90)}  max=${sizes[sizes.length - 1]}`);
console.log();
console.log(`cache speedup: ${(cold / warm).toFixed(0)}x warm, ${(cold / spread).toFixed(0)}x spread`);
console.log(
  warm < 50
    ? "VERDICT: warm hover cost is under 50 µs, i.e. invisible next to the LSP round trip."
    : "VERDICT: warm hover cost is NOT negligible; revisit the cache."
);
