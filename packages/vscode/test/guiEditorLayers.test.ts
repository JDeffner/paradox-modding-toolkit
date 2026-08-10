/**
 * The pure arithmetic the layers panel and the group tools run on: which rows a
 * container has, which of them a reorder can move, the index the op is actually
 * given, what align and distribute move each member by, and what the palette
 * offers.
 *
 * A reorder op counts the container's SOURCE children, declarations included;
 * the panel counts the rows a user can see. Those two numbers differ by one per
 * `blockoverride` / `block` / `template` sitting between the widgets, which is
 * the whole reason `srcIndex` exists, so the translation between them is worth
 * asserting without a mouse.
 */
import { describe, expect, it } from "vitest";
import type { GuiLayoutNode, GuiVocabularyEntry } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { buildScene } from "../src/webviews/guiEditor/app/scene";
import { boxAxis, dropRank, layerRows, reorderTo } from "../src/webviews/guiEditor/app/layers";
import { alignDeltas, distributeDeltas } from "../src/webviews/guiEditor/app/align";
import { containerRows, paletteLabel, paletteRows } from "../src/webviews/guiEditor/app/palette";

function child(name: string, extra: Partial<GuiLayoutNode> = {}): GuiLayoutNode {
  return {
    key: "widget",
    name,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    clip: false,
    positioned: true,
    editable: true,
    line: 1,
    children: [],
    ...extra,
  };
}

function root(children: GuiLayoutNode[]): GuiLayoutNode {
  return {
    key: "widget",
    name: "root",
    rect: { x: 0, y: 0, w: 100, h: 100 },
    clip: false,
    positioned: true,
    editable: true,
    line: 0,
    srcIndex: 0,
    children,
  };
}

describe("a row is movable only when the server gave it an index", () => {
  it("carries the server's srcIndex and ranks only the rows that have one", () => {
    const scene = buildScene([
      root([
        child("a", { srcIndex: 0 }),
        // Spliced from a type: a source line it does not own, and no index.
        child("spliced", { editable: false }),
        child("b", { srcIndex: 2 }),
      ]),
    ]);
    const rows = layerRows(scene, 0);
    expect(rows.map((r) => [r.name, r.source, r.rank, r.synthetic])).toEqual([
      ["a", 0, 0, false],
      ["spliced", -1, -1, true],
      ["b", 2, 1, false],
    ]);
  });

  it("a child with a line but no index is listed and cannot be moved", () => {
    // A named slot's contents and a scrollarea's adopted children: editable, so
    // not synthetic, but no index of theirs names a slot in the drawn parent.
    const scene = buildScene([root([child("a", { srcIndex: 0 }), child("slotted")])]);
    const rows = layerRows(scene, 0);
    expect(rows[1].synthetic).toBe(false);
    expect(rows[1].source).toBe(-1);
    expect(rows[1].rank).toBe(-1);
  });
});

describe("a dropped rank becomes the op's index", () => {
  it("is the rank itself when nothing else shares the body", () => {
    const sources = [0, 1, 2];
    expect(reorderTo(sources, 0, 2)).toBe(2);
    expect(reorderTo(sources, 2, 0)).toBe(0);
    expect(reorderTo(sources, 1, 0)).toBe(0);
  });

  it("steps over the declarations between the widgets", () => {
    // Source children: [W0, decl, W1, decl, W2] -> the widgets are 0, 2, 4.
    const sources = [0, 2, 4];
    // W2 to the front lands immediately before W0, so the declarations stay
    // where they are and the op index is W0's own.
    expect(reorderTo(sources, 2, 0)).toBe(0);
    // W0 to the middle lands immediately before W2, which has shifted down one
    // now that W0's block is out.
    expect(reorderTo(sources, 0, 1)).toBe(3);
    // W0 to the end lands directly after W2, not after a trailing declaration.
    expect(reorderTo(sources, 0, 2)).toBe(4);
  });

  it("a drop on the widget's own rank is the index it already has", () => {
    // The shell never sends this (the drop is compared to `from` first), and
    // the op it would produce has to be the no-op the writer refuses: hopping
    // the block over the neighbouring declaration would change the file
    // without changing any order a user can see.
    expect(reorderTo([0, 2, 4], 1, 1)).toBe(2);
    expect(reorderTo([0, 2, 4], 2, 2)).toBe(4);
  });
});

describe("the container's own axis and the rank a pointer drops on", () => {
  const rects = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 0, y: 20, w: 10, h: 10 },
    { x: 0, y: 40, w: 10, h: 10 },
  ];

  it("reads the axis off the children, not off the container's key", () => {
    expect(boxAxis(rects)).toBe("y");
    expect(boxAxis(rects.map((r) => ({ ...r, x: r.y, y: r.x })))).toBe("x");
  });

  it("counts the other children the pointer has passed the centre of", () => {
    expect(dropRank(rects, 0, "y", 0)).toBe(0);
    expect(dropRank(rects, 0, "y", 30)).toBe(1);
    expect(dropRank(rects, 0, "y", 100)).toBe(2);
  });
});

