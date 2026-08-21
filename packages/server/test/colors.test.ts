import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { provideColorPresentations, provideDocumentColors } from "../src/features/colors";

let n = 0;
const doc = (text: string, lang = "paradox") =>
  TextDocument.create(`file:///colors-${n++}.txt`, lang, 1, text);
const rgb255 = (c: { red: number; green: number; blue: number }) =>
  [c.red, c.green, c.blue].map((x) => Math.round(x * 255));

describe("documentColor, the vanilla forms", () => {
  it("rgb is 0..255, hex has no 0x, both carry the whole value as the range", () => {
    const d = doc("color1 = rgb { 174 169 166 }\nx = hex { 50779b }");
    const [a, b] = provideDocumentColors(d);
    expect(rgb255(a.color)).toEqual([174, 169, 166]);
    expect(d.getText(a.range)).toBe("rgb { 174 169 166 }");
    expect(rgb255(b.color)).toEqual([0x50, 0x77, 0x9b]);
    expect(b.format).toBe("hex");
  });

  it("hsv hue is 0..1 (Jomini), hsv360 is 0..360 with s/v in percent", () => {
    const d = doc("a = hsv { 0.6 0.5 0.7 }\nb = hsv360 { 216 50 70 }");
    const [a, b] = provideDocumentColors(d);
    // Both spell the same blue; a naive h/360 would paint `a` near red.
    expect(rgb255(a.color)).toEqual([89, 125, 179]);
    expect(rgb255(b.color)).toEqual(rgb255(a.color));
  });

  it("untagged blocks need a color key; { 1 1 1 } is white, { 255 0 0 } is red", () => {
    const d = doc(
      "color = { 1 1 1 }\nmap_color = { 255 0 0 }\nposition = { 1 1 1 }\ncolor = { .9 .9 .9 1.0 }",
      "paradox-gui"
    );
    const hits = provideDocumentColors(d);
    expect(hits.map((h) => [h.format, ...rgb255(h.color)])).toEqual([
      ["float", 255, 255, 255],
      ["int", 255, 0, 0],
      ["float", 230, 230, 230],
    ]);
    expect(hits[2].alpha).toBe(true);
  });

  it("portrait genes are palette coordinates, not colors", () => {
    const d = doc("hair_color = { 32 235 66 229 }\nskin_color={ 0 0 0 0 }\neye_color = { 1 1 1 1 }");
    expect(provideDocumentColors(d)).toEqual([]);
  });

  it("a named_colors table makes every entry a color", () => {
    const d = doc("colors = {\n english = { 0.8 0.2 0.2 }\n todo = rgb { 1 0.4 0.6 }\n}");
    const hits = provideDocumentColors(d);
    expect(hits.map((h) => rgb255(h.color))).toEqual([
      [204, 51, 51],
      [255, 102, 153],
    ]);
  });

  it("ignores blocks that are not three or four numbers", () => {
    const d = doc('color = { 1 2 }\ncolor = { a b c }\ncolor = { 1 2 3 4 5 }\ncolor = rgb { "1" 2 3 }');
    expect(provideDocumentColors(d)).toEqual([]);
  });
});

describe("colorPresentation, the multi-format cycle", () => {
  it("leads with the author's notation and offers every other form", () => {
    const d = doc("color = hsv { 0.6 0.5 0.7 }");
    const [site] = provideDocumentColors(d);
    const labels = provideColorPresentations(d, site.color, site.range).map((p) => p.label);
    expect(labels[0]).toBe("hsv { 0.6 0.5 0.7 }");
    expect(labels).toContain("rgb { 89 125 179 }");
    expect(labels).toContain("hsv360 { 216 50 70 }");
    expect(labels).toContain("hex { 597db3 }");
    expect(labels).toContain("{ 89 125 179 }");
    expect(labels).toHaveLength(6);
  });

  it("keeps a spelled alpha and drops an implicit one", () => {
    const d = doc("color = { 0.5 0.5 0.5 0.25 }\ncolor = { 128 128 128 }");
    const [a, b] = provideDocumentColors(d);
    expect(provideColorPresentations(d, a.color, a.range)[0].label).toBe("{ 0.5 0.5 0.5 0.25 }");
    expect(provideColorPresentations(d, b.color, b.range)[0].label).toBe("{ 128 128 128 }");
  });
});
