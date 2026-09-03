/**
 * The measurement behind data/<id>/skeletons.json, as a pure unit: feed it the
 * text of every vanilla file of one definition kind, ask it for the skeleton.
 * scripts/build-skeletons.ts is the file walk around it; test/skeletons.test.ts
 * drives it with fixtures.
 *
 * Every rule here is a count over the game's own files, never a table:
 *
 *  - a key enters the body when at least SKELETON_MAJORITY of the kind's
 *    definitions carry it (schema/skeletons.ts owns the constant);
 *  - its position is the MEDIAN position it holds in those definitions;
 *  - a key whose value is a block at least as often as it is a scalar is
 *    nested ONE level, with the same majority rule over the block's own
 *    occurrences;
 *  - a leaf key keeps its vocabulary only when the corpus uses at most
 *    MAX_VOCAB distinct snippet-safe values for it, most-used first; anything
 *    wider (loc keys, names, paths) becomes a placeholder, which says "fill
 *    this in" without asserting a value;
 *  - the header key (`namespace`) is the top-level scalar most files declare
 *    AND that most of the kind's names are built from.
 *
 * Deterministic by construction: every ordering breaks ties by count and then
 * by name, and the emitted object keys are sorted.
 */
import { parseScript, type Statement } from "../packages/server/src/parser";
import {
  SKELETON_MAJORITY,
  type KindSkeleton,
  type SkeletonBlock,
  type SkeletonKey,
} from "../packages/server/src/schema/skeletons";

/** Definitions a kind needs before its skeleton is published: below this the
 *  "median" and "majority" of a handful of files is noise, not a shape. */
