import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import type { Definition, Reference } from "@px-lsp/protocol/types";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { loadWikiTokens } from "../src/data/wikiDocs";
import { ServerData } from "../src/serverData";
import { CompletionFeature } from "../src/features/completion";
import { loadSchema } from "../src/schema/loader";
import { DefinitionIndex, scanRoot } from "../src/index/indexer";
import { extractDefinitions } from "../src/index/extract";
import { resetInternTable } from "../src/index/intern";
import { extractReferences, ReferenceIndex } from "../src/index/references";
import { devPath } from "../../../scripts/devPaths";

const GAME = devPath("gamePath");
const CORPUS = devPath("corpusPath");
/** The recipe-2 memory measurement reads two whole trees; see perfBench.test.ts. */
const BENCH = process.env.PX_PERF_BENCH === "1";

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
   * definition set. Measured on a full vanilla scan (462,886 definitions):
   * 924 B each / 408 MB before §C2, 437 B each / 193 MB after, which is why
   * the client raises the forked server's heap ceiling
   * (packages/vscode/src/serverHeap.ts).
   *
   * Budgeting the PER-DEFINITION cost rather than the total keeps this
   * meaningful across game patches: it fails when a field is added to
   * Definition or a string stops being shared, not when the game grows.
   */
  it.skipIf(!GAME)("index costs under 600 B per definition", { timeout: 120_000 }, () => {
    // Needs the real collector on both sides of the measurement, otherwise the
    // delta is dominated by whatever the previous test left behind (see the
    // --expose-gc note in vitest.config.ts).
    expect(global.gc, "run vitest with --expose-gc").toBeTypeOf("function");
    // The shared-identifier table is part of what an index costs, and another
    // test in this file may have filled it already (§C2).
    resetInternTable();
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
    expect(bytesPerDef).toBeGreaterThan(100);
    expect(bytesPerDef).toBeLessThan(600);
  });

  /**
   * §C2, the reason the number above fell by half: the parser hands out
   * `content.slice(start, end)` for every key, and V8 stores a substring of 13+
   * characters as a SlicedString that keeps its PARENT alive. One indexed
   * definition therefore pinned the whole file's text, so the index retained a
   * second copy of every tree it scanned (241 MB of the vanilla scan's 408 MB).
   *
   * Always on and synthetic: the filler dwarfs what 2000 definitions can
   * legitimately cost, so a revert fails this by a factor of ten.
   */
  it("an indexed definition does not retain the file it came from", () => {
    expect(global.gc, "run vitest with --expose-gc").toBeTypeOf("function");
    const FILES = 8;
    const FILLER = 8 * 1024 * 1024;
    const extract = (n: number): Definition[] => {
      const lines: string[] = [];
      for (let i = 0; i < 2000; i++) {
        lines.push(`some_long_scripted_effect_name_${i} = { add_gold = 1 }`);
      }
      lines.push("#" + "x".repeat(FILLER)); // never read: it is here to be retained
      return extractDefinitions(
        lines.join("\n"),
        { path: "common/scripted_effects", kind: "scripted_effect" },
        `F:/mod/common/scripted_effects/bench${n}.txt`,
        "mod"
      );
    };

    // Measured as the difference the kept definitions THEMSELVES make (heap
    // with them minus heap after dropping them), because an absolute before/
    // after reading here is dominated by the previous test freeing its index.
    // A cold first call also leaves V8 statics behind, so warm up first.
    expect(extract(0)).toHaveLength(2000);
    let kept: Definition[][] | null = [];
    for (let n = 0; n < FILES; n++) kept.push(extract(n)); // the contents die here
    /^a$/.exec("a"); // V8 holds the last regexp match's SUBJECT: let go of it
    expect(kept).toHaveLength(FILES);
    expect(kept[7][1999].name).toBe("some_long_scripted_effect_name_1999");
    global.gc!();
    global.gc!();
    const withDefs = process.memoryUsage().heapUsed;
    kept = null;
    global.gc!();
    global.gc!();
    const retained = withDefs - process.memoryUsage().heapUsed;

    const total = FILES * FILLER;
    console.log(
      `${FILES} x 2000 defs out of ${(total / 1048576).toFixed(0)} MB of files retain ` +
        `${(retained / 1048576).toFixed(1)} MB`
    );
    // Measured 1.9 MB shared; 64 MB when the names are the parser's own slices.
    expect(retained).toBeLessThan(total / 4);
  });

  /**
   * §C1: the workspace the field reports describe, measured as retained heap in
   * ONE process: the game plus the AGOT corpus twice ("game + AGOT + a second
   * AGOT copy"). The second root is the same tree read again, which is what a
   * duplicated mod costs the index bar its path strings.
   *
   * PER WINDOW: every VS Code window forks its own server (one server per
   * window stays, see docs/perf-campaign.md), so k windows cost k x this, and
   * the client's heap ceiling is per server too (serverHeap.ts, 4096 MB on a
   * 16 GB+ box). The forked server measured 1461 MB heap / 1926 MB RSS on this
   * workspace (perf/baseline.json), so four windows fill an 8 GB machine and
   * the field's 30-window report needs ~58 GB. The escape hatch is
   * px.excludedMods, which §C3 names on activation.
   *
   * Heavy (reads both trees): gated like perfBench, PX_PERF_BENCH=1.
   */
  it.skipIf(!BENCH || !GAME || !CORPUS)(
    "recipe 2 (game + AGOT + AGOT copy) retains under 2 GB",
    { timeout: 600_000 },
    () => {
      expect(global.gc, "run vitest with --expose-gc").toBeTypeOf("function");
      const data = new ServerData();
      data.setTokens(loadWikiTokens(path.join(__dirname, "..", "data", "ck3", "wikidocs")));
      const schema = loadSchema([CORPUS!]);
      const isEngineToken = (name: string) => data.tokenMap.has(name);

      resetInternTable();
      global.gc!();
      const before = process.memoryUsage().heapUsed;
      const index = new DefinitionIndex();
      const refIndex = new ReferenceIndex();
      index.addAll(scanRoot(GAME!, "vanilla", { locLanguage: "english" }));
      let refs = 0;
      for (let root = 0; root < 2; root++) {
        index.addAll(scanRoot(CORPUS!, "mod", { locLanguage: "english" }));
        for (const file of listFiles(CORPUS!, ".txt")) {
          const content = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
          const extracted = extractReferences(content, file, "mod", schema, isEngineToken);
          refIndex.addAll(extracted.references);
          index.addAll(extracted.implicitDefs);
          refs += extracted.references.length;
        }
      }
      global.gc!();
      const used = process.memoryUsage().heapUsed - before;

      const defs = index.stats().total;
      console.log(
        `recipe 2 in one process: ${defs} definitions + ${refs} references retain ` +
          `${(used / 1048576).toFixed(0)} MB post-GC (${(used / defs).toFixed(0)} B/def)`
      );
      expect(defs).toBeGreaterThan(1_000_000);
      expect(refs).toBeGreaterThan(8_000_000);
      // Recorded with headroom, measured 2026-08-07: 1412 MB, and 3153 MB with
      // §C2 reverted (which is also what the forked server reported before it,
      // so this in-process stand-in tracks the real thing).
      expect(used / 1048576).toBeLessThan(2048);
    }
  );

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
