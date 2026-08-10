/**
 * Frequency-table builder (update plan v1.1 §C3). Scans the vanilla tree and
 * optionally a mod corpus dir, counting how often each key appears per
 * completion context — reusing the server's own parser and the same context
 * detection completion uses, so the counts reflect what the ranker sees.
 * Emits packages/server/data/<gameId>/freqs.json (top ~500 names per context +
 * a global token table).
 *
 * The context set (schema/freqs.ts) and classifyPosition()'s file kinds are
 * CK3-shaped by design: for other games the CK3-only contexts simply stay
 * empty and only the global token table and trigger/effect blocks fill in.
 *
 * SHIPPED ARTIFACT: unlike build-structure.ts, this output IS committed and ships
 * with the extension (loaded fail-soft by packages/server/src/schema/freqs.ts).
 *
 * Run:
 *   npx esbuild scripts/build-freqs.ts --bundle --platform=node --outfile=dist/build-freqs.cjs \
 *     && node dist/build-freqs.cjs [--game <id>] [modCorpusDir]
 *   (vanilla path and mod corpus from dev-paths.json / PX_<GAME>_GAME_PATH,
 *    PX_<GAME>_MOD_CORPUS; --game defaults to ck3)
 */
import * as fs from "fs";
import * as path from "path";
import { classifyFile } from "../packages/server/src/index/indexer";
import { walkStatements, parseScript, decode, type Statement } from "../packages/server/src/parser";
import { classifyKeyword } from "../packages/server/src/contextKeywords";
import { resolveProfile } from "../packages/server/src/games/registry";
import { FREQ_CONTEXTS, type FreqContext, type FreqData } from "../packages/server/src/schema/freqs";
import { devPath, parseGameArg } from "./devPaths";

const TOP_PER_CONTEXT = 500;
const TOP_GLOBAL = 2000;
const NAME_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const { gameId, rest } = parseGameArg(process.argv.slice(2));
const schema = resolveProfile(gameId).schema;
const gamePath = devPath("gamePath", gameId);
const modPath = rest[0] ?? devPath("corpusPath", gameId);
if (!gamePath && !modPath) {
  console.error(
    `usage: build-freqs [--game <id>] [modCorpusDir]  ` +
      `(needs gamePath and/or modCorpus for ${gameId} — see dev-paths.example.json)`
  );
  process.exit(1);
}

type Counter = Map<string, number>;
const contexts = new Map<FreqContext, Counter>();
for (const c of FREQ_CONTEXTS) contexts.set(c, new Map());
const global: Counter = new Map();

function bump(counter: Counter, name: string): void {
  counter.set(name, (counter.get(name) ?? 0) + 1);
}

function collect(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (e.name.toLowerCase().endsWith(".txt") && !e.name.endsWith(".info")) out.push(full);
  }
}

/** Same mapping the eval harness/completion use: file kind + block nesting. */
function classifyPosition(entryKind: string | null, enclosing: string[]): FreqContext | null {
  const depth = enclosing.length;
  if (depth === 1) {
    if (entryKind === "event") return "event_top";
    if (entryKind === "character_interaction") return "interaction_top";
    if (entryKind === "decision") return "decision_top";
  }
  if (entryKind === "event" && depth === 2 && enclosing[enclosing.length - 1] === "option") {
    return "event_option";
  }
  for (let i = enclosing.length - 1; i >= 0; i--) {
    const cls = classifyKeyword(enclosing[i]);
    if (cls === "trigger") return "trigger_block";
    if (cls === "effect") return "effect_block";
    if (cls === "transparent") continue;
    break;
  }
  return null;
}

function scanTree(root: string): number {
  const files: string[] = [];
  for (const d of ["common", "events"]) collect(path.join(root, d), files);
  let count = 0;
  for (const file of files) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    const { text } = decode(buf);
    const entry = classifyFile(root, file, schema);
    let root2;
    try {
      root2 = parseScript(text).root;
    } catch {
      continue;
    }
    walkStatements(root2, (stmt: Statement, ancestors) => {
      if (stmt.kind !== "assignment" || stmt.key.quoted) return;
      const key = stmt.key.text;
      if (!NAME_KEY.test(key)) return;
      const enclosing: string[] = [];
      for (const a of ancestors) {
        if (a.kind === "assignment" && !a.key.quoted) enclosing.push(a.key.text);
      }
      const ctx = classifyPosition(entry?.kind ?? null, enclosing);
      if (ctx) bump(contexts.get(ctx)!, key);
      // Global token table: every keyed use inside an effect/trigger block or at a
      // definition body counts, so ranking of effect/trigger tokens has a source.
      bump(global, key);
    });
    count++;
  }
  return count;
}

function topN(counter: Counter, n: number): Record<string, number> {
  const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const out: Record<string, number> = {};
  for (const [name, c] of sorted.slice(0, n)) out[name] = c;
  return out;
}

const sources: string[] = [];
if (gamePath) {
  const t0 = Date.now();
  const files = scanTree(gamePath);
  sources.push(`vanilla (${files} files)`);
  console.error(`scanned vanilla: ${files} files (${Date.now() - t0} ms)`);
}
if (modPath) {
  const t0 = Date.now();
  const files = scanTree(modPath);
  sources.push(`mod corpus (${files} files)`);
  console.error(`scanned mod corpus: ${files} files (${Date.now() - t0} ms)`);
}

const data: FreqData = {
  meta: { generated: new Date().toISOString().slice(0, 10), sources },
  contexts: {} as FreqData["contexts"],
  tokens: topN(global, TOP_GLOBAL),
};
for (const c of FREQ_CONTEXTS) data.contexts[c] = topN(contexts.get(c)!, TOP_PER_CONTEXT);

const outFile = path.join(__dirname, "..", "packages", "server", "data", gameId, "freqs.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(data));
console.error(`wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);

// Spot-check a few §C5 sentinels to stderr.
for (const [ctx, name] of [
  ["effect_block", "save_scope_as"],
  ["trigger_block", "has_trait"],
  ["event_top", "option"],
  ["event_option", "name"],
] as const) {
  console.error(`  ${ctx}.${name} = ${data.contexts[ctx][name] ?? 0}`);
}
