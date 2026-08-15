/**
 * Build-time harvest of the FULL structure-key layer for one game, emitted as
 * packages/server/data/<gameId>/structures.json (bundled; merged UNDER any
 * hand-curated games/<id>/structures.ts, curated docs always win).
 *
 * TWO SOURCES, both from the game's own files:
 *   1. the schema docs the game ships next to its data (CK3's `_*.info`,
 *      Victoria 3's `*.md`), every documented `key = value` line, with its
 *      doc prose and any `# root = X` scope declaration;
 *   2. the vanilla corpus itself, which keys actually appear as DIRECT
 *      children of each definition (depth 1) and of each structural sub-block
 *      (depth 2), with counts. Paradox's docs are incomplete and some folders
 *      ship no doc at all, so usage is the fallback source of truth and the
 *      `freq` that drives completion ranking.
 *
 * Doc keys are kept when vanilla actually uses them (count >= 3) or they carry
 * doc prose and appear at least once; undocumented keys are kept at count >= 3.
 *
 * WHAT IS NOT A RECORD: a definition body written in trigger/effect grammar
 * (scripted_effects, script_values, on_actions…) has no structure layer, its
 * vocabulary is engine tokens, which completion already serves and ranks by
 * scope. Those kinds are detected by measuring how much of their depth-1
 * vocabulary the game's own script_docs dump declares as tokens, and skipped.
 * The same test picks structural sub-blocks (an event `option`'s name/ai_chance)
 * apart from script sub-blocks (`immediate`, `possible`), whose children are
 * tokens.
 *
 * Run (per game; needs data/<gameId>/script_docs for the token test):
 *   npx esbuild scripts/build-structures-json.ts --bundle --platform=node \
 *     --outfile=dist/build-structures-json.cjs \
 *     && node dist/build-structures-json.cjs [--game <id>] [gamePath]
 *
 * Deterministic for a given install: same inputs, same bytes. NOTE that the
 * committed CK3 structures.json predates the sub-block pass, the docless-folder
 * harvest and the script-grammar test, and was deliberately NOT regenerated with
 * them (0.3.1 ships it, and CK3 ranking is already at its measured bar). Running
 * this for ck3 WILL produce a different, larger file, re-run scripts/rank-eval.ts
 * for ck3 before committing that.
 */
import * as fs from "fs";
import * as path from "path";
import { parseScript } from "../packages/server/src/parser";
import { resolveProfile } from "../packages/server/src/games/registry";
import { setActiveProfile } from "../packages/server/src/games/active";
import { loadTokenDataFromLogs } from "../packages/server/src/data/docsParser";
import { parseGameArg, requireDevPath } from "./devPaths";

const { gameId, rest } = parseGameArg(process.argv.slice(2));
const profile = resolveProfile(gameId);
setActiveProfile(profile); // script_docs dialect (classic vs markdown) is per game
const gamePath = rest[0] ?? requireDevPath("gamePath", "build-structures-json", gameId);

const KEY_LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const NAME_OK = /^[a-z][a-z0-9_]*$/;
/** Grammar/logic words that completion serves through the context layer, not as structure keys. */
const STOPLIST = new Set([
  "if",
  "else",
  "else_if",
  "limit",
  "and",
  "or",
  "not",
  "nor",
  "nand",
  "this",
  "root",
  "prev",
  "from",
  "yes",
  "no",
  "value",
  "add",
  "multiply",
  "divide",
  "subtract",
  "min",
  "max",
  "factor",
  "base",
  "first_valid",
  "triggered_desc",
  "random_list",
  "e_g",
]);
const MAX_KEYS_PER_KIND = 60;
const MAX_KEYS_PER_BLOCK = 40;
const MAX_BLOCKS_PER_KIND = 12;
const MAX_DOC = 240;
/**
 * Above this share of a body's key occurrences being engine tokens, the body is
 * script grammar, not a record: no structure layer. Measured on both installs,
 * real record kinds sit under 0.2 (a stray `modifier`/`icon` name collision),
 * scripted_effects/script_values/on_actions sit above 0.8.
 */
