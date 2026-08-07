import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "path";
import type { Definition, Reference } from "@px-lsp/protocol/types";
import { loadWikiTokens } from "../src/data/wikiDocs";
import { ServerData } from "../src/serverData";
import { CompletionFeature } from "../src/features/completion";
import { loadSchema } from "../src/schema/loader";
import { DefinitionIndex, scanRoot } from "../src/index/indexer";
import { ReferenceIndex } from "../src/index/references";
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

  /**
   * §B2: every save fires notifyIndexChanged (scripted lists -> scope model)
   * and a status notification (stats()). Both used to walk the whole index:
   * 127-157 ms per save on the 1.9M-definition recipe-1 workspace, of which
   * 61-74 ms was stats() alone. The property that matters is not the absolute
   * number but that it does not grow with the index, so the budget is on the
   * RATIO between a small and a 10x larger index (plus a generous absolute
   * ceiling, since a regression here reintroduces an O(N) walk).
   */
  it("the per-save index fan-out does not scale with the index", () => {
    const median = (fn: () => void): number => {
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        fn();
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length * 0.5)];
    };

    const loaded = (defCount: number): ServerData => {
      const data = new ServerData();
      const defs: Definition[] = [];
      for (let i = 0; i < defCount; i++) {
        defs.push({
          name: `def_${i}`,
          // Vanilla has ~50 scripted lists whatever the index size, so the
          // ratio below measures the walk and not the list count.
          kind: i < 50 ? "scripted_list" : "scripted_effect",
          file: `f${i % 4000}.txt`,
          line: i,
          source: "vanilla",
        });
      }
      data.index.addAll(defs);
      return data;
    };

    const fanOut = (data: ServerData) =>
      median(() => {
        data.notifyIndexChanged();
        data.index.stats();
      });

    const small = loaded(50_000);
    const large = loaded(500_000);
    const smallMs = fanOut(small);
    const largeMs = fanOut(large);
    // What the fan-out used to do on its scripted-list half: walk every name.
    const fullWalkMs = median(() => {
      for (const _ of large.index.entries((d) => d.kind === "scripted_list")) void _;
    });
    console.log(
      `index fan-out per save: ${smallMs.toFixed(2)}ms @50k defs, ${largeMs.toFixed(2)}ms @500k ` +
        `(the full-name walk it replaced: ${fullWalkMs.toFixed(2)}ms @500k)`
    );
    // 10x the index must not cost 4x the fan-out (before §B2 it cost ~10x).
    // The floor keeps a near-zero small sample from making the ratio explode.
    expect(largeMs).toBeLessThan(Math.max(4 * smallMs, 5));
    expect(largeMs).toBeLessThan(20);
    // Revert sensitivity: the whole fan-out must stay far under the single
    // full-index walk that used to be only one half of it.
    expect(largeMs).toBeLessThan(fullWalkMs / 4);
  });

  /**
   * §B2: after the fan-out was fixed, the entire remaining cost of a save on
   * the AGOT-sized workspace was ReferenceIndex.removeFile — 490-510 ms for a
   * small event file, because it rebuilt a name's whole reference list once per
   * OCCURRENCE in the file. A save must cost the size of the file, not the size
   * of the workspace.
   */
  it("dropping a file's references costs the same however often it names a token", () => {
    const HOT = 400_000; // the AGOT-sized workspace's usage count for a common token
    const ref = (file: string, line: number): Reference => ({
      name: "character_event",
      kinds: ["event"],
      file,
      line,
      startChar: 0,
      endChar: 15,
    });
    const removeMs = (occurrences: number): number => {
      const index = new ReferenceIndex();
      const bulk: Reference[] = [];
      for (let i = 0; i < HOT; i++) bulk.push(ref(`bulk${i % 4000}.txt`, i));
      index.addAll(bulk);
      const mine: Reference[] = [];
      for (let i = 0; i < occurrences; i++) mine.push(ref("mine.txt", i));
      index.addAll(mine);
      const t0 = performance.now();
      index.removeFile("mine.txt");
      const elapsed = performance.now() - t0;
      expect(index.lookup("character_event")).toHaveLength(HOT);
      return elapsed;
    };

    const once = removeMs(1);
    const often = removeMs(25); // one event file's worth of `type = character_event`
    console.log(`refIndex removeFile @${HOT} refs: ${once.toFixed(2)}ms x1, ${often.toFixed(2)}ms x25`);
    // One list rebuild per NAME, not per occurrence: 25 occurrences used to
    // cost 25 rebuilds of a six-figure array (490-510ms on the real workspace).
    expect(often).toBeLessThan(Math.max(3 * once, 5));
    expect(often).toBeLessThan(60);
  });
});
