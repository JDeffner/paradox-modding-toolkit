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
import type { GuiSourceFile, GuiEntry, GuiBody } from "./sourceModel";
import { findEntry, parseGuiSource } from "./sourceModel";

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
  return removeInline(file, entry);
}

/**
 * Removes an entry that shares its line with something else: its exact bytes
 * plus ONE adjacent separator space, the one before it by preference. Taking
 * the space back is what makes a single-line insert and delete exact inverses
 * instead of leaving `{ a  }` behind and growing one space per round trip
 * (W16, W25). An entry that is the ONLY thing between a single-line body's
 * braces takes the whole interior, which is the exact inverse of the insert
 * that filled an empty `{}`. "Only thing" is read off the TEXT, not off the
 * entry list: a body like `{ high light_background widget = {} }` has one
 * entry and two bare values, and clearing it would eat them.
 */
function removeInline(file: GuiSourceFile, entry: GuiEntry): GuiEdit {
  const text = file.text;
  const body = entry.parent?.body;
  if (
    body?.singleLine &&
    isBlank(text, body.open + 1, entry.span.start) &&
    isBlank(text, entry.span.end, body.close!)
  ) {
    return { start: body.open + 1, end: body.close!, newText: "" };
  }
  let { start, end } = entry.span;
  if (text[start - 1] === " ") start--;
  else if (text[end] === " ") end++;
  return { start, end, newText: "" };
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
  value = value.trim();
  if (value.length === 0) return null;

  const entry = `${key} = ${value}`;
  // Single-line body: keep it on one line rather than exploding it into a block
  // the author never wrote.
  if (body.singleLine) return insertInline(file, body, entry);

  const closeLineStart = closeLine(file, body);
  const indent = childIndent(file, node);
  return { start: closeLineStart, end: closeLineStart, newText: `${indent}${entry}${file.newline}` };
}

/**
 * Adds one entry inside a single-line body's braces, with exactly one separator
 * space on each side of it. An empty `{}` becomes `{ entry }`; a body that
 * already has content gets ` entry` appended before the closing brace. The
 * separator is what `removeInline` takes back, so the two are exact inverses
 * (W25, the `{ a  }` accumulation bug).
 */
function insertInline(file: GuiSourceFile, body: GuiBody, entry: string): GuiEdit {
  const text = file.text;
  const close = body.close!;
  const innerStart = body.open + 1;
  if (isBlank(text, innerStart, close)) {
    return { start: innerStart, end: close, newText: ` ${entry} ` };
  }
  // Land BEFORE the body's own trailing gap, so the closing brace keeps the
  // spacing the author gave it (`{a}` stays tight, `{ a }` stays spaced) and
  // the delete takes back exactly the one space this adds.
  let at = close;
  while (at > innerStart && isWhitespace(text[at - 1])) at--;
  return { start: at, end: at, newText: ` ${entry}` };
}

/** The start of the line the body's closing brace sits on. */
function closeLine(file: GuiSourceFile, body: GuiBody): number {
  return file.lines.lineStart(file.lines.positionAt(body.close!).line);
}

/**
 * The indent a new child entry carries: the body's own (copied verbatim from an
 * existing entry, so it matches the author's style exactly), else the closing
 * brace's own indent plus one unit for an otherwise-empty multi-line body.
 */
export function childIndent(file: GuiSourceFile, node: GuiEntry): string {
  const body = node.body!;
  if (body.indent !== null) return body.indent;
  const text = file.text;
  const from = closeLine(file, body);
  let end = from;
  while (end < body.close! && (text[end] === " " || text[end] === "\t")) end++;
  return text.slice(from, end) + file.indentUnit;
}

// ── The block model ─────────────────────────────────────────────────────────

/**
 * The source siblings of `node`: the declarations its body actually holds, in
 * source order. NOT the template-expanded children a preview shows: a
 * `using`-supplied child has no bytes at the use site, so an index taken from
 * the expanded tree would move the wrong block (W09, W14).
 */
export function sourceChildren(node: GuiEntry): GuiEntry[] {
  return node.body ? node.body.children : [];
}

/**
 * A widget's block, verbatim: attached comments and the nested body included,
 * the trailing blank separators excluded (W19). Null for a declaration that
 * shares its line with another one, which has no well-formed block to hand out.
 */
export function blockText(file: GuiSourceFile, entry: GuiEntry): string | null {
  if (!entry.ownLine) return null;
  return file.text.slice(entry.lineSpan.start, entry.lineSpan.end);
}

/** A new declaration to write: `type = { properties }`. */
export interface NewWidget {
  /** The declaration key: `widget`, `vbox`, or a type name. */
  type: string;
  /** Properties for the new body, in the order they are written. */
  properties?: readonly (readonly [string, string])[];
}

// ── Structural operations ───────────────────────────────────────────────────