const TOKEN_SHARE_LIMIT = 0.5;
/** A sub-block is emitted only if this many of its children are NOT engine tokens. */
const MIN_STRUCT_KEYS_PER_BLOCK = 2;
/** How often a key must open a block at depth 1 before its children are harvested. */
const MIN_BLOCK_USES = 5;

interface KeySpecJson {
  key: string;
  doc?: string;
  values?: string;
  freq?: number;
  /** Root scope of the block this key opens, harvested from `# root = X` docs. */
  scope?: string;
}

/**
 * Root-scope declarations in the shipped docs, e.g. "# root = the activity",
 * "# Root - Travel Plan.", "# root ( Character )", "# root = owning country".
 * Mapped to canonical scope type names (event_scopes.log) through a per-game
 * phrase table: the scope vocabulary is the one thing here that cannot be read
 * off the files generically.
 */
const ROOT_DECL = /(?:^|[^a-z])root(?:\s+scope)?\s*(?:=|:|-+>?|is\b|\()\s*(.{2,80})/i;

const ROOT_PHRASES: Record<string, Array<[RegExp, string]>> = {
  ck3: [
    [/task.contract.type/, "task_contract_type"],
    [/situation sub.?region/, "situation_sub_region"],
    [/participant group/, "situation_participant_group"],
    [/combat side/, "combat_side"],
    [/great project|funded project/, "great_project"],
    [/travel plan owner/, "character"],
    [/travel plan/, "travel_plan"],
    [/casus belli/, "casus_belli"],
    [
      /character|ruler|player\b|owner|host\b|councillor|liege|attacker|defender|claimant|employer|employee|courtier|agent\b|knight|promoter|vassal|recipient|actor|founder|holder|creator|schemer|guest|governor|spouse|heir/,
      "character",
    ],
    [/\bcontract\b/, "task_contract"],
    [/\bmemory\b/, "character_memory"],
    [/\bhouse\b/, "dynasty_house"],
    [/\bdynasty\b/, "dynasty"],
    [/\btitle\b|\bcounty\b|\bbarony\b|\bduchy\b|\bkingdom\b|\bempire\b/, "landed_title"],
    [/\bprovince\b/, "province"],
    [/\bactivity\b/, "activity"],
    [/\bscheme\b/, "scheme"],
    [/\bsecret\b/, "secret"],
    [/\bstory\b/, "story"],
    [/\bsituation\b/, "situation"],
    [/\bepidemic\b/, "epidemic"],
    [/\binspiration\b/, "inspiration"],
    [/\blegend\b/, "legend"],
    [/\bdomicile\b/, "domicile"],
    [/\bartifact\b/, "artifact"],
    [/\baccolade\b/, "accolade"],
    [/\bfaith\b/, "faith"],
    [/\bculture\b/, "culture"],
    [/\bwar\b/, "war"],
    [/\barmy\b/, "army"],
    [/\bcombat\b/, "combat"],
    [/\btravel\b/, "travel_plan"],
  ],
  // Vic3 scope names as its script_docs dump spells them. Country words first:
  // "the country that owns the state" is a country root, not a state root.
  vic3: [
    [/interest group/, "interest_group"],
    [/political movement/, "political_movement"],
    [/power bloc/, "power_bloc"],
    [/journal ?entry/, "journal_entry"],
    [/diplomatic play/, "diplomatic_play"],
    [/diplomatic pact/, "diplomatic_pact"],
    [/state region/, "state_region"],
    [/civil war/, "civil_war"],
    [/trade route/, "trade_route"],
    [/military formation/, "military_formation"],
    [/combat unit/, "combat_unit"],
    [/\bcountry\b|\bnation\b|\bowner\b|\btarget country\b|\bplayer\b/, "country"],
    [/\bcharacter\b|\bruler\b|\bcommander\b|\bagitator\b|\bexecutive\b/, "character"],
    [/\bstate\b/, "state"],
    [/\bbuilding\b/, "building"],
    [/\bmarket\b/, "market"],
    [/\bpop\b/, "pop"],
    [/\bfront\b/, "front"],
    [/\bbattle\b/, "battle"],
    [/\bwar\b/, "war"],
    [/\bcompany\b/, "company"],
    [/\binstitution\b/, "institution"],
    [/\bparty\b/, "party"],
    [/\blaw\b/, "law"],
    [/\bgoods?\b/, "goods"],
    [/\btreaty\b/, "treaty"],
  ],
};

function rootScopeFromDoc(line: string): string | undefined {
  const m = ROOT_DECL.exec(line);
  if (!m) return undefined;
  const phrase = m[1].toLowerCase();
  for (const [re, scope] of ROOT_PHRASES[gameId] ?? []) if (re.test(phrase)) return scope;
  return undefined;
}

function guessValues(rhs: string): string | undefined {
  const r = rhs.trim();
  if (/^\{/.test(r)) return "block";
  if (/\byes\/no\b|\bbool\b|^yes$|^no$/i.test(r)) return "bool";
  if (/\bloc_key\b|\bkey\b|<key>/.test(r)) return "loc";
  if (/\btrigger\b|\beffect\b|\bmtth\b|<scripted value>|<script value>/.test(r)) return "block";
  return undefined;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** All `key = …` candidates with doc prose from one shipped doc file, any depth. */
function harvestDoc(text: string): Map<string, KeySpecJson> {
  const out = new Map<string, KeySpecJson>();
  let pending: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) {
      pending.push(trimmed.replace(/^#+\s?/, "").trim());
      continue;
    }
    if (trimmed === "") {
      pending = [];
      continue;
    }
    const m = KEY_LINE.exec(raw);
    if (m) {
      const key = m[2].toLowerCase();
      if (NAME_OK.test(key) && !STOPLIST.has(key)) {
        let rhs = m[3];
        let inlineDoc = "";
        const hash = rhs.indexOf("#");
        if (hash >= 0) {
          inlineDoc = rhs
            .slice(hash + 1)
            .replace(/^#+\s?/, "")
            .trim();
          rhs = rhs.slice(0, hash);
        }
        const doc = [...pending, inlineDoc]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_DOC);
        // Nearest root-scope declaration above (or inline with) the key wins.
        let scope: string | undefined;
        for (const line of [...pending, inlineDoc]) {
          const found = rootScopeFromDoc(line);
          if (found) scope = found;
        }
        const existing = out.get(key);
        // Prefer the occurrence that carries documentation; keep a scope from
        // either occurrence (docs sometimes declare root only once).
        if (!existing || (!existing.doc && doc)) {
          const spec: KeySpecJson = { key };
          if (doc) spec.doc = doc;
          const values = guessValues(rhs);
          if (values) spec.values = values;
          if (scope ?? existing?.scope) spec.scope = scope ?? existing?.scope;
          out.set(key, spec);
        } else if (scope && !existing.scope) {
          existing.scope = scope;
        }
      }
    }
    pending = [];
  }
  return out;
}

interface Usage {
  /** Keys that are DIRECT children of the folder's top-level definitions. */
  topLevel: Map<string, number>;
  /** How often each depth-1 key opens a block. */
  blockUses: Map<string, number>;
  /** depth-1 block name -> its own direct children and counts. */
  inBlock: Map<string, Map<string, number>>;
  /** The folder's own top-level definition names. */
  defNames: Set<string>;
}

/**
 * DEPTH-1 and DEPTH-2 usage counts, parsed with the real CST parser. Any-depth
 * counting (a line regex) lets deeply nested keys (an event option's `name`, a
 * portrait `character`…) masquerade as top-level vocabulary, the source of both
 * a ranking regression and false structure keys.
 */
function usageCounts(dir: string): Usage {
  const usage: Usage = {
    topLevel: new Map(),
    blockUses: new Map(),
    inBlock: new Map(),
    defNames: new Set(),
  };
  const files: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".txt") && !e.name.startsWith("_")) files.push(full);
    }
  };
  walk(dir);
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const file of files) {
    let text: string;
    try {
      text = stripBom(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    let root;
    try {
      root = parseScript(text).root;
    } catch {
      continue;
    }
    for (const stmt of root.statements) {
      if (stmt.kind !== "assignment") continue;
      const v = stmt.value;
      const body = v?.kind === "block" ? v : v?.kind === "tagged-block" ? v.block : null;
      if (!body) continue;
      usage.defNames.add(stmt.key.text.toLowerCase());
      for (const child of body.statements) {
        if (child.kind !== "assignment") continue;
        const k = child.key.text.toLowerCase();
        if (!NAME_OK.test(k)) continue;
        bump(usage.topLevel, k);
        const cv = child.value;
        const sub = cv?.kind === "block" ? cv : cv?.kind === "tagged-block" ? cv.block : null;
        if (!sub) continue;
        bump(usage.blockUses, k);
        let inner = usage.inBlock.get(k);
        if (!inner) usage.inBlock.set(k, (inner = new Map()));
        for (const g of sub.statements) {
          if (g.kind !== "assignment") continue;
          const gk = g.key.text.toLowerCase();
          if (NAME_OK.test(gk)) bump(inner, gk);
        }
      }
    }
  }
  return usage;
}

// ---- engine tokens: what completion already serves as effects/triggers ------
const scriptDocsDir = path.join(__dirname, "..", "packages", "server", "data", gameId, "script_docs");
const engineTokens = new Set<string>();
for (const t of loadTokenDataFromLogs(scriptDocsDir).tokens) {
  if (t.kind !== "modifier") engineTokens.add(t.name.toLowerCase());
}
if (engineTokens.size === 0) {
  console.error(
    `build-structures-json: no engine tokens in ${scriptDocsDir}, the script-grammar test ` +
      `cannot run, so every definition body would be harvested as a record. Bundle the game's ` +
      `script_docs dump first.`
  );
  process.exit(1);
}

/** Share of a body's key occurrences that the engine declares as a token. */
function tokenShare(tally: Map<string, number>): number {
  let total = 0;
  let tokens = 0;
  for (const [key, count] of tally) {
    total += count;
    if (engineTokens.has(key)) tokens += count;
  }
  return total === 0 ? 0 : tokens / total;
}

// ---- pass 1: usage per kind, and which kinds are script grammar -------------
const usageByKind = new Map<string, Usage>();
const entryByKind = new Map<string, (typeof profile.schema)[number]>();
const skippedScriptKinds: string[] = [];
for (const entry of profile.schema) {
  if (entryByKind.has(entry.kind)) continue;
  if (entry.ext && entry.ext !== ".txt") continue;
  const usage = usageCounts(path.join(gamePath, ...entry.path.split("/")));
  if (usage.topLevel.size === 0) continue;
  entryByKind.set(entry.kind, entry);
  usageByKind.set(entry.kind, usage);
  if (tokenShare(usage.topLevel) > TOKEN_SHARE_LIMIT) skippedScriptKinds.push(entry.kind);
}

/**
 * Script-callable names: engine tokens plus the game's OWN scripted effects,
 * triggers and values (the definition names of every script-grammar folder).
 * A sub-block whose children are these is a script block, not a record, its
 * vocabulary is already served and scope-ranked by the token layer, and listing
 * one vanilla mod's favourite scripted effects as "structure" would only bury it.
 */
const scriptNames = new Set(engineTokens);
for (const kind of skippedScriptKinds) {
  for (const name of usageByKind.get(kind)!.defNames) scriptNames.add(name);
}

// ---- pass 2: emit the structure layer ---------------------------------------
const kinds: Record<string, { topLevel: KeySpecJson[]; blocks?: Record<string, KeySpecJson[]> }> = {};
const sources: Record<string, string> = {};

for (const [kind, entry] of entryByKind) {
  if (skippedScriptKinds.includes(kind)) continue;
  const usage = usageByKind.get(kind)!;
  const dir = path.join(gamePath, ...entry.path.split("/"));

  // --- shipped docs next to the data: `_*.info` (CK3) or `*.md` (Vic3) ---
  let docFiles: string[] = [];
  try {
    docFiles = fs
      .readdirSync(dir)
      .filter((n) => (n.startsWith("_") && n.endsWith(".info")) || n.endsWith(".md"))
      .map((n) => path.join(dir, n));
  } catch {
    /* folder missing in this install */
  }
  const candidates = new Map<string, KeySpecJson>();
  for (const f of docFiles) {
    for (const [k, spec] of harvestDoc(stripBom(fs.readFileSync(f, "utf8")))) {
      const existing = candidates.get(k);
      if (!existing || (!existing.doc && spec.doc)) {
        if (existing?.scope && !spec.scope) spec.scope = existing.scope;
        candidates.set(k, spec);
      } else if (spec.scope && !existing.scope) {
        existing.scope = spec.scope;
      }
    }
  }

  const kept: KeySpecJson[] = [];
  for (const spec of candidates.values()) {
    const count = usage.topLevel.get(spec.key) ?? 0;
    if (count >= 3 || (spec.doc && count >= 1)) {
      if (count > 0) spec.freq = count;
      kept.push(spec);
    }
  }
  // Usage-only keys: depth-1 vocabulary vanilla actually uses that the docs never
  // mention (Paradox's docs are incomplete, and many folders ship none at all).
  // count >= 3 keeps typos and one-offs out.
  const have = new Set(kept.map((k) => k.key));
  const usageOnly = new Set<string>();
  for (const [key, count] of usage.topLevel) {
    if (have.has(key) || STOPLIST.has(key) || count < 3) continue;
    usageOnly.add(key);
    kept.push({
      key,
      freq: count,
      doc: `Used ${count}x in vanilla ${path.basename(entry.path)} (not in the shipped docs).`,
    });
  }

  kept.sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0) || (a.key < b.key ? -1 : 1));
  if (kept.length === 0) continue;
  // The cap trims usage-only noise, never Paradox-documented vocabulary: a
  // rarely-used documented key (interactions' ai_frequency, 5 vanilla uses)
  // must not lose its slot to a lucky undocumented one (2026-07 audit bug).
  const docCount = kept.filter((k) => !usageOnly.has(k.key)).length;
  let usageBudget = Math.max(0, MAX_KEYS_PER_KIND - docCount);
  const limited = kept.filter((k) => !usageOnly.has(k.key) || usageBudget-- > 0);

  // --- structural sub-blocks (an event `option`, a decision `cost`) -----------
  // A sub-block whose children are engine tokens is a script block (`immediate`,
  // `possible`): completion serves and scope-ranks those already, so listing them
  // as structure keys would only bury the scope-correct ranking.
  const blocks: Record<string, KeySpecJson[]> = {};
  const blockNames = [...usage.blockUses.entries()]
    .filter(([, uses]) => uses >= MIN_BLOCK_USES)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  for (const name of blockNames) {
    if (Object.keys(blocks).length >= MAX_BLOCKS_PER_KIND) break;
    const inner = usage.inBlock.get(name);
    if (!inner) continue;
    const structural = [...inner.entries()]
      .filter(([key, count]) => count >= 3 && !STOPLIST.has(key) && !scriptNames.has(key))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_KEYS_PER_BLOCK);
    if (structural.length < MIN_STRUCT_KEYS_PER_BLOCK) continue;
    blocks[name] = structural.map(([key, freq]) => {
      const doc = candidates.get(key)?.doc;
      return { key, freq, ...(doc ? { doc } : {}) };
    });
  }

  kinds[entry.kind] = {
    topLevel: limited,
    ...(Object.keys(blocks).length > 0 ? { blocks } : {}),
  };
  sources[entry.kind] = path.basename(entry.path);
}

const out = {
  meta: { generated: new Date().toISOString().slice(0, 10), gameVersionHint: "run per patch" },
  sources,
  kinds,
};
const target = path.join(__dirname, "..", "packages", "server", "data", gameId, "structures.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1), "utf8");
const totalTop = Object.values(kinds).reduce((n, k) => n + k.topLevel.length, 0);
const totalBlockKeys = Object.values(kinds).reduce(
  (n, k) => n + Object.values(k.blocks ?? {}).reduce((m, keys) => m + keys.length, 0),
  0
);
const blockCount = Object.values(kinds).reduce((n, k) => n + Object.keys(k.blocks ?? {}).length, 0);
console.log(
  `wrote ${target}: ${Object.keys(kinds).length} kinds, ${totalTop} top-level keys, ` +
    `${blockCount} sub-blocks / ${totalBlockKeys} keys`
);
console.log(`skipped ${skippedScriptKinds.length} script-grammar kinds: ${skippedScriptKinds.join(", ")}`);
