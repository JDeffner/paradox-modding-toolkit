import { describe, expect, it } from "vitest";
import type { WikiArticle, WikiCard } from "../src/webviews/wiki/messages";
import { articleSections, searchWiki } from "../src/webviews/wiki/search";

const card = (title: string, extra: Partial<WikiCard> = {}): WikiCard => ({
  title,
  url: "https://example.com",
  kind: "Tool",
  icon: "info",
  text: "A useful tool.",
  ...extra,
});
const article = (extra: Partial<WikiArticle> = {}): WikiArticle => ({
  id: "tools",
  title: "Modding Tools",
  section: "Community",
  markdown: "# Modding Tools\nChoose a tool.",
  ...extra,
});

describe("Wiki search", () => {
  it("preserves literal placeholders and script identifiers displayed in source examples", () => {
    const page = article({ markdown: "# Syntax\nUse <trait_name> in l_<language> files." });
    for (const query of ["trait_name", "l_<language>"]) {
      expect(searchWiki([page], "ck3", query)).toEqual([
        expect.objectContaining({ title: "Syntax", anchor: "wiki-heading-0" }),
      ]);
    }
  });

  it("filters individual cards by selected game and opens the original card index", () => {
    const tools = article({
      cards: [card("Other", { games: ["ck3"] }), card("Vicky-Mapgen", { games: ["vic3"] })],
    });
    expect(searchWiki([tools], "ck3", "Vicky-Mapgen")).toEqual([]);
    expect(searchWiki([tools], "vic3", "Vicky-Mapgen")).toEqual([
      expect.objectContaining({ title: "Vicky-Mapgen", page: "tools", anchor: "wiki-card-1" }),
    ]);
  });

  it("keeps visible same-word matches without matching hidden cards or duplicating their parent", () => {
    const tools = article({ cards: [card("Map helper", { games: ["vic3"] }), card("Shared map helper")] });
    expect(searchWiki([tools], "ck3", "map").map((hit) => hit.title)).toEqual(["Shared map helper"]);
  });

  it("searches card descriptions, kind, metadata, and secondary link labels", () => {
    const tools = article({
      cards: [
        card("Named tool", {
          text: "Convert pictures.",
          kind: "Utility",
          meta: "Maintainer",
          links: [{ label: "Setup guide", url: "https://example.com/setup" }],
        }),
      ],
    });
    for (const query of ["pictures", "utility", "maintainer", "setup guide"]) {
      expect(searchWiki([tools], "ck3", query)).toEqual([
        expect.objectContaining({ title: "Named tool", anchor: "wiki-card-0" }),
      ]);
    }
  });

  it("returns the containing section for a body match and distinct repeated heading targets", () => {
    const page = article({
      markdown: "# Modding Tools\nIntro.\n## Setup\nFirst step.\n## Setup\nSecond special step.",
    });
    expect(searchWiki([page], "ck3", "special")).toEqual([
      expect.objectContaining({ title: "Setup", anchor: "wiki-heading-2" }),
    ]);
    expect(searchWiki([page], "ck3", "setup").map((hit) => hit.anchor)).toEqual([
      "wiki-heading-1",
      "wiki-heading-2",
    ]);
    expect(searchWiki([page], "ck3", "modding tools")).toHaveLength(1);
  });

  it("ignores headings inside code fences and strips inline title markup", () => {
    const markdown = "Preamble.\n# **Overview**\n```text\n## Code example\n```\n### `Details`\nBody.";
    expect(articleSections(markdown)).toEqual([
      { title: "Overview", anchor: "wiki-heading-0", text: "## Code example\n" },
      { title: "Details", anchor: "wiki-heading-1", text: "Body.\n" },
    ]);
    expect(searchWiki([article({ markdown })], "ck3", "code example")[0].anchor).toBe("wiki-heading-0");
  });

  it("filters articles by game and supports title and preamble page destinations", () => {
    const pages = [
      article({ game: "vic3" }),
      article({ id: "shared", markdown: "Unique preamble.\n## Details\nBody." }),
    ];
    expect(searchWiki(pages, "ck3", "modding tools").map((hit) => hit.page)).toEqual(["shared"]);
    expect(searchWiki(pages, "ck3", "unique preamble")[0]).toMatchObject({ page: "shared" });
    expect(searchWiki(pages, "ck3", "unique preamble")[0].anchor).toBeUndefined();
    expect(searchWiki(pages, "ck3", " \n\t ")).toEqual([]);
  });

  it("ranks exact titles and title matches ahead of body matches with stable ties", () => {
    const tools = article({
      cards: [
        card("First", { text: "Map instructions." }),
        card("Map helper"),
        card("Map"),
        card("Another map"),
      ],
    });
    expect(searchWiki([tools], "ck3", " MAP ").map((hit) => hit.title)).toEqual([
      "Map",
      "Map helper",
      "Another map",
      "First",
    ]);
  });

  it("limits details and includes context near a match in a long body", () => {
    const tools = article({
      cards: [card("Named tool", { text: `${"Before ".repeat(100)}needle${" after".repeat(100)}` })],
    });
    const [hit] = searchWiki([tools], "ck3", "needle");
    expect(hit.detail.length).toBeLessThanOrEqual(140);
    expect(hit.detail).toContain("needle");
    expect(hit.detail).toContain("Modding Tools");
  });
});
