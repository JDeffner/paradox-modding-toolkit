import { describe, it, expect } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { PATHS } from "../src/webviews/shared/icons";
import { actionGroups, dashboardCollapsed, visibleActionGroups } from "../src/webviews/dashboard/actions";

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
    expect(groups.map((g) => g.label)).not.toContain("Share");
    expect(groups.map((g) => g.label)).toContain("View");
  });

  it("groups the reference and community links under Info, above Create", () => {
    const groups = actionGroups(ck3Meta, 0);
    const info = groups.find((g) => g.label === "Info");
    expect(info?.items.map((it) => it.command)).toEqual([
      "px.openDiscord",
      "px.openWiki",
      "px.openCredits",
      "px.showExamplesWiki",
      "px.exportSnippets",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Tasks",
      "View",
      "Share",
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
    // No tiger and no problems leaves Test & Troubleshoot empty: dropped.
    expect(groups.map((g) => g.label)).not.toContain("Test & Troubleshoot");
  });

  it("lists the game's creators after New Mod, with New Content in daily tasks", () => {
    const create = actionGroups(ck3Meta, 0).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).toEqual([
      "px.createMod",
      "px.createTrait",
      "px.createDynastyLegacy",
      "px.createCulture",
      "px.createTradition",
      "px.openDynastyTree",
      "px.createCoatOfArms",
    ]);
    expect(create?.items.map((it) => it.label)).toContain("Trait Creator");
  });

  it("every creator row names an icon the client actually ships", () => {
    for (const creator of ck3Meta.creators ?? []) {
      expect(Object.keys(PATHS)).toContain(creator.icon);
    }
  });

  it("a game with no creators keeps the Create group it had", () => {
    expect(eu5Meta.creators).toBeUndefined();
    const create = actionGroups(eu5Meta, 0).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).toEqual(["px.createMod", "px.createCoatOfArms"]);
  });

  it("shows the error.log clear row only while there are problems", () => {
    expect(commands(visibleActionGroups(ck3Meta, 0, []))).not.toContain("px.clearGameProblems");
    expect(commands(visibleActionGroups(ck3Meta, 3, []))).toContain("px.clearGameProblems");
  });
});

it("starts with daily tasks while respecting every saved section choice", () => {
  const defaults = dashboardCollapsed({});
  expect(defaults.tasks ?? false).toBe(false);
  for (const section of ["paths", "toggles", "share", "info", "view", "create"])
    expect(defaults[section]).toBe(true);
  expect(dashboardCollapsed({ paths: false, info: false, tasks: true })).toMatchObject({
    paths: false,
    info: false,
    tasks: true,
  });
  expect(
    actionGroups(ck3Meta, 0)
      .find((group) => group.label === "Tasks")
      ?.items.map((item) => item.command)
  ).toEqual(["px.newContent", "px.setup", "px.runTiger"]);
});

it.each([ck3Meta, vic3Meta, eu5Meta])(
  "offers only the GUI editor and validator capabilities supplied by $id",
  (meta) => {
    const ids = commands(actionGroups(meta, 0));
    expect(ids.includes("px.openGuiEditor")).toBe(meta.guiTextMetrics !== undefined);
    expect(ids.includes("px.runTiger")).toBe(meta.tiger !== undefined);
    expect(ids.includes("px.newContent")).toBe((meta.scaffolds?.length ?? 0) > 0);
    expect(new Set(ids).size).toBe(ids.length);
  }
);
