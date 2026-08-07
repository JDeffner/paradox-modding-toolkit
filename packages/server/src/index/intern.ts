/**
 * String sharing for everything that escapes into the index (perf campaign §C2).
 *
 * The parser hands out `content.slice(start, end)` for every key and value, and
 * V8 represents a substring of 13+ characters as a SlicedString that keeps its
 * PARENT alive. One definition or reference name therefore pinned the whole
 * file's text for as long as the index held it: the index was carrying a second
 * copy of every tree it scanned. Retained heap, post-GC, before -> after:
 *
 *   vanilla scan       462,886 defs    408 MB ->  193 MB
 *   AGOT scan          345,557 defs    429 MB ->  145 MB
 *   AGOT references  4,150,494 refs   1017 MB ->  590 MB
 *   game + AGOT x2   (both, in one)   3153 MB -> 1412 MB (budgets.test.ts §C1)
 *
 * The CPU it costs is inside noise on the definition scan (3.83 -> 3.73 s for
 * vanilla) and under 10% on the reference scan (14.4 -> 15.2 s for AGOT).
 *
 * `copyOf` gives a string that owns its characters, so the parent goes away.
 * `intern` also SHARES them, which is the bigger half on the reference side:
 * the AGOT corpus names 4.15M usage sites with 197,873 distinct names.
 *
 * Identifiers (names, containers, params, key chains, namespaces) go through
 * `intern`. Prose and loc values are near-unique per site, so they are copied
 * but not kept in the table. `kind`, `file` and `source` are already one shared
 * string per schema entry / file / literal and need neither.
 *
 * No `vscode` imports here: unit-tested in plain Node.
 */
import type { Definition, Reference } from "@px-lsp/protocol/types";

/**
 * A fresh string that owns its characters. utf16le rather than utf8 because it
 * round-trips every JS string exactly (lone surrogates included); V8 still
 * stores the result one byte per character when it is ASCII.
 */
export function copyOf(s: string): string {
  return Buffer.from(s, "utf16le").toString("utf16le");
}

let table = new Map<string, string>();

/** The shared copy of `s`, creating it on first sight. */
export function intern(s: string): string {
  const hit = table.get(s);
  if (hit !== undefined) return hit;
  // Keyed by the COPY: keying by `s` would leave the table itself holding the
  // sliced string, i.e. the file text this exists to release.
  const copy = copyOf(s);
  table.set(copy, copy);
  return copy;
}

/**
 * Drop the shared copies. Called when the index is rebuilt from scratch: the
 * old index's strings die with it, and keeping their table entries alive would
 * retain a whole workspace's identifiers for nothing.
 */
export function resetInternTable(): void {
  table = new Map();
}

/** Distinct identifiers currently shared (perf trace). */
export function internedCount(): number {
  return table.size;
}

/**
 * A definition `value` is either a short hint that repeats across the workspace
 * (`chain:immediate`, a scripted list's `base`) or a loc line, which is unique.
 */
function shareValue(s: string): string {
  return s.length <= 32 ? intern(s) : copyOf(s);
}

/** Share the strings a batch of definitions will hold for the index's lifetime. */
export function shareDefinitionStrings(defs: Definition[]): Definition[] {
  for (const def of defs) {
    def.name = intern(def.name);
    if (def.value !== undefined) def.value = shareValue(def.value);
    if (def.container !== undefined) def.container = intern(def.container);
    if (def.params) for (let i = 0; i < def.params.length; i++) def.params[i] = intern(def.params[i]);
    if (def.doc !== undefined) def.doc = copyOf(def.doc);
    if (def.tags) {
      for (const tag of def.tags) {
        tag.tag = intern(tag.tag);
        tag.text = copyOf(tag.text);
      }
    }
    if (def.entryMode !== undefined) def.entryMode = intern(def.entryMode);
  }
  return defs;
}

/** Share the strings a batch of references will hold for the index's lifetime. */
export function shareReferenceStrings(refs: Reference[]): Reference[] {
  for (const ref of refs) {
    ref.name = intern(ref.name);
    if (ref.chain !== undefined) ref.chain = intern(ref.chain);
  }
  return refs;
}
