/**
 * Loc text-formatting harvest (server/src/data/textFormatting.ts): the
 * format-block shape, alias-chain resolution to a color, layer last-wins, and
 * the `#tag` completion/hover feature (server/src/features/locFormatting.ts).
 */
import { describe, expect, it } from "vitest";
import { TextFormattingIndex, rgbCss } from "../src/data/textFormatting";
import { provideFormatTagCompletion, provideFormatTagHover } from "../src/features/locFormatting";

const BASE = `textformatting = {
	format = { name = G format = "color:{0,1,0}" override = no }
	format = { name = R format = "color:{1,0,0}" override = no }
	format = { name = instruction format = "G;italic" override = no }
	format = { name = I format = "instruction" override = no }
	format = { name = editor_formatting override = no }
}`;

function baseIndex(): TextFormattingIndex {
  const idx = new TextFormattingIndex();
  idx.harvestText(BASE, "F:/game/../jomini/gui/jomini/basetextformatting.gui", "jomini");
  return idx;
}

describe("textformatting harvest", () => {
  it("parses the format blocks and engine built-ins", () => {
    const idx = baseIndex();
    expect(idx.names()).toContain("G");
    expect(idx.names()).toContain("I");
    // Engine built-ins are always present.
    expect(idx.names()).toContain("bold");
    expect(idx.names()).toContain("italic");
    expect(idx.winner("G")!.format).toBe("color:{0,1,0}");
    // Style-only tag (no format string) still harvests.
    expect(idx.winner("editor_formatting")!.format).toBe("");
  });

  it("resolves an alias chain to the base color", () => {
    const idx = baseIndex();
    const g = idx.resolve("G");
    expect(g.rgb).toEqual([0, 1, 0]);
    expect(rgbCss(g.rgb!)).toBe("rgb(0, 255, 0)");
    // I -> instruction -> G;italic -> G's color.
    const i = idx.resolve("I");
    expect(i.rgb).toEqual([0, 1, 0]);
    expect(i.chain).toEqual(["I", "instruction", "G", "italic"]);
  });

  it("is gui FIOS: a later definition without override does not replace the base", () => {
    const idx = baseIndex();
    idx.harvestText(
      `textformatting = {\n\tformat = { name = G format = "color:{0.5,0.5,0.5}" }\n}`,
      "F:/game/gui/preload/textformatting.gui",
      "game"
    );
    expect(idx.winner("G")!.layer).toBe("jomini");
    expect(idx.resolve("G").rgb).toEqual([0, 1, 0]);
  });

  it("a later definition with override = yes replaces the base", () => {
    const idx = baseIndex();
    idx.harvestText(
      `textformatting = {\n\tformat = { name = G format = "color:{0.5,0.5,0.5}" override = yes }\n}`,
      "F:/mod/gui/mod_formats.gui",
      "mod"
    );
    expect(idx.winner("G")!.layer).toBe("mod");
    expect(idx.resolve("G").rgb).toEqual([0.5, 0.5, 0.5]);
  });

  it("does not crash on an unknown / cyclic alias", () => {
    const idx = new TextFormattingIndex();
    idx.harvestText(
      `textformatting = {\n\tformat = { name = A format = "B" }\n\tformat = { name = B format = "A" }\n}`,
      "F:/game/gui/x.gui",
      "game"
    );
    expect(idx.resolve("A").rgb).toBeNull();
    expect(idx.resolve("A").chain).toEqual(["A", "B"]);
  });
});

describe("#tag completion in a loc value", () => {
  it("offers tag names after # inside a value string", () => {
    const idx = baseIndex();
    const res = provideFormatTagCompletion(idx, ` my_key:0 "some #`);
    expect(res).not.toBeNull();
    const labels = res!.items.map((i) => i.label);
    expect(labels).toContain("G");
    expect(labels).toContain("I");
    expect(labels).toContain("bold");
  });

  it("filters by the partial tag name", () => {
    const idx = baseIndex();
    const res = provideFormatTagCompletion(idx, ` my_key:0 "some #ins`);
    expect(res!.items.map((i) => i.label)).toContain("instruction");
    expect(res!.items.map((i) => i.label)).not.toContain("G");
  });

  it("returns null for a # outside a value string", () => {
    const idx = baseIndex();
    expect(provideFormatTagCompletion(idx, `# a comment #`)).toBeNull();
  });
});

describe("#tag hover in a loc value", () => {
  it("shows the format chain and resolved color", () => {
    const idx = baseIndex();
    const line = ` my_key:0 "text #I formatted#! more"`;
    const character = line.indexOf("#I") + 1;
    const hover = provideFormatTagHover(idx, line, character);
    expect(hover).not.toBeNull();
    expect(hover!.markdown).toContain("#I");
    expect(hover!.markdown).toContain("rgb(0, 255, 0)");
    expect(hover!.markdown.toLowerCase()).toContain("instruction");
  });

  it("returns null for an unknown tag", () => {
    const idx = baseIndex();
    const line = ` my_key:0 "text #zzz here"`;
    expect(provideFormatTagHover(idx, line, line.indexOf("#zzz") + 1)).toBeNull();
  });
});
