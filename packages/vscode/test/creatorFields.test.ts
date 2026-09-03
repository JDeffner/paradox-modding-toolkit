/**
 * The decisions inside the creators' shared field widgets: what a search box
 * keeps, what a chip list does to a value that is already there, and how a
 * modifier row reaches script. The DOM these functions dress is checked by the
 * gallery and by the trait creator's jsdom boot; these are the parts a reader
 * cannot verify by eye.
 */
import { describe, expect, it } from "vitest";
import {
  addChip,
  filterVocabulary,
  modifierRowsToScript,
  removeChip,
  titleCaseFromName,
} from "../src/webviews/shared/fields";

const TRAITS = [
  { value: "brave", doc: "Courage in war and in council.", hint: "game" },
  { value: "craven", doc: "Avoids every risk.", hint: "game" },
  { value: "px_stoic", doc: "Feels nothing, says less.", hint: "this mod" },
];

describe("filterVocabulary", () => {
  it("matches the name, the source badge and the doc line", () => {
    expect(filterVocabulary(TRAITS, "brav").map((i) => i.value)).toEqual(["brave"]);
    expect(filterVocabulary(TRAITS, "this mod").map((i) => i.value)).toEqual(["px_stoic"]);
    // The sentence, not the key: what a modder remembers about a trait.
    expect(filterVocabulary(TRAITS, "risk").map((i) => i.value)).toEqual(["craven"]);
  });

  it("keeps the source order and answers everything for an empty query", () => {
    expect(filterVocabulary(TRAITS, "  ").map((i) => i.value)).toEqual(["brave", "craven", "px_stoic"]);
    expect(filterVocabulary(TRAITS, "a").map((i) => i.value)).toEqual(["brave", "craven", "px_stoic"]);
  });

  it("ignores case on both sides", () => {
    expect(filterVocabulary(TRAITS, "COURAGE").map((i) => i.value)).toEqual(["brave"]);
  });
});

describe("chips", () => {
  it("adds at the end and never twice", () => {
    expect(addChip(["brave"], "craven")).toEqual(["brave", "craven"]);
    expect(addChip(["brave", "craven"], "brave")).toEqual(["brave", "craven"]);
  });

  it("removes by value and leaves the rest in order", () => {
    expect(removeChip(["brave", "craven", "px_stoic"], "craven")).toEqual(["brave", "px_stoic"]);
    expect(removeChip(["brave"], "nothing")).toEqual(["brave"]);
  });
});

describe("modifierRowsToScript", () => {
  it("writes one statement per row, no indentation", () => {
    expect(
      modifierRowsToScript([
        { name: "monthly_prestige", value: 0.5 },
        { name: "health", value: -1 },
      ])
    ).toBe("monthly_prestige = 0.5\nhealth = -1");
  });

  it("drops a row whose modifier was never picked", () => {
    expect(modifierRowsToScript([{ name: "", value: 3 }])).toBe("");
    expect(
      modifierRowsToScript([
        { name: " ", value: 3 },
        { name: "health", value: 1 },
      ])
    ).toBe("health = 1");
  });

  it("writes an integer without a decimal point", () => {
    expect(modifierRowsToScript([{ name: "health", value: 2 }])).toBe("health = 2");
  });
});

describe("titleCaseFromName", () => {
  it("turns a definition key into the loc value a creator prefills", () => {
    expect(titleCaseFromName("px_iron_willed")).toBe("Px Iron Willed");
    expect(titleCaseFromName("brave")).toBe("Brave");
    expect(titleCaseFromName("px__odd___name")).toBe("Px Odd Name");
    expect(titleCaseFromName("")).toBe("");
  });
});
