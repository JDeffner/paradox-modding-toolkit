/**
 * The pure arithmetic and prose behind G5 stage 2's devtools halo: the
 * placement report and the constraint overlay, the heatmap binning, the layout
 * diff, the stats line, the frame-sheet grid, and the type/template browser.
 *
 * The placement cases run against the REAL layout engine rather than a
 * hand-built `GuiPlacement`, because the one claim worth pinning is that the
 * rows a designer reads add up to the rect the canvas drew: a fixture placement
 * could be made to add up while the engine's did not.
 */
import { describe, expect, it } from "vitest";
import type { GuiLayoutNode, GuiTextureInfo, GuiVocabularyEntry } from "@px-lsp/protocol/protocol";
import { computeGuiWidgetInfo } from "../../server/src/gui/widgetInfo";
import { buildScene, type Scene } from "../src/webviews/guiEditor/app/scene";
import {
  constraintOverlay,
  expandingAxes,
  overrideRows,
  placementReport,
} from "../src/webviews/guiEditor/app/placement";
import { buildHeatmap, diffScenes, pulseNote, statsLine } from "../src/webviews/guiEditor/app/devtools";
import {
  textureFolder,
  textureName,
  texturePage,
  textureSummary,
  textureValue,
  thumbGrid,
} from "../src/webviews/guiEditor/app/textures";
import { browserGroups, vocabularyDetail } from "../src/webviews/guiEditor/app/browse";

const VIEWPORT = { w: 1920, h: 1080 };

/**
 * A widget's declaration line. The name rides on the OPENING line of every
 * fixture below, because that is the line a layout node reports and the line
 * `guiWidgetInfo` reads: a `name` on its own line belongs to the body, not to
 * the declaration.
 */
function lineOf(text: string, needle: string): number {
  const line = text.split(/\r?\n/).findIndex((l) => l.includes(needle));
  expect(line).toBeGreaterThanOrEqual(0);
  return line;
}

/** One widget's info WITH the placement trace, the way the "why" panel asks for it. */
function infoAt(text: string, needle: string) {
  const info = computeGuiWidgetInfo(text, lineOf(text, needle), undefined, {
    placement: true,
    viewport: VIEWPORT,
  });
  if (!info) throw new Error(`no widget info at ${needle}`);
  return info;
}

describe("why is it here", () => {
  const ANCHORED = [
    'widget = { name = "px_why_root"',
    "\tsize = { 400 300 }",
    '\twidget = { name = "px_why_kid"',
    "\t\tparentanchor = bottom|right",
    "\t\tposition = { -30 -20 }",
    "\t\tsize = { 40 20 }",
    "\t}",
    "}",
    "",
  ].join("\n");

  it("names each term and closes on the rect the engine actually produced", () => {
    const info = infoAt(ANCHORED, "px_why_kid");
    const report = placementReport(info)!;
    expect(report.boxPlaced).toBe(false);

    const labels = report.rows.map((r) => r.label);
    expect(labels[0]).toBe("the parent's content box");
    expect(labels).toContain("parentanchor = bottom|right");
    // Never written, so the engine mirrored the parent's, and the row says so
    // rather than looking like a duplicate.
    expect(labels).toContain("widgetanchor = bottom|right (mirrors parentanchor)");
    expect(labels).toContain("position = { -30 -20 }");
    expect(labels[labels.length - 1]).toBe("= where it sits");

    // The whole point of the readout: the terms above the rule add up to the
    // rect below it, which is the number the canvas drew.
    const terms = report.rows.slice(0, -1);
    const sum = terms.reduce((at, row) => ({ x: at.x + row.dx, y: at.y + row.dy }), { x: 0, y: 0 });
    expect(sum.x).toBeCloseTo(report.rect.x, 6);
    expect(sum.y).toBeCloseTo(report.rect.y, 6);
    expect(report.rect).toEqual(info.placement!.rect);
  });

  it("says which container took the slot, and that it dropped the position", () => {
    const boxed = [
      'vbox = { name = "px_why_box"',
      "\tposition = { 100 100 }",
      '\twidget = { name = "px_why_boxed"',
      "\t\tposition = { 5 5 }",
      "\t\tsize = { 40 20 }",
      "\t}",
      "}",
      "",
    ].join("\n");
    const report = placementReport(infoAt(boxed, "px_why_boxed"))!;

    expect(report.boxPlaced).toBe(true);
    // A box computes the slot, so there is no anchor sum and the panel does not
    // invent one.
    expect(report.rows).toEqual([]);
    expect(report.notes[0]).toContain("vbox#px_why_box placed it");
    expect(report.notes[0]).toContain("assigns its children's slots");
    expect(report.notes[1]).toContain("position = { 5 5 } was DROPPED");
    expect(report.notes[1]).toContain("Widget cannot have a position in a layout");
  });

  it("names the clipping ancestor and keeps the true geometry", () => {
    const clipped = [
      'scrollarea = { name = "px_why_scroll"',
      "\tposition = { 0 0 }",
      "\tsize = { 100 60 }",
      "\tscrollwidget = {",
      '\t\tvbox = { name = "px_why_inner"',
      '\t\t\twidget = { name = "px_why_tall" size = { 80 400 } }',
      "\t\t}",
      "\t}",
      "}",
      "",
    ].join("\n");
    const report = placementReport(infoAt(clipped, "px_why_tall"))!;
    const clip = report.notes.find((n) => n.includes("clips it to"));
    expect(clip).toBeDefined();
    expect(clip).toContain("The rect above is the true geometry");
    // 400 tall inside a 60 tall viewport: the rect is NOT the intersection.
    expect(report.rect.h).toBe(400);
  });

  it("a request that did not ask for the trace reports nothing rather than guessing", () => {
    const info = computeGuiWidgetInfo(ANCHORED, lineOf(ANCHORED, "px_why_kid"))!;
    expect(info.placement).toBeUndefined();
    expect(placementReport(info)).toBeNull();
    expect(constraintOverlay(info)).toBeNull();
  });
});

