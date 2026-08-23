/**
 * What the inspector must show that is not on disk yet.
 *
 * Nothing the event graph edits is written before Save, so the detail the host
 * answers with is always the file as it was BEFORE the session's edits. Reading
 * it back verbatim would make an edit look like it did nothing: a new option
 * would not be listed, a retyped title would snap back to the old one. This
 * folds the pending edits over the detail instead, and every row it changed is
 * marked unsaved in the panel.
 *
 * Pure and unit-tested: it takes the edit list and answers what to draw.
 */
import type { PendingEdit } from "../history";

/** A field or option row that exists only in the session so far. */
export interface InsertedField {
  key: string;
  value: string;
}

export interface PendingOverlay {
  /** New text for a row that already exists, by the row's key. */
  values: Map<string, string>;
  /** Rows added and not written yet, by the body line they will go into. */
  inserted: Map<number, InsertedField[]>;
  /** Options added and not written yet. They follow the saved ones. */
  options: number;
}

/** The key a localizable row is tracked under. */
export function locRowKey(key: string): string {
  return `loc:${key}`;
}

/** The key a `key = value` row is tracked under: its file and the line it rewrites. */
export function fieldRowKey(file: string, key: string, line: number): string {
  return `${file}:${key}:${line}`;
}

/** Fold `pending` into what the panel should draw for event `id`. */
export function pendingOverlay(id: string, pending: PendingEdit[]): PendingOverlay {
  const values = new Map<string, string>();
  const inserted = new Map<number, InsertedField[]>();
  let options = 0;
  for (const edit of pending) {
    if (edit.id !== id) continue;
    if (edit.kind === "editLoc") {
      values.set(locRowKey(edit.key), edit.value);
    } else if (edit.kind === "addOption") {
      options++;
    } else if (edit.line === null) {
      const list = inserted.get(edit.insertLine);
      if (list) list.push({ key: edit.key, value: edit.value });
      else inserted.set(edit.insertLine, [{ key: edit.key, value: edit.value }]);
    } else {
      values.set(fieldRowKey(edit.file, edit.key, edit.line), edit.value);
    }
  }
  return { values, inserted, options };
}

/** One line saying what an edit does, for the Changes list. */
export function describeEdit(edit: PendingEdit): string {
  if (edit.kind === "editLoc") return `${edit.key} = "${edit.value}"`;
  if (edit.kind === "addOption") return `option ${edit.count + 1}, with its localization key`;
  if (edit.line === null) return `${edit.key} = ${edit.value}, a new line`;
  return `${edit.key} = ${edit.value} on line ${edit.line + 1}`;
}

/** The two-word name of an edit's kind, for the Changes list. */
export function editKind(edit: PendingEdit): string {
  if (edit.kind === "editLoc") return "text";
  if (edit.kind === "addOption") return "option";
  return edit.line === null ? "add field" : "field";
}
