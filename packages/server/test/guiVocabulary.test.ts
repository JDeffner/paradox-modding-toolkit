/**
 * paradox/guiVocabulary: what a designer palette is allowed to offer.
 *
 * The claim under test is provenance. Every entry must come from the bundled
 * harvest or from the document itself, so the palette cannot invent a widget
 * name the game would reject, and the `container` flag must be read off the
 * harvest's own child counts rather than a list of container names.
 */
import { describe, expect, it } from "vitest";
import CK3_GUI_SCHEMA from "../data/ck3/guiSchema.json";
import {
  COMMON_PROPERTY_LIMIT,
  computeGuiVocabulary,
  TYPE_PROPERTY_LIMIT,
  VOCABULARY_LIMIT,
} from "../src/gui/vocabulary";

const DOC = [
  "types PxPaletteTypes {",
  "\ttype px_palette_card = widget {",
  "\t\tsize = { 40 40 }",
  "\t}",
  "}",
  "",
  "template PxPaletteDeco {",
  "\talpha = 0.5",
  "}",
  "",
  "widget = {",
  '\tname = "px_palette_root"',
  "}",
  "",
].join("\n");

describe("the palette's vocabulary comes from the harvest and the document", () => {
  it("puts the document's own declarations first, uncapped", () => {
    const { entries } = computeGuiVocabulary(DOC, CK3_GUI_SCHEMA);
    expect(entries.slice(0, 2)).toEqual([
      { name: "px_palette_card", kind: "type", local: true, base: "widget", container: true },
      // A template keeps the case it was declared with: `using = X` matches it
      // exactly, so a palette that lowercased it would write a dead reference.
      { name: "PxPaletteDeco", kind: "template", local: true },
    ]);
  });

  it("offers the harvested types by vanilla usage, and says what it capped", () => {
    const { entries, total } = computeGuiVocabulary(DOC, CK3_GUI_SCHEMA);
    const builtins = entries.filter((e) => e.kind === "builtin");
    expect(builtins).toHaveLength(VOCABULARY_LIMIT);
    expect(builtins[0].name).toBe("hbox");
    expect(builtins[0].count).toBeGreaterThan(builtins[1].count!);
    // The tail is left out, not pretended away.
    expect(total).toBeGreaterThan(entries.length);
  });

  it("marks a type a container when vanilla writes widgets inside it", () => {
    const by = new Map(computeGuiVocabulary(DOC, CK3_GUI_SCHEMA).entries.map((e) => [e.name, e]));
    for (const name of ["hbox", "vbox", "widget", "container", "flowcontainer", "window"]) {
      expect([name, by.get(name)?.container]).toEqual([name, true]);
    }
    // A spacer holds nothing, and `size`/`background` blocks do not make one.
    expect(by.get("spacer")?.container).toBe(false);
    expect(by.get("expand")?.container).toBe(false);
  });

  it("still answers for a game with no harvest, from the document alone", () => {
    const { entries, total } = computeGuiVocabulary(DOC, undefined);
    expect(entries.map((e) => e.name)).toEqual(["px_palette_card", "PxPaletteDeco"]);
    expect(total).toBe(2);
  });
});

/**
 * The other half of the vocabulary: what an inspector's add-property row is
 * allowed to offer. Same provenance rule as the widget names, so the row cannot
 * complete a property the vanilla tree never writes on that widget.
 */
describe("the property vocabulary", () => {
  it("ranks a named type's properties by vanilla usage", () => {
    const { properties } = computeGuiVocabulary(DOC, CK3_GUI_SCHEMA);
    // `widget` is named twice over: the document writes one, and its own
    // px_palette_card derives from it, which is where the type chain ends.
    expect(properties!.widget[0]).toBe("size");
    expect(properties!.widget).toContain("parentanchor");
    expect(properties!.widget.length).toBeLessThanOrEqual(TYPE_PROPERTY_LIMIT);
  });

  it("carries only the types the document names, not the whole harvest", () => {
    const { properties } = computeGuiVocabulary(DOC, CK3_GUI_SCHEMA);
    expect(Object.keys(properties!)).toEqual(["widget"]);
    // Named nowhere here, and the harvest holds hundreds like it.
    expect(properties!.progressbar).toBeUndefined();

    const withBox = computeGuiVocabulary(`${DOC}\nvbox = {\n\ticon = { }\n}\n`, CK3_GUI_SCHEMA);
    expect(Object.keys(withBox.properties!).sort()).toEqual(["icon", "vbox", "widget"]);
    expect(withBox.properties!.icon).toContain("texture");
  });

  it("offers the tree-wide ranking as the fallback for a type it does not know", () => {
    const { commonProperties } = computeGuiVocabulary(DOC, CK3_GUI_SCHEMA);
    expect(commonProperties![0]).toBe("name");
    expect(commonProperties!.length).toBe(COMMON_PROPERTY_LIMIT);
  });

  it("has nothing to offer for a game with no harvest, and says so with empties", () => {
    const { properties, commonProperties } = computeGuiVocabulary(DOC, undefined);
    expect(properties).toEqual({});
    expect(commonProperties).toEqual([]);
  });
});
