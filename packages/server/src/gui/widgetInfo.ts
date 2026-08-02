/**
 * paradox/guiWidgetInfo backend: the properties of ONE widget, with the
 * template/type chain each value came from. This is the designer inspector's
 * read side.
 *
 * Two rules keep it honest:
 * - It addresses the widget the way the WRITER does (`findWidgetAtLine` over
 *   the source model), so what the inspector lists is what a `setProperties`
 *   op would rewrite, on the same line, in the same file.
 * - It resolves the widget the way the ENGINE does (`effectiveDefs` +
 *   `expandWidgetWithOrigins`), so it cannot list a value the canvas did not
 *   lay the widget out with. Last-in-wins per key, exactly as the engine reads
 *   an expanded body.
 *
 * Values are rendered from the parser's own tokens rather than sliced out of
 * the document: a property inherited from a type lives in another file, whose
 * text the def store does not keep.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { GuiWidgetInfo, GuiWidgetProperty } from "@px-lsp/protocol/protocol";
import type { Statement, ValueNode } from "../parser";
import { effectiveDefs, PROPERTY_BLOCKS } from "./layoutEngine";
import { expandWidgetWithOrigins, typeBaseChain, type GuiDefs } from "./guiDefs";
import { findWidgetAtLine, parseGuiSource } from "./sourceModel";

/** Marker words whose assignment is a named slot, not a property. */
const SLOT_KEYS = new Set(["block", "blockoverride"]);

/** Marker words that turn the FOLLOWING assignment into a declaration. */
const DECL_MARKERS = new Set(["template", "local_template", "types", "type", "block", "blockoverride"]);

export function computeGuiWidgetInfo(text: string, line: number, store?: GuiDefs): GuiWidgetInfo | null {
  const file = parseGuiSource(text);
  const target = findWidgetAtLine(file, line);
  if (!target || !target.block) return null;
  // A template/type DECLARATION is not an instance: expanding its own name
  // would splice the definition into itself. The canvas never selects one.
  if (target.marker) return null;

  const defs = effectiveDefs(text, store);
  const expanded = expandWidgetWithOrigins(target.key, target.block, defs);

  // Last-in-wins per key, and the winner keeps the position it was written at:
  // inherited rows stay where the type put them, an override moves down to the
  // instance body, which is where its bytes are.
  const byKey = new Map<string, GuiWidgetProperty>();
  let marker: string | null = null;
  for (const { stmt, origin } of expanded.statements) {
    if (stmt.kind === "value") {
      marker =
        stmt.value.kind === "scalar" && DECL_MARKERS.has(stmt.value.text.toLowerCase())
          ? stmt.value.text.toLowerCase()
          : null;
      continue;
    }
    const wasDecl = marker !== null;
    marker = null;
    if (wasDecl || !stmt.value) continue;
    const keyLower = stmt.key.text.toLowerCase();
    if (SLOT_KEYS.has(keyLower)) continue;
    // The inverse rule the writer and the engine share: a block child is a
    // widget unless its key is a known attribute block.
    if (stmt.value.kind === "block" && !PROPERTY_BLOCKS.has(keyLower)) continue;
    byKey.delete(keyLower);
    byKey.set(keyLower, { key: stmt.key.text, value: renderValue(stmt.value), origin });
  }

  return {
    key: target.key,
    name: nameOf(expanded.statements),
    typeChain: typeBaseChain(target.key, [defs]),
    properties: [...byKey.values()],
  };
}

/** The widget's effective `name`, last-in-wins like every other scalar. */
function nameOf(statements: readonly { stmt: Statement }[]): string | undefined {
  let found: string | undefined;
  for (const { stmt } of statements) {
    if (stmt.kind !== "assignment" || stmt.value?.kind !== "scalar") continue;
    if (stmt.key.text.toLowerCase() === "name") found = stmt.value.text;
  }
  return found;
}

/**
 * A value as authored, from the tokens alone. Quoted scalars keep their quotes
 * (`.gui` distinguishes them and the row should read like the source); a block
 * renders with single spaces, so the rendering is independent of the interior
 * whitespace of a file this reader may not have.
 */
function renderValue(value: ValueNode): string {
  if (value.kind === "scalar") return value.quoted ? `"${value.text}"` : value.text;
  if (value.kind === "tagged-block") return `${value.tag.text} ${renderValue(value.block)}`;
  const parts = value.statements.map(renderStatement);
  return parts.length === 0 ? "{}" : `{ ${parts.join(" ")} }`;
}

function renderStatement(stmt: Statement): string {
  if (stmt.kind === "value") return renderValue(stmt.value);
  const key = stmt.key.quoted ? `"${stmt.key.text}"` : stmt.key.text;
  if (!stmt.value) return stmt.op === null ? key : `${key} ${stmt.op}`;
  const value = renderValue(stmt.value);
  return stmt.op === null ? `${key} ${value}` : `${key} ${stmt.op} ${value}`;
}