describe("what overrides what", () => {
  it("names the value each key replaced and where that value came from", () => {
    const text = [
      "types PxOverride {",
      "\ttype px_ov_card = widget {",
      "\t\tsize = { 100 50 }",
      "\t}",
      "}",
      "",
      'px_ov_card = { name = "px_ov_use" position = { 10 10 } size = { 120 60 } }',
      "",
    ].join("\n");
    const info = infoAt(text, "px_ov_use");
    const rows = overrideRows(info.properties);
    const size = rows.find((r) => r.key === "size")!;

    expect(size.value).toBe("{ 120 60 }");
    expect(size.was).toBe("{ 100 50 }");
    expect(size.from).toBe("type px_ov_card");
    expect(size.now).toBe("this widget's own body");
  });

  it("a key assigned once is not an override", () => {
    expect(overrideRows([{ key: "size", value: "{ 1 1 }", origin: [] }])).toEqual([]);
  });
});

describe("the constraint overlay", () => {
  it("puts the two anchor points where the terms say, so the link line IS the position", () => {
    const text = [
      'widget = { name = "px_ov_root"',
      "\tposition = { 100 50 }",
      "\tsize = { 400 300 }",
      '\twidget = { name = "px_ov_kid"',
      "\t\tparentanchor = center",
      "\t\tposition = { 20 10 }",
      "\t\tsize = { 40 20 }",
      "\t}",
      "}",
      "",
    ].join("\n");
    const info = infoAt(text, "px_ov_kid");
    const overlay = constraintOverlay(info)!;

    expect(overlay.parent).toEqual(info.placement!.parentRect);
    // The parent's centre, in world coordinates.
    expect(overlay.parentAnchor).toEqual({ x: 100 + 200, y: 50 + 150 });
    // The matching point on the widget, which the position offsets from it.
    expect(overlay.widgetAnchor!.x - overlay.parentAnchor!.x).toBeCloseTo(20, 6);
    expect(overlay.widgetAnchor!.y - overlay.parentAnchor!.y).toBeCloseTo(10, 6);
  });

  it("reads the expanding axes off the widget's own policy, never off its rect", () => {
    const text = [
      'hbox = { name = "px_ex_box"',
      "\tsize = { 400 100 }",
      '\twidget = { name = "px_ex_wide"',
      "\t\tlayoutpolicy_horizontal = expanding",
      "\t\tsize = { 10 10 }",
      "\t}",
      '\twidget = { name = "px_ex_fixed" size = { 10 10 } }',
      "}",
      "",
    ].join("\n");
    expect(expandingAxes(infoAt(text, "px_ex_wide"))).toMatchObject({ x: true, y: false });
    // A widget the box happens to stretch is not a widget that was told to.
    expect(expandingAxes(infoAt(text, "px_ex_fixed"))).toMatchObject({ x: false, y: false });
  });
});

// ---- the scene devtools -----------------------------------------------------

