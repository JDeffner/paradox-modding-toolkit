/**
 * The event graph's edit history: one undo stack over everything the view can
 * change, and a list of file edits that are NOT written until the user saves.
 *
 * Two kinds of change live in the same history on purpose. Moving a node and
 * refocusing the graph are view state that never touches disk; editing a loc
 * string or a field is a `PendingEdit` that the host will apply, in order, when
 * Save is pressed. Undo covers both, so a modder can experiment in the graph
 * the way they experiment in a text editor.
 *
 * Saving RESETS the pending list and strips `pending` from every stored state.
 * Undo can restore where you were looking; it cannot unwrite a file, and a
 * history that offered to would re-apply edits that already landed.
 *
 * Pure and unit-tested; no DOM, no host.
 */
import type { EventGraphParams } from "@px-lsp/protocol/protocol";

/** A file edit waiting for Save. Each maps to one host action. */
export type PendingEdit =
  | {
      kind: "editLoc";
      /** The event the edit belongs to, so the inspector can refresh it. */
      id: string;
      key: string;
      value: string;
      file?: string;
      line?: number;
    }
  | { kind: "addOption"; id: string; file: string; endLine: number; count: number }
  | {
      kind: "setField";
      id: string;
      file: string;
      key: string;
      value: string;
      /** 0-based line to rewrite, or null to insert a new statement. */
      line: number | null;
      /** Insertion point when `line` is null. */
      insertLine: number;
      /** Tab depth for an inserted line. */
      indent: number;
    };

export interface GraphState {
  /** What the graph is showing (root / namespace / everything). */
  focus: EventGraphParams;
  /** Show only the nodes connected to this one (the Cluster tool). */
  cluster?: string;
  /** Node id -> position a drag put it at. Absent = wherever the layout says. */
  positions: Record<string, { x: number; y: number }>;
  /** File edits waiting for Save, oldest first. */
  pending: PendingEdit[];
}

/** Deep enough for the shapes above, and it never has to guess about classes. */
function clone(state: GraphState): GraphState {
  return {
    focus: { ...state.focus },
    cluster: state.cluster,
    positions: { ...state.positions },
    pending: state.pending.map((edit) => ({ ...edit })),
  };
}

/** Steps kept. A graph session is minutes long; this is well past it. */
const LIMIT = 120;

export class GraphHistory {
  private current: GraphState;
  private past: Array<{ label: string; state: GraphState }> = [];
  private future: Array<{ label: string; state: GraphState }> = [];
  /** Label of the step that PRODUCED the current state (what undo would take back). */
  private currentLabel = "";

  constructor(initial: GraphState) {
    this.current = clone(initial);
  }

  get state(): GraphState {
    return this.current;
  }
  get pending(): PendingEdit[] {
    return this.current.pending;
  }
  get pendingCount(): number {
    return this.current.pending.length;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  /** "Undo move node" / "Redo add option": the label goes in the button tooltip. */
  get undoLabel(): string {
    return this.currentLabel;
  }
  get redoLabel(): string {
    return this.future[this.future.length - 1]?.label ?? "";
  }

  /** Record a new state. Anything that was undone is dropped, as in an editor. */
  push(label: string, next: GraphState): void {
    this.past.push({ label: this.currentLabel, state: this.current });
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
    this.current = clone(next);
    this.currentLabel = label;
  }

  /** Convenience: same state plus one file edit. */
  pushEdit(label: string, edit: PendingEdit): void {
    this.push(label, { ...this.current, pending: [...this.current.pending, edit] });
  }

  undo(): GraphState | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push({ label: this.currentLabel, state: this.current });
    this.current = step.state;
    this.currentLabel = step.label;
    return this.current;
  }

  redo(): GraphState | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push({ label: this.currentLabel, state: this.current });
    this.current = step.state;
    this.currentLabel = step.label;
    return this.current;
  }

  /**
   * The pending edits reached disk. They leave the current state and every
   * stored one, so undo still walks back through focus and layout changes
   * without ever offering to apply an edit twice.
   */
  markSaved(): void {
    const strip = (entry: { label: string; state: GraphState }) => ({
      label: entry.label,
      state: { ...entry.state, pending: [] },
    });
    this.past = this.past.map(strip);
    this.future = this.future.map(strip);
    this.current = { ...this.current, pending: [] };
  }
}
