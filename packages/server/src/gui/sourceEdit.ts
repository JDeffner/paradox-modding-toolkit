// Implements the source-writer design of Sage's Clausewitz Studio; behavior contract in docs/gui-designer/parity-checklist.md. GPL-3.0-or-later.
/**
 * The .gui source WRITER, built on the stage-1 span model (`sourceModel.ts`).
 *
 * A `.gui` file is hand-authored, comment-rich and inconsistently formatted, so
 * the writer never re-serializes the document: every change is a surgical
 * replace over the exact span the model recorded for that entry, so untouched
 * bytes stay byte-identical. All offsets are into the SAME text the model was
 * parsed from; the host applies the returned edits (host-owns-text, per
 * EMBEDDING.md), which keeps undo and the live preview in the editor's hands.
 *
 * Stage 2 (this section): property operations. `setProperty` rewrites the LAST
 * source entry for a key (the engine's own last-in-wins override order) or inserts one,
 * `setValue` rewrites one entry, `removeProperty` deletes an entry (whole line
 * when alone, entry-only when a comment shares the line), `applyAll` composes a
 * batch computed against the SAME text, `dropNested` collapses overlapping
 * selections to the outermost. Contract rows W02-W09, swept by S02.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { GuiSourceFile, GuiEntry } from "./sourceModel";
import { findEntry } from "./sourceModel";

/**
 * One surgical replacement: replace `[start, end)` with `newText`. An insert
 * has `start === end`; a delete has an empty `newText`. Offsets are UTF-16 code
 * units into the request's text, the same units the CST and the span model use.
 */
export interface GuiEdit {
  start: number;
  end: number;
  newText: string;
}

/** Apply one edit to text. */
export function applyEdit(text: string, edit: GuiEdit): string {
  return text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
}

/**
 * Apply several edits computed against the SAME original text. Later offsets go
 * first so earlier ones stay valid; edits that insert at the same offset keep
 * their list order in the result. Overlapping edits are dropped rather than
 * corrupting the text (W05, W23).
 */
export function applyAll(text: string, edits: readonly GuiEdit[]): string {
  if (edits.length === 0) return text;
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => b.edit.start - a.edit.start || b.index - a.index);

  let lastStart = Infinity;
  for (const { edit } of ordered) {
    if (edit.start < 0 || edit.end > text.length) continue;
    if (edit.end > lastStart) continue; // overlaps a later (further-right) edit
    text = applyEdit(text, edit);
    lastStart = edit.start;
  }
  return text;
}

// ── Property operations ─────────────────────────────────────────────────────

/**
 * Sets `key` to `value` on `node`: rewrites the LAST source entry with that key
 * (the engine's last-in-wins override order, W02/W07), or inserts a new entry into the
 * body when the key isn't present in this file (W03). Null when the change can't
 * be expressed: a synthetic node has no `body` here, so a `using`-supplied
 * property with no local entry inserts a LOCAL override and the template's bytes
 * are untouched (W09).
 */
export function setProperty(file: GuiSourceFile, node: GuiEntry, key: string, value: string): GuiEdit | null {
  if (key.trim().length === 0) return null;
  if (!node.body || node.body.close === null) return null;

  // findEntry is the case-insensitive last-in-wins lookup (W02); a real .gui
  // never names a child widget with a property key, so its match is the
  // property to rewrite.
  const existing = findEntry(node.body, key);
  if (existing && existing.kind === "property") return setValue(file, existing, value);

  return insertProperty(file, node, key, value);
}

/**
 * Rewrites one specific entry's value in place. Use this rather than
 * `setProperty` when a key appears several times and a particular row was
 * edited. A value equal to the raw source is a no-op, not a churn edit (W02).
 */
export function setValue(file: GuiSourceFile, entry: GuiEntry, value: string): GuiEdit | null {
  if (!entry.valueSpan || entry.valueSpan.end > file.text.length) return null;
  value = value.trim();
  if (value.length === 0) return null;
  if (file.text.slice(entry.valueSpan.start, entry.valueSpan.end) === value) return null;
  return { start: entry.valueSpan.start, end: entry.valueSpan.end, newText: value };
}

