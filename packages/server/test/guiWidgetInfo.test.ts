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
