/**
 * paradox/guiWidgetInfo: the inspector's read side.
 *
 * The two claims worth testing are the ones the designer leans on: a row's
 * VALUE is the one the engine laid the widget out with (last-in-wins through
 * the type chain and the template splices), and a row's ORIGIN names the
 * definition it came from, so an inherited value is never mistaken for one this
 * file wrote.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { collectGuiDefs } from "../src/gui/guiDefs";
import { computeGuiWidgetInfo } from "../src/gui/widgetInfo";

const FIXTURE = path.join(__dirname, "fixtures", "gui", "layout", "templates-types.gui");
const TEXT = fs.readFileSync(FIXTURE, "utf8");

/** The 0-based line a named widget is declared on, the way the engine reports it. */
function lineOf(text: string, name: string): number {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(`name = "${name}"`));
  if (at < 0) throw new Error(`no widget named ${name}`);
  // A `name` on its own line belongs to the declaration above it.
  return /^\s*name\s*=/.test(lines[at]) ? at - 1 : at;
}

function infoFor(name: string) {
  const info = computeGuiWidgetInfo(TEXT, lineOf(TEXT, name));
  if (!info) throw new Error(`no widget info for ${name}`);
  return info;
}

function valueOf(name: string, key: string): string | undefined {
  return infoFor(name).properties.find((p) => p.key === key)?.value;
}

function originOf(name: string, key: string): string {
  const property = infoFor(name).properties.find((p) => p.key === key);
  if (!property) throw new Error(`${name} has no ${key}`);
  return property.origin.map((o) => `${o.kind} ${o.name}`).join(" in ");
}

describe("the widget's own properties", () => {
  it("names the widget and its type chain", () => {
    const info = infoFor("px_card_positioned");
    expect(info.key).toBe("px_card");
    expect(info.name).toBe("px_card_positioned");
    expect(info.typeChain).toEqual(["widget"]);
  });

  it("a locally authored property has an EMPTY origin: this file wrote it", () => {
    expect(originOf("px_card_positioned", "position")).toBe("");
    expect(valueOf("px_card_positioned", "position")).toBe("{ 10 10 }");
  });

  it("child widgets are not properties", () => {
    expect(infoFor("px_derived_frame").properties.map((p) => p.key)).toEqual(["name", "position", "size"]);
  });

  it("a quoted value keeps its quotes, so the row reads like the source", () => {
    expect(valueOf("px_card_positioned", "name")).toBe('"px_card_positioned"');
  });
});

describe("template-chain origins", () => {
  it("a value inherited from a type says which type", () => {
    expect(originOf("px_card_positioned", "size")).toBe("type px_card");
    expect(valueOf("px_card_positioned", "size")).toBe("{ 100 50 }");
  });

  it("a value spliced in by `using` says which template", () => {
    expect(originOf("px_using_plain", "size")).toBe("template PxDeco");
    expect(originOf("px_using_plain", "background")).toBe("template PxDeco");
    expect(valueOf("px_using_plain", "background")).toBe(
      '{ texture = "gfx/px_fixtures/flat.dds" color = { 0.2 0.2 0.2 1 } }'
    );
  });

  it("an instance override wins, and the row that survives is the local one", () => {
    // `using = PxDeco size = { 30 30 }`: the template's size is written first
    // and the use site's after it, which is exactly how the engine reads it.
    expect(valueOf("px_using_overridden", "size")).toBe("{ 30 30 }");
    expect(originOf("px_using_overridden", "size")).toBe("");
    expect(originOf("px_using_overridden", "background")).toBe("template PxDeco");
    expect(infoFor("px_using_overridden").properties.filter((p) => p.key === "size")).toHaveLength(1);
  });

  it("a type override wins over the base type it derives from", () => {
    const text = [
      "types PxT {",
      "\ttype px_base = widget { size = { 10 10 } alpha = 0.5 }",
      "\ttype px_derived = px_base { size = { 20 20 } }",
      "}",
      'px_derived = { name = "instance" }',
    ].join("\n");
    const info = computeGuiWidgetInfo(text, 4)!;
    expect(info.typeChain).toEqual(["px_base", "widget"]);
    const size = info.properties.find((p) => p.key === "size")!;
    expect(size.value).toBe("{ 20 20 }");
    expect(size.origin).toEqual([{ kind: "type", name: "px_derived" }]);
    const alpha = info.properties.find((p) => p.key === "alpha")!;
    expect(alpha.origin).toEqual([{ kind: "type", name: "px_base" }]);
  });

  it("a template used INSIDE a type reports the whole chain, innermost first", () => {
    const text = [
      "template PxInner { alpha = 0.25 }",
      "types PxT {",
      "\ttype px_outer = widget { using = PxInner }",
      "}",
      'px_outer = { name = "instance" }',
    ].join("\n");
    const alpha = computeGuiWidgetInfo(text, 4)!.properties.find((p) => p.key === "alpha")!;
    expect(alpha.origin).toEqual([
      { kind: "template", name: "PxInner" },
      { kind: "type", name: "px_outer" },
    ]);
  });

  it("a template from ANOTHER file resolves through the store the canvas used", () => {
    const store = collectGuiDefs("template PxShared { alpha = 0.75 }", undefined, "other.gui");
    const info = computeGuiWidgetInfo('widget = {\n\tname = "x"\n\tusing = PxShared\n}', 0, store)!;
    const alpha = info.properties.find((p) => p.key === "alpha")!;
    expect(alpha.value).toBe("0.75");
    expect(alpha.origin).toEqual([{ kind: "template", name: "PxShared" }]);
  });
});

