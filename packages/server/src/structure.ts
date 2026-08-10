/**
 * Block-schema structure context (update plan v1.1 §B2): which named sub-block
 * of a definition kind the cursor sits in, and the KeySpecs valid there.
 *
 * Pairs the file's schema kind (from classifyFile) with the CST block stack:
 * the innermost stack keyword that names a structure sub-block wins; otherwise
 * the cursor is at the definition's top level. Transparent wrappers (first_valid,
 * random_list, if…) are simply not named blocks, so the walk skips past them.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { KeySpec } from "./schema/types";
import type { StructureIndex } from "./schema/loader";
import { blockStackFromParse } from "./context";
import type { ParseResult } from "./parser";

export interface StructureContext {
  /** Schema kind of the file, e.g. "character_interaction". */
  kind: string;
  /** Named sub-block the cursor is in, or "" for the definition's top level. */
  block: string;
  /** KeySpecs valid at this position (empty if the kind/block is unknown). */
  keys: Map<string, KeySpec>;
}

/**
 * Resolve the structure context at `offset`. Returns null when the file's kind
 * has no `structure` layer (most kinds) — callers then skip structure work.
 */
export function structureContextAt(
  parse: ParseResult,
  offset: number,
  kind: string,
  structures: StructureIndex
): StructureContext | null {
  const byBlock = structures.keysByKindBlock.get(kind);
  if (!byBlock) return null;

  const stack = blockStackFromParse(parse, offset);
  // The outermost named frame is the definition body; its top-level keys apply
  // only when the cursor sits DIRECTLY in it. A recognized sub-block (option,
  // send_option…) supplies its own keys. Any other named block between the
  // definition body and the cursor (immediate, trigger, limit, a scope change…)
  // is a trigger/effect/transparent block, not a structural level — return null so
  // completion offers tokens there instead of leaking top-level structure keys.
  const named = stack.filter((s) => s !== "<anon>");
  if (named.length === 0) return null; // above/outside any definition body
  const innermost = named[named.length - 1].toLowerCase();
  if (named.length === 1) {
    // Directly in the definition body → top-level keys.
    return { kind, block: "", keys: byBlock.get("") ?? new Map<string, KeySpec>() };
  }
  const sub = byBlock.get(innermost);
  if (sub) return { kind, block: innermost, keys: sub };
  return null;
}
