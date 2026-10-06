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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { characterBlock, characterForm, dynastyBlock, houseBlock } from "../src/webviews/dynastyTree/blocks";
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
\treligion = "catholic"
\tculture = "anglo_saxon"

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
    expect(edited.notes).toEqual([]);
    // A marriage stays where it stands rather than being re-dated.
    expect(edited.text).toContain("\t867.1.1 = {\n\t\tadd_spouse = 306020\n\t}\n");
    expect(edited.text.match(/add_spouse/g)).toHaveLength(1);
  });

  it("rewrites the keys the form owns", () => {
    expect(edited.text).toContain('\tname = "Alfred the Great" #the Great\n');
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

describe("source-preserving character history", () => {
  const rie = readFileSync(join(__dirname, "fixtures/rie-earendil.txt"), "utf8").replace(/\r\n/g, "\n");
  const melleth = readFileSync(join(__dirname, "fixtures/rie-melleth.txt"), "utf8").replace(/\r\n/g, "\n");

  it.each([rie, melleth, rie.replace(/\n/g, "\r\n"), PREVIOUS])(
    "keeps an unchanged form byte-identical",
    (source) => {
      expect(characterBlock(characterForm(source), source).text).toBe(source);
    }
  );

  it("changes a name and culture without changing comments, spacing or quotation style", () => {
    const source = rie.replace("culture = gondorian", "culture  =   gondorian # a comment with } {");
    const form = characterForm(source);
    form.name = "New_name_key";
    form.culture = "norse";
    expect(characterBlock(form, source).text).toBe(
      source.replace("E_a_arendil", "New_name_key").replace("gondorian #", "norse #")
    );
  });

  it("retains a death reason when death is the only dated statement", () => {
    const source = "42 = { name = Name\n  900.1.1 = { death = { death_reason = death_natural_causes } }\n}";
    const form = characterForm(source);
    expect(form.deathReason).toBe("death_natural_causes");
    form.name = "Changed";
    expect(characterBlock(form, source).text).toBe(source.replace("name = Name", "name = Changed"));
    // Callers without the new field must not erase what they do not model.
    delete form.deathReason;
    expect(characterBlock(form, source).text).toContain("death_reason = death_natural_causes");
  });

  it("changes only the death reason while preserving a killer and neighbouring effects", () => {
    const source = rie.replace(
      "death_reason = death_natural_causes",
      "death_reason  = death_murder # reason\n            killer = lineofanarion7"
    );
    const form = characterForm(source);
    form.deathReason = "death_battle";
    expect(characterBlock(form, source).text).toBe(source.replace("death_murder", "death_battle"));
  });

  it("adds and clears a simple reason, but refuses to discard extra death details", () => {
    const form = characterForm(melleth);
    form.deathReason = "death_natural_causes";
    const added = characterBlock(form, melleth).text;
    expect(added).toBe(melleth.replace("death = yes", "death = { death_reason = death_natural_causes }"));
    form.deathReason = "";
    expect(characterBlock(form, added).text).toBe(melleth);
    const killer = added.replace("death_natural_causes }", "death_murder killer = lineofanarion7 }");
    expect(() => characterBlock(form, killer)).toThrow("other details");
  });

  it("keeps trait groups and comments when one trait is removed and another added", () => {
    const form = characterForm(rie);
    form.traits = form.traits.filter((t) => t !== "generous");
    form.traits.push("just");
    const text = characterBlock(form, rie).text;
    expect(text).toContain(
      "trait = compassionate\n    trait = gregarious\n    trait = education_diplomacy_3\n\n\n    trait = blood_of_numenor_10"
    );
    expect(text).not.toContain("trait = generous");
    expect(text).toContain("    trait = just\n");
    expect(text).toContain("name = E_a_arendil # King of Gondor");
  });

  it("moves a death without moving its other dated effects or losing the reason", () => {
    const form = characterForm(rie);
    form.death = "4359.8.23";
    const text = characterBlock(form, rie).text;
    expect(text).toContain("4357.8.23 = {\n        make_trait_inactive = equipped_crown_of_gondor");
    expect(text).toContain("4359.8.23 = {\n        death = { death_reason = death_natural_causes }");
    expect(text.match(/death =/g)).toHaveLength(1);
    expect(characterForm(text).death).toBe("4359.8.23");
  });

  it("moves a literal birth date and preserves the effects at its previous date", () => {
    const source = PREVIOUS.replace("birth = yes", 'birth = "849.1.1"');
    const form = characterForm(source);
    form.birth = "850.1.1";
    const text = characterBlock(form, source).text;
    expect(text).toContain('birth = "850.1.1"');
    expect(text).toContain("849.1.1 = {\n\t\t\n\t\teffect = {");
    expect(characterForm(text).birth).toBe("850.1.1");
  });

  it("preserves same-date events and repeated dates while editing the first death", () => {
    const source =
      "42 = { name = Name\n  900.1.1 = { birth = yes death = { death_reason = death_murder killer = 5 } }\n  900.1.1 = { effect = { add_gold = 1 } }\n}";
    const form = characterForm(source);
    form.deathReason = "death_natural_causes";
    expect(characterBlock(form, source).text).toBe(source.replace("death_murder", "death_natural_causes"));
  });

  it("removes a spouse inside a mixed date without removing the other statements", () => {
    const source = rie.replace(
      "add_spouse = lineofmamandil16sister",
      "add_spouse = lineofmamandil16sister\n        effect = { add_gold = 1 }"
    );
    const form = characterForm(source);
    form.spouses = [];
    expect(characterBlock(form, source).text).toBe(source.replace("add_spouse = lineofmamandil16sister", ""));
  });

  it("preserves empty dated blocks, explicit female = no and script-valued skills on a no-op", () => {
    const source = "42 = { name = Name female = no martial = @skill 900.1.1 = { } }";
    expect(characterBlock(characterForm(source), source).text).toBe(source);
  });

  it("uses independent quotation defaults for new values and explicit choices for existing ones", () => {
    const defaults = { name: false, culture: false, religion: true };
    const generated = characterBlock(form, undefined, defaults).text;
    expect(generated).toContain("name = Eadgar");
    expect(generated).toContain("culture = anglo_saxon");
    expect(generated).toContain('religion = "catholic"');
    const existing = characterForm(rie);
    expect(characterBlock(existing, rie, { name: true, culture: true, religion: true }).text).toBe(rie);
    existing.quotes = { name: true, culture: true };
    expect(characterBlock(existing, rie).text).toBe(
      rie
        .replace("name = E_a_arendil", 'name = "E_a_arendil"')
        .replace("culture = gondorian", 'culture = "gondorian"')
    );
    expect(characterBlock({ ...form, name: "Two words" }, undefined, defaults).text).toContain(
      'name = "Two words"'
    );
  });

  it("writes one grouped block for events on the same date", () => {
    const text = characterBlock({ ...form, death: form.birth, deathReason: "death_natural_causes" }).text;
    expect(text.match(/943.8.7 =/g)).toHaveLength(1);
    expect(text).toContain("birth = yes\n\t\tdeath = { death_reason = death_natural_causes }");
  });

  it("refuses invalid inputs and incomplete marriages instead of partially writing a character", () => {
    expect(() => characterBlock({ ...form, death: undefined, deathReason: "death_murder" })).toThrow(
      "death date"
    );
    expect(() => characterBlock({ ...form, religion: "faith # injected" })).toThrow("identifier");
    expect(() => characterBlock({ ...form, death: "900.2.31" })).toThrow("valid history date");
    expect(() => characterBlock({ ...form, birth: undefined, spouses: ["5"] })).toThrow("marriage date");
  });
});
