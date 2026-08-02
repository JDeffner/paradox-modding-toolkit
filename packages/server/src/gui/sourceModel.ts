// Implements the source-writer design of Sage's Clausewitz Studio; behavior contract in docs/gui-designer/parity-checklist.md. GPL-3.0-or-later.
/**
 * The span-recording .gui source model (G1 stage 1: reads only, no ops).
 *
 * A source-preserving writer edits BYTES, so it needs a model that knows where
 * every byte came from: the raw span of every key, operator and value (quotes,
 * pipes and interior spacing verbatim), the braces of every body, and the
 * block-structure facts that decide what a reorder or a delete is allowed to
 * move. Every read a later stage needs is recorded here once, so no operation
 * has to re-tokenize the document to answer a question about it.
 *
 * This is a second VIEW of the toolkit's own tolerant CST (`parseScript`), not
 * a second parser: the CST supplies the structure and the token ranges, and
 * this module adds the line-granular facts a text editor works in.
 *
 * Contract rows: W01 (spans), S01 (every span re-tokenizes to its model value),
 * S06 (every body's braces land on braces). The structure facts the later
 * stages consume are W12 (blank separators belong to the block above), W13
 * (attached comments travel with their widget), W14/S03 (interleaved bodies),
 * W24 (the append point) and W06/W15/W20 (newline and indent unit).
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import {
  LineIndex,
  parseScript,
  type AssignmentNode,
  type BlockNode,
  type CommentNode,
  type Operator,
  type ParseError,
  type Range,
  type ScalarNode,
  type Statement,
  type ValueNode,
} from "../parser";
import { PROPERTY_BLOCKS } from "./layoutEngine";

/** A raw byte range in the document (UTF-16 code units, like the CST). */
export type GuiSpan = Range;

/**
 * `widget` is a child widget declaration (the inverse rule: a block child is a
 * widget unless its key is a known attribute block), `decl` is a
 * template/type/block declaration introduced by a marker word, `property` is
 * everything else, including the attribute BLOCKS (`size = { 100 200 }`),
 * whose value happens to be a block.
 */
export type GuiEntryKind = "widget" | "decl" | "property";

/** Marker words that turn the following assignment into a declaration. */
const DECL_MARKERS = new Set(["template", "local_template", "types", "type", "block", "blockoverride"]);

/**
 * Named slots, which vanilla spells two ways: `blockoverride "name" { ... }`
 * (272 uses in the game tree, the marker form) and `blockoverride = "name"
 * { ... }` (29 uses, which the CST reads as one assignment whose value is a
 * tagged block). Both mean the same slot, so the model normalizes the second
 * into the first: the key becomes the marker, the tag becomes the key, and the
 * value is the block alone.
 */
const SLOT_KEYS = new Set(["block", "blockoverride"]);

/** One `key [op] value` statement, with every raw span the writer addresses it by. */
export interface GuiEntry {
  kind: GuiEntryKind;
  /** Key text as authored, without the quotes of a quoted key. */
  key: string;
  keyLower: string;
  /** The key token's raw bytes, quotes included. */
  keySpan: GuiSpan;
  keyQuoted: boolean;
  /** null for the operator-less GUI form `widget { ... }`. */
  op: Operator | null;
  opSpan: GuiSpan | null;
  /**
   * The value normalized for comparison: a quoted scalar without its quotes, a
   * bare scalar verbatim (`top|left` stays one value), a block rendered
   * canonically. Re-tokenizing `valueSpan` alone reproduces exactly this (S01).
   */
  value: string | null;
  /** The value's raw bytes: quotes, pipes, braces and interior spacing verbatim. */
  valueSpan: GuiSpan | null;
  valueKind: "none" | "scalar" | "block";
  valueQuoted: boolean;
  /** The tag of `type px_x = widget { ... }`, else null. */
  base: string | null;
  /** The declaration marker word (lowercased), else null. */
  marker: string | null;
  markerSpan: GuiSpan | null;
  /**
   * The entry's own bytes: header start (the marker when there is one, else the
   * key) through the end of the value. Key then value, in order.
   */
  span: GuiSpan;
  /** 0-based line of `span.start`. */
  line: number;
  /** 0-based line of the last byte of `span`. */
  endLine: number;
  /** Whitespace between the start of `line` and `span.start` (empty when the entry shares a line). */
  indent: string;
  /**
   * The entry starts its line and nothing but a comment follows it on its last
   * line. `commentSpan`/`lineSpan`/`blockSpan` are only meaningful when true;
   * a line-sharing declaration can only be addressed by `span` (W14, W16).
   */
  ownLine: boolean;
  /** The run of comment-only lines directly above, with no blank line between (W13). */
  commentSpan: GuiSpan | null;
  /** A comment after the entry on its last line: information the line still carries (W04). */
  trailingComment: GuiSpan | null;
  /** Attached comments plus the entry's own lines, trailing newline included. */
  lineSpan: GuiSpan;
  /** `lineSpan` plus the blank lines below it, which belong to the block above (W12). */
  blockSpan: GuiSpan;
  /** Present when the value is a block (attribute blocks included). */
  body: GuiBody | null;
  /**
   * The CST block `body` was built from. The model is a second VIEW of the
   * toolkit's CST, so keeping the node costs nothing and lets a reader that
   * needs the parser's own shape (template/type expansion) start from the same
   * entry the writer addresses, instead of re-finding the widget its own way.
   */
  block: BlockNode | null;
  parent: GuiEntry | null;
}

