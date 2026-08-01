/**
 * Firing-order arrangement of an event's blocks (the event simulator webview).
 * The server owns the block contents; what is asserted here is the ORDER and
 * the wording used for blocks that are absent, empty or unlocalized.
 */
import { describe, expect, it } from "vitest";
import type { EventDetail, EventSectionInfo, EventOptionInfo } from "@px-lsp/protocol/protocol";
import { simulationSteps } from "../src/webviews/eventSim/steps";

const section = (name: string, lines: string[], extra: Partial<EventSectionInfo> = {}): EventSectionInfo => ({
  name,
  line: 10,
  keys: [],
  lines: lines.map((text, i) => ({ depth: 0, text, line: 11 + i })),
  totalLines: lines.length,
  targets: [],
  targetsTotal: 0,
  ...extra,
});

const option = (extra: Partial<EventOptionInfo> = {}): EventOptionInfo => ({
  line: 20,
  effectKeys: [],
  hasTrigger: false,
  hasAiChance: false,
  lines: [{ depth: 0, text: "add_gold = 10", line: 21 }],
  totalLines: 1,
  targets: [],
  targetsTotal: 0,
  ...extra,
});

const detail = (extra: Partial<EventDetail> = {}): EventDetail => ({
  id: "sim.1",
  file: "C:/mod/events/sim.txt",
  line: 2,
  endLine: 30,
  sections: [],
  options: [],
  refs: [],
  ...extra,
});

describe("simulationSteps", () => {
  it("orders the blocks the way the game runs them", () => {
    const steps = simulationSteps(
      detail({
        // Deliberately out of source order: the walkthrough is firing order.
        sections: [
          section("after", ["add_prestige = 5"]),
          section("immediate", ["add_gold = 1"]),
          section("trigger", ["is_adult = yes"]),
        ],
        options: [option(), option()],
      })
    );
    expect(steps.map((s) => s.title)).toEqual(["TRIGGER", "IMMEDIATE", "OPTION A", "OPTION B", "AFTER"]);
  });

  it("states that an event without a trigger fires unconditionally", () => {
    const steps = simulationSteps(detail({ sections: [section("immediate", ["add_gold = 1"])] }));
    expect(steps[0].title).toBe("TRIGGER");
    expect(steps[0].note).toContain("no trigger");
    expect(steps[0].lines).toEqual([]);
    // With no trigger block to point at, the heading jumps to the event itself.
    expect(steps[0].line).toBe(2);
  });

  it("omits absent sections but reports empty ones", () => {
    const steps = simulationSteps(detail({ sections: [section("immediate", [])] }));
    expect(steps.map((s) => s.title)).toEqual(["TRIGGER", "IMMEDIATE"]);
    expect(steps[1].note).toBe("(empty block)");
  });

  it("puts on_trigger_fail straight after the trigger it belongs to", () => {
    const steps = simulationSteps(
      detail({
        sections: [
          section("trigger", ["is_adult = yes"]),
          section("immediate", ["add_gold = 1"]),
          section("on_trigger_fail", ["debug_log = nope"]),
        ],
      })
    );
    expect(steps.map((s) => s.title)).toEqual(["TRIGGER", "ON TRIGGER FAIL", "IMMEDIATE"]);
  });

  it("puts cancellation_trigger with the trigger it re-checks, not after the options", () => {
    const steps = simulationSteps(
      detail({
        sections: [
          section("trigger", ["has_technology_researched = tech"]),
          section("immediate", ["set_variable = done"]),
          section("cancellation_trigger", ["NOT = {"]),
        ],
        options: [option()],
      })
    );
    expect(steps.map((s) => s.title)).toEqual(["TRIGGER", "CANCELLATION TRIGGER", "IMMEDIATE", "OPTION A"]);
  });

  it("reports how many lines the server capped away", () => {
    const steps = simulationSteps(
      detail({ sections: [section("immediate", ["a = 1", "b = 2"], { totalLines: 70 })] })
    );
    expect(steps[1].hidden).toBe(68);
  });

  it("labels option text honestly: resolved, unlocalized, dynamic, absent", () => {
    const steps = simulationSteps(
      detail({
        options: [
          option({ name: { key: "sim.1.a", text: "Take the gold" } }),
          option({ name: { key: "sim.1.b" } }),
          option({ name: { key: "", dynamic: true } }),
          option(),
        ],
      })
    );
    const subtitles = steps.filter((s) => s.kind === "option").map((s) => s.subtitle);
    expect(subtitles[0]).toBe("Take the gold");
    expect(subtitles[1]).toBe("sim.1.b (no localization)");
    expect(subtitles[2]).toContain("dynamic");
    expect(subtitles[3]).toBe("(unnamed option)");
  });

  it("says when an option has no effects at all", () => {
    const steps = simulationSteps(detail({ options: [option({ lines: [], totalLines: 0 })] }));
    expect(steps[1].note).toContain("no effects");
  });

  it("letters options past Z by number", () => {
    const steps = simulationSteps(detail({ options: Array.from({ length: 27 }, () => option()) }));
    const titles = steps.filter((s) => s.kind === "option").map((s) => s.title);
    expect(titles[25]).toBe("OPTION Z");
    expect(titles[26]).toBe("OPTION #27");
  });

  it("keeps a section this ordering does not name instead of dropping it", () => {
    const steps = simulationSteps(detail({ sections: [section("some_new_block", ["x = 1"])] }));
    expect(steps.map((s) => s.title)).toEqual(["TRIGGER", "SOME_NEW_BLOCK"]);
  });

  it("passes the server's step-into targets through untouched", () => {
    const targets = [{ via: "trigger_event", name: "sim.2", kind: "event" as const, line: 12 }];
    const steps = simulationSteps(
      detail({
        sections: [section("immediate", ["trigger_event = sim.2"], { targets, targetsTotal: 1 })],
      })
    );
    expect(steps[1].targets).toEqual(targets);
    expect(steps[1].hiddenTargets).toBe(0);
  });

  it("reports how many targets the server capped away", () => {
    const targets = [{ via: "trigger_event", name: "sim.2", kind: "event" as const, line: 12 }];
    const steps = simulationSteps(
      detail({
        sections: [section("immediate", ["trigger_event = sim.2"], { targets, targetsTotal: 54 })],
      })
    );
    expect(steps[1].hiddenTargets).toBe(53);
  });
});
