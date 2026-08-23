/**
 * What a textbox shows in the preview: keys resolve through the injected loc
 * lookup, `[datafunctions]` resolve only where knowable, everything else is
 * an honest chip, and formatting tags never reach the measurer.
 */
import { describe, expect, it } from "vitest";
import { resolveGuiText } from "../src/gui/textResolve";

const LOC: Record<string, string> = {
  my_title: "Imperial Council",
  fancy: "#bold Bold#! and §Yyellow§! text",
  greeting: "Hello [GetPlayer.GetName], welcome",
  concept_tax: "Taxation",
};
const r = { loc: (k: string) => LOC[k] };

describe("resolveGuiText", () => {
  it("resolves a bare key and keeps the key as the source", () => {
    expect(resolveGuiText("my_title", r)).toEqual({
      text: "Imperial Council",
      segments: [{ text: "Imperial Council", kind: "loc", source: "my_title", resolved: true }],
    });
  });

  it("strips formatting tags from a resolved value", () => {
    expect(resolveGuiText("fancy", r).text).toBe("Bold and yellow text");
  });

  it("marks an unknown key as unresolved but leaves a plain word alone", () => {
    expect(resolveGuiText("missing_key", r)).toEqual({
      text: "missing_key",
      segments: [{ text: "missing_key", kind: "loc", source: "missing_key", resolved: false }],
    });
    expect(resolveGuiText("Hello", r)).toEqual({ text: "Hello" });
    expect(resolveGuiText("Hello there", r)).toEqual({ text: "Hello there" });
  });

  it("turns datafunctions into chips, resolves Localize and Concept, honours preview values", () => {
    expect(resolveGuiText("[GetPlayer.GetName]", r)).toEqual({
      text: "Name",
      segments: [{ text: "Name", kind: "datafn", source: "GetPlayer.GetName", resolved: false }],
    });
    expect(resolveGuiText("[Localize('my_title')]", r).text).toBe("Imperial Council");
    expect(resolveGuiText("[Concept('concept_tax','Taxes')]", r).text).toBe("Taxes");
    expect(resolveGuiText("[Concept('concept_tax')]", r).text).toBe("Taxation");
    const withValues = { ...r, previewValues: { "GetPlayer.GetName": "Joel's Realm" } };
    expect(resolveGuiText("[GetPlayer.GetName]", withValues).text).toBe("Joel's Realm");
  });

  it("resolves datafunctions inside a loc value one level deep", () => {
    const out = resolveGuiText("greeting", r);
    expect(out.text).toBe("Hello Name, welcome");
    expect(out.segments?.map((s) => [s.kind, s.resolved])).toEqual([
      ["loc", true],
      ["datafn", false],
      ["loc", true],
    ]);
  });

  it("keeps literals with escaped brackets and mixed text", () => {
    expect(resolveGuiText("Gold: [GetPlayer.GetGold|0] [[units]", r).text).toBe("Gold: Gold [units]");
    expect(resolveGuiText("", r)).toEqual({ text: "" });
  });
});
