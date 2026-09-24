import { describe, it, expect } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { PATHS } from "../src/webviews/shared/icons";
import { actionGroups, visibleActionGroups } from "../src/webviews/dashboard/actions";

/** Every command id the panel offers for a game, groups flattened. */
function commands(groups: ReturnType<typeof actionGroups>): string[] {
  return groups.flatMap((g) => g.items.map((it) => it.command));
}

describe("visibleActionGroups", () => {
  it("drops the hidden rows and keeps the rest", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.showEventGraph", "px.showExamplesWiki"]);
    const ids = commands(groups);
    expect(ids).not.toContain("px.showEventGraph");
    expect(ids).not.toContain("px.showExamplesWiki");
    expect(ids).toContain("px.simulateEvent");
    expect(ids).toContain("px.convertToDds");
  });

  it("drops a group whose rows are all hidden", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.openWorkshopManager", "px.openWorkshopPage"]);
    expect(groups.map((g) => g.label)).not.toContain("Publish");
    expect(groups.map((g) => g.label)).toContain("View");
  });

  it("groups the reference and community links under Info, above Create", () => {
    const groups = actionGroups(ck3Meta, 0);
    const info = groups.find((g) => g.label === "Info");
    expect(info?.items.map((it) => it.command)).toEqual([
      "px.getStarted",
      "px.openDiscord",
      "px.openWiki",
      "px.openCredits",
      "px.showExamplesWiki",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Workspace Mods",
      "View",
      "Utils",
      "Publish",
      "Info",
      "Create",
      "Test & Troubleshoot",
    ]);
    // The wiki rows moved out of View, they are not listed twice.
    const view = groups.find((g) => g.label === "View");
    expect(view?.items.map((it) => it.command)).not.toContain("px.openWiki");
    expect(view?.items.map((it) => it.command)).not.toContain("px.showExamplesWiki");
  });

  it("the designer is ONE row, in Create, and never a second one in View", () => {
    const groups = actionGroups(ck3Meta, 0);
    const ids = commands(groups);
    expect(ids.filter((id) => id === "px.createCoatOfArms")).toHaveLength(1);
    // The View row (px.openFlagBuilder) read as a second tool; the palette
    // command stays, the panel row does not.
    expect(ids).not.toContain("px.openFlagBuilder");
    const row = groups
      .find((g) => g.label === "Create")!
      .items.find((it) => it.command === "px.createCoatOfArms");
    expect(row?.label).toBe("Coat of Arms Designer");
    // A game with no designer files gets the honest label for what opens.
    const eu5 = actionGroups(eu5Meta, 0)
      .find((g) => g.label === "Create")!
      .items.find((it) => it.command === "px.createCoatOfArms");
    expect(eu5?.label).toBe("Flag Builder");
  });

  it("ignores ids that match no row", () => {
    const all = visibleActionGroups(ck3Meta, 0, []);
    const withJunk = visibleActionGroups(ck3Meta, 0, ["px.notARow", ""]);
    expect(withJunk).toEqual(all);
  });

  it("keeps working for a game without a tiger", () => {
    // Every row the Create group has for a game without creators: hiding all
    // of them is what drops the group.
    const groups = visibleActionGroups(eu5Meta, 0, ["px.newContent", "px.createMod", "px.createCoatOfArms"]);
    const ids = commands(groups);
    expect(ids).not.toContain("px.newContent");
    expect(ids).not.toContain("px.tigerCreateBaseline");
    expect(groups.map((g) => g.label)).not.toContain("Create");
    // No tiger and no problems leaves no command rows; the view still renders its switches.
    expect(groups.map((g) => g.label)).not.toContain("Test & Troubleshoot");
  });

  it("lists the game's creators after New Content, with New Mod under Workspace Mods", () => {
    const create = actionGroups(ck3Meta, 0).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).toEqual([
      "px.newContent",
      "px.createTrait",
      "px.createDynastyLegacy",
      "px.createCulture",
      "px.createTradition",
      "px.openDynastyTree",
      "px.createCoatOfArms",
    ]);
    expect(create?.items.map((it) => it.label)).toContain("Trait Creator");
    expect(
      actionGroups(ck3Meta, 0)
        .find((g) => g.label === "Workspace Mods")
        ?.items.map((it) => it.command)
    ).toEqual(["px.openMod", "px.createMod"]);
  });

  it("every creator row names an icon the client actually ships", () => {
    for (const creator of ck3Meta.creators ?? []) {
      expect(Object.keys(PATHS)).toContain(creator.icon);
    }
  });

  it("a game with no creators keeps its scaffold and flag tools in Create", () => {
    expect(eu5Meta.creators).toBeUndefined();
    const create = actionGroups(eu5Meta, 0).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).toEqual(["px.newContent", "px.createCoatOfArms"]);
  });

  it("shows the error.log clear row only while there are problems", () => {
    expect(commands(visibleActionGroups(ck3Meta, 0, []))).not.toContain("px.clearGameProblems");
    expect(commands(visibleActionGroups(ck3Meta, 3, []))).toContain("px.clearGameProblems");
  });
});

it.each([ck3Meta, vic3Meta, eu5Meta])(
  "offers only the tools supplied by $id and omits redundant dashboard commands",
  (meta) => {
    const ids = commands(actionGroups(meta, 0));
    expect(ids).toContain("px.openCompatch");
    expect(ids.includes("px.openGuiEditor")).toBe(meta.guiTextMetrics !== undefined);
    expect(ids.includes("px.tigerCreateBaseline")).toBe(meta.tiger !== undefined);
    expect(ids).not.toContain("px.setup");
    expect(ids).not.toContain("px.runTiger");
    expect(ids).not.toContain("px.exportSnippets");
    expect(ids.includes("px.newContent")).toBe((meta.scaffolds?.length ?? 0) > 0);
    expect(new Set(ids).size).toBe(ids.length);
  }
);