export const MIN_SAMPLES = 10;
/** Distinct values a leaf key may have and still be offered as a choice list. */
export const MAX_VOCAB = 8;
/** Values a snippet choice can carry: no quotes, spaces, commas or pipes. */
const SAFE_VALUE = /^-?[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;
/** Also excludes the `@constant = 5` script-value lines that head many folders. */
const DEF_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const EVENT_ID = /^[A-Za-z0-9_-]+\.\d+$/;

/** Extraction modes whose definitions are `name = { … }` at a file's top level. */
export type Extraction = "top-level-key" | "event-id";
export const SUPPORTED_EXTRACTION = new Set<string>(["top-level-key", "event-id"]);

type Body = Statement[];

function blockOf(stmt: Statement): Body | null {
  if (stmt.kind !== "assignment" || !stmt.value) return null;
  if (stmt.value.kind === "block") return stmt.value.statements;
  if (stmt.value.kind === "tagged-block") return stmt.value.block.statements;
  return null;
}

function scalarOf(stmt: Statement): string | null {
  if (stmt.kind !== "assignment" || !stmt.value) return null;
  return stmt.value.kind === "scalar" ? stmt.value.text : null;
}

interface KeyStats {
  /** Bodies the key appears in. */
  present: number;
  /** Its 0-based position among each body's distinct keys. */
  positions: number[];
  blocks: number;
  scalars: number;
  values: Map<string, number>;
  /** Bodies of the block this key opens, for the nested pass. */
  inner: Body[];
}

function statsOf(bodies: Body[]): Map<string, KeyStats> {
  const stats = new Map<string, KeyStats>();
  for (const body of bodies) {
    const seen = new Set<string>();
    for (const stmt of body) {
      if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
      const key = stmt.key.text;
      if (!DEF_NAME.test(key)) continue;
      let s = stats.get(key);
      if (!s) {
        s = { present: 0, positions: [], blocks: 0, scalars: 0, values: new Map(), inner: [] };
        stats.set(key, s);
      }
      if (!seen.has(key)) {
        s.present++;
        s.positions.push(seen.size);
        seen.add(key);
      }
      const block = blockOf(stmt);
      if (block) {
        s.blocks++;
        s.inner.push(block);
        continue;
      }
      const scalar = scalarOf(stmt);
      if (scalar !== null) {
        s.scalars++;
        s.values.set(scalar, (s.values.get(scalar) ?? 0) + 1);
      }
    }
  }
  return stats;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Most-used first, ties by value; null when the vocabulary is not a choice. */
function choicesOf(s: KeyStats): string[] | null {
  if (s.values.size === 0 || s.values.size > MAX_VOCAB) return null;
  const all = [...s.values.entries()];
  if (!all.every(([v]) => SAFE_VALUE.test(v))) return null;
  return all.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([v]) => v);
}

/**
 * The keys at least SKELETON_MAJORITY of `bodies` carry, in median order.
 * `depth` is how many further levels of nesting to derive; at 0 a block key is
 * still a block, just an empty one.
 */
function deriveKeys(bodies: Body[], depth: number): SkeletonKey[] {
  const n = bodies.length;
  if (n === 0) return [];
  const kept: Array<{ key: string; s: KeyStats; order: number }> = [];
  for (const [key, s] of statsOf(bodies)) {
    if (s.present / n < SKELETON_MAJORITY) continue;
    kept.push({ key, s, order: median(s.positions) });
  }
  kept.sort((a, b) => a.order - b.order || b.s.present - a.s.present || (a.key < b.key ? -1 : 1));
  return kept.map(({ key, s }) => {
    if (s.blocks >= s.scalars) {
      return { key, block: depth > 0 ? deriveKeys(s.inner, depth - 1) : [] };
    }
    const choices = choicesOf(s);
    return choices ? { key, choices } : { key };
  });
}

/** Child-block skeletons: the kind's block keys that have a measured shape. */
function deriveBlocks(bodies: Body[]): Record<string, SkeletonBlock> {
  const out: Record<string, SkeletonBlock> = {};
  const n = bodies.length;
  for (const [key, s] of [...statsOf(bodies)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (s.present / n < SKELETON_MAJORITY) continue;
    if (s.blocks < s.scalars || s.inner.length < MIN_SAMPLES) continue;
    const keys = deriveKeys(s.inner, 1);
    // A block with no measured shape inserts as `key = { }`, which the schema's
    // own `values: "block"` completion already does. Nothing to add.
    if (keys.length === 0) continue;
    out[key] = { sampled: s.inner.length, keys };
  }
  return out;
}

/** One kind's measurement, fed file by file. */
export class SkeletonHarvest {
  private bodies: Body[] = [];
  private files = 0;
  private names = 0;
  private headerKeys = new Map<string, number>();
  private namedFromHeader = new Map<string, number>();

  /** Number of definitions seen so far (what `sampled` reports). */
  get sampled(): number {
    return this.bodies.length;
  }

  addFile(text: string, extraction: Extraction): void {
    let root;
    try {
      root = parseScript(text).root;
    } catch {
      return;
    }
    this.files++;

    // The file's own header values: top-level SCALAR assignments. A definition
    // is always a block, so the two never overlap.
    const header = new Map<string, string>();
    for (const stmt of root.statements) {
      if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
      if (!DEF_NAME.test(stmt.key.text)) continue;
      const scalar = scalarOf(stmt);
      if (scalar === null) continue;
      if (!header.has(stmt.key.text)) header.set(stmt.key.text, scalar);
    }
    for (const key of header.keys()) this.headerKeys.set(key, (this.headerKeys.get(key) ?? 0) + 1);

    for (const stmt of root.statements) {
      if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
      const body = blockOf(stmt);
      if (!body) continue;
      const name = stmt.key.text;
      if (extraction === "event-id" ? !EVENT_ID.test(name) : !DEF_NAME.test(name)) continue;
      this.bodies.push(body);
      this.names++;
      const dot = name.lastIndexOf(".");
      if (dot <= 0 || !/^\d+$/.test(name.slice(dot + 1))) continue;
      const prefix = name.slice(0, dot);
      for (const [key, value] of header) {
        if (value === prefix) this.namedFromHeader.set(key, (this.namedFromHeader.get(key) ?? 0) + 1);
      }
    }
  }

  /**
   * The kind's skeleton, or null when too few definitions were seen to measure
   * one. A kind where no key reaches the majority (a scripted effect's body is
   * whatever the effect does) still gets a skeleton: the empty one. The name
   * shape, the header and the `name = { }` wrapper are what the game fails
   * silently on, and all three are measured. Inventing a body for it is the
   * hand-written rule file this harvest exists to avoid.
   */
  finish(): KindSkeleton | null {
    if (this.bodies.length < MIN_SAMPLES) return null;
    const skel: KindSkeleton = { sampled: this.bodies.length, keys: deriveKeys(this.bodies, 1) };
    // A header key qualifies only if most of the kind's FILES declare it AND
    // most of its NAMES are built from that value: either half alone is chance.
    const fromHeader = [...this.namedFromHeader.entries()]
      .filter(
        ([key, count]) =>
          (this.headerKeys.get(key) ?? 0) / this.files >= SKELETON_MAJORITY &&
          count / this.names >= SKELETON_MAJORITY
      )
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (fromHeader) skel.nameFromHeader = fromHeader[0];
    const blocks = deriveBlocks(this.bodies);
    if (Object.keys(blocks).length > 0) skel.blocks = blocks;
    return skel;
  }
}
