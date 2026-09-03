/**
 * Which definition skeletons (schema/skeletons.ts) apply at a cursor, and how
 * they read. One resolver, three consumers: key-position completion, the
 * paradox/snippets request, and the unit tests.
 *
 * Placement is the whole trick. A definition skeleton belongs OUTSIDE every
 * definition body (the file's top level, where completion has nothing useful to
 * say today); a child-block skeleton belongs directly INSIDE a definition body,
 * where that block key is valid. Anywhere else the answer is nothing.
 */
import { blockStackFromParse } from "../context";
import type { ParseResult } from "../parser";
import {
  renderBlockSkeleton,
  renderDefinitionSkeleton,
  type KindSkeleton,
  type RenderedSkeleton,
} from "../schema/skeletons";

export interface SkeletonOffer {
  /** Stable id: `<kind>` for the definition, `<kind>.<block>` for a child block. */
  id: string;
  /** What the item reads as: "new event", "option block". */
  label: string;
  /** How many of the game's own definitions the shape was measured over. */
  detail: string;
  /** A whole definition, or one of its child blocks. */
  form: "definition" | "block";
  text: RenderedSkeleton;
}

/** Depth of the enclosing definition bodies at `offset`; 0 = the file's top level. */
function definitionDepth(parse: ParseResult, offset: number): number {
  return blockStackFromParse(parse, offset).filter((s) => s !== "<anon>").length;
}

/** `3214` → `3,214`, so a detail line reads as a measurement and not as an id. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The value the document already declares for the kind's header key
 * (`namespace = intrigue`), or undefined when it declares none.
 */
function headerValue(parse: ParseResult, key: string): string | undefined {
  for (const stmt of parse.root.statements) {
    if (stmt.kind !== "assignment" || stmt.key.quoted || stmt.key.text !== key) continue;
    if (stmt.value?.kind === "scalar") return stmt.value.text;
  }
  return undefined;
}

/**
 * Skeletons offered at `offset` in a document the schema classifies as `kind`.
 * Empty when the game has no measured skeleton for the kind, or when the cursor
 * is deeper than a definition body (an effect block wants effects, not a form).
 */
export function skeletonsAt(
  parse: ParseResult,
  offset: number,
  kind: string,
  skeletons: Record<string, KindSkeleton> | undefined
): SkeletonOffer[] {
  const skel = skeletons?.[kind];
  if (!skel) return [];
  const depth = definitionDepth(parse, offset);
  if (depth === 0) return [definitionOffer(parse, kind, skel)];
  if (depth !== 1) return [];
  return blockOffers(kind, skel);
}

/**
 * Every skeleton the document's kind has, position-independent: what a picker
 * offers, where the modder chooses the insert point rather than the cursor.
 */
export function skeletonsFor(
  parse: ParseResult,
  kind: string,
  skeletons: Record<string, KindSkeleton> | undefined
): SkeletonOffer[] {
  const skel = skeletons?.[kind];
  if (!skel) return [];
  return [definitionOffer(parse, kind, skel), ...blockOffers(kind, skel)];
}

function definitionOffer(parse: ParseResult, kind: string, skel: KindSkeleton): SkeletonOffer {
  const existing = skel.nameFromHeader ? headerValue(parse, skel.nameFromHeader) : undefined;
  return {
    id: kind,
    label: `new ${kind.replace(/_/g, " ")}`,
    detail: `skeleton measured over ${count(skel.sampled)} vanilla definitions`,
    form: "definition",
    text: renderDefinitionSkeleton(kind, skel, {
      headerValue: existing,
      withHeader: skel.nameFromHeader !== undefined && existing === undefined,
    }),
  };
}

function blockOffers(kind: string, skel: KindSkeleton): SkeletonOffer[] {
  return Object.entries(skel.blocks ?? {}).map(([name, block]) => ({
    id: `${kind}.${name}`,
    label: `${name} block`,
    detail: `skeleton measured over ${count(block.sampled)} vanilla ${name} blocks`,
    form: "block" as const,
    text: renderBlockSkeleton(name, block),
  }));
}
