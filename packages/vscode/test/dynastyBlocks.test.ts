/**
 * The script the Dynasty Tree writes. The shapes are the vanilla ones (key
 * counts in packages/server/src/overview/dynastyTree.ts): a character carries
 * its keys at its own level and its dates as blocks, a dynasty carries a loc
 * key and a culture, a house carries a loc key and its dynasty.
 *
 * The round trip is the load-bearing case: editing a character must not throw
 * away the statements the form does not model.
 */
import { describe, expect, it } from "vitest";
import { characterBlock, dynastyBlock, houseBlock } from "../src/webviews/dynastyTree/blocks";
import type { CharacterForm } from "../src/webviews/dynastyTree/messages";

const form: CharacterForm = {
  id: "1000001",
  name: "Eadgar",
  female: false,
  house: "house_test_wessex",
  father: "1000000",
  culture: "anglo_saxon",
  religion: "catholic",
  birth: "943.8.7",
  death: "975.7.8",
  traits: ["honest", "education_diplomacy_4"],
  spouses: [],
};

describe("characterBlock", () => {
  it("writes the keys at the character's level and the dates as blocks", () => {
    expect(characterBlock(form).text).toBe(
      `1000001 = {
\tname = "Eadgar"
\tdynasty_house = house_test_wessex
\tculture = "anglo_saxon"
\treligion = "catholic"
\tfather = 1000000
\ttrait = honest
\ttrait = education_diplomacy_4
\t943.8.7 = {
\t\tbirth = yes
\t}
\t975.7.8 = {
\t\tdeath = yes
\t}
}
`
    );
  });

  it("writes female = yes only for a woman, and a dynasty only without a house", () => {
    const woman = characterBlock({ ...form, female: true, house: undefined, dynasty: "1000" }).text;
    expect(woman).toContain("\tfemale = yes\n");
    expect(woman).toContain("\tdynasty = 1000\n");
    expect(woman).not.toContain("dynasty_house");

    // With only a name typed the block is still saveable, and says nothing.
    const bare = characterBlock({ id: "42", name: "Nn", female: false, traits: [], spouses: [] });
    expect(bare.text).toBe(`42 = {\n\tname = "Nn"\n}\n`);
    expect(bare.notes).toEqual([]);
  });

  it("marries a spouse in a dated block, and dates the marriage from the form", () => {
    const text = characterBlock({ ...form, spouses: ["1000002"], marriageDate: "965.3.1" }).text;
    expect(text).toContain("\t965.3.1 = {\n\t\tadd_spouse = 1000002\n\t}\n");
    // Dated blocks come out in date order, whatever order the form built them.
    expect(text.indexOf("943.8.7")).toBeLessThan(text.indexOf("965.3.1"));
    expect(text.indexOf("965.3.1")).toBeLessThan(text.indexOf("975.7.8"));
  });
});

/** A real vanilla character: skills, a dna line, an effect inside the birth. */
const PREVIOUS = `7627 = {
\tname = Alfred #the Great
\tdna = 7627_earl_alfred
\tdynasty_house = house_british_isles_wessex
\tmartial = 11
\tlearning = 13
\treligion = catholic
\tculture = anglo_saxon
\ttrait = honest
\tsexuality = heterosexual
\tfather = 33355 #(Aethelwulf)
\t849.1.1 = {
\t\tbirth = yes
\t\teffect = {
\t\t\tadd_character_flag = has_scripted_appearance
\t\t}
\t}
\t867.1.1 = {
\t\tadd_spouse = 306020
\t}
\t899.10.26 = {
\t\tdeath = yes
\t}
}`;

describe("characterBlock round trip", () => {
  const edited = characterBlock(
    {
      id: "7627",
      name: "Alfred the Great",
      female: false,
      house: "house_british_isles_wessex",
      father: "33355",
      culture: "anglo_saxon",
      religion: "catholic",
      birth: "849.1.1",
      death: "899.10.26",
      dna: "7627_earl_alfred",
      skills: { martial: 11, learning: 13 },
      traits: ["honest", "just"],
      spouses: ["306020"],
    },
    PREVIOUS
  );

  it("writes the dna and the skills back unchanged, and keeps what the form does not model", () => {
    for (const line of ["\tdna = 7627_earl_alfred", "\tmartial = 11", "\tlearning = 13"]) {
      expect(edited.text).toContain(`${line}\n`);
    }
    // Once each: the form owns them now, so the source lines are not kept too.
    expect(edited.text.match(/martial = /g)).toHaveLength(1);
    // `sexuality` is no field of the form's, so it survives byte for byte.
    expect(edited.text).toContain("\tsexuality = heterosexual\n");
  });

  // A skill written as a script value never becomes a number in the form, so
  // the form must not be allowed to write it away.
  it("keeps a skill the form could not read as a number", () => {
    const kept = characterBlock(
      { id: "7627", name: "Alfred", female: false, traits: [], spouses: [] },
      `7627 = {\n\tname = Alfred\n\tmartial = @heroic_martial\n}`
    );
    expect(kept.text).toContain("\tmartial = @heroic_martial\n");
  });

  it("keeps a dated block that carries more than a birth, exactly as written", () => {
    expect(edited.text).toContain(
      "\t849.1.1 = {\n\t\tbirth = yes\n\t\teffect = {\n\t\t\tadd_character_flag = has_scripted_appearance\n\t\t}\n\t}\n"
    );
    // It was kept, so the form's birth was not written a second time.
    expect(edited.text.match(/birth = yes/g)).toHaveLength(1);
    expect(edited.notes.some((n) => n.includes("849.1.1"))).toBe(true);
    // A marriage stays where it stands rather than being re-dated.
    expect(edited.text).toContain("\t867.1.1 = {\n\t\tadd_spouse = 306020\n\t}\n");
    expect(edited.text.match(/add_spouse/g)).toHaveLength(1);
  });

  it("rewrites the keys the form owns", () => {
    expect(edited.text).toContain('\tname = "Alfred the Great"\n');
    expect(edited.text).toContain("\ttrait = honest\n\ttrait = just\n");
    expect(edited.text).not.toContain("name = Alfred #the Great");
    // A simple date block IS the form's, so the death is regenerated once.
    expect(edited.text.match(/death = yes/g)).toHaveLength(1);
  });

  it("drops a spouse the form removed", () => {
    const without = characterBlock(
      { id: "7627", name: "Alfred", female: false, traits: [], spouses: [] },
      PREVIOUS
    );
    expect(without.text).not.toContain("add_spouse");
  });
});

describe("dynastyBlock and houseBlock", () => {
  it("writes a dynasty as its loc key and culture, and a house as its loc key and its dynasty", () => {
    expect(dynastyBlock({ id: "1000000", nameKey: "dynn_Testing", culture: "anglo_saxon" })).toBe(
      `1000000 = {\n\tname = "dynn_Testing"\n\tculture = "anglo_saxon"\n}\n`
    );
    // No culture in the form, no culture line.
    expect(dynastyBlock({ id: "1000000", nameKey: "dynn_Testing" })).toBe(
      `1000000 = {\n\tname = "dynn_Testing"\n}\n`
    );
    expect(houseBlock({ id: "house_testing", nameKey: "dynn_Testing", dynasty: "1000000" })).toBe(
      `house_testing = {\n\tname = "dynn_Testing"\n\tdynasty = 1000000\n}\n`
    );
  });
});