/** A `{ ... }` body, or the document root, with the facts a structural edit needs. */
export interface GuiBody {
  /** Offset of `{`, or -1 for the document root. */
  open: number;
  /** Offset of `}`, or null when the brace is missing (root, or a parse error). */
  close: number | null;
  /** Between the braces (the whole document for the root). */
  inner: GuiSpan;
  /** Every `key [op] value` statement of this body, in source order. */
  entries: GuiEntry[];
  /** The subset that declares something: the reorder/insert/delete sibling list. */
  children: GuiEntry[];
  /** Open and close brace on the same line. */
  singleLine: boolean;
  /** No statements at all (`{}` or `{ }`). */
  empty: boolean;
  /** Nothing but whitespace before `}` on its line, so a new line can be inserted above it. */
  closeOwnLine: boolean;
  /** The body's own indent, from its first line-owning entry; null when it has none. */
  indent: string | null;
  /**
   * The children tile the body with nothing between them, so a reorder is a
   * pure permutation. False for an interleaved body, whose round trip is
   * legitimately not the identity (W14, S03).
   */
  contiguous: boolean;
  /**
   * Where a new child is appended: after the last child's own lines (NOT after
   * its blank separators, so an insert and a delete are exact inverses), or,
   * with no children, backed up over a trailing comment run so an insert never
   * lands below commented-out code (W24).
   */
  appendAfter: number;
}

export interface GuiSourceFile {
  text: string;
  /** The file's own line ending: every inserted line follows it (W06). */
  newline: "\n" | "\r\n";
  /** The file's own indent unit: a tab, or the narrowest space indent it uses (W06, W15, W20). */
  indentUnit: string;
  root: GuiBody;
  /** Every entry in the document, depth first, in source order. */
  entries: GuiEntry[];
  /** Parse errors from the CST; a file with errors is not safe to edit. */
  errors: ParseError[];
  lines: LineIndex;
}

interface BuildCtx {
  text: string;
  lines: LineIndex;
  /** Per line: blank, comment-only, or code. */
  lineKind: Uint8Array;
  commentsByLine: Map<number, CommentNode[]>;
  entries: GuiEntry[];
}

const LINE_BLANK = 0;
const LINE_COMMENT = 1;
const LINE_CODE = 2;

