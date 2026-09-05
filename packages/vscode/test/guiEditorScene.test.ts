/**
 * The GUI editor's scene-dump harness: the headless equivalent of the Studio's
 * `--render-gui` check. It runs the REAL scene builder the webview runs, over
 * every layout fixture, and diffs `label x y w h fillKind [flags]` against a
 * recorded baseline.
 *
 * The load-bearing assertion is not the dump but the one under it: a scene rect
 * must EQUAL the engine's rect, value for value, in draw order. That is what
 * pins the renderer to the measured layout engine without a browser — the
 * canvas is allowed to decide how a widget looks, never where it is.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { devPath } from "../../../scripts/devPaths";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import {
  computeGuiLayout,
  computeNineSlice as engineNineSlice,
  GHOST_OPACITY as ENGINE_GHOST_OPACITY,
} from "../../server/src/gui/layoutEngine";
import { computeNineSlice } from "../../server/src/gui/fillGeometry";
import type { GuiLayoutNode } from "@px-lsp/protocol/protocol";
import {
  applyScrollOffsets,
  buildScene,
  dumpScene,
  GHOST_BOX,
  GHOST_OPACITY,
  pathKey,
  scrollExtent,
} from "../src/webviews/guiEditor/app/scene";

const FIXTURES = path.join(__dirname, "..", "..", "server", "test", "fixtures", "gui", "layout");
const BASELINE = path.join(__dirname, "fixtures", "gui-scene.baseline.txt");

function layoutOf(file: string): GuiLayoutNode[] {
  const text = fs.readFileSync(path.join(FIXTURES, file), "utf8");
  return computeGuiLayoutResult(text, null, null).nodes;
}

function fixtureFiles(): string[] {
  return fs
    .readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".gui"))
    .sort();
}

/** Engine rects in the same order the scene draws them: pre-order, siblings in order. */
function engineRects(nodes: GuiLayoutNode[]): { label: string; rect: GuiLayoutNode["rect"] }[] {
  const out: { label: string; rect: GuiLayoutNode["rect"] }[] = [];
  const visit = (n: GuiLayoutNode): void => {
    out.push({ label: n.name ? `${n.key}#${n.name}` : n.key, rect: n.rect });
    for (const c of n.children) visit(c);
  };
  for (const n of nodes) visit(n);
  return out;
}

function sceneNamed(nodes: GuiLayoutNode[], name: string) {
  const item = buildScene(nodes).items.find((i) => i.name === name);
  if (!item) throw new Error(`no widget named ${name}`);
  return item;
}

describe("scene dump over the fixture corpus", () => {
  it("every fixture's scene matches the recorded baseline", () => {
    const lines: string[] = [];
    for (const file of fixtureFiles()) {
      lines.push(file);
      lines.push(...dumpScene(buildScene(layoutOf(file))));
    }
    const text = `${lines.join("\n")}\n`;
    if (process.env.PX_WRITE_GUI_SCENE_BASELINE) fs.writeFileSync(BASELINE, text, "utf8");
    // Line endings are the checkout's business, the numbers are ours.
    expect(text).toBe(fs.readFileSync(BASELINE, "utf8").replace(/\r\n/g, "\n"));
  });

  it("scene rects EQUAL the engine's rects, exactly, in draw order", () => {
    for (const file of fixtureFiles()) {
      const nodes = layoutOf(file);
      const expected = engineRects(nodes);
      const items = buildScene(nodes).items;
      expect(items.length, file).toBe(expected.length);
      for (let i = 0; i < items.length; i++) {
        const label = `${file} #${i} ${expected[i].label}`;
        expect([items[i].rect.x, items[i].rect.y, items[i].rect.w, items[i].rect.h], label).toEqual([
          expected[i].rect.x,
          expected[i].rect.y,
          expected[i].rect.w,
          expected[i].rect.h,
        ]);
      }
    }
  });
});

