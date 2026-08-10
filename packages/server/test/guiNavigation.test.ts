/**
 * GUI navigation: template/type declaration sites in collectGuiDefs,
 * overridable-block listing across using-splices and base-type chains, and
 * go-to-definition for type/template names and blockoverride targets.
 */
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  collectGuiDefs,
  collectOverridableBlocks,
  emptyGuiDefs,
  mergeGuiDefs,
  resolveGuiDef,
  typeBaseChain,
} from "../src/gui/guiDefs";
import { provideGuiDefinition } from "../src/features/guiNavigation";

const NO_PATHS = { gamePath: null, modPath: null, parentPaths: [] };

const LIB = `
template CellHeader {
	block "header_icon" {
		texture = "icon.dds"
	}
	widget = {
		block "header_text" {
			text = "x"
		}
	}
}

local_template PrivateBits {
	size = { 10 10 }
}

types MyTypes {
	type my_button = button_standard {
		using = CellHeader
		block "button_glow" {
		}
	}
	type button_standard = button {
		block "button_bg" {
		}
	}
}
`;

describe("collectGuiDefs provenance", () => {
  it("records file and line for templates, local_templates and types", () => {
    const defs = collectGuiDefs(LIB, undefined, "F:/mod/gui/lib.gui");
    const tpl = defs.templates.get("CellHeader")!;
    expect(tpl.file).toBe("F:/mod/gui/lib.gui");
    expect(tpl.line).toBe(1);
    expect(defs.templates.get("PrivateBits")).toMatchObject({ local: true, file: "F:/mod/gui/lib.gui" });
    const type = defs.types.get("my_button")!;
    expect(type.base).toBe("button_standard");
    expect(typeof type.line).toBe("number");
  });
});

describe("overridable blocks", () => {
  const defs = collectGuiDefs(LIB, undefined, "F:/mod/gui/lib.gui");

  it("template: own blocks incl. nested-in-widgets", () => {
    const resolved = resolveGuiDef("CellHeader", [defs])!;
    const blocks = collectOverridableBlocks(resolved, [defs]);
    expect([...blocks.keys()].sort()).toEqual(["header_icon", "header_text"]);
    expect(blocks.get("header_icon")!.file).toBe("F:/mod/gui/lib.gui");
  });

  it("type: blocks from the body, spliced templates and the base chain", () => {
    const resolved = resolveGuiDef("MY_BUTTON", [defs])!; // widget keys match case-insensitively
    expect(resolved.kind).toBe("type");
    const blocks = collectOverridableBlocks(resolved, [defs]);
    expect([...blocks.keys()].sort()).toEqual(["button_bg", "button_glow", "header_icon", "header_text"]);
  });

  it("base chain resolves derived-first", () => {
    expect(typeBaseChain("my_button", [defs])).toEqual(["button_standard", "button"]);
  });

  it("templates resolve exact-case only", () => {
    expect(resolveGuiDef("cellheader", [defs])).toBeNull();
  });
});

describe("gui go-to-definition", () => {
  let uriCounter = 0;
  const makeDoc = (text: string) =>
    TextDocument.create(`file:///mod/gui/nav-${uriCounter++}.gui`, "paradox-gui", 1, text);

  function definitionAt(text: string, marker = "|") {
    const cursor = text.indexOf(marker);
    const clean = text.slice(0, cursor) + text.slice(cursor + marker.length);
    const doc = makeDoc(clean);
    return provideGuiDefinition(doc, doc.positionAt(cursor), NO_PATHS);
  }

  it("using = Template jumps to the template declaration in the same doc", () => {
    const text = LIB + "\nwindow = {\n\tusing = Cell|Header\n}\n";
    const locs = definitionAt(text)!;
    expect(locs).toHaveLength(1);
    expect(locs[0].range.start.line).toBe(1); // template CellHeader
  });

  it("widget type usage jumps to the type declaration", () => {
    const text = LIB + "\nwindow = {\n\tmy_but|ton = {}\n}\n";
    const locs = definitionAt(text)!;
    expect(locs).toHaveLength(1);
    const defs = collectGuiDefs(LIB.replace("|", ""));
    expect(defs.types.has("my_button")).toBe(true);
  });

  it("blockoverride name jumps to the block site through using + type chain", () => {
    const viaTemplate = LIB + '\nwindow = {\n\tusing = CellHeader\n\tblockoverride "header_|icon" {}\n}\n';
    const viaTemplateLocs = definitionAt(viaTemplate)!;
    expect(viaTemplateLocs).toHaveLength(1);
    expect(viaTemplateLocs[0].range.start.line).toBe(2); // block "header_icon" line

    const viaType = LIB + '\nwindow = {\n\tmy_button = {\n\t\tblockoverride "button_|bg" {}\n\t}\n}\n';
    const viaTypeLocs = definitionAt(viaType)!;
    expect(viaTypeLocs).toHaveLength(1);
    // block "button_bg" sits inside type button_standard.
    const lib = collectGuiDefs(LIB, undefined, "x.gui");
    const site = collectOverridableBlocks(resolveGuiDef("button_standard", [lib])!, [lib]).get("button_bg")!;
    expect(viaTypeLocs[0].uri.endsWith(".gui")).toBe(true);
    expect(site.name).toBe("button_bg");
  });

  it("returns null for plain properties (falls through to the index provider)", () => {
    const text = LIB + "\nwindow = {\n\tsi|ze = { 10 10 }\n}\n";
    expect(definitionAt(text)).toBeNull();
  });
});

describe("FIOS merge keeps provenance", () => {
  it("first definition wins and keeps its file", () => {
    const a = collectGuiDefs('template T { block "a" {} }', undefined, "a.gui");
    const b = collectGuiDefs('template T { block "b" {} }', undefined, "b.gui");
    const merged = emptyGuiDefs();
    mergeGuiDefs(merged, a);
    mergeGuiDefs(merged, b);
    expect(merged.templates.get("T")!.file).toBe("a.gui");
  });
});
