import { describe, it, expect } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
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

  it("translation launchers moved to the coverage view's title bar, off the panel", () => {
    expect(commands(actionGroups(ck3Meta, 0))).not.toContain("px.translateNext");
    expect(actionGroups(ck3Meta, 0).map((g) => g.label)).not.toContain("Localization");
  });

  it("drops a group whose rows are all hidden", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.openWorkshopManager", "px.openWorkshopPage"]);
    expect(groups.map((g) => g.label)).not.toContain("Share");
    expect(groups.map((g) => g.label)).toContain("View");
  });

  it("reference links moved into the Wiki hub, off the panel footer", () => {
    const ids = commands(actionGroups(ck3Meta, 0));
    expect(ids).not.toContain("px.openInfoDocs");
    expect(ids).not.toContain("px.imageGuidelines");
    // Mod Report is a Wiki subpage now, not an Info row.
    expect(ids).not.toContain("px.modReport");
    expect(ids).toContain("px.openWiki");
  });

  it("groups the reference and community links under Info, below Create", () => {
    const groups = actionGroups(ck3Meta, 0);
    const info = groups.find((g) => g.label === "Info");
    expect(info?.items.map((it) => it.command)).toEqual([
      "px.openDiscord",
      "px.openWiki",
      "px.openCredits",
      "px.showExamplesWiki",
    ]);
    expect(groups.map((g) => g.label)).toEqual(["View", "Create", "Share", "Info", "Test & Troubleshoot"]);
    // The wiki rows moved out of View, they are not listed twice.
    const view = groups.find((g) => g.label === "View");
    expect(view?.items.map((it) => it.command)).not.toContain("px.openWiki");
    expect(view?.items.map((it) => it.command)).not.toContain("px.showExamplesWiki");
  });

  it("hides Info rows like any other row", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.openDiscord", "px.openWiki"]);
    const info = groups.find((g) => g.label === "Info");
    expect(info?.items.map((it) => it.command)).toEqual(["px.openCredits", "px.showExamplesWiki"]);
  });

  it("offers the coat-of-arms creator right after New Content, per game", () => {
    // Both Flag Builder doors are gated on the same meta fact: the creator in
    // Create, the blank canvas in View.
    const ids = actionGroups(eu5Meta, 0)
      .find((g) => g.label === "Create")!
      .items.map((it) => it.command);
    expect(ids.indexOf("px.createCoatOfArms")).toBe(ids.indexOf("px.newContent") + 1);
    // CK3 has the Flag Builder too (measured coverage in games/ck3/meta.ts).
    expect(commands(actionGroups(ck3Meta, 0))).toContain("px.createCoatOfArms");
    expect(commands(actionGroups(ck3Meta, 0))).toContain("px.openFlagBuilder");
  });

  it("ignores ids that match no row", () => {
    const all = visibleActionGroups(ck3Meta, 0, []);
    const withJunk = visibleActionGroups(ck3Meta, 0, ["px.notARow", ""]);
    expect(withJunk).toEqual(all);
  });

  it("keeps working for a game without a tiger", () => {
    const groups = visibleActionGroups(eu5Meta, 0, ["px.newContent", "px.createMod", "px.createCoatOfArms"]);
    const ids = commands(groups);
    expect(ids).not.toContain("px.newContent");
    expect(ids).not.toContain("px.tigerCreateBaseline");
    expect(groups.map((g) => g.label)).not.toContain("Create");
    // No tiger and no problems leaves Test & Troubleshoot empty: dropped.
    expect(groups.map((g) => g.label)).not.toContain("Test & Troubleshoot");
  });

  it("launching lives in the editor Run button, not as panel rows", () => {
    const ids = commands(actionGroups(ck3Meta, 3));
    expect(ids).not.toContain("px.launchGame");
    expect(ids).not.toContain("px.launchMapEditor");
    expect(ids).toContain("px.clearGameProblems");
  });

  it("lists the game's creators in the Create group, after the two scaffolds", () => {
    const create = actionGroups(ck3Meta, 0).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).toEqual([
      "px.createMod",
      "px.newContent",
      "px.createTrait",
      "px.createDynastyLegacy",
      "px.createCulture",
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

  it("hides a creator row like any other row", () => {
    const create = visibleActionGroups(ck3Meta, 0, ["px.createTrait"]).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).not.toContain("px.createTrait");
    expect(create?.items.map((it) => it.command)).toContain("px.createCulture");
  });

  it("a game with no creators keeps the Create group it had", () => {
    expect(eu5Meta.creators).toBeUndefined();
    const create = actionGroups(eu5Meta, 0).find((g) => g.label === "Create");
    expect(create?.items.map((it) => it.command)).toEqual([
      "px.createMod",
      "px.newContent",
      "px.createCoatOfArms",
    ]);
  });

  it("shows the error.log clear row only while there are problems", () => {
    expect(commands(visibleActionGroups(ck3Meta, 0, []))).not.toContain("px.clearGameProblems");
    expect(commands(visibleActionGroups(ck3Meta, 3, []))).toContain("px.clearGameProblems");
  });
});