describe("L11b: unmeasurable content renders as a dashed ghost", () => {
  const nodes = layoutOf("container-measurability.gui");

  it("a container whose content could not be measured gets a ghost box", () => {
    // Both cases collapse to 0x0 in the rect baseline: a { 0 0 } child and a
    // child of a type no file defines. The engine invents no pixels; the canvas
    // draws the estimate instead, at the widget's own origin.
    for (const name of ["px_unmeasurable_zero", "px_unmeasurable_unknown_type"]) {
      const item = sceneNamed(nodes, name);
      expect([item.rect.w, item.rect.h], name).toEqual([0, 0]);
      expect(item.ghostBox, name).toEqual({ x: item.rect.x, y: item.rect.y, w: GHOST_BOX, h: GHOST_BOX });
    }
  });

  it("content that still measured to something visible keeps its rect and gets no box", () => {
    // The datamodel and binding cases are unmeasurable in the L11b sense too,
    // but they never collapse: the preview already shows something, so there is
    // nothing to estimate.
    for (const name of ["px_unmeasurable_datamodel", "px_unmeasurable_binding", "px_container_measurable"]) {
      expect(sceneNamed(nodes, name).ghostBox, name).toBeUndefined();
    }
  });

  it("an EMPTY container collapsing to 0 is measured behavior, not an estimate", () => {
    // L25, settled by the in-game probe: no children, no ghost box.
    const item = sceneNamed(nodes, "px_container_empty");
    expect([item.rect.w, item.rect.h]).toEqual([0, 0]);
    expect(item.ghostBox).toBeUndefined();
  });

  it("keeps an axis the engine did measure", () => {
    const item = buildScene([
      {
        key: "container",
        name: "half",
        rect: { x: 10, y: 20, w: 0, h: 120 },
        clip: false,
        positioned: true,
        editable: true,
        children: [
          {
            key: "widget",
            rect: { x: 10, y: 20, w: 0, h: 120 },
            clip: false,
            positioned: true,
            editable: true,
            children: [],
          },
        ],
      },
    ]).items[0];
    expect(item.ghostBox).toEqual({ x: 10, y: 20, w: GHOST_BOX, h: 120 });
  });

  it("borrows the engine's ghost opacity rather than inventing one", () => {
    expect(GHOST_OPACITY).toBe(ENGINE_GHOST_OPACITY);
  });
});

describe("fill geometry is the engine's, not a copy", () => {
  it("the renderer's nine-slice IS the layout engine's function", () => {
    // The canvas imports @px-lsp/server/gui/fillGeometry directly; the engine
    // re-exports the same binding. One implementation, so the drawn corners
    // cannot drift from the measured ones (L21a-d).
    expect(computeNineSlice).toBe(engineNineSlice);
  });
});

describe("clipping is resolved into the draw list", () => {
  it("a clipped descendant carries its clipper's rect", () => {
    const nodes = layoutOf("clipping.gui");
    const scene = buildScene(nodes);
    const clipped = scene.items.filter((i) => i.clip);
    expect(clipped.length).toBeGreaterThan(0);
    for (const item of clipped) {
      expect(Number.isFinite(item.clip!.w)).toBe(true);
      expect(Number.isFinite(item.clip!.h)).toBe(true);
    }
  });
});

describe("vanilla corpus", () => {
  it.skipIf(!devPath("gamePath"))("window_character builds a scene", () => {
    const gamePath = devPath("gamePath")!;
    const file = path.join(gamePath, "gui", "window_character.gui");
    const result = computeGuiLayoutResult(fs.readFileSync(file, "utf8"), gamePath, null);
    const scene = buildScene(result.nodes);

    expect(scene.count).toBe(result.nodeCount);
    expect(scene.count).toBeGreaterThan(500);
    for (const item of scene.items) {
      expect(Number.isFinite(item.rect.x + item.rect.y + item.rect.w + item.rect.h)).toBe(true);
    }
    // The window is textured and ghosted: the scene must carry both, or the
    // canvas would be drawing an empty grey box and passing its own tests.
    expect(scene.items.some((i) => i.fill?.texture || i.bg?.texture)).toBe(true);
    expect(scene.items.some((i) => i.ghost)).toBe(true);
    expect(scene.items.some((i) => i.textLines.length > 0)).toBe(true);
  });
});

describe("interact scrolling over a scrollarea", () => {
  const SCROLL = `
scrollarea = {
	size = { 100 50 }
	scrollwidget = {
		vbox = {
			icon = { size = { 100 40 } texture = "a.dds" }
			icon = { size = { 100 40 } texture = "a.dds" }
			icon = { size = { 100 40 } texture = "a.dds" }
		}
	}
}`;
  it("the extent is the content past the viewport, and an offset shifts the children only", () => {
    const nodes = computeGuiLayout(SCROLL, { viewport: { w: 1000, h: 1000 } }) as unknown as GuiLayoutNode[];
    const scene = buildScene(nodes);
    expect(scene.items[0].scrolls).toBe(true);
    expect(scrollExtent(scene, 0)).toEqual({ x: 0, y: 70 });
    const before = scene.items.map((i) => ({ ...i.rect }));
    applyScrollOffsets(scene, new Map([[pathKey(scene.items[0].path), { x: 0, y: 30 }]]));
    expect(scene.items[0].rect).toEqual(before[0]);
    for (let i = 1; i < scene.items.length; i++) {
      expect(scene.items[i].rect.y).toBe(before[i].y - 30);
      expect(scene.items[i].clip).toEqual(before[0]);
    }
    // The layout nodes are untouched: the next rebuild starts from the engine's geometry.
    expect(buildScene(nodes).items[1].rect).toEqual(before[1]);
  });
});
