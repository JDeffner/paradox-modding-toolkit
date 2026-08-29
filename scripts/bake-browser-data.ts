/**
 * Bake the bundled language data into the two JSON payloads the browser build
 * consumes. On node the server parses data/<game>/script_docs/*.log at startup;
 * a browser has no filesystem and no appetite for 1.1 MB of log text, so the
 * same parsers run here instead and the result ships as JSON.
 *
 * The split is the point. Completion, diagnostics and scope inference need only
 * a token's name, kind and scopes; the doc and usage prose is needed the first
 * time someone hovers and is two thirds of the bytes. Emitting them separately
 * lets a host start on the small half.
 *
 * Output: packages/server/dist/browser-data/<gameId>/{tokens,docs,freqs}.json
 *
 * Run:
 *   pnpm run bake:browser                  every game that ships script_docs
 *   pnpm run bake:browser -- --game vic3   just that one
 */
import * as fs from "fs";
import * as path from "path";
import type { TokenData } from "../packages/protocol/src/types";
import { setActiveProfile } from "../packages/server/src/games/active";
import { resolveProfile, allProfiles } from "../packages/server/src/games/registry";
import { loadTokenDataFromLogs, parseOnActionsLog } from "../packages/server/src/data/docsParser";
import { loadWikiTokens, mergeWikiTokens } from "../packages/server/src/data/wikiDocs";
import {
  BROWSER_DATA_VERSION,
  type BakedDocs,
  type BakedToken,
  type BakedTokens,
} from "../packages/server/src/browser/data";
import { parseGameArg } from "./devPaths";

const SERVER = path.resolve(__dirname, "..", "packages", "server");
const kb = (n: number): string => (n / 1024).toFixed(0).padStart(5) + " KB";

function bake(gameId: string): boolean {
  // The parsers read the ACTIVE profile for their token vocabulary, so this has
  // to move with the game rather than being set once at startup.
  setActiveProfile(resolveProfile(gameId));

  const data = path.join(SERVER, "data", gameId);
  const scriptDocs = path.join(data, "script_docs");
  if (!fs.existsSync(scriptDocs)) return false;

  const loaded = loadTokenDataFromLogs(scriptDocs);
  if (loaded.missing.length > 0) {
    console.warn(`  ${gameId}: missing logs, baked without them: ${loaded.missing.join(", ")}`);
  }

  // Same merge order as server.ts: script_docs first, the wiki mirror filling
  // the gaps. Baking the merged result means the browser never does either.
  const wiki = loadWikiTokens(path.join(data, "wikidocs"));
  const tokens: TokenData[] = mergeWikiTokens(loaded.tokens, wiki).tokens;

  const hot: BakedToken[] = [];
  const prose: Array<[string, string]> = [];
  for (const t of tokens) {
    const entry: BakedToken = { name: t.name, kind: t.kind, scopes: t.scopes };
    if (t.traits) entry.traits = t.traits;
    hot.push(entry);
    prose.push([t.doc ?? "", t.usage ?? ""]);
  }

  const onActionScopes: Record<string, string> = {};
  for (const [name, scope] of parseOnActionsLog(scriptDocs)) onActionScopes[name] = scope;

  const bakedTokens: BakedTokens = {
    version: BROWSER_DATA_VERSION,
    gameId,
    source: `bundled script_docs + wikidocs (${new Date().toISOString().slice(0, 10)})`,
    tokens: hot,
    templates: loaded.templates,
    onActionScopes,
  };
  const bakedDocs: BakedDocs = { version: BROWSER_DATA_VERSION, gameId, prose };

  const out = path.join(SERVER, "dist", "browser-data", gameId);
  fs.mkdirSync(out, { recursive: true });
  const write = (name: string, value: unknown): number => {
    const json = JSON.stringify(value);
    fs.writeFileSync(path.join(out, name), json, "utf8");
    return Buffer.byteLength(json);
  };

  const tokensSize = write("tokens.json", bakedTokens);
  const docsSize = write("docs.json", bakedDocs);

  // freqs.json is copied rather than transformed: coerceFreqs validates it on
  // the way in, so the browser sees the same shape node does.
  let freqsSize = 0;
  const freqsSrc = path.join(data, "freqs.json");
  if (fs.existsSync(freqsSrc)) {
    const raw = fs.readFileSync(freqsSrc, "utf8");
    fs.writeFileSync(path.join(out, "freqs.json"), raw, "utf8");
    freqsSize = Buffer.byteLength(raw);
  } else {
    console.warn(`  ${gameId}: no freqs.json, completion ranking falls back to empty tables`);
  }

  console.log(`${gameId}: ${tokens.length} tokens, ${loaded.templates.length} templates`);
  console.log(`  tokens.json ${kb(tokensSize)}   (name/kind/scopes/traits)`);
  console.log(`  docs.json   ${kb(docsSize)}   (doc + usage prose, fetch on first hover)`);
  console.log(`  freqs.json  ${kb(freqsSize)}   (completion ranking)`);
  return true;
}

const argv = process.argv.slice(2);
const explicit = argv.some((a) => a === "--game" || a.startsWith("--game="));
const games = explicit ? [parseGameArg(argv).gameId] : allProfiles().map((p) => p.id);

let baked = 0;
for (const gameId of games) {
  if (bake(gameId)) baked += 1;
  else if (explicit) {
    console.error(`no script_docs bundled for game "${gameId}"`);
    process.exit(1);
  }
}

if (baked === 0) {
  console.error("no game bundles script_docs; nothing to bake");
  process.exit(1);
}
console.log(`-> ${path.join(SERVER, "dist", "browser-data")}`);
