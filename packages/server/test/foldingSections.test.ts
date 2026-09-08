import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideFoldingRanges } from "../src/features/folding";

let serial = 0;
function fold(text: string, language = "paradox") {
  return provideFoldingRanges(TextDocument.create(`file:///sections-${serial++}.txt`, language, 1, text));
}
function region(startLine: number, endLine: number) {
  return { startLine, endLine, kind: "region" };
}

describe("comment section folding", () => {
  it.each([
    "paradox",
    "paradox-ck3",
    "paradox-vic3",
    "paradox-eu5",
    "paradox-gui",
    "paradox-mod",
    "paradox-info",
  ])("folds short and long headings in %s, including multiple code blocks", (language) => {
    const ranges = fold(
      [
        "### Gumagan",
        "# travelers, 1 move",
        "first = {",
        " x = 1",
        "}",
        "second = { y = 2 }",
        "",
        "######## Makara",
        "# diplomats, 1 move",
        "third = { z = 3 }",
      ].join("\n"),
      language
    );
    expect(ranges).toContainEqual(region(0, 6));
    expect(ranges).toContainEqual(region(7, 9));
    expect(ranges).toContainEqual({ startLine: 2, endLine: 3 });
    expect(ranges.filter((r) => r.startLine === 0)).toHaveLength(1);
  });

  it("ends at the next heading regardless of indentation or brace depth", () => {
    const ranges = fold(
      [
        "### Outer",
        "outer = {",
        "  ### Inner one",
        "  x = 1",
        "  ######## Inner two",
        "  y = 2",
        "}",
        "### Next",
        "z = 3",
      ].join("\n")
    );
    expect(ranges.filter((r) => r.kind === "region")).toEqual([
      region(0, 1),
      region(2, 3),
      region(4, 6),
      region(7, 8),
    ]);
    expect(ranges).not.toContainEqual({ startLine: 1, endLine: 5 });
  });

  it("crosses closing braces and sibling blocks until the next heading or EOF", () => {
    const ranges = fold("a = {\n ### A\n x = 1\n}\nb = {\n ### B\n y = 2\n}");
    expect(ranges).toEqual([region(1, 4), region(5, 7)]);
  });

  it("keeps compatible brace folds while giving sections priority over crossing folds", () => {
    const ranges = fold("outer = {\n ### A\n inner = {\n  x = 1\n }\n}\nafter = 2");
    expect(ranges).toContainEqual(region(1, 6));
    expect(ranges).toContainEqual({ startLine: 2, endLine: 3 });
    expect(ranges).not.toContainEqual({ startLine: 0, endLine: 4 });
  });

  it("ignores short comments, hash-only separators, inline comments and quoted hashes", () => {
    const ranges = fold('# One\n## Two\n########\nx = "### String"\ny = 1 ### Inline\nz = 2');
    expect(ranges.some((r) => r.kind === "region")).toBe(false);
    expect(ranges).toContainEqual({ startLine: 0, endLine: 2, kind: "comment" });
  });

  it("handles a BOM, tabs, CRLF and a heading without a space", () => {
    expect(
      fold("\uFEFF\t###First\r\nx = 1\r\n\t######## Second\r\ny = 2").filter((r) => r.kind === "region")
    ).toEqual([region(0, 1), region(2, 3)]);
  });

  it("does not let comment-only folds compete with or cross section headings", () => {
    const ranges = fold("# Intro\n# Notes\n### A\n# Help\n# More help\nx = 1\n### B\ny = 2");
    expect(ranges.filter((r) => r.kind === "comment")).toEqual([
      { startLine: 0, endLine: 1, kind: "comment" },
      { startLine: 3, endLine: 4, kind: "comment" },
    ]);
    expect(ranges).toContainEqual(region(2, 5));
  });

  it("omits empty sections and folds an unclosed block through EOF", () => {
    expect(fold("### Empty\n######## Next\nx = 1").filter((r) => r.kind === "region")).toEqual([
      region(1, 2),
    ]);
    expect(fold("a = {\n ### Open\n x = 1")).toContainEqual(region(1, 2));
    expect(fold("### EOF")).toEqual([]);
  });

  it("folds localization sections while preserving the language-body fold", () => {
    const ranges = fold(
      '\uFEFFl_english:\n ### Names\n name:0 "Name"\n ######## Descriptions\n desc:0 "Description"',
      "paradox-loc"
    );
    expect(ranges).toContainEqual({ startLine: 0, endLine: 4 });
    expect(ranges.filter((r) => r.kind === "region")).toEqual([region(1, 2), region(3, 4)]);
  });

  it("extends localization sections through trailing comments to EOF", () => {
    const ranges = fold('l_english:\n ### Names\n name:0 "Name"\n# Trailer\n# Notes', "paradox-loc");
    expect(ranges).not.toContainEqual({ startLine: 0, endLine: 2 });
    expect(ranges).toContainEqual(region(1, 4));
  });
});
