/**
 * ck3/guiWidgetEdit: preview drag / property-panel changes -> precise text
 * edits on the .gui source. Applying the returned edit must produce exactly
 * the expected document.
 */
import { describe, expect, it } from "vitest";
import { computeGuiWidgetEdit } from "../src/gui/widgetEdit";

function apply(text: string, edit: { start: number; end: number; newText: string } | null): string {
  expect(edit).not.toBeNull();
  return text.slice(0, edit!.start) + edit!.newText + text.slice(edit!.end);
}

const DOC = `widget = {
	name = "root"
	size = { 200 100 }
	icon = {
		position = { 30 20 }
		size = { 40 40 }
		texture = "t.dds"
	}
	my_custom_type = {
	}
}
`;

describe("computeGuiWidgetEdit", () => {
  it("replaces an existing position pair, preserving everything else", () => {
    // The icon's statement starts on line 3 (0-based).
    const out = apply(DOC, computeGuiWidgetEdit(DOC, 3, "position", [55, -12]));
    expect(out).toContain("position = { 55 -12 }");
    expect(out).not.toContain("{ 30 20 }");
    expect(out).toContain('texture = "t.dds"'); // untouched
    expect(out).toContain("size = { 40 40 }"); // icon size untouched
  });

  it("replaces the right widget's size, not an ancestor's", () => {
    const out = apply(DOC, computeGuiWidgetEdit(DOC, 3, "size", [64, 48]));
    expect(out).toContain("size = { 64 48 }");
    expect(out).toContain("size = { 200 100 }"); // root size untouched
  });

  it("inserts a missing position with the block's indentation", () => {
    // my_custom_type on line 8 has no position.
    const out = apply(DOC, computeGuiWidgetEdit(DOC, 8, "position", [10, 10]));
    expect(out).toContain("my_custom_type = {\n\t\tposition = { 10 10 }\n\t}");
  });

  it("inserts into a widget that has children, matching their indent", () => {
    const doc = `window = {\n    vbox = {\n        spacing = 4\n    }\n}`;
    const out = apply(doc, computeGuiWidgetEdit(doc, 0, "size", [400, 300]));
    // The insert lands on its own line before the closing brace (W03), which is
    // where the G1 writer puts a new property; this request used to put it
    // first in the body instead. The indent is still the body's own.
    expect(out).toContain("    }\n    size = { 400 300 }\n}");
  });

  it("rounds near-integers and keeps one decimal otherwise", () => {
    const out = apply(DOC, computeGuiWidgetEdit(DOC, 3, "position", [12.001, 7.5]));
    expect(out).toContain("position = { 12 7.5 }");
  });

  it("handles one-liner widgets (key and properties share the line)", () => {
    const doc = `widget = {\n\ticon = { size = { 40 40 } texture = "t.dds" }\n}`;
    const out = apply(doc, computeGuiWidgetEdit(doc, 1, "size", [60, 60]));
    expect(out).toContain('icon = { size = { 60 60 } texture = "t.dds" }');
  });

  it("returns null for unknown lines and non-pair properties", () => {
    expect(computeGuiWidgetEdit(DOC, 99, "position", [0, 0])).toBeNull();
    expect(computeGuiWidgetEdit(DOC, 3, "name" as unknown as "position", [0, 0])).toBeNull();
  });
});
