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
 *   pnpm --filter @px-lsp/server run bake:browser [-- --game <id>]
 */
import * as fs from "fs";
import * as path from "path";
import type { TokenData } from "../packages/protocol/src/types";
import { setActiveProfile } from "../packages/server/src/games/active";
import { resolveProfile } from "../packages/server/src/games/registry";
import { loadTokenDataFromLogs, parseOnActionsLog } from "../packages/server/src/data/docsParser";
import { loadWikiTokens, mergeWikiTokens } from "../packages/server/src/data/wikiDocs";
import {
  BROWSER_DATA_VERSION,
  type BakedDocs,
  type BakedToken,
  type BakedTokens,
} from "../packages/server/src/browser/data";
import { parseGameArg } from "./devPaths";

const { gameId } = parseGameArg(process.argv.slice(2));
setActiveProfile(resolveProfile(gameId));

const SERVER = path.resolve(__dirname, "..", "packages", "server");
const DATA = path.join(SERVER, "data", gameId);
const OUT = path.join(SERVER, "dist", "browser-data", gameId);

if (!fs.existsSync(DATA)) {
  console.error(`no bundled data for game "${gameId}" at ${DATA}`);
  process.exit(1);
}

const scriptDocs = path.join(DATA, "script_docs");
const loaded = loadTokenDataFromLogs(scriptDocs);
if (loaded.missing.length > 0) {
  console.warn(`missing logs (baked without them): ${loaded.missing.join(", ")}`);
}

// Same merge order as server.ts: script_docs first, the wiki mirror filling the
// gaps. Baking the merged result means the browser never has to do either.
const wiki = loadWikiTokens(path.join(DATA, "wikidocs"));
const tokens: TokenData[] = mergeWikiTokens(loaded.tokens, wiki);

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

fs.mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown): number => {
  const json = JSON.stringify(value);
  fs.writeFileSync(path.join(OUT, name), json, "utf8");
  return Buffer.byteLength(json);
};

const sizes = {
  tokens: write("tokens.json", bakedTokens),
  docs: write("docs.json", bakedDocs),
  freqs: 0,
};

// freqs.json is copied rather than transformed: coerceFreqs validates it on the
// way in, and the browser has no reason to see a different shape than node does.
const freqsSrc = path.join(DATA, "freqs.json");
if (fs.existsSync(freqsSrc)) {
  const raw = fs.readFileSync(freqsSrc, "utf8");
  fs.writeFileSync(path.join(OUT, "freqs.json"), raw, "utf8");
  sizes.freqs = Buffer.byteLength(raw);
} else {
  console.warn(`no freqs.json for ${gameId}; completion ranking falls back to empty tables`);
}

const kb = (n: number): string => (n / 1024).toFixed(0).padStart(5) + " KB";
console.log(`baked ${gameId}: ${tokens.length} tokens, ${loaded.templates.length} templates`);
console.log(`  tokens.json ${kb(sizes.tokens)}   (name/kind/scopes/traits)`);
console.log(`  docs.json   ${kb(sizes.docs)}   (doc + usage prose, fetch on first hover)`);
console.log(`  freqs.json  ${kb(sizes.freqs)}   (completion ranking)`);
console.log(`  -> ${OUT}`);
