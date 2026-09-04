import { describe, it, expect } from "vitest";
import { GAME_METAS } from "../src/gameDetect";
import { MODDING_TOOLS, moddingToolsMarkdown } from "../src/webviews/wiki/moddingTools";

describe("modding tools", () => {
  it("lists tools only for supported games", () => {
    for (const id of Object.keys(MODDING_TOOLS)) expect(GAME_METAS[id]).toBeDefined();
  });

  it("gives every tool at least one web link", () => {
    for (const list of Object.values(MODDING_TOOLS)) {
      for (const tool of list.tools) {
        expect(tool.links.length, tool.name).toBeGreaterThan(0);
        for (const link of tool.links) expect(link.url, tool.name).toMatch(/^https?:\/\//);
      }
    }
  });

  it("builds a page per game and nothing for an unknown one", () => {
    const ck3 = moddingToolsMarkdown("ck3", "Crusader Kings III");
    expect(ck3).toContain("## Validation");
    expect(ck3).toContain("## Add a tool");
    expect(moddingToolsMarkdown("nope", "x")).toBeUndefined();
  });
});
