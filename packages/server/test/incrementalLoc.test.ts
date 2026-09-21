import { afterEach, describe, expect, it } from "vitest";
import { TextDocument, type TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument";
import { IncrementalLoc } from "../src/parser/incrementalLoc";
import { LineIndex, parseLoc } from "../src/parser";
import { evictParse, getLocParse, updateDocumentWithParseCache } from "../src/parseCache";

let sequence = 0;
const uris: string[] = [];
function document(text: string) {
  const uri = `file:///incremental-${++sequence}_l_english.yml`;
  uris.push(uri);
  return TextDocument.create(uri, "paradox-loc", 1, text);
}
afterEach(() => {
  for (const uri of uris.splice(0)) evictParse(uri);
});

describe("incremental localization parsing", () => {
  it.each(["\n", "\r\n", "\r"])(
    "matches a fresh parse through edits and fallbacks with %j lines",
    (newline) => {
      const initial = [
        "\uFEFFl_english:",
        ' a:0 "one"',
        '\tb:0 "two"',
        " broken",
        ' a:0 "inner "quotes""',
        ' c:0 "unfinished',
        "# comment",
        "",
      ].join(newline);
      const state = new IncrementalLoc(initial);
      const edits: [number, number, number, string][] = [
        [1, 7, 0, "🌍"],
        [2, 0, 1, " "],
        [3, 0, 7, ' fixed:0 "ok"'],
        [5, 0, 0, "#"],
        [4, 0, 0, `# split${newline}`],
        [0, 0, 0, "#"],
        [0, 0, 1, ""],
        [1, 0, 0, `l_french:${newline}`],
      ];
      for (const edit of edits) expect(state.edit(...edit)).toEqual(parseLoc(state.text));
      expect(state.edit(1, 0, state.lines[1].length, "")).toEqual(parseLoc(state.text));
      expect(state.edit(0, 0, state.text.length, initial)).toEqual(parseLoc(initial));
      expect(state.edit(state.lines.length - 1, 0, 0, ' eof:0 "end"')).toEqual(parseLoc(state.text));
    }
  );

  it("keeps ranges and errors correct during a deterministic mixed edit sequence", () => {
    const state = new IncrementalLoc('l_english:\n a:0 "start"\n bad line\n b:0 "end"\n');
    let seed = 713;
    for (let i = 0; i < 200; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const line = 1 + (seed % (state.lines.length - 1));
      const length = state.lines[line].replace(/[\r\n]+$/, "").length;
      const character = seed % (length + 1);
      const remove = character < length && i % 3 === 0 ? 1 : 0;
      const insert = ["x", "", "🌍", '"', "#", "\t"][i % 6];
      expect(state.edit(line, character, remove, insert)).toEqual(parseLoc(state.text));
    }
  });

  it("preserves cached snapshots across a batch of sequential UTF-16 changes", () => {
    let doc = document('l_english:\n a:0 "one"\n b:0 "two"\n');
    const before = getLocParse(doc);
    const snapshot = structuredClone(before.result);
    const changes: TextDocumentContentChangeEvent[] = [
      { range: { start: { line: 1, character: 7 }, end: { line: 1, character: 7 } }, text: "🌍" },
      { range: { start: { line: 2, character: 7 }, end: { line: 2, character: 10 } }, text: "changed" },
    ];
    doc = updateDocumentWithParseCache(doc, changes, 2);
    const after = getLocParse(doc);
    expect(after.version).toBe(2);
    expect(after.result).toEqual(parseLoc(doc.getText()));
    expect(before.result).toEqual(snapshot);
    expect(getLocParse(doc)).toBe(after);
    const freshIndex = new LineIndex(doc.getText());
    for (const entry of after.result.entries)
      expect(after.lineIndex.positionAt(entry.valueRange.start)).toEqual(
        freshIndex.positionAt(entry.valueRange.start)
      );
  });

  it("handles full replacements, skipped cache versions and close/reopen without stale results", () => {
    let doc = document('l_english:\n a:0 "one"');
    getLocParse(doc);
    doc = updateDocumentWithParseCache(doc, [{ text: 'l_french:\n b:0 "deux"' }], 4);
    expect(getLocParse(doc).result).toEqual(parseLoc(doc.getText()));
    doc = TextDocument.update(doc, [{ text: 'l_english:\n c:0 "three"' }], 5);
    doc = updateDocumentWithParseCache(
      doc,
      [{ range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } }, text: "T" }],
      6
    );
    expect(getLocParse(doc).result).toEqual(parseLoc(doc.getText()));
    evictParse(doc.uri);
    doc = TextDocument.create(doc.uri, "paradox-loc", 1, 'l_english:\n reopened:0 "fresh"');
    expect(getLocParse(doc).result).toEqual(parseLoc(doc.getText()));
  });

  it("falls back to authoritative document text for clamped client ranges", () => {
    let doc = document('l_english:\n a:0 "one"');
    getLocParse(doc);
    doc = updateDocumentWithParseCache(
      doc,
      [{ range: { start: { line: 50, character: 0 }, end: { line: 50, character: 0 } }, text: "!" }],
      2
    );
    expect(getLocParse(doc).result).toEqual(parseLoc(doc.getText()));
  });

  it("updates a large document through the production cache entry point", () => {
    let doc = document(
      "l_english:\n" + Array.from({ length: 50_000 }, (_, i) => ` key_${i}:0 "value_${i}"\n`).join("")
    );
    getLocParse(doc);
    for (let i = 0; i < 4; i++) {
      doc = updateDocumentWithParseCache(
        doc,
        [
          {
            range: { start: { line: 25_000, character: 16 }, end: { line: 25_000, character: 16 + (i % 2) } },
            text: i % 2 ? "" : "X",
          },
        ],
        i + 2
      );
      expect(getLocParse(doc).result).toEqual(parseLoc(doc.getText()));
    }
  });
});
