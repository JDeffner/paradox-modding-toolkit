import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "path";
import { loadWikiTokens } from "../src/data/wikiDocs";
import { ServerData } from "../src/serverData";
import { CompletionFeature } from "../src/features/completion";
import { loadSchema } from "../src/schema/loader";
import { DefinitionIndex, scanRoot } from "../src/index/indexer";
import { devPath } from "../../../scripts/devPaths";

const GAME = devPath("gamePath");

/**
 * Performance budgets (rework plan Phase 6). The completion budget runs
 * everywhere (bundled wiki tokens, synthetic document); the cold-scan budget
 * needs the game and is gated on the configured gamePath (see devPaths.ts).
 */

function syntheticEventFile(events: number): string {
  const lines: string[] = ["namespace = bench"];
  for (let i = 1; i <= events; i++) {
    lines.push(
      `bench.${i} = {`,
      "\ttype = character_event",
      `\ttitle = bench.${i}.t`,
      "\timmediate = {",
      "\t\tevery_vassal = {",
      "\t\t\tlimit = { is_adult = yes }",
      "\t\t\tadd_gold = 5",
      "\t\t}",
      "\t}",
      "\toption = {",
      `\t\tname = bench.${i}.a`,
      "\t}",
      "}"
    );
  }
  return lines.join("\n");
}

describe("performance budgets", () => {
  it("completion p95 stays under 100ms on a 2000-line document", () => {
    const data = new ServerData();
    data.setTokens(loadWikiTokens(path.join(__dirname, "..", "data", "ck3", "wikidocs")));
    expect(data.tokens.length).toBeGreaterThan(500); // sanity: wiki data loaded
    const schema = loadSchema(null);
    const completion = new CompletionFeature(data, () => schema);

    const text = syntheticEventFile(160); // ~2000 lines
    const doc = TextDocument.create("file:///bench/events/bench.txt", "paradox", 1, text);
    const offset = text.indexOf("add_gold");

    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      const { items } = completion.provide(doc, offset, new Set(["character"]));
      samples.push(performance.now() - t0);
      expect(items.length).toBeGreaterThan(100);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];

    console.log(`completion p95: ${p95.toFixed(1)}ms (min ${samples[0].toFixed(1)}ms)`);
    expect(p95).toBeLessThan(100);
  });

  it.skipIf(!GAME)("cold vanilla scan stays under 60s", { timeout: 120_000 }, () => {
    const t0 = Date.now();
    const defs = scanRoot(GAME!, "vanilla", { locLanguage: "english" });
    const elapsed = Date.now() - t0;
    console.log(`cold scan: ${elapsed}ms, ${defs.length} definitions`);
    expect(elapsed).toBeLessThan(60_000);
    expect(defs.length).toBeGreaterThan(300_000);
  });

  /**
   * The index is the server's dominant allocation and it is unbounded by
   * design: every extra root (parentPaths, workspace mods) adds its whole
   * definition set. Measured at ~924 B per definition, i.e. ~408 MB retained
   * for a full vanilla scan, which is why the client raises the forked
   * server's heap ceiling (packages/vscode/src/serverHeap.ts).
   *
   * Budgeting the PER-DEFINITION cost rather than the total keeps this
   * meaningful across game patches: it fails when a field is added to
   * Definition or a string stops being shared, not when the game grows.
   */
  it.skipIf(!GAME)("index costs under 2.5 KB per definition", { timeout: 120_000 }, () => {
    // Needs the real collector on both sides of the measurement, otherwise the
    // delta is dominated by whatever the previous test left behind (see the
    // --expose-gc note in vitest.config.ts).
    expect(global.gc, "run vitest with --expose-gc").toBeTypeOf("function");
    global.gc!();
    const before = process.memoryUsage().heapUsed;

    const defs = scanRoot(GAME!, "vanilla", { locLanguage: "english" });
    const index = new DefinitionIndex();
    index.addAll(defs);

    global.gc!();
    const used = process.memoryUsage().heapUsed - before;
    const bytesPerDef = used / defs.length;
    console.log(
      `index memory: ${(used / 1024 / 1024).toFixed(0)} MB for ${defs.length} defs ` +
        `(${bytesPerDef.toFixed(0)} B/def)`
    );

    expect(index.stats().total).toBe(defs.length);
    // A non-positive reading means the measurement broke, not that the index is free.
    expect(bytesPerDef).toBeGreaterThan(200);
    expect(bytesPerDef).toBeLessThan(2560);
  });
});
