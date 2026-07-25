/**
 * paradox/guiWidgetEdit backend: turn a preview interaction (drag, property-panel
 * change) into a precise text edit on the .gui source.
 *
 * The widget is addressed by the 0-based line its instance statement starts
 * on (the same `line` the layout engine reports). The edit either replaces
 * the existing `property = { a b }` pair value or inserts the property as the
 * first statement of the widget's block, matching the block's indentation.
 *
 * Pure text-in/edit-out (no vscode imports): the client applies the returned
 * offset range via WorkspaceEdit, which keeps undo, dirty state, and the
 * live-preview refresh loop in the editor's hands.
 */
import { LineIndex, parseScript, type AssignmentNode, type BlockNode, type Statement } from "../parser";

export interface WidgetTextEdit {
  /** UTF-16 offsets into the request's text. */
  start: number;
  end: number;
  newText: string;
}

const PAIR_PROPERTIES = new Set(["position", "size"]);

export function computeGuiWidgetEdit(
  text: string,
  line: number,
  property: string,
  values: [number, number]
): WidgetTextEdit | null {
  if (!PAIR_PROPERTIES.has(property)) return null;
  const result = parseScript(text);
  const lineIndex = new LineIndex(text);
  const target = findWidgetAt(result.root.statements, line, lineIndex);
  if (!target) return null;
  const block = valueBlock(target);
  if (!block || block.closeBrace === null) return null;

  const pair = `{ ${fmt(values[0])} ${fmt(values[1])} }`;

  // Replace the existing pair's value block, if the widget declares one.
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment") continue;
    if (stmt.key.text.toLowerCase() !== property) continue;
    const v = stmt.value;
    if (v && v.kind === "block") {
      return { start: v.range.start, end: v.range.end, newText: pair };
    }
  }

  // Insert as the first statement, using the indentation of the block's
  // first child (or the key's own indentation plus one tab).
  const keyPos = lineIndex.positionAt(target.key.range.start);
  const keyIndent =
    text.slice(lineIndex.lineStart(keyPos.line), target.key.range.start).match(/^[ \t]*/)?.[0] ?? "";
  let indent = keyIndent + "\t";
  const first = block.statements[0];
  if (first) {
    const p = lineIndex.positionAt(first.range.start);
    const fromLineStart = text.slice(lineIndex.lineStart(p.line), first.range.start);
    if (/^[ \t]*$/.test(fromLineStart)) indent = fromLineStart;
  }
  const insertAt = block.openBrace + 1;
  return { start: insertAt, end: insertAt, newText: `\n${indent}${property} = ${pair}` };
}

/** First assignment-with-block whose key starts on `line` (depth-first). */
function findWidgetAt(statements: Statement[], line: number, lineIndex: LineIndex): AssignmentNode | null {
  for (const stmt of statements) {
    if (stmt.kind !== "assignment") continue;
    const block = valueBlock(stmt);
    if (!block) continue;
    if (lineIndex.positionAt(stmt.key.range.start).line === line) return stmt;
    const nested = findWidgetAt(block.statements, line, lineIndex);
    if (nested) return nested;
  }
  return null;
}

function valueBlock(stmt: AssignmentNode): BlockNode | null {
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

function fmt(v: number): string {
  const rounded = Math.round(v);
  return Math.abs(v - rounded) < 0.005 ? String(rounded) : v.toFixed(1);
}