/**
 * Moves the child at `from` to index `to` among its source siblings, as ONE
 * edit over the run between them. The blocks permute and whatever sits BETWEEN
 * them stays exactly where it is, so a move lands correctly relative to the
 * sibling it was aimed at even in an interleaved body (round-trip identity is
 * then legitimately not the identity there, which is why a sweep skips those,
 * W14/S03). Indices out of range clamp, a same-index move is a no-op, and a
 * body with fewer than two source children or a line-sharing declaration in
 * the run is refused (W11, W14).
 */
export function reorderChild(
  file: GuiSourceFile,
  parent: GuiEntry,
  from: number,
  to: number
): GuiEdit | null {
  const children = sourceChildren(parent);
  if (children.length < 2) return null;
  const last = children.length - 1;
  from = Math.min(Math.max(from, 0), last);
  to = Math.min(Math.max(to, 0), last);
  if (from === to) return null;

  const lo = Math.min(from, to);
  const run = children.slice(lo, Math.max(from, to) + 1);
  if (run.some((c) => !c.ownLine)) return null;

  // Blocks and the gaps between them: the gaps keep their slots, the blocks
  // permute through them (W12 gives each block its own trailing blank lines,
  // which is what makes a contiguous move a pure permutation).
  const blocks = run.map((c) => file.text.slice(c.blockSpan.start, c.blockSpan.end));
  const gaps = run.slice(0, -1).map((c, i) => file.text.slice(c.blockSpan.end, run[i + 1].blockSpan.start));
  blocks.splice(to - lo, 0, ...blocks.splice(from - lo, 1));

  let newText = blocks[0];
  for (let i = 1; i < blocks.length; i++) newText += gaps[i - 1] + blocks[i];
  return { start: run[0].blockSpan.start, end: run[run.length - 1].blockSpan.end, newText };
}

/**
 * Adds a child declaration to `parent`'s body at `index` among its source
 * children, or appends when the index is past the end. An append lands at the
 * last child's block end rather than on the closing brace's line, so it never
 * slips below a trailing run of commented-out code (W24). A single-line body
 * stays single-line, a propertyless widget gets an empty `{}` body rather than
 * a malformed one, and the declaration follows the file's newline and the
 * body's own indent (W15, W06).
 */
export function insertChild(
  file: GuiSourceFile,
  parent: GuiEntry,
  widget: NewWidget,
  index = Infinity
): GuiEdit | null {
  const body = parent.body;
  if (!body || body.close === null || widget.type.trim().length === 0) return null;

  if (body.singleLine) return insertInline(file, body, formatDeclInline(widget));
  const at = insertPoint(file, body, index);
  if (at < 0) return null;
  return { start: at, end: at, newText: formatDeclBlock(file, childIndent(file, parent), widget, "") };
}

/**
 * Pastes copied `.gui` text as a child of `parent`: the fragment's own common
 * leading whitespace is stripped as a string PREFIX, its interior indent LEVELS
 * are converted to the destination's unit (so no tab survives into a
 * space-indented file), its newlines become the destination's, and it lands by
 * the same rules as `insertChild`. Refused for a blank fragment, for text that
 * does not parse as declarations, and for a single-line destination body, which
 * a multi-line paste would explode (W20).
 */
export function insertRawChild(
  file: GuiSourceFile,
  parent: GuiEntry,
  fragment: string,
  index = Infinity
): GuiEdit | null {
  const body = parent.body;
  if (!body || body.close === null || body.singleLine) return null;

  const frag = parseGuiSource(fragment);
  if (frag.errors.length > 0 || frag.root.entries.length === 0) return null;
  if (frag.root.entries.some((e) => e.kind === "property")) return null;

  const at = insertPoint(file, body, index);
  if (at < 0) return null;
  return { start: at, end: at, newText: reindent(file, frag, childIndent(file, parent)) };
}

/**
 * Deletes a widget: its whole block, attached comments included and the blank
 * separators below it excluded, so an insert and a delete are exact inverses
 * (W16). A declaration sharing its line loses its exact bytes plus one adjacent
 * space, which cannot corrupt the neighbour.
 */
export function deleteWidget(file: GuiSourceFile, entry: GuiEntry): GuiEdit {
  if (!entry.ownLine) return removeInline(file, entry);
  return { start: entry.lineSpan.start, end: entry.lineSpan.end, newText: "" };
}

/**
 * Copies a widget's block in as its own next sibling, directly below the
 * original and inside the same body. `newName` renames ONLY the copy, keeping
 * the original's quoting style; without one the copy is byte-identical to the
 * original. Refused for a line-sharing declaration, for a rename with no `name`
 * entry to rewrite, and for a block with no newline of its own to sit on: the
 * last line of a file that does not end in one (W17).
 */
export function duplicateWidget(file: GuiSourceFile, entry: GuiEntry, newName?: string): GuiEdit | null {
  let copy = blockText(file, entry);
  if (copy === null || !copy.endsWith("\n")) return null;

  if (newName !== undefined) {
    const name = newName.trim();
    const source = entry.body ? findEntry(entry.body, "name") : null;
    if (name.length === 0 || !source?.valueSpan) return null;
    const start = source.valueSpan.start - entry.lineSpan.start;
    const end = source.valueSpan.end - entry.lineSpan.start;
    copy = copy.slice(0, start) + (source.valueQuoted ? `"${name}"` : name) + copy.slice(end);
  }
  return { start: entry.lineSpan.end, end: entry.lineSpan.end, newText: copy };
}

