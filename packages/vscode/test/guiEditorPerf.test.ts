/**
 * Perf budgets for the GUI editor's scene build (G3.4).
 *
 * The scene is rebuilt from scratch on every layout push, which is every 300 ms
 * while the user types in the .gui file, so it sits directly under the typing
 * loop. What is measured here is ONLY `buildScene`: the layout itself is the
 * server's cost and has its own budgets, and the canvas paint is a browser's.
 *
 * The budgets are recorded measurements with headroom, not aspirations. Numbers
 * in the comments were taken on the development machine (Windows 10, i7, under
 * interactive load) and are logged on every run, so a regression shows up as a
 * changed number long before it trips the assertion. Each case reports min /
 * median / p95 over its samples and asserts on the p95: a single scheduling
 * spike on a loaded machine must not fail a suite, a systematically slower
 * scene build must.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { devPath } from "../../../scripts/devPaths";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { computeGuiSourceEdit } from "../../server/src/gui/sourceEditService";
import { collectGuiDefs } from "../../server/src/gui/guiDefs";
import { applyAll } from "../../server/src/gui/sourceEdit";
import { buildScene } from "../src/webviews/guiEditor/app/scene";

interface Timing {
  min: number;
  median: number;
  p95: number;
}

/** Time `run` `samples` times and report the distribution, warm. */
function time(run: () => void, samples: number): Timing {
  for (let i = 0; i < 3; i++) run();
  const taken: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    run();
    taken.push(performance.now() - t0);
  }
  taken.sort((a, b) => a - b);
  return {
    min: taken[0],
    median: taken[Math.floor(taken.length / 2)],
    p95: taken[Math.min(taken.length - 1, Math.floor(taken.length * 0.95))],
  };
}

function report(label: string, count: number, t: Timing): void {
  const per = (t.median / count) * 1000;
  console.log(
    `${label}: ${count} widgets, min ${t.min.toFixed(2)}ms, median ${t.median.toFixed(2)}ms, ` +
      `p95 ${t.p95.toFixed(2)}ms (${per.toFixed(2)}µs/widget)`
  );
}

/**
 * A document at vanilla window scale. `window_character` expands to 13,702
 * widgets behind the vanilla template store, which is the biggest scene this
 * editor is expected to hold; the fixtures are two orders of magnitude smaller,
 * so the corpus alone cannot bound the case that matters.
 */
function syntheticWindow(widgets: number): string {
  const lines = ["window = {", '\tname = "px_bench_window"', "\tsize = { 1920 1080 }"];
  for (let i = 0; i < widgets; i++) {
    lines.push(
      "\tcontainer = {",
      `\t\tname = "px_bench_row_${i}"`,
      `\t\tposition = { 0 ${(i % 200) * 5} }`,
      "\t\ticon = {",
      `\t\t\tname = "px_bench_icon_${i}"`,
      "\t\t\tsize = { 24 24 }",
      '\t\t\ttexture = "gfx/interface/icons/bench.dds"',
      "\t\t}",
      "\t\ttext_single = {",
      `\t\t\tname = "px_bench_label_${i}"`,
      "\t\t\tposition = { 28 0 }",
      `\t\t\traw_text = "bench row ${i}"`,
      "\t\t}",
      "\t}"
    );
  }
  lines.push("}");
  return lines.join("\n");
}

describe("scene build budgets", () => {
  it("a vanilla-scale scene (13.7k widgets) builds inside the layout debounce", () => {
    // 4500 source widgets expand to ~13.5k nodes, window_character's scale.
    const result = computeGuiLayoutResult(syntheticWindow(4500), null, null);
    expect(result.nodeCount).toBeGreaterThan(13_000);
    const t = time(() => buildScene(result.nodes), 40);
    report("vanilla-scale scene", result.nodeCount, t);

    const scene = buildScene(result.nodes);
    expect(scene.count).toBe(result.nodeCount);

    // Measured: 13,501 widgets, median 1.40 ms, p95 3.89 ms (0.10 µs/widget).
    // The budget is 100 ms, a third of the 300 ms layout debounce, so the scene
    // build can never be what makes typing in a big .gui feel slow. The gap to
    // the measurement is deliberate: a garbage collection during a sample shows
    // up as a p95 of ~11 ms on this machine, and that is not a regression.
    expect(t.p95).toBeLessThan(100);
  });

  it.skipIf(!devPath("gamePath"))("window_character itself stays inside the same budget", () => {
    const gamePath = devPath("gamePath")!;
    const text = fs.readFileSync(path.join(gamePath, "gui", "window_character.gui"), "utf8");
    const result = computeGuiLayoutResult(text, gamePath, null);
    const t = time(() => buildScene(result.nodes), 20);
    report("window_character", result.nodeCount, t);

    // Measured: 13,702 widgets, median 1.93 ms, p95 11.00 ms. The synthetic
    // document above is calibrated against exactly this, and the real one is
    // checked whenever a game install is configured.
    expect(result.nodeCount).toBeGreaterThan(500);
    expect(t.p95).toBeLessThan(100);
  });
});

describe("the commit budget on the biggest real document", () => {
  /**
   * The smoke measures the nudge round trip end to end on a hand-sized
   * document (`guiEditorSmoke.test.ts`, ~3 ms). This measures the same path on
   * the biggest window the game ships, which is the case where it could
   * plausibly get slow: the host's half of a commit, with the cross-file
   * template store already warm the way a second edit finds it.
   */
  it.skipIf(!devPath("gamePath"))("a nudge in window_character stays inside the nudge budget", () => {
    const gamePath = devPath("gamePath")!;
    let text = fs.readFileSync(path.join(gamePath, "gui", "window_character.gui"), "utf8");
    const first = computeGuiLayoutResult(text, gamePath, null);

    // Any widget with a declaration of its own and a position to move.
    let line = -1;
    const stack = [...first.nodes];
    for (let node = stack.pop(); node; node = stack.pop()) {
      if (node.editable && node.line !== undefined && node.srcPosition) {
        line = node.line;
        break;
      }
      stack.push(...node.children);
    }
    expect(line).toBeGreaterThanOrEqual(0);

    const taken: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      const result = computeGuiSourceEdit(
        text,
        { kind: "setProperties", line, properties: [{ key: "position", value: `{ ${i} ${i} }` }] },
        collectGuiDefs(text)
      );
      expect(result?.edits?.length, result?.refused).toBeGreaterThan(0);
      text = applyAll(text, result!.edits!);
      buildScene(computeGuiLayoutResult(text, gamePath, null).nodes);
      taken.push(performance.now() - t0);
    }
    const sorted = [...taken].sort((a, b) => a - b);
    console.log(
      `window_character nudge (host half): ${taken.map((t) => t.toFixed(0)).join(", ")}ms, ` +
        `median ${sorted[Math.floor(sorted.length / 2)].toFixed(0)}ms`
    );

    // Measured over 5,650 lines and 13,702 widgets, split source edit ~15 ms,
    // layout ~50 ms, scene build ~4 ms:
    //   this file alone:      107, 93, 69, 69, 62, 68 ms (median 69)
    //   inside the full suite: 235, 225, 195, 223, 185, 202 ms (median 223)
    // The first is the one the ~150 ms feel target is judged against, and it
    // passes with room on the worst document the game ships. The second is what
    // this assertion has to survive: the repo suite runs one vitest worker per
    // core, and three times the wall clock for the same work is contention, not
    // a regression. Hence 400 ms, on the FASTEST sample: a path that genuinely
    // got slower moves the floor as much as it moves the median, and the logged
    // numbers above are where a change actually shows up.
    expect(sorted[0]).toBeLessThan(400);
  });
});