describe("over the real engine", () => {
  it("a blockoverride between two children shifts the index the panel sends", () => {
    const text = [
      "widget = {",
      '\tname = "px_layers_root"',
      "\tsize = { 300 200 }",
      '\twidget = { name = "px_layers_a" size = { 10 10 } }',
      '\tblockoverride "px_slot" {}',
      '\twidget = { name = "px_layers_b" size = { 10 10 } }',
      "}",
      "",
    ].join("\n");
    const scene = buildScene(computeGuiLayoutResult(text, null, null).nodes);
    const rows = layerRows(scene, 0);
    expect(rows.map((r) => r.source)).toEqual([0, 2]);
    // Moving the first past the second is a move to source index 2, which the
    // old rank counting would have called 1 and landed above the blockoverride.
    expect(
      reorderTo(
        rows.map((r) => r.source),
        0,
        1
      )
    ).toBe(2);
  });
});

// ── What the group tools compute ────────────────────────────────────────────

describe("align moves each member onto the selection's own bounding box", () => {
  const rects = [
    { x: 10, y: 10, w: 40, h: 40 },
    { x: 100, y: 30, w: 60, h: 20 },
    { x: 200, y: 90, w: 40, h: 40 },
  ];

  it("lines edges and centres up, as DELTAS and never as coordinates", () => {
    // Deltas, because a rect is the engine's answer to anchors and parent
    // boxes: writing the coordinate back would write that whole chain into
    // `position` (gesture.ts's rule, and align obeys it too).
    // The box is x 10..240, y 10..130: left and top are the minima, right and
    // bottom the maxima, and each member moves by its own distance to them.
    expect(alignDeltas(rects, "left").map((d) => d.dx)).toEqual([0, -90, -190]);
    expect(alignDeltas(rects, "right").map((d) => d.dx)).toEqual([190, 80, 0]);
    expect(alignDeltas(rects, "top").map((d) => d.dy)).toEqual([0, -20, -80]);
    expect(alignDeltas(rects, "bottom").map((d) => d.dy)).toEqual([80, 80, 0]);
    // The box spans 10..240 horizontally, centre 125.
    expect(alignDeltas(rects, "hcenter").map((d) => d.dx)).toEqual([95, -5, -95]);
  });

  it("moves nothing on one axis while it aligns the other", () => {
    expect(alignDeltas(rects, "left").every((d) => d.dy === 0)).toBe(true);
    expect(alignDeltas(rects, "top").every((d) => d.dx === 0)).toBe(true);
  });

  it("has nothing to do with fewer than two members", () => {
    expect(alignDeltas([rects[0]], "left")).toEqual([{ dx: 0, dy: 0 }]);
  });
});

describe("distribute leaves equal gaps", () => {
  it("spreads the middle members and leaves the outermost where they are", () => {
    // Tops at 10, 30 and 90, sizes 40: the span is 10..130, which holds three
    // 40s exactly, so the gaps come out 0 and the middle one lands at 50.
    const rects = [
      { x: 0, y: 10, w: 10, h: 40 },
      { x: 0, y: 30, w: 10, h: 40 },
      { x: 0, y: 90, w: 10, h: 40 },
    ];
    expect(distributeDeltas(rects, "y").map((d) => d.dy)).toEqual([0, 20, 0]);
  });

  it("reads the order off the axis, not off the selection order", () => {
    const rects = [
      { x: 200, y: 0, w: 20, h: 10 },
      { x: 0, y: 0, w: 20, h: 10 },
      { x: 90, y: 0, w: 20, h: 10 },
    ];
    // Left to right: 0, 90, 200. The span is 0..220, three 20s leave 160 for
    // two gaps, so the middle one goes to 20 + 80 = 100.
    expect(distributeDeltas(rects, "x").map((d) => d.dx)).toEqual([0, 0, 10]);
  });

  it("has no gap to equalise with fewer than three members", () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 0, w: 10, h: 10 },
    ];
    expect(distributeDeltas(rects, "x")).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });
});

describe("the palette shows what can actually be written", () => {
  const entries: GuiVocabularyEntry[] = [
    { name: "px_card", kind: "type", local: true, base: "widget", container: true },
    { name: "PxDeco", kind: "template", local: true },
    { name: "hbox", kind: "builtin", count: 3860, container: true },
    { name: "vbox", kind: "builtin", count: 3282, container: true },
    { name: "hbox_sort_ledger", kind: "builtin", count: 77, container: true },
    { name: "spacer", kind: "builtin", count: 127, container: false },
  ];

  it("leaves templates out: a template is applied with `using`, not declared", () => {
    expect(paletteRows(entries, "").map((e) => e.name)).toEqual([
      "px_card",
      "hbox",
      "vbox",
      "hbox_sort_ledger",
      "spacer",
    ]);
  });

  it("puts prefix matches before interior ones and keeps the host's order", () => {
    expect(paletteRows(entries, "hbox").map((e) => e.name)).toEqual(["hbox", "hbox_sort_ledger"]);
    expect(paletteRows(entries, "sort").map((e) => e.name)).toEqual(["hbox_sort_ledger"]);
    expect(paletteRows(entries, "nothing")).toEqual([]);
  });

  it("offers containers and the document's own types for a wrap", () => {
    expect(containerRows(entries).map((e) => e.name)).toEqual([
      "px_card",
      "hbox",
      "vbox",
      "hbox_sort_ledger",
    ]);
  });

  it("labels a local declaration so it cannot be mistaken for a vanilla one", () => {
    expect(paletteLabel(entries[0])).toBe("px_card (this file, a widget)");
    expect(paletteLabel(entries[2])).toBe("hbox");
  });
});
