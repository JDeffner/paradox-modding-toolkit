/**
 * Completion-ranking evaluation harness (update plan v1.1 §C4).
 *
 * Offline replay: sample N real key-positions from a mod corpus across the six
 * completion contexts, strip the typed key, run the REAL completion provider at
 * that offset, and measure the stripped key's rank in the returned list (sorted
 * as VS Code sorts an empty prefix: by sortText, then label). Reports top-1,
 * top-5 and MRR per context.
 *
 * Shared core: consumed by test/rankEval.test.ts (vitest, gated on CK3_MOD_CORPUS)
 * and scripts/rank-eval.ts (standalone, esbuild-bundled like scripts/bench.ts) so
 * the same numbers can be recorded before and after a ranking change.
 *
 * No `vscode` imports: plain Node, unit-testable / bundleable.
 */
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem } from "vscode-languageserver/node";
import { CompletionFeature } from "../src/features/completion";
import { ServerData } from "../src/serverData";
import { loadSchema, type SchemaData } from "../src/schema/loader";
import { loadWikiTokens } from "../src/data/wikiDocs";
import { loadFreqs } from "../src/schema/freqs";
import { classifyFile, DefinitionIndex, scanRoot } from "../src/index/indexer";
import { extractReferences } from "../src/index/references";
import { CK3_SCHEMA } from "../src/games/ck3/schema";
import { walkStatements, parseScript, decode, type Statement } from "../src/parser";
import { classifyKeyword } from "../src/contextKeywords";
import type { SchemaEntry } from "../src/schema/types";

/** The completion contexts we sample and report separately. */
export type EvalContext =
  "event_top" | "event_option" | "interaction_top" | "decision_top" | "effect_block" | "trigger_block";

export const EVAL_CONTEXTS: EvalContext[] = [
  "event_top",
  "event_option",
  "interaction_top",
  "decision_top",
  "effect_block",
  "trigger_block",
];

export interface EvalSample {
  context: EvalContext;
  /** The key that was stripped and searched for. */
  key: string;
  /** 0-based rank in the returned list, or -1 if not offered at all. */
  rank: number;
}

export interface ContextMetrics {
  context: EvalContext;
  n: number;
  top1: number;
  top5: number;
  mrr: number;
  /** Fraction of samples where the key was not offered at all (rank -1). */
  missing: number;
}

