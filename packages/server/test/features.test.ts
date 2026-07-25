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
});
