import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideFormattingEdits } from "../src/features/formatting";
import { ErrorLogParser, parseErrorLogLine } from "@px-lsp/protocol/errorLogParser";

function applyEdits(text: string, doc: TextDocument): string {
  const edits = provideFormattingEdits(doc);
  // apply in reverse order (per line, non-overlapping)
  let out = text;
  const sorted = [...edits].sort(
    (a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character
  );
  for (const e of sorted) {
    const start = doc.offsetAt(e.range.start);
    const end = doc.offsetAt(e.range.end);
    out = out.slice(0, start) + e.newText + out.slice(end);
  }
  return out;
}

let n = 0;
const mkdoc = (text: string) => TextDocument.create(`file:///f${n++}.txt`, "paradox", 1, text);

describe("formatter (indentation only)", () => {
  it("reindents by brace depth with tabs", () => {
    const input = "a = {\nb = {\n      x = 1\n }\n}\n";
    const doc = mkdoc(input);
    expect(applyEdits(input, doc)).toBe("a = {\n\tb = {\n\t\tx = 1\n\t}\n}\n");
  });

  it("is idempotent", () => {
    const input = "a = {\n\tb = { x = 1 }\n\t# comment\n}\n";
    const doc = mkdoc(input);
    const once = applyEdits(input, doc);
    const doc2 = mkdoc(once);
    expect(applyEdits(once, doc2)).toBe(once);
  });

  it("changes nothing but leading whitespace", () => {
    const input = '  a = {\n x = "keep  {  spacing"\n}\n';
    const doc = mkdoc(input);
    const output = applyEdits(input, doc);
    expect(output.replace(/^[\t ]+/gm, "")).toBe(input.replace(/^[\t ]+/gm, ""));
  });

  it("braces in strings and comments do not affect depth", () => {
    const input = 'a = {\nx = "}"\n# }\ny = 1\n}\n';
    const doc = mkdoc(input);
    expect(applyEdits(input, doc)).toBe('a = {\n\tx = "}"\n\t# }\n\ty = 1\n}\n');
  });

  it("leaves blank lines alone", () => {
    const input = "a = {\n\n\tx = 1\n}\n";
    const doc = mkdoc(input);
    expect(applyEdits(input, doc)).toBe(input);
  });
});

describe("error.log parsing", () => {
  it("parses the standard file/line entry", () => {
    const p = parseErrorLogLine(
      "[18:33:24][E][dlc_descriptor.cpp:70]: Invalid supported_version in file: mod/ugc_2220326926.mod line: 7\r"
    );
    expect(p).toMatchObject({ relFile: "mod/ugc_2220326926.mod", line: 6, severity: "error" });
    expect(p!.message).toContain("Invalid supported_version");
  });

  it("parses quoted paths and 'near line'", () => {
    const p = parseErrorLogLine(
      '[10:00:00][E][pdx.cpp:1]: Error: "Unexpected token" in file: "events/my_events.txt" near line: 5'
    );
    expect(p).toMatchObject({ relFile: "events/my_events.txt", line: 4 });
  });

  it("handles file-level entries without a line", () => {
    const p = parseErrorLogLine("[10:00:00][W][x.cpp:1]: something odd in file: common/traits/mine.txt");
    expect(p).toMatchObject({ relFile: "common/traits/mine.txt", line: null, severity: "warning" });
  });

  it("returns null for lines without a file", () => {
    expect(parseErrorLogLine("[10:00:00][E][x.cpp:1]: generic engine complaint")).toBeNull();
    expect(parseErrorLogLine("")).toBeNull();
  });

  // Vic3 writes no [E]/[W] tag and no `file:` keyword.
  it("parses the Vic3 bare `path.gui:NN - message` shape as an error", () => {
    const p = parseErrorLogLine(
      "[01:30:39][pdx_gui_layout.cpp:186]: gui/px_probe_b.gui:110 - Widget cannot have a position in a layout"
    );
    expect(p).toMatchObject({
      message: "Widget cannot have a position in a layout",
      relFile: "gui/px_probe_b.gui",
      line: 109,
      severity: "error",
    });
  });

  it("needs the ` - ` separator, so a bare path in prose is not a location", () => {
    expect(
      parseErrorLogLine("[01:30:39][x.cpp:1]: could not open gui/px_probe_b.gui:110 for reading")
    ).toBeNull();
  });
});

describe("error.log parsing (multi-line blocks)", () => {
  const BLOCK = [
    "[18:14:55][E][jomini_script_system.cpp:303]: Script system error!\r",
    "  Error: is_cultivator trigger [ Scoped object of type 'character' is not valid ((no character)) ]\r",
    "  Script location: file: common/script_values/cultivation_gui_values.txt line: 25 (cultivation_gui_is_cultivator)\r",
  ];

  it("uses the Error: line as the message, the location line for file/line", () => {
    const p = new ErrorLogParser();
    expect(p.push(BLOCK[0])).toBeNull();
    expect(p.push(BLOCK[1])).toBeNull();
    expect(p.push(BLOCK[2])).toMatchObject({
      message: "is_cultivator trigger [ Scoped object of type 'character' is not valid ((no character)) ]",
      relFile: "common/script_values/cultivation_gui_values.txt",
      line: 24,
      severity: "error",
    });
  });

  it("still drops console-command locations", () => {
    const p = new ErrorLogParser();
    p.push("[17:50:06][E][jomini_script_system.cpp:303]: Script system error!");
    p.push("  Error: add_legitimacy effect [ Scoped character doesn't have valid legitimacy type ]");
    expect(p.push("  Script location: file: effect console command line: 1")).toBeNull();
  });

  it("a new timestamped entry closes an open block", () => {
    const p = new ErrorLogParser();
    p.push(BLOCK[0]);
    p.push(BLOCK[1]);
    const single = p.push("[18:15:00][W][x.cpp:1]: something odd in file: common/traits/mine.txt");
    expect(single).toMatchObject({ relFile: "common/traits/mine.txt", severity: "warning" });
    // The stale Error: text must not leak into later blocks.
    p.push("[18:15:01][E][jomini_script_system.cpp:303]: Script system error!");
    const q = p.push("  Script location: file: events/other.txt line: 3 (name)");
    expect(q!.message).not.toContain("is_cultivator");
  });

  // Same block shape as CK3, but with no [E] tag on the header line.
  it("stitches an untagged Vic3 script-system block", () => {
    const p = new ErrorLogParser();
    expect(p.push("[15:35:19][jomini_script_system.cpp:265]: Script system error!")).toBeNull();
    expect(p.push("  Error: Undefined event target 'government_petition_ig'")).toBeNull();
    expect(
      p.push("  Script location: file: common/journal_entries/03_ig_agendas.txt line: 35")
    ).toMatchObject({
      message: "Undefined event target 'government_petition_ig'",
      relFile: "common/journal_entries/03_ig_agendas.txt",
      line: 34,
      severity: "error",
    });
  });

  it("passes single-line entries through unchanged", () => {
    const p = new ErrorLogParser();
    const single = p.push(
      "[18:33:24][E][dlc_descriptor.cpp:70]: Invalid supported_version in file: mod/ugc_2220326926.mod line: 7\r"
    );
    expect(single).toMatchObject({ relFile: "mod/ugc_2220326926.mod", line: 6, severity: "error" });
  });
});
