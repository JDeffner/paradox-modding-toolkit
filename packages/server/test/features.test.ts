import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LineIndex, parseLoc, parseScript } from "../src/parser";
import {
  computeLocDiagnostics,
  computeScriptDiagnostics,
  type FileContext,
} from "../src/features/diagnostics";
import { provideDocumentSymbols } from "../src/features/symbols";
import { provideFoldingRanges } from "../src/features/folding";

let uriCounter = 0;
/** Unique per test: the parse cache keys by uri+version. */
const uri = () => `file:///mod/fixture-${uriCounter++}.txt`;

const MOD = "C:\\mods\\my_mod";

function scriptCtx(fsPath: string, bom: boolean | null = null): FileContext {
  return { fsPath, modPath: MOD, bomOnDisk: bom };
}

function scriptDiags(text: string, fsPath = `${MOD}\\events\\my_events.txt`) {
  return computeScriptDiagnostics(parseScript(text), new LineIndex(text), scriptCtx(fsPath));
}

function locDiags(text: string, fsPath: string, bom: boolean | null) {
  return computeLocDiagnostics(parseLoc(text), new LineIndex(text), scriptCtx(fsPath, bom));
}

describe("script structural diagnostics", () => {
  it("flags an unclosed brace at the opening brace with the silent-failure hint", () => {
    const text = "my.1 = {\n\ttrigger = {\n}\n"; // outer block never closed
    const diags = scriptDiags(text);
    const unclosed = diags.filter((d) => d.code === "unclosed-brace");
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0].range.start.line).toBe(0);
    expect(unclosed[0].message).toMatch(/ignores everything/i);
    expect(unclosed[0].severity).toBe(1); // Error
  });

  it("clean file produces no diagnostics", () => {
    expect(scriptDiags("my.1 = {\n\ttrigger = { is_adult = yes }\n}\n")).toEqual([]);
  });

  it("flags a stray closing brace", () => {
    const diags = scriptDiags("a = { x = 1 }\n}\n");
    expect(diags.some((d) => d.code === "stray-close")).toBe(true);
  });

  it("flags files under common/on_actions (plural, wrong)", () => {
    const diags = scriptDiags("on_birth = {}\n", `${MOD}\\common\\on_actions\\mine.txt`);
    expect(diags.some((d) => d.code === "wrong-on-action-folder")).toBe(true);
  });

  it("does not apply folder checks outside the mod", () => {
    const diags = scriptDiags("on_birth = {}\n", "D:\\game\\common\\on_actions\\vanilla.txt");
    expect(diags.some((d) => d.code === "wrong-on-action-folder")).toBe(false);
  });
});

describe("localization structural diagnostics", () => {
  const locPath = `${MOD}\\localization\\english\\mine_l_english.yml`;

  it("flags a missing BOM", () => {
    const diags = locDiags('l_english:\n key:0 "v"\n', locPath, false);
    expect(diags.some((d) => d.code === "missing-bom")).toBe(true);
  });

  it("accepts a healthy file", () => {
    expect(locDiags('l_english:\n key:0 "v"\n', locPath, true)).toEqual([]);
  });

  it("stays silent on BOM when the disk state is unknown", () => {
    const diags = locDiags('l_english:\n key:0 "v"\n', locPath, null);
    expect(diags.some((d) => d.code === "missing-bom")).toBe(false);
  });

  it("flags header/filename language mismatch", () => {
    const diags = locDiags('l_french:\n key:0 "v"\n', locPath, true);
    expect(diags.some((d) => d.code === "loc-header-mismatch")).toBe(true);
  });

  it("flags a missing _l_<language> filename marker inside localization/", () => {
    const diags = locDiags('l_english:\n key:0 "v"\n', `${MOD}\\localization\\english\\mine.yml`, true);
    expect(diags.some((d) => d.code === "loc-bad-filename")).toBe(true);
  });

  it("flags the localisation/ (British) folder", () => {
    const diags = locDiags(
      'l_english:\n key:0 "v"\n',
      `${MOD}\\localisation\\english\\mine_l_english.yml`,
      true
    );
    expect(diags.some((d) => d.code === "wrong-localization-folder")).toBe(true);
  });

  it("maps tab indentation to an error", () => {
    const diags = locDiags('l_english:\n\tkey:0 "v"\n', locPath, true);
    const tab = diags.find((d) => d.code === "loc-tab-indent");
    expect(tab).toBeDefined();
    expect(tab!.severity).toBe(1);
  });
});

