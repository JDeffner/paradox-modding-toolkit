import { describe, it, expect } from "vitest";
import { moddingToolsPage } from "../src/webviews/wiki/moddingTools";

describe("modding tools", () => {
  it("builds one page, a shared tool once naming every game it serves", () => {
    const page = moddingToolsPage({ ck3: "CK3", vic3: "Vic3", eu5: "EU5" });
    expect(page.cards.map((c) => c.kind)).toContain("Validation");
    // Every card leads somewhere, says what the tool does, wears an icon and names a game.
    for (const card of page.cards) {
      expect(card.url, card.title).toMatch(/^https?:\/\//);
      expect(card.text, card.title).not.toBe("");
      expect(card.icon, card.title).toBeTruthy();
      expect(card.games?.length, card.title).toBeGreaterThan(0);
    }
    // PDX DeepL is listed for Vic3 and EU5: one card, two games, no duplicate.
    const deepl = page.cards.filter((c) => c.title === "PDX DeepL");
    expect(deepl).toHaveLength(1);
    expect(deepl[0].games).toEqual(["vic3", "eu5"]);
    expect(page.outro).toContain("## Add a tool");
  });
});
