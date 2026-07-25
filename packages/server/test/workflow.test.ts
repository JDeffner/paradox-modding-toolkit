import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideFormattingEdits } from "../src/features/formatting";
import { parseErrorLogLine } from "@px-lsp/protocol/errorLogParser";

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
});
