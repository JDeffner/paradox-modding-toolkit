import { describe, it, expect } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { actionGroups, visibleActionGroups, visibleReferenceItems } from "../src/webviews/dashboard/actions";

/** Every command id the panel offers for a game, groups flattened. */
function commands(groups: ReturnType<typeof actionGroups>): string[] {
  return groups.flatMap((g) => g.items.map((it) => it.command));
}

describe("visibleActionGroups", () => {
  it("drops the hidden rows and keeps the rest", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.showEventGraph", "px.modReport"]);
    const ids = commands(groups);
    expect(ids).not.toContain("px.showEventGraph");
    expect(ids).not.toContain("px.modReport");
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

  it("reference links live in the footer list, not the groups, and hide the same way", () => {
    expect(commands(actionGroups(ck3Meta, 0))).not.toContain("px.openInfoDocs");
    expect(visibleReferenceItems(ck3Meta, []).map((it) => it.command)).toEqual([
      "px.openInfoDocs",
      "px.imageGuidelines",
    ]);
    expect(visibleReferenceItems(ck3Meta, ["px.imageGuidelines"]).map((it) => it.command)).toEqual([
      "px.openInfoDocs",
    ]);
  });

  it("ignores ids that match no row", () => {
    const all = visibleActionGroups(ck3Meta, 0, []);
    const withJunk = visibleActionGroups(ck3Meta, 0, ["px.notARow", ""]);
    expect(withJunk).toEqual(all);
  });

  it("keeps working for a game without a tiger", () => {
    const groups = visibleActionGroups(eu5Meta, 0, ["px.newContent", "px.createMod"]);
    const ids = commands(groups);
    expect(ids).toContain("px.launchGame");
    expect(ids).not.toContain("px.newContent");
    expect(ids).not.toContain("px.tigerCreateBaseline");
    expect(groups.map((g) => g.label)).not.toContain("Create");
  });

  it("shows the error.log clear row only while there are problems", () => {
    expect(commands(visibleActionGroups(ck3Meta, 0, []))).not.toContain("px.clearGameProblems");
    expect(commands(visibleActionGroups(ck3Meta, 3, []))).toContain("px.clearGameProblems");
  });
});
