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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GuiVisibilityOptions } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult, profileMeasurer } from "../src/gui/layoutService";
import { activeProfile, setActiveProfile } from "../src/games/active";
import { defaultProfile } from "../src/games/registry";
import { vic3Profile } from "../src/games/vic3";
import { GITAN_MEASURED_METRICS } from "../src/gui/measuredMetrics";

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
describe("game-profile text metrics", () => {
  const TEXTBOX = 'textbox = { autoresize = yes fontsize = 15 raw_text = "MMMM" }';

  it("a profile carrying guiTextMetrics changes the measured text rect", () => {
    const before = computeGuiLayoutResult(TEXTBOX, null, null, [], []).nodes[0].rect;
    // Calibrated default: (n-1)*14 + 13 = 55 wide, 21 tall (B2-L, B1-G).
    expect(before.w).toBe(55);
    expect(before.h).toBe(21);

    const base = activeProfile();
    setActiveProfile({
      ...base,
      // A probe-measured table with doubled M metrics and a 30px line box.
      guiTextMetrics: {
        baseFontsize: 15,
        lineHeight: 30,
        glyphs: { M: { adv: 28, ink: 26 } },
        defaultGlyph: { adv: 9, ink: 8 },
      },
    });
    try {
      const after = computeGuiLayoutResult(TEXTBOX, null, null, [], []).nodes[0].rect;
      expect(after.w).toBe(3 * 28 + 26);
      expect(after.h).toBe(30);
    } finally {
      setActiveProfile(base);
    }
  });

  it("the default profile's own table IS the engine's fallback, so it changes nothing", () => {
    // The batch-01..03 measurements are of this profile's font, so naming them
    // on the profile (which is what tells the client the game is calibrated)
    // must measure exactly like the fallback an uncalibrated profile gets.
    expect(activeProfile().guiTextMetrics).toEqual(GITAN_MEASURED_METRICS);
    expect(activeProfile().guiLayoutQuirks).toBeUndefined();
    const calibrated = computeGuiLayoutResult(TEXTBOX, null, null, [], []).nodes[0].rect;

    setActiveProfile({ ...activeProfile(), guiTextMetrics: undefined });
    try {
      expect(profileMeasurer()).toBeUndefined();
      expect(computeGuiLayoutResult(TEXTBOX, null, null, [], []).nodes[0].rect).toEqual(calibrated);
    } finally {
      setActiveProfile(defaultProfile);
    }
  });
});

describe("vic3 measured calibration (probe 2026-08-09)", () => {
  const rectOf = (gui: string) => computeGuiLayoutResult(gui, null, null, [], []).nodes[0].rect;
  const TENM = 'raw_text = "MMMMMMMMMM"';

  beforeEach(() => setActiveProfile(vic3Profile));
  afterEach(() => setActiveProfile(defaultProfile));

  it("reproduces every measured text box exactly", () => {
    // px_probe_d T1/T3 and px_probe_e X2, measured at 1920x1080, 100% scaling.
    const r15 = rectOf(`textbox = { autoresize = yes fontsize = 15 ${TENM} }`);
    expect([r15.w, r15.h]).toEqual([140, 19.5]); // game ceils the box to 20
    const r30 = rectOf(`textbox = { autoresize = yes fontsize = 30 ${TENM} }`);
    expect([r30.w, r30.h]).toEqual([270, 39]);
    // A bare textbox renders at the measured default fontsize 17.
    const rDef = rectOf(`textbox = { autoresize = yes ${TENM} }`);
    expect(rDef.w).toBe(150); // round(0.9*17) = 15 per glyph
    expect(rDef.h).toBeCloseTo(22.1); // 1.3*17; game ceils to the measured 23
    // Space advance 3 (T4) and the multiline widest line (T6).
    expect(rectOf('textbox = { autoresize = yes fontsize = 15 raw_text = "M M M M M" }').w).toBe(82);
    expect(rectOf('textbox = { autoresize = yes fontsize = 15 raw_text = "MMMM MMMM" }').w).toBe(115);
  });

  it("an EMPTY container keeps an authored size (quirk; the default profile collapses it)", () => {
    const gui = "container = { size = { 150 60 } }";
    const kept = rectOf(gui);
    expect([kept.w, kept.h]).toEqual([150, 60]); // px_probe_c C5
    setActiveProfile(defaultProfile);
    const collapsed = rectOf(gui);
    expect([collapsed.w, collapsed.h]).toEqual([0, 0]); // L25 narrow, 2026-08-02
  });
});
