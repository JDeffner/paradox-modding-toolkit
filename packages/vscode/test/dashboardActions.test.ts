import { describe, it, expect } from "vitest";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { actionGroups, visibleActionGroups } from "../src/webviews/dashboard/actions";

/** Every command id the panel offers for a game, groups flattened. */
function commands(groups: ReturnType<typeof actionGroups>): string[] {
  return groups.flatMap((g) => g.items.map((it) => it.command));
}

describe("visibleActionGroups", () => {
  it("drops the hidden rows and keeps the rest", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.showEventGraph", "px.imageGuidelines"]);
    const ids = commands(groups);
    expect(ids).not.toContain("px.showEventGraph");
    expect(ids).not.toContain("px.imageGuidelines");
    expect(ids).toContain("px.simulateEvent");
    expect(ids).toContain("px.convertToDds");
  });

  it("drops a group whose rows are all hidden", () => {
    const groups = visibleActionGroups(ck3Meta, 0, ["px.modReport"]);
    expect(groups.map((g) => g.label)).not.toContain("Inspect");
    expect(groups.map((g) => g.label)).toContain("Open");
  });

  it("ignores ids that match no row", () => {
    const all = visibleActionGroups(ck3Meta, 0, []);
    const withJunk = visibleActionGroups(ck3Meta, 0, ["px.notARow", ""]);
    expect(withJunk).toEqual(all);
  });

  it("keeps working for a game without a tiger", () => {
    const groups = visibleActionGroups(eu5Meta, 0, ["px.newContent"]);
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

  it("shows the error.log clear row only while there are problems", () => {
    expect(commands(visibleActionGroups(ck3Meta, 0, []))).not.toContain("px.clearGameProblems");
    expect(commands(visibleActionGroups(ck3Meta, 3, []))).toContain("px.clearGameProblems");
  });
});
