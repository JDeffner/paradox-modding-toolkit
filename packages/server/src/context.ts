/**
 * Block-context detection: from a cursor offset, walk the CST path upward to
 * the nearest block keyword that decides trigger vs effect grammar.
 *
 * This is deliberately not scope-chain inference (that is the scope engine's
 * job, Phase 3); it only answers "am I inside a trigger block, an effect
 * block, or don't know". Built on the tolerant parser — the v0.3 regex walker
 * this replaces re-scanned the whole document per keystroke.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import { classifyKeyword } from "./contextKeywords";
import { nodeAtOffset, parseScript, type BlockNode, type ParseResult, type Statement } from "./parser";

export type BlockContext = "trigger" | "effect" | "value" | "unknown";

export interface ContextResult {
  context: BlockContext;
  /** The block keyword that decided the context, or null at top level. */
  keyword: string | null;
}

function childBlock(stmt: Statement): BlockNode | null {
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

/** The stack of enclosing block keywords at `offset` (outermost first, "<anon>" for bare blocks). */
export function blockStackFromParse(parse: ParseResult, offset: number): string[] {
  return blockPathFromParse(parse, offset).map((stmt) =>
    stmt && stmt.kind === "assignment" ? stmt.key.text : "<anon>"
  );
}

/** As blockStackFromParse, but the enclosing statements themselves (null for bare blocks). */
export function blockPathFromParse(parse: ParseResult, offset: number): Array<Statement | null> {
  const hit = nodeAtOffset(parse.root, offset);
  if (!hit) return [];
  const path: Array<Statement | null> = [];
  for (const stmt of hit.path) {
    const block = childBlock(stmt);
    // Only statements whose *block* encloses the offset contribute to the stack;
    // the leaf statement under the cursor (a half-typed word) does not.
    if (!block) continue;
    if (offset <= block.openBrace) continue;
    if (block.closeBrace !== null && offset > block.closeBrace) continue;
    path.push(stmt.kind === "assignment" ? stmt : null);
  }
  return path;
}

/**
 * Detect the completion context at `offset` from a cached parse. Walks the
 * block stack from the innermost block outward: the first keyword classified
 * as trigger or effect wins; transparent keywords (if/else/AND/OR/scope
 * changes) are skipped; an unrecognized keyword yields "unknown" (never hide
 * results when unsure).
 */
export function detectContextFromParse(parse: ParseResult, offset: number): ContextResult {
  const stack = blockStackFromParse(parse, offset);
  for (let i = stack.length - 1; i >= 0; i--) {
    const keyword = stack[i];
    if (keyword === "<anon>") continue;
    const cls = classifyKeyword(keyword);
    if (cls === "trigger" || cls === "effect" || cls === "value") return { context: cls, keyword };
    if (cls === "transparent") continue;
    return { context: "unknown", keyword };
  }
  return { context: "unknown", keyword: null };
}

/** Convenience for tests and one-off callers: parse + detect in one step. */
export function detectContext(text: string, offset: number): ContextResult {
  return detectContextFromParse(parseScript(text), offset);
}
