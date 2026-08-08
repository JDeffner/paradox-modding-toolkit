/**
 * G5 additions to `paradox/guiLayout`: conditional-visibility preview modes and
 * the per-stage timings behind a stats line.
 *
 * The rule the modes bend is spec.md's `ignoreinvisible` (L27): a hidden child
 * collapses out of a box and its siblings shift up. `visible = no` is
 * deterministic and always does that; a `visible = "[expr]"` cannot be
 * evaluated in a static preview, so the DEFAULT keeps the widget (L11b) and the
 * modes are the only way to see the other branch. The tests therefore assert on
 * the rects the collapse produces, not just on a flag: a mode that reported a
 * check but did not move anything would be useless.
 */
import { describe, expect, it } from "vitest";
import type { GuiVisibilityOptions } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult } from "../src/gui/layoutService";

const COND_A = "[GetPlayer.IsAI]";
const COND_B = "[Character.IsAlive]";

/** A vbox whose middle child is conditional: its collapse moves the third. */
const TEXT = [
  "vbox = {", // 0
  '\tname = "column"', // 1
  "\tsize = { 100 300 }", // 2
  '\twidget = { name = "first" size = { 40 30 } }', // 3
  `\twidget = { name = "middle" size = { 40 30 } visible = "${COND_A}" }`, // 4
  '\twidget = { name = "last" size = { 40 30 } }', // 5
  `\twidget = { name = "other" size = { 40 30 } visible = "${COND_B}" }`, // 6
  "}", // 7
].join("\n");

function layout(visibility?: GuiVisibilityOptions) {
  return computeGuiLayoutResult(TEXT, null, null, [], [], visibility);
}

function rectOf(visibility: GuiVisibilityOptions | undefined, name: string) {
  const children = layout(visibility).nodes[0].children;
  const node = children.find((c) => c.name === name);
  if (!node) throw new Error(`no child named ${name}`);
  return node.rect;
}

describe("visibility preview modes", () => {
  it("showAll is the default and is today's behavior: nothing collapses", () => {
    const both = [layout(), layout({ mode: "showAll" })];
    for (const result of both) {
      const laid = result.nodes[0].children.filter((c) => c.rect.h > 0);
      expect(laid).toHaveLength(4);
    }
    expect(rectOf(undefined, "last")).toEqual(rectOf({ mode: "showAll" }, "last"));
  });

  it("hideAll collapses every conditional widget and the siblings shift up", () => {
    const shown = rectOf(undefined, "last");
    const hidden = rectOf({ mode: "hideAll" }, "last");
    // Its own slot is gone AND the space-around share changed: it moved.
    expect(hidden.y).not.toBe(shown.y);
    expect(rectOf({ mode: "hideAll" }, "middle")).toEqual({ x: 0, y: expect.any(Number), w: 0, h: 0 });
    // A widget with no `visible` at all is never touched by the mode.
    expect(rectOf({ mode: "hideAll" }, "first").h).toBe(30);
  });

  it("evaluate collapses only the checks assigned false", () => {
    const mode: GuiVisibilityOptions = { mode: "evaluate", checks: { [COND_A]: false, [COND_B]: true } };
    expect(rectOf(mode, "middle").h).toBe(0);
    expect(rectOf(mode, "other").h).toBe(30);
  });

  it("an UNASSIGNED check falls back to shown, so a partial map cannot hide surprises", () => {
    const partial: GuiVisibilityOptions = { mode: "evaluate", checks: { [COND_A]: false } };
    const explicit: GuiVisibilityOptions = {
      mode: "evaluate",
      checks: { [COND_A]: false, [COND_B]: true },
    };
    expect(rectOf(partial, "other").h).toBe(30);
    // Leaving B out is the same answer as writing `true` for it.
    expect(rectOf(partial, "other")).toEqual(rectOf(explicit, "other"));
  });

  it("`visible = no` and `visible = yes` are deterministic in every mode", () => {
    const text = [
      "vbox = {",
      '\twidget = { name = "off" size = { 40 30 } visible = no }',
      '\twidget = { name = "on" size = { 40 30 } visible = yes }',
      "}",
    ].join("\n");
    for (const mode of ["showAll", "hideAll", "evaluate"] as const) {
      const kids = computeGuiLayoutResult(text, null, null, [], [], { mode }).nodes[0].children;
      expect(kids.find((c) => c.name === "off")!.rect.h).toBe(0);
      expect(kids.find((c) => c.name === "on")!.rect.h).toBe(30);
    }
    // Neither is a CHECK: a literal needs no toggle.
    expect(computeGuiLayoutResult(text, null, null, [], [], { mode: "showAll" }).visibilityChecks).toEqual(
      []
    );
  });
});

describe("the reported checks", () => {
  it("are reported in showAll too, so the toggle UI exists before the mode switch", () => {
    expect(layout().visibilityChecks).toEqual([
      { key: COND_B, count: 1, hidden: false },
      { key: COND_A, count: 1, hidden: false },
    ]);
  });

  it("say whether THIS run hid them", () => {
    const checks = layout({ mode: "evaluate", checks: { [COND_A]: false } }).visibilityChecks;
    expect(checks.find((c) => c.key === COND_A)!.hidden).toBe(true);
    expect(checks.find((c) => c.key === COND_B)!.hidden).toBe(false);
  });

  it("count the widgets sharing one condition, which is what makes them one toggle", () => {
    const text = [
      "vbox = {",
      `\twidget = { name = "a" size = { 10 10 } visible = "${COND_A}" }`,
      `\twidget = { name = "b" size = { 10 10 } visible = "${COND_A}" }`,
      "}",
    ].join("\n");
    const checks = computeGuiLayoutResult(text, null, null, [], []).visibilityChecks;
    expect(checks).toEqual([{ key: COND_A, count: 2, hidden: false }]);
  });

  it("the key is the condition source, quotes stripped, so the client can echo it back", () => {
    const [check] = layout().visibilityChecks.filter((c) => c.key === COND_A);
    const mode: GuiVisibilityOptions = { mode: "evaluate", checks: { [check.key]: false } };
    expect(rectOf(mode, "middle").h).toBe(0);
  });
});

describe("timings", () => {
  it("every stage is measured and the total covers them", () => {
    const { timings } = layout();
    for (const v of [timings.parseMs, timings.defsMs, timings.layoutMs, timings.totalMs]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    // The stages run inside the request, so their sum cannot exceed it (a small
    // slack absorbs the clock reads between them).
    expect(timings.parseMs + timings.defsMs + timings.layoutMs).toBeLessThanOrEqual(timings.totalMs + 1);
  });
});