describe("lines with nothing to inspect", () => {
  it("a line with no declaration answers null", () => {
    // Line 0 of the fixture is a comment.
    expect(computeGuiWidgetInfo(TEXT, 0)).toBeNull();
  });

  it("a template or type DECLARATION is not an instance", () => {
    const text = "template PxDeco {\n\talpha = 0.5\n}\n";
    expect(computeGuiWidgetInfo(text, 0)).toBeNull();
  });

  it("a slot declaration is not a property row", () => {
    const info = infoFor("px_slot_filled");
    expect(info.properties.map((p) => p.key)).not.toContain("px_content");
    expect(info.properties.map((p) => p.key)).not.toContain("blockoverride");
  });
});

// ---------------------------------------------------------------------------
// G5: what a row overrides
// ---------------------------------------------------------------------------

describe("the override note", () => {
  it("an instance value records the template value it replaced", () => {
    const size = infoFor("px_using_overridden").properties.find((p) => p.key === "size")!;
    expect(size.value).toBe("{ 30 30 }");
    expect(size.overrides).toEqual([{ value: "{ 80 40 }", origin: [{ kind: "template", name: "PxDeco" }] }]);
  });

  it("a derived type records the base type's value", () => {
    const text = [
      "types PxT {",
      "\ttype px_base = widget { size = { 10 10 } }",
      "\ttype px_derived = px_base { size = { 20 20 } }",
      "}",
      'px_derived = { name = "instance" }',
    ].join("\n");
    const size = computeGuiWidgetInfo(text, 4)!.properties.find((p) => p.key === "size")!;
    expect(size.overrides).toEqual([{ value: "{ 10 10 }", origin: [{ kind: "type", name: "px_base" }] }]);
  });

  it("three assignments record two shadowed values, base-most first", () => {
    const text = [
      "template PxA { alpha = 0.1 }",
      "types PxT {",
      "\ttype px_three = widget { alpha = 0.2 }",
      "}",
      'px_three = { name = "instance" using = PxA alpha = 0.3 }',
    ].join("\n");
    const alpha = computeGuiWidgetInfo(text, 4)!.properties.find((p) => p.key === "alpha")!;
    expect(alpha.value).toBe("0.3");
    expect(alpha.overrides?.map((o) => o.value)).toEqual(["0.2", "0.1"]);
    expect(alpha.overrides?.map((o) => o.origin[0]?.name)).toEqual(["px_three", "PxA"]);
  });

  it("a key assigned once carries no note at all", () => {
    expect(
      infoFor("px_card_positioned").properties.find((p) => p.key === "position")!.overrides
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G5: placement explanation
// ---------------------------------------------------------------------------

describe("why the widget is here", () => {
  const anchored = [
    "widget = {", // 0
    '\tname = "frame"', // 1
    "\tsize = { 300 200 }", // 2
    "\twidget = {", // 3
    '\t\tname = "anchored"', // 4
    "\t\tparentanchor = bottom|right", // 5
    "\t\tposition = { -30 -30 }", // 6
    "\t\tsize = { 20 20 }", // 7
    "\t}", // 8
    "}", // 9
  ].join("\n");

  it("is absent unless asked for", () => {
    expect(computeGuiWidgetInfo(anchored, 3)!.placement).toBeUndefined();
  });

  it("names the anchor terms, and they SUM to the rect origin", () => {
    const placement = computeGuiWidgetInfo(anchored, 3, undefined, { placement: true })!.placement!;
    expect(placement.rect).toEqual({ x: 250, y: 150, w: 20, h: 20 });
    expect(placement.parentRect).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(placement.terms).toEqual([
      { kind: "parentOrigin", dx: 0, dy: 0 },
      { kind: "parentanchor", source: "bottom|right", dx: 300, dy: 200 },
      { kind: "widgetanchor", source: "bottom|right", dx: -20, dy: -20 },
      { kind: "position", source: "{ -30 -30 }", dx: -30, dy: -30 },
    ]);
    // The invariant that keeps the readout from drifting from the placement.
    const sum = (pick: (t: (typeof placement.terms)[number]) => number) =>
      placement.terms.reduce((n, t) => n + pick(t), 0);
    expect(sum((t) => t.dx)).toBe(placement.rect.x);
    expect(sum((t) => t.dy)).toBe(placement.rect.y);
    expect(placement.placedBy).toBeUndefined();
  });

  it("a box child says who placed it and which position was dropped", () => {
    const text = [
      "vbox = {", // 0
      '\tname = "column"', // 1
      "\twidget = {", // 2
      '\t\tname = "slotted"', // 3
      "\t\tposition = { 200 0 }", // 4
      "\t\tsize = { 40 30 }", // 5
      "\t}", // 6
      "}", // 7
    ].join("\n");
    const placement = computeGuiWidgetInfo(text, 2, undefined, { placement: true })!.placement!;
    // L23, probe 2026-08-02: the box owns the slot and the position went nowhere.
    expect(placement.terms).toEqual([]);
    expect(placement.placedBy).toEqual({
      key: "vbox",
      name: "column",
      layout: "box",
      droppedPosition: [200, 0],
    });
    // The box cross-centers the child in its own width; the authored 200 is
    // nowhere in that number.
    expect(placement.rect.x).toBe((1920 - 40) / 2);
    // The container's own rect, not the slot handed to the child.
    expect(placement.parentRect).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("a clipped descendant names the clipping ancestor and its rect", () => {
    const text = [
      "scrollarea = {", // 0
      '\tname = "viewport"', // 1
      "\tsize = { 100 60 }", // 2
      "\twidget = {", // 3
      '\t\tname = "overflowing"', // 4
      "\t\tposition = { 10 10 }", // 5
      "\t\tsize = { 400 400 }", // 6
      "\t}", // 7
      "}", // 8
    ].join("\n");
    const placement = computeGuiWidgetInfo(text, 3, undefined, { placement: true })!.placement!;
    expect(placement.clippedBy).toEqual({
      key: "scrollarea",
      name: "viewport",
      rect: { x: 0, y: 0, w: 100, h: 60 },
    });
    // B3-R1: the rect stays true geometry; the renderer clips it.
    expect(placement.rect).toEqual({ x: 10, y: 10, w: 400, h: 400 });
  });

  it("a widget the layout never reaches has properties but no placement", () => {
    // A tooltipwidget subtree is created lazily in-engine and skipped here.
    const text = [
      "widget = {",
      '\tname = "host"',
      "\ttooltipwidget = {",
      "\t\twidget = {",
      '\t\t\tname = "tip_child"',
      "\t\t}",
      "\t}",
      "}",
    ].join("\n");
    const info = computeGuiWidgetInfo(text, 3, undefined, { placement: true })!;
    expect(info.name).toBe("tip_child");
    expect(info.placement).toBeUndefined();
  });
});
