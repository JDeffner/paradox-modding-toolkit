/**
 * Definition skeletons: the canonical shape of one definition of a kind,
 * derived from measured vanilla usage by scripts/build-skeletons.ts and shipped
 * as packages/server/data/<game>/skeletons.json.
 *
 * Nothing here is written by hand. A key is in a skeleton because at least
 * SKELETON_MAJORITY of the game's own definitions of that kind carry it; its
 * order is the median position it holds in them; its pre-filled value is the
 * value the corpus uses most, and only where the key's whole measured
 * vocabulary is small enough to be a real choice. A key whose vocabulary is
 * wider but entirely NUMERIC still gets the number the corpus writes most,
 * since a key name is valid script nowhere in a numeric slot. Anything wider
 * than that (loc keys, names, paths) gets its own name as placeholder text,
 * which says "fill this in" without asserting a value.
 *
 * Both insert forms are rendered at once, exactly like features/blockSnippets.ts:
 * `snippet` for clients that declared snippetSupport, `plain` (free of `${`) for
 * the rest.
 *
 * No `vscode` imports: plain data plus pure renderers.
 */

/**
 * Share of a kind's definitions a key must appear in to enter the skeleton.
 * Half: a skeleton is what a definition of this kind USUALLY looks like, not
 * the union of everything the folder has ever used. Applied identically to the
 * keys of a nested block (share of that block's own occurrences).
 */
export const SKELETON_MAJORITY = 0.5;

/** One key of a skeleton body. */
export interface SkeletonKey {
  key: string;
  /**
   * The key's whole measured value vocabulary, most-used first. Set only where
   * the corpus uses few enough distinct values for the list to be a choice
   * rather than a guess; absent = the value is a placeholder.
   */
  choices?: string[];
  /**
   * The single most-used measured value, set only where the vocabulary is too
   * wide to offer as a choice AND every value the corpus writes for the key is
   * a number. A key name is valid script nowhere in a numeric slot, so a
   * measured number is the honest placeholder; it stays a tabstop, so it still
   * reads as "fill this in".
   */
  placeholder?: string;
  /**
   * Nested one level: the block this key opens, carrying the keys measured in
   * at least SKELETON_MAJORITY of its occurrences. An empty array = the block
   * has no stable shape, so it is inserted empty.
   */
  block?: SkeletonKey[];
}

/** A named child block of a definition, offered on its own. */
export interface SkeletonBlock {
  /** Occurrences of the block measured across the kind's definitions. */
  sampled: number;
  keys: SkeletonKey[];
}

export interface KindSkeleton {
  /** Vanilla definitions of this kind the skeleton was measured over. */
  sampled: number;
  keys: SkeletonKey[];
  /**
   * The file-level key the kind's definition names were measured to derive
   * from: at least SKELETON_MAJORITY of the folder's files declare it as a
   * top-level scalar, and at least that share of the kind's names are
   * `<its value>.<number>` (`namespace = intrigue` → `intrigue.0001`). Absent =
   * names are plain identifiers and files need no header line.
   */
  nameFromHeader?: string;
  /** Child-block skeletons, keyed by the block's key. */
  blocks?: Record<string, SkeletonBlock>;
}

export interface SkeletonData {
  meta: { generated: string; sources: string[]; majority: number };
  /** Definition kind, as the schema table spells it. */
  kinds: Record<string, KindSkeleton>;
}

/** Both insert forms of one skeleton. */
export interface RenderedSkeleton {
  /** `${n:…}` tabstop form; only for clients declaring snippetSupport. */
  snippet: string;
  /** Plain-text skeleton, free of `${`. */
  plain: string;
}

interface Counter {
  n: number;
}

function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&");
}

/** The right-hand side of a leaf key, in one of the two forms. */
function leafValue(spec: SkeletonKey, snippet: boolean, c: Counter): string {
  const filled = spec.choices?.[0] ?? spec.placeholder ?? spec.key;
  if (!snippet) return filled;
  if (spec.choices && spec.choices.length > 1) return `\${${++c.n}|${spec.choices.join(",")}|}`;
  return `\${${++c.n}:${escapeSnippet(filled)}}`;
}

function renderKeys(keys: SkeletonKey[], indent: string, snippet: boolean, c: Counter): string {
  let out = "";
  for (const spec of keys) {
    if (spec.block) {
      out += `${indent}${spec.key} = {\n`;
      out +=
        spec.block.length > 0
          ? renderKeys(spec.block, indent + "\t", snippet, c)
          : `${indent}\t${snippet ? `$${++c.n}` : ""}\n`;
      out += `${indent}}\n`;
      continue;
    }
    out += `${indent}${spec.key} = ${leafValue(spec, snippet, c)}\n`;
  }
  return out;
}

export interface SkeletonRenderOptions {
  /**
   * Value of the header key the target document already declares
   * (`namespace = my_events`), so a generated name matches its own file.
   */
  headerValue?: string;
  /** Write the header line above the definition (the document declares none). */
  withHeader?: boolean;
}

/** The whole definition, header line included when the document lacks it. */
export function renderDefinitionSkeleton(
  kind: string,
  skel: KindSkeleton,
  opts: SkeletonRenderOptions = {}
): RenderedSkeleton {
  const one = (snippet: boolean): string => {
    const c: Counter = { n: 0 };
    // A name built from a header key the insert writes itself mirrors tabstop 1
    // into both places, so editing the namespace renames the definition too.
    const mirrored = skel.nameFromHeader !== undefined && opts.headerValue === undefined;
    if (mirrored) c.n = 1;
    const prefix = mirrored
      ? snippet
        ? `\${1:my_${escapeSnippet(skel.nameFromHeader!)}}`
        : `my_${skel.nameFromHeader}`
      : opts.headerValue;

    // The header line is written only when the document has none: a second
    // `namespace =` in one file is exactly the silent failure to avoid.
    const out = opts.withHeader && skel.nameFromHeader ? `${skel.nameFromHeader} = ${prefix}\n\n` : "";

    const name = skel.nameFromHeader
      ? snippet
        ? `${prefix}.\${${++c.n}:1}`
        : `${prefix}.1`
      : snippet
        ? `\${${++c.n}:my_${escapeSnippet(kind)}}`
        : `my_${kind}`;
    // A kind with no measured body is still worth inserting: the wrapper, the
    // name shape and the header are the parts the game fails silently on.
    const body =
      skel.keys.length > 0 ? renderKeys(skel.keys, "\t", snippet, c) : `\t${snippet ? `$${++c.n}` : ""}\n`;
    return `${out}${name} = {\n${body}}`;
  };
  return { snippet: one(true), plain: one(false) };
}

/** One named child block (`option = { name = … }`), inserted on its own. */
export function renderBlockSkeleton(name: string, block: SkeletonBlock): RenderedSkeleton {
  const one = (snippet: boolean): string => {
    const body =
      block.keys.length > 0 ? renderKeys(block.keys, "\t", snippet, { n: 0 }) : `\t${snippet ? "$1" : ""}\n`;
    return `${name} = {\n${body}}`;
  };
  return { snippet: one(true), plain: one(false) };
}