/**
 * Wraps `members` in a fresh container placed in the FIRST member's slot: the
 * members move inside in selection order, re-indented one unit, each carrying
 * its attached comment, and a skipped sibling of a non-contiguous selection
 * stays exactly where it was (W22). Returns the batch `applyAll` applies;
 * refused for an empty selection, for members of different bodies, and for a
 * line-sharing declaration, which has no block to move.
 */
export function wrapInContainer(
  file: GuiSourceFile,
  members: readonly GuiEntry[],
  container: NewWidget
): GuiEdit[] | null {
  const first = members[0];
  if (!first || container.type.trim().length === 0) return null;
  if (members.some((m) => m.parent !== first.parent || !m.ownLine)) return null;

  const inner = members
    .map((m) => indentLines(file.text.slice(m.lineSpan.start, m.lineSpan.end), file.indentUnit))
    .join("");
  const edits: GuiEdit[] = [
    {
      start: first.lineSpan.start,
      end: first.lineSpan.end,
      newText: formatDeclBlock(file, first.indent, container, inner),
    },
  ];
  for (const m of members.slice(1)) {
    edits.push({ start: m.lineSpan.start, end: m.lineSpan.end, newText: "" });
  }
  return edits;
}

// ── Formatting a new declaration ────────────────────────────────────────────

/** `type = {}` or `type = { k = v }`, for a body that must stay on one line. */
function formatDeclInline(widget: NewWidget): string {
  const props = properties(widget);
  const head = `${widget.type.trim()} = {`;
  if (props.length === 0) return `${head}}`;
  return `${head} ${props.map(([k, v]) => `${k} = ${v}`).join(" ")} }`;
}

/**
 * `type = { … }` as its own lines at `indent`, one property per line and
 * `inner` (already indented) between them and the closing brace. With neither
 * it stays the one-line empty `{}`, which is what a propertyless insert writes
 * rather than a two-line body the author never asked for.
 */
function formatDeclBlock(file: GuiSourceFile, indent: string, widget: NewWidget, inner: string): string {
  const props = properties(widget);
  const nl = file.newline;
  const head = `${indent}${widget.type.trim()} = {`;
  if (props.length === 0 && inner.length === 0) return `${head}}${nl}`;
  const body = props.map(([k, v]) => `${indent}${file.indentUnit}${k} = ${v}${nl}`).join("");
  return `${head}${nl}${body}${inner}${indent}}${nl}`;
}

function properties(widget: NewWidget): readonly (readonly [string, string])[] {
  return (widget.properties ?? []).filter(([key]) => key.trim().length > 0);
}

/** Prefixes every non-blank line of a block with one more indent unit. */
function indentLines(block: string, unit: string): string {
  return block.replace(/^(?=[^\r\n])/gm, unit);
}

/**
 * Re-indents a copied fragment for its destination. The fragment's own common
 * prefix is a STRING (a tab is never mistaken for n columns), what is left is
 * counted in the fragment's OWN unit and re-emitted in the destination's, and
 * the line endings become the destination's (W20).
 */
function reindent(file: GuiSourceFile, frag: GuiSourceFile, indent: string): string {
  const prefix = frag.root.indent ?? "";
  const unit = frag.indentUnit;
  const lines: string[] = [];
  for (const raw of frag.text.split(/\r?\n/)) {
    if (raw.trim().length === 0) {
      lines.push("");
      continue;
    }
    let rest = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^[ \t]*/, "");
    const lead = /^[ \t]*/.exec(rest)![0];
    rest = rest.slice(lead.length);
    let levels = 0;
    let extra = lead;
    while (extra.startsWith(unit)) {
      levels++;
      extra = extra.slice(unit.length);
    }
    lines.push(indent + file.indentUnit.repeat(levels) + extra.replace(/\t/g, file.indentUnit) + rest);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line + file.newline).join("");
}

/**
 * Where a new child lands: before the block of the child at `index` (its
 * attached comment included), else the body's append point, which is the last
 * child's own lines rather than the closing-brace line (W15, W24). A child that
 * shares its line has no block boundary to insert at, so the new one goes above
 * that whole line. Returns -1 when the point is not the start of a line, which
 * a body whose `}` shares a line with its last content can produce: writing a
 * line there would split that line, and the delete could not put it back.
 */
function insertPoint(file: GuiSourceFile, body: GuiBody, index: number): number {
  const target = body.children[index];
  const at = !target
    ? body.appendAfter
    : target.ownLine
      ? target.blockSpan.start
      : file.lines.lineStart(target.line);
  const lineStart = file.lines.lineStart(file.lines.positionAt(at).line);
  return isBlank(file.text, lineStart, at) ? at : -1;
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
