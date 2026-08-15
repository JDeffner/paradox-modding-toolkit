/**
 * The GUI editor's edit gestures, as pure modules: handle grabbing, the delta
 * arithmetic a drag commits, and the keys a gesture asks the guards about.
 *
 * The claim these tests exist to hold up is the one an editor gets wrong
 * silently: a gesture commits EFFECTIVE VALUE + DELTA, never the canvas
 * coordinate under the cursor. An anchored widget is the case that tells the
 * two apart, so it is asserted against the real layout engine's own numbers
 * rather than a hand-written rect.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { GuiLayoutNode } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { buildScene, subtreeEnd, type SceneItem, type SceneRect } from "../src/webviews/guiEditor/app/scene";
import {
  baseOf,
  gestureKeys,
  handleAt,
  handleCursor,
  handlePoints,
  moveWrite,
  pairValue,
  resizeWrite,
  roundDelta,
  HANDLE_SIZE,
  type GestureBase,
} from "../src/webviews/guiEditor/app/gesture";

const FIXTURES = path.join(__dirname, "..", "..", "server", "test", "fixtures", "gui", "layout");

function sceneOf(name: string) {
  const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
  return buildScene(computeGuiLayoutResult(text, null, null).nodes);
}

function itemNamed(name: string, fixture: string): SceneItem {
  const scene = sceneOf(fixture);
  const item = scene.items.find((i) => i.name === name);
  if (!item) throw new Error(`no widget named ${name} in ${fixture}`);
  return item;
}

const RECT: SceneRect = { x: 100, y: 200, w: 80, h: 40 };
const BASE: GestureBase = { position: [10, 20], size: [80, 40] };

describe("resize handles", () => {
  it("puts eight grips on the rect, corners before edges", () => {
    const points = handlePoints(RECT);
    expect(points.map((p) => p.handle)).toEqual(["nw", "ne", "se", "sw", "n", "e", "s", "w"]);
    expect(points[0]).toEqual({ handle: "nw", x: 100, y: 200 });
    expect(points[2]).toEqual({ handle: "se", x: 180, y: 240 });
    expect(points[6]).toEqual({ handle: "s", x: 140, y: 240 });
  });

  it("grabs the grip under the point, and nothing in the middle of the widget", () => {
    expect(handleAt(RECT, 100, 200, 1)).toBe("nw");
    expect(handleAt(RECT, 180, 220, 1)).toBe("e");
    expect(handleAt(RECT, 140, 220, 1)).toBeNull();
  });

  it("a corner beats the edge grip it overlaps on a small widget", () => {
    // 6 wide: the north grip's square covers the whole top edge, corners too.
    const small: SceneRect = { x: 0, y: 0, w: 6, h: 6 };
    expect(handleAt(small, 0, 0, 1)).toBe("nw");
    expect(handleAt(small, 6, 0, 1)).toBe("ne");
  });

  it("stays the same SCREEN size at every zoom", () => {
    // Half a grip away from the corner: inside it at 1:1, outside it zoomed in.
    const near = HANDLE_SIZE / 2 - 0.5;
    expect(handleAt(RECT, 100 + near, 200, 1)).toBe("nw");
    expect(handleAt(RECT, 100 + near, 200, 4)).toBeNull();
  });

  it("names the cursor each grip drags with", () => {
    expect(handleCursor("nw")).toBe("nwse-resize");
    expect(handleCursor("ne")).toBe("nesw-resize");
    expect(handleCursor("n")).toBe("ns-resize");
    expect(handleCursor("w")).toBe("ew-resize");
  });
});

describe("the base a gesture adds its delta to", () => {
  it("is the widget's own source values when it has them", () => {
    const item = itemNamed("px_a_inset", "anchors.gui");
    expect(baseOf(item)).toEqual({ position: [-30, -30], size: [20, 20] });
  });

  it("falls back to the origin and the laid-out rect when the widget declares neither", () => {
    const item: SceneItem = {
      key: "widget",
      rect: { x: 5, y: 6, w: 70, h: 30 },
      depth: 0,
      path: [0],
      textLines: [],
      opacity: 1,
      ghost: false,
      editable: true,
      declared: false,
    };
    expect(baseOf(item)).toEqual({ position: [0, 0], size: [70, 30] });
  });
});

describe("a move commits position + delta, never the cursor's world point", () => {
  it("writes the source position plus the drag, not where the widget landed", () => {
    // The anchored widget: laid out at 250,150 by a bottom|right anchor, but its
    // `position` reads -30,-30. Writing the canvas coordinate would move it by
    // the whole anchor offset the moment the engine re-applied the anchor.
    const item = itemNamed("px_a_inset", "anchors.gui");
    expect(item.rect).toMatchObject({ x: 250, y: 150 });

    const write = moveWrite(baseOf(item), item.rect, 10, 5);
    expect(write.properties).toEqual([{ key: "position", value: "{ -20 -25 }" }]);
    expect(write.rect).toEqual({ x: 260, y: 155, w: 20, h: 20 });
    expect(write.offset).toEqual({ dx: 10, dy: 5 });
    expect(write.noop).toBe(false);
  });

  it("a delta that rounds to nothing writes nothing, and says so", () => {
    const write = moveWrite(BASE, RECT, 0, 0);
    expect(write.properties).toEqual([]);
    expect(write.noop).toBe(true);
    expect(write.rect).toEqual(RECT);
  });

  it("rounds the delta once, before anything is derived from it", () => {
    expect(roundDelta(4.4, -4.4)).toEqual([4, -4]);
    expect(roundDelta(0.5, -0.5)).toEqual([1, -0]);
  });

  it("renders a pair the way the writer expects it", () => {
    expect(pairValue(10, -20)).toBe("{ 10 -20 }");
    expect(pairValue(10.005, 20.5)).toBe("{ 10.01 20.5 }");
  });
});

describe("a resize commits size + delta, and moves the origin only when it must", () => {
  it("an east or south grip writes size alone", () => {
    expect(resizeWrite(BASE, RECT, "e", 20, 99).properties).toEqual([{ key: "size", value: "{ 100 40 }" }]);
    expect(resizeWrite(BASE, RECT, "s", 99, 10).properties).toEqual([{ key: "size", value: "{ 80 50 }" }]);
    expect(resizeWrite(BASE, RECT, "se", 20, 10).properties).toEqual([{ key: "size", value: "{ 100 50 }" }]);
  });

  it("a west grip writes both, and the east edge does not move", () => {
    const write = resizeWrite(BASE, RECT, "w", -20, 0);
    expect(write.properties).toEqual([
      { key: "position", value: "{ -10 20 }" },
      { key: "size", value: "{ 100 40 }" },
    ]);
    // 100 wide from x = 80 ends at 180, exactly where the rect ended before.
    expect(write.rect).toEqual({ x: 80, y: 200, w: 100, h: 40 });
    expect(write.offset).toEqual({ dx: -20, dy: 0 });
  });

  it("a north grip dragged straight up leaves the untouched axis out of the write", () => {
    const write = resizeWrite(BASE, RECT, "n", 0, -10);
    expect(write.properties).toEqual([
      { key: "position", value: "{ 10 10 }" },
      { key: "size", value: "{ 80 50 }" },
    ]);
  });

  it("a corner dragged along one axis only writes what changed", () => {
    expect(resizeWrite(BASE, RECT, "se", 20, 0).properties).toEqual([{ key: "size", value: "{ 100 40 }" }]);
    expect(resizeWrite(BASE, RECT, "se", 0, 0).noop).toBe(true);
  });

  it("never writes a negative size: the dragged edge stops at the opposite one", () => {
    const east = resizeWrite(BASE, RECT, "e", -200, 0);
    expect(east.properties).toEqual([{ key: "size", value: "{ 0 40 }" }]);

    // Dragged past the right edge, the west grip stops there instead of
    // inverting the widget, and its position stops with it.
    const west = resizeWrite(BASE, RECT, "w", 200, 0);
    expect(west.properties).toEqual([
      { key: "position", value: "{ 90 20 }" },
      { key: "size", value: "{ 0 40 }" },
    ]);
    expect(west.rect).toEqual({ x: 180, y: 200, w: 0, h: 40 });
  });
});

describe("what the gesture-start check asks the guards about", () => {
  it("a move asks about position", () => {
    expect(gestureKeys(null)).toEqual(["position"]);
  });

  it("a grip that only stretches asks about size", () => {
    expect(gestureKeys("e")).toEqual(["size"]);
    expect(gestureKeys("s")).toEqual(["size"]);
    expect(gestureKeys("se")).toEqual(["size"]);
  });

  it("a grip that moves the origin asks about both, whichever way it is dragged", () => {
    for (const handle of ["nw", "n", "ne", "w", "sw"] as const) {
      expect(gestureKeys(handle)).toEqual(["position", "size"]);
    }
  });
});

describe("the subtree a drag preview carries with it", () => {
  it("is the contiguous slice of the draw list the widget owns", () => {
    const scene = sceneOf("anchors.gui");
    const mid = scene.items.findIndex((i) => i.name === "px_a_mid");
    expect(subtreeEnd(scene, mid)).toBe(mid + 2);
    expect(scene.items[mid + 1].name).toBe("px_a_leaf");

    // The root carries everything below it, and a leaf carries only itself.
    expect(subtreeEnd(scene, 0)).toBe(scene.items.length);
    const leaf = scene.items.findIndex((i) => i.name === "px_a_leaf");
    expect(subtreeEnd(scene, leaf)).toBe(leaf + 1);
  });

  it("the scene carries the engine's own source values onto every item", () => {
    const scene = sceneOf("anchors.gui");
    const leaf = scene.items.find((i) => i.name === "px_a_leaf")!;
    expect(leaf.srcPosition).toEqual([10, 10]);
    expect(leaf.srcSize).toEqual([20, 20]);

    const node: GuiLayoutNode = {
      key: "widget",
      rect: leaf.rect,
      clip: false,
      positioned: true,
      editable: true,
      children: [],
    };
    expect(buildScene([node]).items[0].srcPosition).toBeUndefined();
  });
});
