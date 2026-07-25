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
 * Load the bundled freqs.json from `dir`. Fail-soft: any error (missing file,
 * bad JSON, wrong shape) returns empty tables so completion still works.
 */
export function loadFreqs(dir: string): FreqData {
  try {
    const raw = fs.readFileSync(path.join(dir, "freqs.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<FreqData>;
    if (!parsed || typeof parsed !== "object" || !parsed.contexts || !parsed.tokens) {
      return emptyFreqData();
    }
    const out = emptyFreqData();
    for (const c of FREQ_CONTEXTS) {
      const table = (parsed.contexts as Record<string, unknown>)[c];
      if (table && typeof table === "object") {
        out.contexts[c] = table as Record<string, number>;
      }
    }
    if (parsed.tokens && typeof parsed.tokens === "object") out.tokens = parsed.tokens;
    if (parsed.meta) out.meta = parsed.meta;
    return out;
  } catch {
    return emptyFreqData();
  }
}
