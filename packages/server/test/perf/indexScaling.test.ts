/**
 * Where does a request's time go on a BIG index? (perf round 2)
 *
 * The §A3 bench measures the whole server; this one isolates the data
 * structure, so a fix can be judged in seconds instead of the 9-minute
 * recipe-2 run. It builds a DefinitionIndex at field scale and times the
 * primitives the request path actually calls.
 *
 * Gated on PX_PERF_SCALING=1: it allocates well over a gigabyte.
 *   PX_PERF_SCALING=1 npx vitest run packages/server/test/perf/indexScaling.test.ts
 */
import { describe, expect, it } from "vitest";
import { DefinitionIndex } from "../../src/index/indexer";
import type { Definition, DefSource } from "@px-lsp/protocol/types";

const RUN = process.env.PX_PERF_SCALING === "1";

/**
 * A synthetic index shaped like the field one: recipe 2 measures 1.36M
 * definitions, and a mod/parent copy of a vanilla file gives many names more
 * than one definition (that is what shadow resolution exists for).
 */
function buildIndex(defCount: number): { index: DefinitionIndex; names: string[] } {
  const index = new DefinitionIndex();
  const kinds = [
    "loc_key",
    "event",
    "trait",
    "scripted_effect",
    "scripted_trigger",
    "decision",
    "culture",
    "scripted_list",
  ];
  const sources: DefSource[] = ["vanilla", "parent", "mod"];
  const names: string[] = [];
  const batch: Definition[] = [];
  for (let i = 0; i < defCount; i++) {
    // Every 5th definition re-uses an earlier name (the shadowing case).
    const nameIdx = i % 5 === 0 && names.length > 0 ? i % names.length : names.length;
    const name = names[nameIdx] ?? `def_name_${i}`;
    if (nameIdx === names.length) names.push(name);
    batch.push({
      name,
      kind: kinds[i % kinds.length],
      file: `C:/root${i % 40}/common/file${i % 900}.txt`,
      line: i % 500,
      source: sources[i % 3],
    });
    if (batch.length >= 50_000) {
      index.addAll(batch);
      batch.length = 0;
    }
  }
  if (batch.length > 0) index.addAll(batch);
  return { index, names };
}

function time(label: string, fn: () => number): { label: string; ms: number; produced: number } {
  const t0 = performance.now();
  const produced = fn();
  const ms = performance.now() - t0;
  return { label, ms: Math.round(ms), produced };
}

describe.skipIf(!RUN)("index scaling (PX_PERF_SCALING=1)", () => {
  it(
    "times the primitives a completion request calls on a field-scale index",
    { timeout: 15 * 60_000 },
    () => {
      const DEFS = 1_400_000;
      const t0 = performance.now();
      const { index, names } = buildIndex(DEFS);
      const buildMs = Math.round(performance.now() - t0);
      const stats = index.stats();
      console.log(`built ${stats.total} definitions over ${names.length} distinct names in ${buildMs}ms`);

      const rows: Array<{ label: string; ms: number; produced: number }> = [];

      // What itemsFor() does: entries() with a kind filter, several times.
      rows.push(
        time("entries(scripted_list) — one call", () => {
          let n = 0;
          for (const _ of index.entries((d) => d.kind === "scripted_list")) n++;
          return n;
        })
      );
      rows.push(
        time("entries(scripted_effect|trigger|modifier) — one call", () => {
          let n = 0;
          for (const _ of index.entries(
            (d) =>
              d.kind === "scripted_effect" || d.kind === "scripted_trigger" || d.kind === "scripted_modifier"
          ))
            n++;
          return n;
        })
      );
      rows.push(
        time("entries(loc_key, mod only) — one call", () => {
          let n = 0;
          for (const _ of index.entries((d) => d.kind === "loc_key" && d.source === "mod")) n++;
          return n;
        })
      );
      // §B2's tracked-kind fast path, for comparison: same answer, only the
      // names that carry one are visited.
      rows.push(
        time("scriptedLists() — the §B2 tracked-name path", () => {
          let n = 0;
          for (const _ of index.scriptedLists()) n++;
          return n;
        })
      );
      // The pure lookup path, which is NOT a full walk.
      rows.push(
        time("lookup() x 10,000", () => {
          let n = 0;
          for (let i = 0; i < 10_000; i++) n += index.lookup(names[i % names.length]).length;
          return n;
        })
      );

      for (const r of rows)
        console.log(`  ${r.label.padEnd(52)} ${String(r.ms).padStart(7)} ms  → ${r.produced} items`);

      // A completion request calls entries() SEVEN times (completion.ts).
      const oneWalk = rows[1].ms;
      console.log(`\n  7 entries() walks (one completion request) ≈ ${oneWalk * 7} ms`);

      expect(stats.total).toBe(DEFS);
    }
  );
});