function node(name: string, extra: Partial<GuiLayoutNode> = {}): GuiLayoutNode {
  return {
    key: "widget",
    name,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    clip: false,
    positioned: true,
    editable: true,
    line: 0,
    children: [],
    ...extra,
  };
}

function sceneOf(nodes: GuiLayoutNode[]): Scene {
  return buildScene(nodes);
}

describe("the heatmaps", () => {
  const scene = sceneOf([
    node("root", {
      clip: true,
      children: [
        node("kid"),
        node("spliced", { editable: false }),
        node("deep", { children: [node("deeper")] }),
      ],
    }),
  ]);

  it("depth is relative to the deepest widget in THIS document", () => {
    const heat = buildHeatmap(scene, "depth")!;
    expect(heat.values[0]).toBe(0);
    // root(0) kid(1) spliced(1) deep(1) deeper(2): the deepest is the full tint.
    expect(heat.values[heat.values.length - 1]).toBe(1);
    expect(heat.legend).toBe("depth 0 to 2, over 5 widgets");
  });

  it("clipped tints the widgets under a clip and leaves the clipper alone", () => {
    const heat = buildHeatmap(scene, "clipped")!;
    // The scrollarea clips its CHILDREN; its own rect is not clipped.
    expect(heat.values[0]).toBe(-1);
    expect(heat.values[1]).toBe(1);
    expect(heat.legend).toContain("4 of 5 widgets under a scrollarea");
  });

  it("synthetic tints exactly the widgets with no source here", () => {
    const heat = buildHeatmap(scene, "synthetic")!;
    expect([...heat.values]).toEqual([-1, -1, 1, -1, -1]);
    expect(heat.legend).toContain("1 of 5 widgets spliced in");
  });

  it("off allocates nothing", () => {
    expect(buildHeatmap(scene, "off")).toBeNull();
  });
});

describe("the layout diff", () => {
  it("reports the widgets whose rect moved, and no others", () => {
    const before = sceneOf([node("root", { children: [node("a"), node("b")] })]);
    const after = sceneOf([
      node("root", { children: [node("a", { rect: { x: 5, y: 0, w: 10, h: 10 } }), node("b")] }),
    ]);
    const diff = diffScenes(before, after);
    expect(diff.changed).toEqual([1]);
    expect(diff.removed).toBe(0);
    expect(pulseNote(diff)).toBe("layout: 1 widget changed");
  });

  it("a new widget counts as changed and a removed one is counted", () => {
    const before = sceneOf([node("root", { children: [node("a"), node("gone")] })]);
    const after = sceneOf([node("root", { children: [node("a"), node("fresh")] })]);
    const diff = diffScenes(before, after);
    // The path 0.1 now holds a different widget: new, and the old one is gone.
    expect(diff.changed).toEqual([2]);
    expect(diff.removed).toBe(1);
    expect(pulseNote(diff)).toBe("layout: 1 widget changed, 1 gone");
  });

  it("the first layout has nothing to diff against and pulses nothing", () => {
    const after = sceneOf([node("root")]);
    expect(diffScenes(null, after)).toEqual({ changed: [], removed: 0 });
    expect(pulseNote(diffScenes(null, after))).toBeNull();
  });

  it("an identical re-layout moves nothing", () => {
    const scene = sceneOf([node("root", { children: [node("a")] })]);
    expect(pulseNote(diffScenes(sceneOf([node("root", { children: [node("a")] })]), scene))).toBeNull();
  });
});

describe("the stats line", () => {
  it("keeps one shape so a column of them reads, server stages first", () => {
    expect(
      statsLine({
        timings: { parseMs: 1.25, defsMs: 0, layoutMs: 12.4, totalMs: 14.2 },
        sceneMs: 0.8,
        paintMs: 3.14159,
        widgets: 512,
      })
    ).toBe("parse 1.3ms  defs 0.0ms  layout 12ms  server 14ms  scene 0.8ms  paint 3.1ms  512w");
  });
});

// ---- the texture surfaces ----------------------------------------------------

function sheet(extra: Partial<GuiTextureInfo> = {}): GuiTextureInfo {
  return { path: "gfx/px/strip.dds", source: "fill", width: 128, height: 64, ...extra };
}