/**
 * Deletes an entry. When it sits alone on its line the whole line goes
 * (indentation and newline included); when a comment shares the line only the
 * `key = value` span is removed, so the information the line still carries
 * survives (W04).
 */
export function removeProperty(file: GuiSourceFile, entry: GuiEntry): GuiEdit | null {
  if (!entry.valueSpan || entry.valueSpan.end > file.text.length) return null;
  const text = file.text;

  const lineStart = file.lines.lineStart(entry.line);
  const aloneBefore = isBlank(text, lineStart, entry.keySpan.start);

  // Everything after the value up to the newline must be blank too: a trailing
  // comment means the line carries information a remove must not eat.
  let after = entry.valueSpan.end;
  while (after < text.length && text[after] !== "\n") after++;
  let contentEnd = after;
  if (contentEnd > entry.valueSpan.end && text[contentEnd - 1] === "\r") contentEnd--;
  const aloneAfter = isBlank(text, entry.valueSpan.end, contentEnd);

  if (aloneBefore && aloneAfter) {
    const end = after < text.length ? after + 1 : after; // swallow the newline
    return { start: lineStart, end, newText: "" };
  }
  return { start: entry.keySpan.start, end: entry.valueSpan.end, newText: "" };
}

/**
 * Collapses a selection to its outermost entries: any entry with a selected
 * ancestor is dropped, so a batch built from the result never contains two
 * overlapping edits (W23). Property writes do NOT go through this; only
 * structural batches, where an overlapping edit would be silently lost.
 */
export function dropNested(entries: readonly GuiEntry[]): GuiEntry[] {
  const set = new Set(entries);
  return entries.filter((e) => {
    for (let p = e.parent; p; p = p.parent) if (set.has(p)) return false;
    return true;
  });
}

// ── Insertion ───────────────────────────────────────────────────────────────

/**
 * Adds `key = value` to a widget's body, on its own line before the closing
 * brace, at the body's own indent. A single-line body stays single-line; an
 * empty `{}` gets a spaced entry (W06, W25).
 */
function insertProperty(file: GuiSourceFile, node: GuiEntry, key: string, value: string): GuiEdit | null {
  const body = node.body!;
  const text = file.text;
  const close = body.close!;
  value = value.trim();
  if (value.length === 0) return null;

  const entry = `${key} = ${value}`;
  const closeLineStart = file.lines.lineStart(file.lines.positionAt(close).line);

  // Single-line body: keep it on one line rather than exploding it into a block
  // the author never wrote.
  if (closeLineStart <= body.open) {
    const innerStart = body.open + 1;
    if (isBlank(text, innerStart, close)) {
      return { start: innerStart, end: close, newText: ` ${entry} ` };
    }
    const sep = isWhitespace(text[close - 1]) ? "" : " ";
    return { start: close, end: close, newText: `${sep}${entry} ` };
  }

  const indent = childIndent(file, node, closeLineStart);
  return { start: closeLineStart, end: closeLineStart, newText: `${indent}${entry}${file.newline}` };
}

/**
 * The indent a new child entry carries: the body's own (copied verbatim from an
 * existing entry, so it matches the author's style exactly), else the closing
 * brace's own indent plus one unit for an otherwise-empty multi-line body.
 */
export function childIndent(file: GuiSourceFile, node: GuiEntry, closeLineStart: number): string {
  const body = node.body!;
  if (body.indent !== null) return body.indent;
  const text = file.text;
  let end = closeLineStart;
  while (end < body.close! && (text[end] === " " || text[end] === "\t")) end++;
  return text.slice(closeLineStart, end) + file.indentUnit;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

export function isBlank(text: string, start: number, end: number): boolean {
  for (let i = start; i < end && i < text.length; i++) {
    if (!isWhitespace(text[i])) return false;
  }
  return true;
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f" || c === "\v";
}
