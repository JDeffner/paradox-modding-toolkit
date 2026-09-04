/**
 * The decisions inside the creators' shared field widgets: what a search box
 * keeps, what a chip list does to a value that is already there, how a modifier
 * row reaches script, and the two things every creator's form depends on being
 * true (an empty input shows an example, and a picker reads the player's word
 * for a definition while still naming the key that gets written).
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  addChip,
  filterVocabulary,
  modifierRowsToScript,
  refField,
  removeChip,
  textField,
  titleCaseFromName,
} from "../src/webviews/shared/fields";

const TRAITS = [
  { value: "brave", doc: "Courage in war and in council.", hint: "game" },
  { value: "craven", doc: "Avoids every risk.", hint: "game" },
  { value: "px_stoic", doc: "Feels nothing, says less.", hint: "this mod" },
];

describe("filterVocabulary", () => {
  it("matches the name, the source badge, the doc line and the loc-resolved label, either case", () => {
    expect(filterVocabulary(TRAITS, "brav").map((i) => i.value)).toEqual(["brave"]);
    expect(filterVocabulary(TRAITS, "this mod").map((i) => i.value)).toEqual(["px_stoic"]);
    // The sentence, not the key: what a modder remembers about a trait.
    expect(filterVocabulary(TRAITS, "risk").map((i) => i.value)).toEqual(["craven"]);
    expect(filterVocabulary(TRAITS, "COURAGE").map((i) => i.value)).toEqual(["brave"]);
    // The name a picker actually shows, when loc resolved one.
    const labelled = [{ value: "px_stoic", label: "Stoic" }, { value: "brave" }];
    expect(filterVocabulary(labelled, "stoi").map((i) => i.value)).toEqual(["px_stoic"]);
  });

  it("keeps the source order and answers everything for an empty query", () => {
    expect(filterVocabulary(TRAITS, "  ").map((i) => i.value)).toEqual(["brave", "craven", "px_stoic"]);
    expect(filterVocabulary(TRAITS, "a").map((i) => i.value)).toEqual(["brave", "craven", "px_stoic"]);
  });
});

describe("chips", () => {
  it("adds at the end and never twice, removes by value and leaves the rest in order", () => {
    expect(addChip(["brave"], "craven")).toEqual(["brave", "craven"]);
    expect(addChip(["brave", "craven"], "brave")).toEqual(["brave", "craven"]);
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
});

describe("placeholders", () => {
  it("shows the example the caller gave as the input's own placeholder", () => {
    const field = textField({ label: "Category", placeholder: "personality" });
    const input = field.el.querySelector("input")!;
    expect(input.placeholder).toBe("personality");
    // No example: the input says nothing rather than inventing an instruction.
    expect(textField({ label: "Category" }).el.querySelector("input")!.placeholder).toBe("");
  });
});

describe("refField picker", () => {
  // jsdom has no layout, so the menu's "keep the active row in view" call has
  // nothing to do here.
  Element.prototype.scrollIntoView = (): undefined => undefined;

  const open = (items: Parameters<typeof refField>[0]["items"]): HTMLElement[] => {
    document.body.replaceChildren();
    const field = refField({ label: "Opposite", items });
    document.body.append(field.el);
    field.el.querySelector<HTMLButtonElement>("button")!.click();
    return [...document.body.querySelectorAll<HTMLElement>(".px-menu-item")];
  };

  it("reads the player's word, keeps the key as the hint, and leads with the key when loc has none", () => {
    const rows = open([
      { value: "brave", label: "Brave", hint: "game" },
      { value: "px_stoic", hint: "this mod" },
    ]);
    const named = rows.find((r) => r.textContent?.includes("Brave"))!;
    expect(named.querySelector(".px-grow")!.textContent).toBe("Brave");
    expect(named.querySelector(".px-menu-hint")!.textContent).toBe("brave");
    const bare = rows.find((r) => r.textContent?.includes("px_stoic"))!;
    expect(bare.querySelector(".px-grow")!.textContent).toBe("px_stoic");
    expect(bare.querySelector(".px-menu-hint")!.textContent).toBe("this mod");
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
