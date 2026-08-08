/**
 * The layers panel's pure arithmetic: which rows a container has, which of them
 * a reorder can move, and the index the op is actually given.
 *
 * The op counts the container's SOURCE children, declarations included; the
 * panel counts the rows a user can see. Those two numbers differ by one per
 * `blockoverride` / `block` / `template` sitting between the widgets, which is
 * the whole reason `srcIndex` exists, so the translation between them is worth
 * asserting without a mouse.
 */
import { describe, expect, it } from "vitest";
import type { GuiLayoutNode } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { buildScene } from "../src/webviews/guiEditor/app/scene";
import { boxAxis, dropRank, layerRows, reorderTo } from "../src/webviews/guiEditor/app/layers";

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
    expect(reorderTo(
      rows.map((r) => r.source),
      0,
      1
    )).toBe(2);
  });
});
