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
import type { KeySpec, SchemaEntry } from "./schema/types";
import type { StructureIndex } from "./schema/loader";
import { blockPathFromParse, blockStackFromParse } from "./context";
import { nestedDefinitionKind, topLevelDefinitionKind } from "./index/extract";
import type { ParseResult } from "./parser";

export interface StructureContext {
  /** Schema kind of the enclosing definition, e.g. "character_interaction". */
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
  entry: string | SchemaEntry,
  structures: StructureIndex
): StructureContext | null {
  let kind = typeof entry === "string" ? entry : entry.kind;
  let stack: string[] | undefined;
  if (typeof entry !== "string" && entry.kindByField) {
    const path = blockPathFromParse(parse, offset);
    const top = path[0];
    if (!top) return null;
    kind = topLevelDefinitionKind(entry, top);
    // A legacy container's nested declaration owns its own structural keys.
    // Keep its inner trigger/effect frames so they cannot inherit those keys.
    const depth = (entry.nestedDefinitions?.path.length ?? 0) + 2;
    const declaration = path.slice(0, depth);
    if (declaration.every((stmt) => stmt !== null)) {
      const nestedKind = nestedDefinitionKind(entry, declaration);
      if (nestedKind) {
        kind = nestedKind;
        path.splice(0, depth - 1);
      }
    }
    stack = path.map((stmt) => (stmt?.kind === "assignment" ? stmt.key.text : "<anon>"));
  }
  const byBlock = structures.keysByKindBlock.get(kind);
  if (!byBlock) return null;

  // The outermost named frame is the definition body; its top-level keys apply
  // only when the cursor sits DIRECTLY in it. A recognized sub-block (option,
  // send_option…) supplies its own keys. Any other named block between the
  // definition body and the cursor (immediate, trigger, limit, a scope change…)
  // is a trigger/effect/transparent block, not a structural level — return null so
  // completion offers tokens there instead of leaking top-level structure keys.
  const named = (stack ?? blockStackFromParse(parse, offset)).filter((s) => s !== "<anon>");
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
