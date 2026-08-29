/**
 * Bundled corpus-frequency tables (update plan v1.1 §C3), the ranking input for
 * Workstream C. Emitted by scripts/build-freqs.ts from a vanilla scan (+ optional
 * mod corpus) and shipped as packages/server/data/<game>/freqs.json. Loaded fail-soft: a
 * missing/corrupt file yields empty tables and the extension ranks with a neutral
 * frequency bucket everywhere.
 *
 * `contexts` are the same six completion contexts the eval harness reports on;
 * each maps a key name to its occurrence count in that context. `tokens` is a
 * context-independent global table (a key's count summed across all contexts),
 * used for effect/trigger tokens and definitions that aren't structural keys.
 *
 * No `vscode` imports: plain data + a Node fs loader.
 */
import * as fs from "fs";
import * as path from "path";

/** The frequency contexts. Mirrors the eval harness's EvalContext set. */
export type FreqContext =
  "event_top" | "event_option" | "interaction_top" | "decision_top" | "effect_block" | "trigger_block";

export const FREQ_CONTEXTS: FreqContext[] = [
  "event_top",
  "event_option",
  "interaction_top",
  "decision_top",
  "effect_block",
  "trigger_block",
];

export interface FreqData {
  /** Provenance note (which corpora, when) — display only. */
  meta?: { generated?: string; sources?: string[] };
  /** Per-context name -> count (top-N per context). */
  contexts: Record<FreqContext, Record<string, number>>;
  /** Global name -> count across all contexts (top-N). */
  tokens: Record<string, number>;
}

export function emptyFreqData(): FreqData {
  const contexts = {} as Record<FreqContext, Record<string, number>>;
  for (const c of FREQ_CONTEXTS) contexts[c] = {};
  return { contexts, tokens: {} };
}

/**
 * Validate a parsed freqs.json into `FreqData`. Fail-soft: anything unexpected
 * (null, wrong shape, missing tables) degrades to empty tables so completion
 * still works. Shared with the browser build, which supplies the parsed JSON
 * directly because it has no filesystem to read it from.
 */
export function coerceFreqs(parsed: unknown): FreqData {
  const out = emptyFreqData();
  if (!parsed || typeof parsed !== "object") return out;
  const p = parsed as Partial<FreqData>;
  // Per field, not all-or-nothing: a payload with usable contexts and a broken
  // `tokens` keeps its contexts instead of degrading both to empty.
  if (p.contexts !== null && typeof p.contexts === "object") {
    for (const c of FREQ_CONTEXTS) {
      const table = (p.contexts as Record<string, unknown>)[c];
      if (table && typeof table === "object") out.contexts[c] = table as Record<string, number>;
    }
  }
  // `typeof null === "object"`, so the null check is not redundant: a null here
  // would replace the empty table and completion throws on `freqs.tokens[name]`.
  if (p.tokens !== null && typeof p.tokens === "object") out.tokens = p.tokens;
  if (p.meta) out.meta = p.meta;
  return out;
}

/**
 * Load the bundled freqs.json from `dir`. Fail-soft: any error (missing file,
 * bad JSON, wrong shape) returns empty tables so completion still works.
 */
export function loadFreqs(dir: string): FreqData {
  try {
    return coerceFreqs(JSON.parse(fs.readFileSync(path.join(dir, "freqs.json"), "utf8")));
  } catch {
    return emptyFreqData();
  }
}