export function parseGuiSource(text: string): GuiSourceFile {
  const parsed = parseScript(text);
  const lines = new LineIndex(text);
  const commentsByLine = new Map<number, CommentNode[]>();
  for (const c of parsed.comments) {
    const list = commentsByLine.get(c.line);
    if (list) list.push(c);
    else commentsByLine.set(c.line, [c]);
  }
  const ctx: BuildCtx = {
    text,
    lines,
    lineKind: classifyLines(text, lines, commentsByLine),
    commentsByLine,
    entries: [],
  };
  const root = buildBody(parsed.root.statements, -1, null, { start: 0, end: text.length }, null, ctx);
  return {
    text,
    newline: detectNewline(text),
    indentUnit: detectIndentUnit(text, lines),
    root,
    entries: ctx.entries,
    errors: parsed.errors,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Reads the later stages are built on
// ---------------------------------------------------------------------------

/**
 * The declaration whose statement starts on `line`: the same 0-based line the
 * layout engine reports for a node, so a preview selection maps to its source.
 * Depth first, outermost first. Null means the node has no source here (a
 * template-expanded or otherwise synthetic node), which is a refusal (W09).
 */
export function findWidgetAtLine(file: GuiSourceFile, line: number): GuiEntry | null {
  for (const entry of file.entries) {
    if (entry.kind === "property") continue;
    if (entry.line === line) return entry;
    if (file.lines.positionAt(entry.keySpan.start).line === line) return entry;
  }
  return null;
}

/**
 * A body's entry for `key`, matched case-insensitively. The LAST occurrence
 * wins: duplicate keys inside one body resolve last-in-wins in the engine, so
 * that is the one a write has to rewrite (W02, W07).
 */
export function findEntry(body: GuiBody, key: string): GuiEntry | null {
  const lower = key.toLowerCase();
  let found: GuiEntry | null = null;
  for (const entry of body.entries) {
    if (entry.keyLower === lower) found = entry;
  }
  return found;
}

/** The indent a new entry inside `body` takes: the body's own, else one unit deeper than its owner. */
export function bodyIndent(file: GuiSourceFile, body: GuiBody, owner: GuiEntry | null): string {
  if (body.indent !== null) return body.indent;
  return (owner?.ownLine ? owner.indent : "") + file.indentUnit;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function buildBody(
  statements: Statement[],
  open: number,
  close: number | null,
  inner: GuiSpan,
  owner: GuiEntry | null,
  ctx: BuildCtx
): GuiBody {
  const entries: GuiEntry[] = [];
  let marker: { text: string; span: GuiSpan } | null = null;
  for (const stmt of statements) {
    if (stmt.kind === "value") {
      // A bare `template` / `type` / `blockoverride` word labels the next
      // assignment; anything else clears the label.
      marker =
        stmt.value.kind === "scalar" && DECL_MARKERS.has(stmt.value.text.toLowerCase())
          ? { text: stmt.value.text.toLowerCase(), span: stmt.value.range }
          : null;
      continue;
    }
    const own = marker;
    marker = null;
    entries.push(buildEntry(stmt, own, owner, ctx));
  }

  const children = entries.filter((e) => e.kind !== "property");
  const closeLine = close === null ? -1 : ctx.lines.positionAt(close).line;
  const closeOwnLine =
    close !== null && /^[ \t]*$/.test(ctx.text.slice(ctx.lines.lineStart(closeLine), close));
  let indent: string | null = null;
  for (const entry of entries) {
    if (entry.ownLine) {
      indent = entry.indent;
      break;
    }
  }

  let contiguous = true;
  for (let i = 0; i + 1 < children.length; i++) {
    if (
      !children[i].ownLine ||
      !children[i + 1].ownLine ||
      children[i].blockSpan.end !== children[i + 1].blockSpan.start
    ) {
      contiguous = false;
      break;
    }
  }

  return {
    open,
    close,
    inner,
    entries,
    children,
    singleLine: open >= 0 && close !== null && ctx.lines.positionAt(open).line === closeLine,
    empty: statements.length === 0,
    closeOwnLine,
    indent,
    contiguous,
    appendAfter: appendPoint(children, close, closeLine, closeOwnLine, ctx),
  };
}

/**
 * W24: append after the last child's own lines, not after its blank
 * separators, or an insert and its delete would disagree about one blank line.
 * With no children, back up from the closing brace over a run of comment-only
 * lines, so a new widget lands above commented-out code instead of below it.
 */
function appendPoint(
  children: GuiEntry[],
  close: number | null,
  closeLine: number,
  closeOwnLine: boolean,
  ctx: BuildCtx
): number {
  const last = children[children.length - 1];
  if (last && last.ownLine) return last.lineSpan.end;
  // A body whose `}` shares a line with content has no line to insert above.
  if (close !== null && !closeOwnLine) return close;
  // The document root ends at the last line that carries anything.
  let line = closeLine;
  if (close === null) {
    line = ctx.lines.lineCount;
    while (line > 0 && ctx.lineKind[line - 1] === LINE_BLANK) line--;
  }
  while (line > 0 && ctx.lineKind[line - 1] === LINE_COMMENT) line--;
  return ctx.lines.lineStart(line);
}

function buildEntry(
  stmt: AssignmentNode,
  declMarker: { text: string; span: GuiSpan } | null,
  parent: GuiEntry | null,
  ctx: BuildCtx
): GuiEntry {
  const { text, lines } = ctx;
  const opSpan = operatorSpan(text, stmt);
  const slot = slotForm(stmt, declMarker);
  const marker = slot?.marker ?? declMarker;
  const key = slot?.key ?? stmt.key;
  const value = slot?.value ?? stmt.value;
  const block = blockOf(value);
  const start = marker ? marker.span.start : key.range.start;
  const end = value ? value.range.end : stmt.range.end;
  const span: GuiSpan = { start, end };
  const line = lines.positionAt(start).line;
  const endLine = lines.positionAt(Math.max(start, end - 1)).line;
  const lineStart = lines.lineStart(line);
  const indentText = text.slice(lineStart, start);
  const startsLine = /^[ \t]*$/.test(indentText);

  // A comment after the entry does not break line ownership, but it is
  // information the line still carries, so a remove is entry-granular (W04).
  const lineEnd = lines.lineStart(endLine + 1);
  let trailingComment: GuiSpan | null = null;
  let endsLine = /^[ \t\r\n]*$/.test(text.slice(end, lineEnd));
  if (!endsLine) {
    for (const c of ctx.commentsByLine.get(endLine) ?? []) {
      if (c.range.start < end) continue;
      if (!/^[ \t]*$/.test(text.slice(end, c.range.start))) break;
      trailingComment = c.range;
      endsLine = true;
      break;
    }
  }
  const ownLine = startsLine && endsLine;

  const entry: GuiEntry = {
    kind: classify(key, marker, block),
    key: key.text,
    keyLower: key.text.toLowerCase(),
    keySpan: key.range,
    keyQuoted: key.quoted,
    op: stmt.op,
    opSpan,
    value: value ? normalizeValue(text, value) : null,
    valueSpan: value ? value.range : null,
    valueKind: value === null ? "none" : value.kind === "scalar" ? "scalar" : "block",
    valueQuoted: value?.kind === "scalar" ? value.quoted : false,
    base: value?.kind === "tagged-block" ? value.tag.text : null,
    marker: marker?.text ?? null,
    markerSpan: marker?.span ?? null,
    span,
    line,
    endLine,
    indent: startsLine ? indentText : "",
    ownLine,
    commentSpan: null,
    trailingComment,
    lineSpan: span,
    blockSpan: span,
    body: null,
    block,
    parent,
  };

  if (ownLine) {
    let first = line;
    while (first > 0 && ctx.lineKind[first - 1] === LINE_COMMENT) first--;
    const from = lines.lineStart(first);
    entry.commentSpan = first === line ? null : { start: from, end: lineStart };
    entry.lineSpan = { start: from, end: lineEnd };
    // Blank lines below belong to the block above them, which is what makes a
    // move a pure permutation and a move-and-move-back the identity (W12).
    let below = endLine + 1;
    while (below < ctx.lineKind.length && ctx.lineKind[below] === LINE_BLANK) below++;
    entry.blockSpan = { start: from, end: lines.lineStart(below) };
  }

  ctx.entries.push(entry);
  if (block) {
    entry.body = buildBody(
      block.statements,
      block.openBrace,
      block.closeBrace,
      { start: block.openBrace + 1, end: block.closeBrace ?? block.range.end },
      entry,
      ctx
    );
  }
  return entry;
}

/**
 * The inverse rule, taken from the layout engine's own attribute-block set so
 * the writer and the preview can never disagree about what is a widget: a
 * block child is a widget unless its key is a known attribute block.
 */
function classify(key: ScalarNode, marker: { text: string } | null, block: BlockNode | null): GuiEntryKind {
  if (marker) return "decl";
  if (!block) return "property";
  const lower = key.text.toLowerCase();
  if (PROPERTY_BLOCKS.has(lower) || lower.startsWith("@")) return "property";
  return "widget";
}

/** The `blockoverride = "name" { ... }` spelling, re-read as marker + name + body. */
function slotForm(
  stmt: AssignmentNode,
  marker: { text: string; span: GuiSpan } | null
): { marker: { text: string; span: GuiSpan }; key: ScalarNode; value: BlockNode } | null {
  if (marker || stmt.value?.kind !== "tagged-block") return null;
  const lower = stmt.key.text.toLowerCase();
  if (!SLOT_KEYS.has(lower)) return null;
  return {
    marker: { text: lower, span: stmt.key.range },
    key: stmt.value.tag,
    value: stmt.value.block,
  };
}

function blockOf(value: ValueNode | null): BlockNode | null {
  if (!value) return null;
  if (value.kind === "block") return value;
  if (value.kind === "tagged-block") return value.block;
  return null;
}

/**
 * The operator token's own bytes. The CST records the operator's TEXT but not
 * its range; it is the first content between the key and the value, so finding
 * it costs one trivia skip rather than a re-tokenize.
 */
function operatorSpan(text: string, stmt: AssignmentNode): GuiSpan | null {
  if (stmt.op === null) return null;
  const at = skipTrivia(text, stmt.key.range.end);
  if (!text.startsWith(stmt.op, at)) return null;
  return { start: at, end: at + stmt.op.length };
}

function skipTrivia(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11) {
      i++;
      continue;
    }
    if (c === 35 /* # */) {
      while (i < text.length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      continue;
    }
    break;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Value normalization (S01)
// ---------------------------------------------------------------------------

/**
 * The comparison form of a value. A quoted scalar loses its quotes (the model
 * value is the string, the span keeps the bytes); a bare scalar is verbatim, so
 * a compound `top|left` stays ONE value and its span covers both sides of the
 * pipe (W08); a block is rendered from its tokens with single spaces, so the
 * rendering is independent of the interior whitespace the span preserves.
 */
export function normalizeValue(text: string, value: ValueNode): string {
  if (value.kind === "scalar") return value.text;
  return renderValue(text, value);
}

function renderValue(text: string, value: ValueNode): string {
  if (value.kind === "scalar") return text.slice(value.range.start, value.range.end);
  if (value.kind === "tagged-block") {
    return `${text.slice(value.tag.range.start, value.tag.range.end)} ${renderValue(text, value.block)}`;
  }
  const parts = value.statements.map((s) => renderStatement(text, s));
  return parts.length === 0 ? "{}" : `{ ${parts.join(" ")} }`;
}

function renderStatement(text: string, stmt: Statement): string {
  if (stmt.kind === "value") return renderValue(text, stmt.value);
  const key = text.slice(stmt.key.range.start, stmt.key.range.end);
  const value = stmt.value ? renderValue(text, stmt.value) : "";
  if (stmt.op === null) return stmt.value ? `${key} ${value}` : key;
  return stmt.value ? `${key} ${stmt.op} ${value}` : `${key} ${stmt.op}`;
}

// ---------------------------------------------------------------------------
// Line facts
// ---------------------------------------------------------------------------

function classifyLines(
  text: string,
  lines: LineIndex,
  commentsByLine: Map<number, CommentNode[]>
): Uint8Array {
  const kinds = new Uint8Array(lines.lineCount);
  for (let line = 0; line < lines.lineCount; line++) {
    const start = lines.lineStart(line);
    const end = lines.lineStart(line + 1);
    const raw = text.slice(start, end);
    if (/^\s*$/.test(raw)) {
      kinds[line] = LINE_BLANK;
      continue;
    }
    // Comment-only means the first content on the line is a comment token; a
    // `#` inside a quoted string is not one, which is why this reads the
    // parser's comment list instead of searching the text.
    const contentAt = start + (/^[ \t]*/.exec(raw)?.[0].length ?? 0);
    const isComment = (commentsByLine.get(line) ?? []).some((c) => c.range.start === contentAt);
    kinds[line] = isComment ? LINE_COMMENT : LINE_CODE;
  }
  return kinds;
}

/** The file's line ending, by majority: a CRLF file gets CRLF inserts (W06). */
function detectNewline(text: string): "\n" | "\r\n" {
  let lf = 0;
  let crlf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10) continue;
    lf++;
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
  }
  return crlf * 2 >= lf && crlf > 0 ? "\r\n" : "\n";
}

/**
 * The file's indent unit: a tab when tabs lead at least as many indented lines
 * as spaces do (vanilla .gui is tab-indented, and a stray aligned comment must
 * not flip a tabbed file), otherwise the narrowest space indent in the file.
 * Per-BODY indent is a string copied verbatim from the body (GuiBody.indent);
 * this unit is only for going one level deeper than a body that has none.
 */
function detectIndentUnit(text: string, lines: LineIndex): string {
  let tabs = 0;
  let spaces = 0;
  let narrowest = Infinity;
  for (let line = 0; line < lines.lineCount; line++) {
    const start = lines.lineStart(line);
    const raw = text.slice(start, lines.lineStart(line + 1));
    if (/^\s*$/.test(raw)) continue;
    const indent = /^[ \t]*/.exec(raw)?.[0] ?? "";
    if (indent.startsWith("\t")) tabs++;
    else if (indent.length > 0) {
      spaces++;
      narrowest = Math.min(narrowest, indent.length);
    }
  }
  if (tabs >= spaces || !Number.isFinite(narrowest)) return "\t";
  return " ".repeat(narrowest);
}
