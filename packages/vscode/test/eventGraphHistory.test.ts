/**
 * The event graph's undo history. The property that matters is the one a
 * reader cannot see in the UI: nothing reaches disk before Save, and after a
 * Save the history can still walk back through focus and layout changes
 * WITHOUT offering to apply an edit that already landed.
 */
import { describe, expect, it } from "vitest";
import { GraphHistory, type GraphState } from "../src/webviews/eventGraph/history";

const start = (): GraphState => ({ focus: { root: "ns.1" }, positions: {}, pending: [] });
const locEdit = (key: string, value: string) =>
  ({ kind: "editLoc", id: "ns.1", key, value }) as const;

describe("GraphHistory", () => {
  it("walks back and forward through focus and layout steps", () => {
    const history = new GraphHistory(start());
    expect(history.canUndo).toBe(false);
    history.push("move ns.1", { ...history.state, positions: { "ns.1": { x: 10, y: 20 } } });
    history.push("focus ns.2", { ...history.state, focus: { root: "ns.2" } });

    expect(history.undoLabel).toBe("focus ns.2");
    expect(history.undo()!.focus).toEqual({ root: "ns.1" });
    expect(history.state.positions["ns.1"]).toEqual({ x: 10, y: 20 });
    expect(history.undo()!.positions).toEqual({});
    expect(history.undo()).toBeNull();

    expect(history.redo()!.positions["ns.1"]).toEqual({ x: 10, y: 20 });
    expect(history.redoLabel).toBe("focus ns.2");
    expect(history.redo()!.focus).toEqual({ root: "ns.2" });
    expect(history.canRedo).toBe(false);
  });

  it("counts pending edits and drops them again on undo", () => {
    const history = new GraphHistory(start());
    history.pushEdit("edit title", locEdit("ns.1.t", "A Gift"));
    history.pushEdit("edit description", locEdit("ns.1.desc", "It arrives"));
    expect(history.pendingCount).toBe(2);
    expect(history.pending.map((p) => p.kind)).toEqual(["editLoc", "editLoc"]);

    history.undo();
    expect(history.pendingCount).toBe(1);
    history.redo();
    expect(history.pendingCount).toBe(2);
  });

  it("a new step after an undo drops the redo branch", () => {
    const history = new GraphHistory(start());
    history.pushEdit("edit title", locEdit("ns.1.t", "A Gift"));
    history.undo();
    history.push("focus ns.3", { ...history.state, focus: { root: "ns.3" } });
    expect(history.canRedo).toBe(false);
    expect(history.pendingCount).toBe(0);
  });

  it("keeps the view history after a save but never the applied edits", () => {
    const history = new GraphHistory(start());
    history.push("move ns.1", { ...history.state, positions: { "ns.1": { x: 5, y: 5 } } });
    history.pushEdit("edit title", locEdit("ns.1.t", "A Gift"));
    history.markSaved();
    expect(history.pendingCount).toBe(0);

    expect(history.undo()!.positions["ns.1"]).toEqual({ x: 5, y: 5 });
    expect(history.pendingCount).toBe(0);
    expect(history.undo()!.positions).toEqual({});
    expect(history.pendingCount).toBe(0);
  });
});