/** A deterministic small LCG so a fixed seed samples the same positions run-to-run. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0xffffffff;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

/** VS Code's empty-prefix order: by sortText (fallback label), tiebreak label. */
export function sortLikeVsCode(items: CompletionItem[]): CompletionItem[] {
  return [...items].sort((a, b) => {
    const ka = a.sortText ?? a.label;
    const kb = b.sortText ?? b.label;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

export interface EvalEnv {
  data: ServerData;
  schema: SchemaData;
  completion: CompletionFeature;
}

/**
 * Build a server-shaped environment: bundled wiki tokens + a full definition and
 * reference index over the vanilla tree (if present) and the mod corpus — exactly
 * what the live completion provider consumes.
 */
export function buildEvalEnv(opts: {
  wikidocsDir: string;
  /** Directory holding freqs.json (packages/server/data/ck3). Omit to eval with neutral F. */
  freqsDir?: string;
  gamePath?: string | null;
  modPath: string;
}): EvalEnv {
  const data = new ServerData();
  data.setTokens(loadWikiTokens(opts.wikidocsDir));
  const schema = loadSchema(opts.modPath);
  data.completableKinds = new Set([
    ...schema.entries.filter((e) => e.completable !== false).map((e) => e.kind),
    "saved_scope",
    "variable",
  ]);

  const index = new DefinitionIndex();
  if (opts.gamePath) {
    index.addAll(scanRoot(opts.gamePath, "vanilla", { locLanguage: "english" }));
  }
  const modDefs = scanRoot(opts.modPath, "mod", { locLanguage: "english" });
  index.addAll(modDefs);

  // Mod references + implicit defs (save_scope_as, set_variable) — usageCount source.
  const scriptFiles: string[] = [];
  for (const d of ["common", "events"]) collect(path.join(opts.modPath, d), ".txt", scriptFiles);
  for (const file of scriptFiles) {
    const buf = safeRead(file);
    if (!buf) continue;
    const { text } = decode(buf);
    const extracted = extractReferences(text, file, "mod", schema);
    data.refIndex.addAll(extracted.references);
    if (extracted.implicitDefs.length > 0) index.addAll(extracted.implicitDefs);
  }
  data.index = index;
  data.notifyIndexChanged();

  const completion = new CompletionFeature(data, () => schema);
  if (opts.freqsDir) completion.setFreqs(loadFreqs(opts.freqsDir));
  return { data, schema, completion };
}

function collect(dir: string, ext: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, ext, out);
    else if (e.name.toLowerCase().endsWith(ext) && !e.name.endsWith(".info")) out.push(full);
  }
}

function safeRead(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** A candidate key-position discovered in a file: which context, and the CST node. */
interface Candidate {
  context: EvalContext;
  key: string;
  /** offset of the key's first character. */
  keyStart: number;
  /** offset just past the key. */
  keyEnd: number;
}

const NAME_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Keys that completion deliberately does NOT offer as items, so they are excluded
 * from sampling: boolean/logic connectors, transparent control-flow wrappers, and
 * scope-chain words. Completion handles these through the grammar/context layer,
 * not as ranked trigger/effect items — sampling them would only measure a rank of
 * "not offered" that reflects design, not ranking quality (they dominate the raw
 * effect/trigger "missing" counts: limit, modifier, NOT, this, OR, …).
 */
const NON_ITEM_KEYS = new Set([
  "if",
  "else",
  "else_if",
  "limit",
  "trigger_if",
  "trigger_else",
  "trigger_else_if",
  "and",
  "or",
  "not",
  "nor",
  "nand",
  "any",
  "all",
  "modifier",
  "ai_value_modifier",
  "compare_modifier",
  "opinion_modifier",
  "this",
  "root",
  "prev",
  "from",
  "base",
  "add",
  "subtract",
  "multiply",
  "divide",
  "min",
  "max",
  "factor",
  "weight",
  "value",
  "list",
  "chance",
  "random",
]);

/**
 * Discover sampleable key-positions in a parsed file. Only assignment keys that
 * are plain identifiers (not scope:/var:/numbers/quoted), not grammar/logic
 * connectors, and sit in a context we report on. `entryKind` decides structural
 * contexts; block nesting decides trigger/effect.
 */
function candidatesInFile(text: string, entryKind: string | null): Candidate[] {
  const { root } = parseScript(text);
  const out: Candidate[] = [];

  walkStatements(root, (stmt: Statement, ancestors) => {
    if (stmt.kind !== "assignment" || stmt.key.quoted) return;
    const key = stmt.key.text;
    if (!NAME_KEY.test(key) || NON_ITEM_KEYS.has(key.toLowerCase())) return;

    // Nearest named enclosing assignment block (skip anonymous/transparent).
    const enclosing: string[] = [];
    for (const a of ancestors) {
      if (a.kind === "assignment" && !a.key.quoted) enclosing.push(a.key.text);
    }
    const depth = enclosing.length;
    const context = classifyPosition(entryKind, enclosing, depth);
    if (!context) return;
    out.push({ context, key, keyStart: stmt.key.range.start, keyEnd: stmt.key.range.end });
  });
  return out;
}

/**
 * Map an enclosing-keyword chain to one of the reported contexts. Structural
 * contexts are decided by the file kind + block depth; effect/trigger blocks by
 * the nearest classifying keyword — mirroring what completion's own context
 * detection sees.
 */
function classifyPosition(entryKind: string | null, enclosing: string[], depth: number): EvalContext | null {
  // Structural top-level: directly inside a definition body (depth 1) of a kind
  // whose structure layer we ship.
  if (depth === 1) {
    if (entryKind === "event") return "event_top";
    if (entryKind === "character_interaction") return "interaction_top";
    if (entryKind === "decision") return "decision_top";
  }
  // Event option body: `option = { | }` (depth 2, parent is option).
  if (entryKind === "event" && depth === 2 && enclosing[enclosing.length - 1] === "option") {
    return "event_option";
  }

  // Effect / trigger blocks: nearest classifying keyword up the chain.
  for (let i = enclosing.length - 1; i >= 0; i--) {
    const cls = classifyKeyword(enclosing[i]);
    if (cls === "trigger") return "trigger_block";
    if (cls === "effect") return "effect_block";
    if (cls === "transparent") continue;
    // A non-classifying named block (e.g. a definition body) stops the walk.
    break;
  }
  return null;
}

/**
 * Run the eval over the mod corpus. Deterministic: files are sorted and sampled
 * with a fixed-seed RNG. `perContext` caps how many samples each context keeps
 * (so a few huge files don't dominate one bucket).
 */
export function runRankEval(
  env: EvalEnv,
  modPath: string,
  opts: { seed?: number; perContext?: number } = {}
): { samples: EvalSample[]; metrics: ContextMetrics[] } {
  const seed = opts.seed ?? 1234567;
  const perContext = opts.perContext ?? 200;
  const rng = new Rng(seed);

  // Collect script files under common/ and events/, sorted for determinism.
  const files: string[] = [];
  for (const d of ["common", "events"]) collect(path.join(modPath, d), ".txt", files);
  files.sort();

  const byContext = new Map<EvalContext, EvalSample[]>();
  for (const c of EVAL_CONTEXTS) byContext.set(c, []);
  const need = () => EVAL_CONTEXTS.some((c) => byContext.get(c)!.length < perContext);

  // Shuffle file order deterministically so we don't drain one folder first.
  for (let i = files.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [files[i], files[j]] = [files[j], files[i]];
  }

  for (const file of files) {
    if (!need()) break;
    const entry = classifyFile(modPath, file, CK3_SCHEMA);
    const buf = safeRead(file);
    if (!buf) continue;
    const { text } = decode(buf);
    let candidates: Candidate[];
    try {
      candidates = candidatesInFile(text, entry?.kind ?? null);
    } catch {
      continue;
    }
    if (candidates.length === 0) continue;

    // Deterministic shuffle of candidates within the file.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (const cand of candidates) {
      const bucket = byContext.get(cand.context)!;
      if (bucket.length >= perContext) continue;
      const sample = evalOne(env, file, entry, text, cand);
      if (sample) bucket.push(sample);
    }
  }

  const samples: EvalSample[] = [];
  for (const c of EVAL_CONTEXTS) samples.push(...byContext.get(c)!);
  return { samples, metrics: metricsOf(samples) };
}

/** Strip the key, run completion at the hole, find the key's rank. */
function evalOne(
  env: EvalEnv,
  file: string,
  entry: SchemaEntry | null,
  text: string,
  cand: Candidate
): EvalSample | null {
  // Replace the key with nothing (empty prefix), keeping the `= ...` intact.
  const holed = text.slice(0, cand.keyStart) + text.slice(cand.keyEnd);
  const uri = `file:///${file.replace(/\\/g, "/")}#h${cand.keyStart}`;
  const doc = TextDocument.create(uri, "paradox", 1, holed);
  const rootScopes = entry?.rootScopes?.length ? new Set(entry.rootScopes.map((s) => s.toLowerCase())) : null;
  let items: CompletionItem[];
  try {
    items = env.completion.provide(doc, cand.keyStart, rootScopes, entry, Number.MAX_SAFE_INTEGER).items;
  } catch {
    return null;
  }
  const sorted = sortLikeVsCode(items);
  const rank = sorted.findIndex((it) => it.label === cand.key);
  return { context: cand.context, key: cand.key, rank };
}

export function metricsOf(samples: EvalSample[]): ContextMetrics[] {
  const out: ContextMetrics[] = [];
  for (const context of EVAL_CONTEXTS) {
    const group = samples.filter((s) => s.context === context);
    const n = group.length;
    if (n === 0) {
      out.push({ context, n: 0, top1: 0, top5: 0, mrr: 0, missing: 0 });
      continue;
    }
    let top1 = 0;
    let top5 = 0;
    let mrr = 0;
    let missing = 0;
    for (const s of group) {
      if (s.rank < 0) {
        missing++;
        continue;
      }
      if (s.rank === 0) top1++;
      if (s.rank < 5) top5++;
      mrr += 1 / (s.rank + 1);
    }
    out.push({
      context,
      n,
      top1: top1 / n,
      top5: top5 / n,
      mrr: mrr / n,
      missing: missing / n,
    });
  }
  return out;
}

export function formatMetrics(metrics: ContextMetrics[]): string {
  const rows = metrics.map(
    (m) =>
      `  ${m.context.padEnd(16)} n=${String(m.n).padStart(4)}  ` +
      `top1=${pct(m.top1)}  top5=${pct(m.top5)}  MRR=${m.mrr.toFixed(3)}  missing=${pct(m.missing)}`
  );
  return rows.join("\n");
}

function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(5) + "%";
}