describe("the frame-sheet grid", () => {
  it("fits the sheet in the box and scales the server's cell with it", () => {
    const grid = thumbGrid(
      sheet({ framesize: [32, 32], columns: 4, rows: 2, frame: 6, cell: { x: 32, y: 32, w: 32, h: 32 } }),
      { w: 256, h: 256 }
    )!;
    // 128x64 into 256x256 fits on width: scale 2, centred vertically.
    expect(grid.image).toEqual({ x: 0, y: 64, w: 256, h: 128 });
    expect([grid.columns, grid.rows]).toEqual([4, 2]);
    expect([grid.cellW, grid.cellH]).toEqual([64, 64]);
    // Frame 6 is row 1, column 1 of a 4x2 grid: the highlight lands on the cell.
    expect(grid.current).toEqual({ x: 64, y: 64 + 64, w: 64, h: 64 });
  });

  it("a plain texture is a one-cell grid with no highlight", () => {
    const grid = thumbGrid(sheet(), { w: 128, h: 128 })!;
    expect([grid.columns, grid.rows]).toEqual([1, 1]);
    expect(grid.current).toBeUndefined();
  });

  it("no sheet size means no grid at all, rather than a guessed one", () => {
    expect(thumbGrid({ path: "gfx/px/a.dds", source: "fill" }, { w: 100, h: 100 })).toBeNull();
  });

  it("the summary says the size, and the frame out of the total when there is one", () => {
    expect(textureSummary(sheet())).toBe("128 x 64");
    expect(textureSummary(sheet({ framesize: [32, 32], columns: 4, rows: 2, frame: 3 }))).toBe(
      "128 x 64 · 4 x 2 frames of 32 x 32 · showing 3 of 8"
    );
    expect(textureSummary({ path: "gfx/px/a.dds", source: "fill" })).toContain("not found");
  });
});

describe("the texture browser", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    path: `gfx/interface/icons/icon_${i}.dds`,
    source: "game" as const,
  }));

  it("asks for thumbnails only for the page it draws", () => {
    const page = texturePage(entries, 10);
    expect(page.rows).toHaveLength(10);
    expect(page.paths).toEqual(page.rows.map((r) => r.path));
  });

  it("splits a path the way a picker reads it, and quotes what the engine takes", () => {
    expect(textureName("gfx/interface/icons/faith/foo.dds")).toBe("foo.dds");
    expect(textureFolder("gfx/interface/icons/faith/foo.dds")).toBe("gfx/interface/icons/faith");
    expect(textureValue("gfx/interface/icons/faith/foo.dds")).toBe('"gfx/interface/icons/faith/foo.dds"');
  });
});

// ---- the type and template browser -------------------------------------------

describe("the type and template browser", () => {
  const vocabulary: GuiVocabularyEntry[] = [
    { name: "PxLocalDeco", kind: "template", local: true },
    { name: "px_local_card", kind: "type", local: true, base: "widget" },
    { name: "PxSharedRow", kind: "template" },
    { name: "vbox", kind: "builtin", count: 900, container: true },
    { name: "icon", kind: "builtin", count: 300 },
  ];

  it("groups by where the entry comes from, and lists a local one only once", () => {
    const groups = browserGroups(vocabulary, "");
    expect(groups.map((g) => g.id)).toEqual(["local", "template", "builtin"]);
    expect(groups[0].entries.map((e) => e.name)).toEqual(["PxLocalDeco", "px_local_card"]);
    // The local template is NOT repeated under Templates.
    expect(groups[1].entries.map((e) => e.name)).toEqual(["PxSharedRow"]);
    expect(groups[2].entries.map((e) => e.name)).toEqual(["vbox", "icon"]);
  });

  it("filters on a substring and drops the groups that empty out", () => {
    const groups = browserGroups(vocabulary, "box");
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("builtin");
    expect(groups[0].entries.map((e) => e.name)).toEqual(["vbox"]);
  });

  it("says what a group hid rather than silently truncating", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `w${i}`,
      kind: "builtin" as const,
    }));
    const group = browserGroups(many, "", 5)[0];
    expect(group.entries).toHaveLength(5);
    expect(group.hidden).toBe(7);
  });

  it("tells a template's use apart from a type's, and never invents documentation", () => {
    const template = vocabularyDetail(vocabulary[0]);
    expect(template.join(" ")).toContain("Apply it to a widget with `using`");
    expect(template.join(" ")).not.toContain("Inserting");

    const type = vocabularyDetail(vocabulary[1]);
    expect(type.join(" ")).toContain("deriving from widget");
    expect(type.join(" ")).toContain("Inserting it writes an instance");

    const builtin = vocabularyDetail(vocabulary[3]);
    expect(builtin.join(" ")).toContain("900 times");
    expect(builtin.join(" ")).toContain("can hold children");
  });
});
