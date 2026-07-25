/**
 * Build-time harvest of the FULL structure-key layer: every documented
 * `key = value` line in every `_*.info` schema doc the game ships, validated
 * against real usage counts in that folder's vanilla files, emitted as
 * packages/server/data/ck3/structures.json (bundled; merged UNDER the hand-curated
 * packages/server/src/games/ck3/structures.ts at load time — curated docs always win).
 *
 * Keys are kept when they are actually used in vanilla (count >= 3) or carry
 * a doc comment and appear at least once — this filters the .info files'
 * prose and worked examples down to the real vocabulary. `freq` is the
 * vanilla usage count (drives completion ranking).
 *
 * Run:
 *   npx esbuild scripts/build-structures-json.ts --bundle --platform=node \
 *     --outfile=dist/build-structures-json.cjs && node dist/build-structures-json.cjs [gamePath]
 */
import * as fs from "fs";
import * as path from "path";
import { CK3_SCHEMA } from "../packages/server/src/games/ck3/schema";
import { parseScript } from "../packages/server/src/parser";
import { requireDevPath } from "./devPaths";

const gamePath = process.argv[2] ?? requireDevPath("gamePath", "build-structures-json");

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
const MAX_DOC = 240;

interface KeySpecJson {
  key: string;
  doc?: string;
  values?: string;
  freq?: number;
  /** Root scope of the block this key opens, harvested from `# root = X` docs. */
  scope?: string;
}

/**
 * Root-scope declarations in .info docs, e.g. "# root = the activity",
 * "# Root - Travel Plan.", "# root ( Character )", "# root is the attacker",
 * "# Root scope = ruler with the law". Mapped to canonical scope type names
 * (event_scopes.log). Character-words go first: "character hosting the
 * activity" is a character root, not an activity root.
 */
const ROOT_DECL = /(?:^|[^a-z])root(?:\s+scope)?\s*(?:=|:|-+>?|is\b|\()\s*(.{2,80})/i;

const ROOT_PHRASES: Array<[RegExp, string]> = [
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
];

function rootScopeFromDoc(line: string): string | undefined {
  const m = ROOT_DECL.exec(line);
  if (!m) return undefined;
  const phrase = m[1].toLowerCase();
  for (const [re, scope] of ROOT_PHRASES) if (re.test(phrase)) return scope;
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

/** All `key = …` candidates with doc prose from one .info file, any depth. */
function harvestInfo(text: string): Map<string, KeySpecJson> {
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

/**
 * DEPTH-1 usage counts: keys that appear as DIRECT children of the folder's
 * top-level definitions, parsed with the real CST parser. Any-depth counting
 * (the previous line-regex approach) let deeply nested keys (an event
 * option's `name`, portrait `character`…) masquerade as top-level vocabulary
 * — the source of both a ranking regression and false structure keys.
 *
 * Also the base for USAGE-ONLY keys: Paradox's .info docs are incomplete
 * (scheme_types' `desc`/`success_desc`/`name` are used 654/75/60 times but
 * documented nowhere), so vanilla usage itself is harvested as the fallback
 * source of truth.
 */
function usageCounts(dir: string): Map<string, number> {
  const tally = new Map<string, number>();
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
      const block = v?.kind === "block" ? v : v?.kind === "tagged-block" ? v.block : null;
      if (!block) continue;
      for (const child of block.statements) {
        if (child.kind !== "assignment") continue;
        const k = child.key.text.toLowerCase();
        if (NAME_OK.test(k)) tally.set(k, (tally.get(k) ?? 0) + 1);
      }
    }
  }
  return tally;
}

const kinds: Record<string, { topLevel: KeySpecJson[] }> = {};
const sources: Record<string, string> = {};
const seenKinds = new Set<string>();

for (const entry of CK3_SCHEMA) {
  if (seenKinds.has(entry.kind)) continue;
  seenKinds.add(entry.kind);
  const dir = path.join(gamePath, ...entry.path.split("/"));
  let infoFiles: string[];
  try {
    infoFiles = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("_") && n.endsWith(".info"))
      .map((n) => path.join(dir, n));
  } catch {
    continue;
  }
  if (infoFiles.length === 0) continue;

  const candidates = new Map<string, KeySpecJson>();
  for (const f of infoFiles) {
    for (const [k, spec] of harvestInfo(stripBom(fs.readFileSync(f, "utf8")))) {
      const existing = candidates.get(k);
      if (!existing || (!existing.doc && spec.doc)) {
        if (existing?.scope && !spec.scope) spec.scope = existing.scope;
        candidates.set(k, spec);
      } else if (spec.scope && !existing.scope) {
        existing.scope = spec.scope;
      }
    }
  }
  const tally = usageCounts(dir);

  const kept: KeySpecJson[] = [];
  for (const spec of candidates.values()) {
    const count = tally.get(spec.key) ?? 0;
    if (count >= 3 || (spec.doc && count >= 1)) {
      if (count > 0) spec.freq = count;
      kept.push(spec);
    }
  }
  // Usage-only keys: depth-1 vocabulary vanilla actually uses that the .info
  // never documents. count >= 3 keeps typos and one-offs out.
  const have = new Set(kept.map((k) => k.key));
  const usageOnly = new Set<string>();
  for (const [key, count] of tally) {
    if (have.has(key) || STOPLIST.has(key) || count < 3) continue;
    usageOnly.add(key);
    kept.push({
      key,
      freq: count,
      doc: `Used ${count}x in vanilla ${path.basename(entry.path)} (not in the .info docs).`,
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
  kinds[entry.kind] = { topLevel: limited };
  sources[entry.kind] = path.basename(entry.path);
}

const out = {
  meta: { generated: new Date().toISOString().slice(0, 10), gameVersionHint: "run per patch" },
  sources,
  kinds,
};
const target = path.join(__dirname, "..", "packages", "server", "data", "ck3", "structures.json");
fs.writeFileSync(target, JSON.stringify(out, null, 1), "utf8");
const total = Object.values(kinds).reduce((n, k) => n + k.topLevel.length, 0);
console.log(`wrote ${target}: ${Object.keys(kinds).length} kinds, ${total} keys`);
