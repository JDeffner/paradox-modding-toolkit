/**
 * Coat-of-arms targets: the key the game reads a dynasty's, a house's, a
 * title's or a character's arms under, and what the app does when one arrives.
 *
 * The claim worth pinning down is the one the game fails silently on: a
 * character has NO coa key of their own, so a character pick must resolve to
 * their house and fall back to their dynasty. The block reader has to survive
 * the shape those facts actually come in (comments, quotes, dated sub-blocks
 * that hold effects, not facts).
 */
import { describe, expect, it } from "vitest";
import type { OverviewDef } from "../../protocol/src/protocol";
import {
  blockScalars,
  coaTargetArg,
  coaTargetItems,
  coaTargetLabel,
  COA_TARGET_KINDS,
  targetAction,
} from "../src/webviews/flagBuilder/target";

const kind = (id: string) => COA_TARGET_KINDS.find((k) => k.id === id)!;
const def = (name: string, line: number, file = "C:/mod/history/characters/persian.txt"): OverviewDef => ({
  name,
  file,
  line,
});

// The shape history/characters files have in the game (persian.txt).
const CHARACTERS = [
  "\ufeff6896 = {",
  '\tname = "Mahmud" # Fantasy',
  "\tdynasty = 855",
  "\tculture = persian",
  "\t845.1.1 = {",
  "\t\tbirth = yes",
  "\t\tdynasty = 999", // an effect in a dated block, not the character's fact
  "\t}",
  "}",
  "",
  "6897 = {",
  '\tname = "Farroukh"',
  "\tdynasty_house = house_khayyam",
  "\tdynasty = 856",
  "}",
  "",
  "6898 = {",
  '\tname = "Landless"',
  "}",
].join("\n");

describe("blockScalars", () => {
  it("reads the block's own scalars and stops at its closing brace", () => {
    expect(blockScalars(CHARACTERS, 0)).toEqual({ name: "Mahmud", dynasty: "855", culture: "persian" });
  });

  it("ignores assignments inside a dated sub-block", () => {
    expect(blockScalars(CHARACTERS, 0).dynasty).toBe("855");
  });

  it("reads a later block without seeing the earlier ones", () => {
    expect(blockScalars(CHARACTERS, 10)).toEqual({
      name: "Farroukh",
      dynasty_house: "house_khayyam",
      dynasty: "856",
    });
  });

  it("returns nothing for a line that opens no block", () => {
    // A coa alias (`98 = c_perigord`) and a stray line both land here.
    expect(blockScalars(CHARACTERS, 3)).toEqual({});
    expect(blockScalars("98 = c_perigord", 0)).toEqual({});
    expect(blockScalars(CHARACTERS, 999)).toEqual({});
  });
});

describe("coaTargetItems", () => {
  const scalars = (d: OverviewDef) => blockScalars(CHARACTERS, d.line);

  it("keys a character by their house, falling back to their dynasty", () => {
    const items = coaTargetItems(kind("character"), [def("6897", 10), def("6896", 0)], scalars);
    expect(items).toEqual([
      { key: "house_khayyam", title: "Farroukh", file: "C:/mod/history/characters/persian.txt" },
      { key: "855", title: "Mahmud", file: "C:/mod/history/characters/persian.txt" },
    ]);
  });

  it("leaves out a character with neither a house nor a dynasty", () => {
    // Nothing in the coa database would ever be read for them.
    expect(coaTargetItems(kind("character"), [def("6898", 16)], scalars)).toEqual([]);
  });

  it("keys a landed title by its own name, with no file read", () => {
    const never = () => {
      throw new Error("a landed title's key needs no block read");
    };
    const items = coaTargetItems(kind("landed_title"), [def("k_france", 3, "C:/mod/t.txt")], never);
    expect(items).toEqual([{ key: "k_france", title: "k_france", file: "C:/mod/t.txt" }]);
  });

  it("shows a dynasty's name over its numeric key", () => {
    const dynasties = '25061 = {\n\tname = "dynn_Karling"\n\tculture = frankish\n}';
    const items = coaTargetItems(kind("dynasty"), [def("25061", 0, "C:/mod/d.txt")], () =>
      blockScalars(dynasties, 0)
    );
    expect(items).toEqual([{ key: "25061", title: "dynn_Karling", file: "C:/mod/d.txt" }]);
    expect(coaTargetLabel(kind("dynasty"), items[0])).toBe("dynn_Karling (dynasty)");
  });
});

describe("targetAction", () => {
  const flags = [{ name: "house_luxemburg", source: "game", file: "90_dynasties.txt" }];

  it("opens the definition the key already has", () => {
    expect(targetAction("house_luxemburg", flags)).toEqual({ kind: "open", entry: flags[0] });
  });

  it("starts a fresh flag under a key nothing defines yet", () => {
    expect(targetAction("house_deffner", flags)).toEqual({ kind: "new", name: "house_deffner" });
  });
});

describe("coaTargetArg", () => {
  it("takes a name and a label", () => {
    expect(coaTargetArg({ name: "house_clare", label: "de Clare (house)" })).toEqual({
      name: "house_clare",
      label: "de Clare (house)",
    });
  });

  it("refuses anything that is not a legal key", () => {
    // The name becomes a definition key in a script file: no paths, no spaces.
    expect(coaTargetArg({ name: "../evil" })).toBeUndefined();
    expect(coaTargetArg({ name: "two words" })).toBeUndefined();
    expect(coaTargetArg({ name: 25061 })).toBeUndefined();
    expect(coaTargetArg(undefined)).toBeUndefined();
    expect(coaTargetArg("house_clare")).toBeUndefined();
  });

  it("drops an empty label rather than showing a blank line", () => {
    expect(coaTargetArg({ name: "25061", label: "   " })).toEqual({ name: "25061", label: undefined });
  });
});
