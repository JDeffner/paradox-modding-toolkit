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
import {
  nodeAtOffset,
  parseScript,
  walkStatements,
  type BlockNode,
  type ParseResult,
  type RootNode,
  type Statement,
} from "./parser";

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
export function detectContextFromParse(parse: ParseResult, offset: number, rootKind?: string): ContextResult {
  return contextFromStatements(parse.root, blockPathFromParse(parse, offset), rootKind);
}

const inlineKinds = new WeakMap<RootNode, Map<Statement, string>>();

/** The parser represents an inline declaration as a marker then an assignment. */
export function inlineKind(root: RootNode, statement: Statement): string | undefined {
  let kinds = inlineKinds.get(root);
  if (!kinds) {
    kinds = new Map();
    walkStatements(root, (stmt, ancestors) => {
      if (stmt.kind !== "value" || stmt.value.kind !== "scalar" || stmt.value.quoted) return;
      const kind = stmt.value.text;
      if (kind !== "scripted_trigger" && kind !== "scripted_effect") return;
      const parent = ancestors.at(-1);
      const siblings = parent?.kind === "block" ? parent.statements : root.statements;
      const next = siblings[siblings.indexOf(stmt) + 1];
      if (next?.kind === "assignment") kinds!.set(next, kind);
    });
    inlineKinds.set(root, kinds);
  }
  return kinds.get(statement);
}

export function contextFromStatements(
  root: RootNode,
  statements: readonly (Statement | BlockNode | null)[],
  rootKind?: string
): ContextResult {
  const stack: string[] = [];
  for (const stmt of statements) {
    if (stmt?.kind !== "assignment") continue;
    const kind = inlineKind(root, stmt);
    if (kind) {
      stack.length = 0;
      rootKind = kind;
    }
    stack.push(stmt.key.text);
  }
  return contextFromKeywords(stack, rootKind);
}

/** Shared by cursor features and the reference extractor's ancestor walk. */
export function contextFromKeywords(stack: readonly string[], rootKind?: string): ContextResult {
  for (let i = stack.length - 1; i >= 0; i--) {
    const keyword = stack[i];
    if (keyword === "<anon>") continue;
    if (i === 0) {
      if (rootKind === "scripted_trigger") return { context: "trigger", keyword };
      if (rootKind === "scripted_effect") return { context: "effect", keyword };
      if (rootKind === "script_value") return { context: "value", keyword };
    }
    // script_docs random_list: each weighted child contains effects. The
    // child's label is a weight expression, not a new grammar context.
    if (i > 0 && stack[i - 1].toLowerCase() === "random_list") continue;
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
