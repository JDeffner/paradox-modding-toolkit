import { describe, it, expect } from "vitest";
import { MODDING_GUIDES, moddingGuidesPage } from "../src/webviews/wiki/moddingGuides";

describe("modding guides", () => {
  it("builds one page with every game's wiki pages as cards", () => {
    const page = moddingGuidesPage({ ck3: "CK3", vic3: "Vic3", eu5: "EU5" });
    expect(Object.keys(MODDING_GUIDES)).toEqual(["ck3", "vic3", "eu5"]);
    // Every card leads to its wiki, says what the page covers, and names its game.
    for (const card of page.cards) {
      expect(card.url, card.title).toMatch(/^https:\/\/(ck3|vic3|eu5)\.paradoxwikis\.com\/[A-Za-z0-9_.-]+$/);
      expect(card.text, card.title).not.toBe("");
      expect(card.games, card.title).toHaveLength(1);
    }
    // No wiki path listed twice for one game.
    for (const [id, list] of Object.entries(MODDING_GUIDES)) {
      expect(new Set(list.pages.map((p) => p.path)).size, id).toBe(list.pages.length);
    }
    // The pages this started from.
    const ck3 = page.cards.filter((c) => c.games?.[0] === "ck3").map((c) => c.url);
    for (const p of ["Modding", "Sound_modding", "Music_modding", "Mod_compatibility"]) {
      expect(ck3).toContain(`https://ck3.paradoxwikis.com/${p}`);
    }
    expect(page.cards[0].kind).toBe("Basics");
    expect(page.outro).toContain("Sources:");
  });
});
