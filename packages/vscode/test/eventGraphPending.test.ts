/**
 * The unsaved-edit overlay the inspector draws from. The point of the view is
 * that an edit is visible the moment it is made, so what is checked here is
 * exactly that: every kind of pending edit turns into something the panel can
 * show, the newest value of a row wins, and another event's edits stay out.
 */
import { describe, expect, it } from "vitest";
import type { PendingEdit } from "../src/webviews/eventGraph/history";
import {
  describeEdit,
  editKind,
  fieldRowKey,
  locRowKey,
  pendingOverlay,
} from "../src/webviews/eventGraph/app/pendingView";

const F = "C:/mod/events/gaze.txt";

const loc = (id: string, key: string, value: string): PendingEdit => ({ kind: "editLoc", id, key, value });
const field = (id: string, key: string, value: string, line: number): PendingEdit => ({
  kind: "setField",
  id,
  file: F,
  key,
  value,
  line,
  insertLine: line,
  indent: 1,
});
const addField = (id: string, key: string, value: string, insertLine: number): PendingEdit => ({
  kind: "setField",
  id,
  file: F,
  key,
  value,
  line: null,
  insertLine,
  indent: 1,
});
const addOption = (id: string, count: number): PendingEdit => ({
  kind: "addOption",
  id,
  file: F,
  endLine: 40,
  count,
});

describe("pendingOverlay", () => {
  it("is empty when nothing is pending", () => {
    const view = pendingOverlay("a.1", []);
    expect(view.values.size).toBe(0);
    expect(view.inserted.size).toBe(0);
    expect(view.options).toBe(0);
  });

  it("shows a retyped localization and a rewritten field", () => {
    const view = pendingOverlay("a.1", [loc("a.1", "a.1.t", "The Gaze"), field("a.1", "theme", "war", 12)]);
    expect(view.values.get(locRowKey("a.1.t"))).toBe("The Gaze");
    expect(view.values.get(fieldRowKey(F, "theme", 12))).toBe("war");
  });

  it("keeps the newest value of a row that was edited twice", () => {
    const view = pendingOverlay("a.1", [loc("a.1", "a.1.t", "first"), loc("a.1", "a.1.t", "second")]);
    expect(view.values.get(locRowKey("a.1.t"))).toBe("second");
  });

  it("groups inserted lines by the body they go into, in the order they were added", () => {
    const view = pendingOverlay("a.1", [
      addField("a.1", "cooldown", "yes", 4),
      addField("a.1", "add_gold", "10", 9),
      addField("a.1", "hidden", "yes", 4),
    ]);
    expect(view.inserted.get(4)).toEqual([
      { key: "cooldown", value: "yes" },
      { key: "hidden", value: "yes" },
    ]);
    expect(view.inserted.get(9)).toEqual([{ key: "add_gold", value: "10" }]);
  });

  it("counts the options waiting to be written", () => {
    expect(pendingOverlay("a.1", [addOption("a.1", 2), addOption("a.1", 3)]).options).toBe(2);
  });

  it("ignores edits that belong to another event", () => {
    const view = pendingOverlay("a.1", [
      loc("a.2", "a.2.t", "elsewhere"),
      addOption("a.2", 0),
      addField("a.2", "hidden", "yes", 4),
    ]);
    expect(view.values.size).toBe(0);
    expect(view.inserted.size).toBe(0);
    expect(view.options).toBe(0);
  });
});

describe("the Changes list", () => {
  it("names every kind of edit and says what it does", () => {
    const edits = [
      loc("a.1", "a.1.t", "The Gaze"),
      field("a.1", "theme", "war", 12),
      addField("a.1", "cooldown", "yes", 4),
      addOption("a.1", 2),
    ];
    expect(edits.map(editKind)).toEqual(["text", "field", "add field", "option"]);
    expect(edits.map(describeEdit)).toEqual([
      'a.1.t = "The Gaze"',
      "theme = war on line 13",
      "cooldown = yes, a new line",
      "option 3, with its localization key",
    ]);
  });

  it("a created event is a Changes entry, not an overlay (no card exists yet)", () => {
    const create = {
      kind: "createEvent",
      id: "a.9",
      file: null,
      type: "character_event",
      title: "T",
      desc: "D",
      options: 2,
    } as const;
    expect(editKind(create)).toBe("new event");
    expect(describeEdit(create)).toBe("a.9 (character_event, 2 options), with its localization keys");
    const view = pendingOverlay("a.9", [create]);
    expect(view.values.size).toBe(0);
    expect(view.options).toBe(0);
  });
});