describe("document symbols", () => {
  it("lists events with option children (option loc name as detail)", () => {
    const text = [
      "namespace = my",
      "my.1 = {",
      "\ttype = character_event",
      "\timmediate = { add_gold = 5 }",
      "\toption = {",
      "\t\tname = my.1.a",
      "\t}",
      "}",
      "my_effect = { add_gold = 1 }",
    ].join("\n");
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const symbols = provideDocumentSymbols(doc);
    expect(symbols.map((s) => s.name)).toEqual(["my.1", "my_effect"]);
    const event = symbols[0];
    expect(event.children!.map((c) => c.name)).toEqual(["immediate", "option"]);
    expect(event.children![1].detail).toBe("my.1.a");
  });

  it("groups loc entries under the language header", () => {
    const text = 'l_english:\n a:0 "A"\n b:1 "B"\n';
    const doc = TextDocument.create(uri(), "paradox-loc", 1, text);
    const symbols = provideDocumentSymbols(doc);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("l_english");
    expect(symbols[0].children!.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("folding", () => {
  it("folds multi-line blocks and keeps the closing brace visible", () => {
    const text = "a = {\n\tb = {\n\t\tx = 1\n\t}\n}\n";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const ranges = provideFoldingRanges(doc);
    expect(ranges).toContainEqual({ startLine: 0, endLine: 3 });
    expect(ranges).toContainEqual({ startLine: 1, endLine: 2 });
  });

  it("folds comment banners", () => {
    const text = "# one\n# two\n# three\na = { b = 1 }\n";
    const doc = TextDocument.create(uri(), "paradox", 1, text);
    const ranges = provideFoldingRanges(doc);
    expect(ranges.some((r) => r.kind === "comment" && r.startLine === 0 && r.endLine === 2)).toBe(true);
  });

  it("folds .gui files too — the routed provider must not disable folding there", () => {
    const text = [
      "types LabelTypes",
      "{",
      "\ttype text_single = textbox {",
      "\t\tautoresize = yes",
      "\t}",
      "}",
      "window = {",
      '\tname = "w"',
      "\tvbox = {",
      "\t\tspacing = 4",
      "\t}",
      "}",
    ].join("\n");
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const ranges = provideFoldingRanges(doc);
    // types group block, its tagged-block type entry, window, vbox — closing
    // braces stay visible.
    expect(ranges).toContainEqual({ startLine: 1, endLine: 4 });
    expect(ranges).toContainEqual({ startLine: 2, endLine: 3 });
    expect(ranges).toContainEqual({ startLine: 6, endLine: 10 });
    expect(ranges).toContainEqual({ startLine: 8, endLine: 9 });
  });

  it("folds the loc language body and its comment banners", () => {
    const text = '# section\n# banner\nl_english:\n a:0 "A"\n b:1 "B"\n';
    const doc = TextDocument.create(uri(), "paradox-loc", 1, text);
    const ranges = provideFoldingRanges(doc);
    expect(ranges).toContainEqual({ startLine: 2, endLine: 4 });
    expect(ranges.some((r) => r.kind === "comment" && r.startLine === 0 && r.endLine === 1)).toBe(true);
  });

  it("folds INDENTED loc comment banners (the dominant vanilla style) and survives a BOM", () => {
    const text = '﻿# a\n# b\nl_english:\n a:0 "A"\n #x\n #y\n b:1 "B"\n';
    const doc = TextDocument.create(uri(), "paradox-loc", 1, text);
    const ranges = provideFoldingRanges(doc);
    expect(ranges.some((r) => r.kind === "comment" && r.startLine === 0 && r.endLine === 1)).toBe(true);
    expect(ranges.some((r) => r.kind === "comment" && r.startLine === 4 && r.endLine === 5)).toBe(true);
  });

  it("folds an unclosed-at-EOF block through its last line (no brace to keep visible)", () => {
    const text = "window = {\n\tvbox = {\n\t\ta = 1";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const ranges = provideFoldingRanges(doc);
    expect(ranges).toContainEqual({ startLine: 0, endLine: 2 });
    expect(ranges).toContainEqual({ startLine: 1, endLine: 2 });
  });
});

describe("gui document symbols", () => {
  it("nests the widget tree with declaration markers and name details", () => {
    const text = [
      "types MagicViewTypes",
      "{",
      "\ttype spell_slot = widget {",
      "\t\tsize = { 40 40 }",
      "\t}",
      "}",
      "template SpellRow",
      "{",
      "\thbox = {",
      "\t\tspacing = 4",
      "\t}",
      "}",
      "window = {",
      '\tname = "magic_view"',
      "\tvbox = {",
      "\t\thbox = {",
      '\t\t\twidget = { name = "slot_1" size = { 10 10 } }',
      "\t\t}",
      "\t}",
      '\tblockoverride "header_text"',
      "\t{",
      '\t\traw_text = "x"',
      "\t}",
      "}",
    ].join("\n");
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const symbols = provideDocumentSymbols(doc);
    expect(symbols.map((s) => s.name)).toEqual(["types MagicViewTypes", "template SpellRow", "window"]);
    // The types group nests its type entries, with the base as detail.
    expect(symbols[0].children!.map((c) => c.name)).toEqual(["spell_slot"]);
    expect(symbols[0].children![0].detail).toBe("= widget");
    // The window carries its name property as detail and the full child tree.
    const window = symbols[2];
    expect(window.detail).toBe("magic_view");
    expect(window.children!.map((c) => c.name)).toEqual(["vbox", "blockoverride header_text"]);
    const hbox = window.children![0].children![0];
    expect(hbox.name).toBe("hbox");
    expect(hbox.children![0].name).toBe("widget");
    expect(hbox.children![0].detail).toBe("slot_1");
    // Ranges span the whole block (what sticky scroll pins headers from).
    expect(window.range.start.line).toBe(12);
    expect(window.range.end.line).toBe(23);
  });

  it("handles the assignment spelling of a slot override", () => {
    const text = 'widget = {\n\tblockoverride = "header" {\n\t\tx = 1\n\t}\n}\n';
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const [widget] = provideDocumentSymbols(doc);
    expect(widget.children!.map((c) => c.name)).toEqual(["blockoverride header"]);
  });

  it("property blocks are data, not outline entries (guiTree's split)", () => {
    const text = [
      "window = {",
      "\tsize = { 40 40 }",
      "\tbackground = {",
      '\t\ttexture = "x.dds"',
      "\t\tmodify_texture = { blend_mode = overlay }",
      "\t}",
      "\tstate = {",
      "\t\tname = _show",
      "\t}",
      "\tvbox = {",
      "\t\tmargin = { 5 5 }",
      "\t}",
      "}",
    ].join("\n");
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const [window] = provideDocumentSymbols(doc);
    // size/background/state/margin all vanish; only the widget child remains.
    expect(window.children!.map((c) => c.name)).toEqual(["vbox"]);
    expect(window.children![0].children).toEqual([]);
  });

  it("a declaration's range starts at its marker word (cursor-on-keyword resolves)", () => {
    const text = "types LabelTypes\n{\n\ttype a = widget {\n\t\tx = 1\n\t}\n}\n";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const [types] = provideDocumentSymbols(doc);
    expect(types.name).toBe("types LabelTypes");
    expect(types.range.start).toEqual({ line: 0, character: 0 });
    // The nested `type` entry likewise covers its own marker word.
    expect(types.children![0].range.start.character).toBe(1);
  });

  it("widgets inside anonymous list blocks still reach the outline", () => {
    const text = "window = {\n\tlist = {\n\t\t{\n\t\t\titem = {\n\t\t\t\tx = 1\n\t\t\t}\n\t\t}\n\t}\n}\n";
    const doc = TextDocument.create(uri(), "paradox-gui", 1, text);
    const [window] = provideDocumentSymbols(doc);
    const list = window.children![0];
    expect(list.name).toBe("list");
    expect(list.children!.map((c) => c.name)).toEqual(["item"]);
  });
});
