/**
 * One-off importer: cwtools-eu5-config `types = { ... }` blocks -> the EU5
 * schema table (packages/server/src/games/eu5/schema.generated.ts).
 *
 * CWT is a rule language for a different engine (CWTools), so this is a lossy
 * projection, not a translation: only the type declarations whose layout maps
 * onto one of the five NameExtraction modes survive. Everything else is
 * dropped LOUDLY (printed here and listed in the generated file's
 * "Not covered" block), so the gap is visible instead of silently missing.
 *
 * Not a build step: the output is committed and the importer is expected to be
 * run by hand when the upstream config is re-pinned.
 *
 * Run:
 *   npx esbuild scripts/import-cwt-types.ts --bundle --platform=node --outfile=dist/import-cwt-types.cjs \
 *     && node dist/import-cwt-types.cjs <path-to-cwtools-eu5-config-clone>
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/** Pinned upstream provenance; update together with the clone. */
const UPSTREAM_REPO = "https://github.com/kaiser-chris/cwtools-eu5-config";
const UPSTREAM_COMMIT = "7f2764a9536951dc9915c0b05509d0499408381a";
const UPSTREAM_GAME_VERSION = "1.3.4-beta";
const IMPORT_DATE = "2026-08-01";
const OUT_FILE = path.join(
  __dirname,
  "..",
  "packages",
  "server",
  "src",
  "games",
  "eu5",
  "schema.generated.ts"
);

/** CWT's virtual root for the game/mod directory. */
const GAME_ROOT = "game/";
/** Roots belonging to a different game, should the config ever grow shared rules. */
const FOREIGN_ROOTS = /^(ck3|vic3|hoi4|stellaris|imperator|eu4|ir)\//;
const PATH_RE = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;
const KIND_RE = /^[a-z0-9_]+$/;

// ---------------------------------------------------------------- tokenizer

type Tok = { t: "{" | "}" | "=" | "word" | "opt"; v: string };

/**
 * CWT is Paradox script plus comment conventions: `#` is a plain comment,
 * `##` carries options for the NEXT statement, `###` is documentation.
 */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "#") {
      const end = src.indexOf("\n", i);
      const line = src.slice(i, end === -1 ? src.length : end);
      // `###` (doc) before `##` (option): both start with "##".
      if (!line.startsWith("###") && line.startsWith("##")) {
        toks.push({ t: "opt", v: line.slice(2).trim() });
      }
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      toks.push({ t: "word", v: src.slice(i + 1, end === -1 ? src.length : end) });
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === "{" || c === "}" || c === "=") {
      toks.push({ t: c, v: c });
      i++;
      continue;
    }
    let j = i;
    while (j < src.length && !/[\s{}=#"]/.test(src[j])) j++;
    toks.push({ t: "word", v: src.slice(i, j) });
    i = j;
  }
  return toks;
}

// ------------------------------------------------------------------- parser

interface CwtType {
  name: string;
  file: string;
  paths: string[];
  /** Scalar body fields (last wins; `path` is collected separately). */
  fields: Map<string, string>;
  /** Body fields whose value was a block (`skip_root_key = { ... }`). */
  blockFields: Set<string>;
  /** `## key = value` option comments attached to the type declaration. */
  options: string[];
  /** Flattened right-hand sides of the `localisation = { ... }` block. */
  loc: string[];
}

/** Advance past a `{ ... }` whose opening brace is at `i`. */
function skipBlock(toks: Tok[], i: number): number {
  let depth = 0;
  for (; i < toks.length; i++) {
    if (toks[i].t === "{") depth++;
    else if (toks[i].t === "}" && --depth === 0) return i + 1;
  }
  return i;
}

/** Collect every leaf right-hand side of a block, descending through subtypes. */
function collectLeaves(toks: Tok[], i: number, out: string[]): number {
  let depth = 0;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "{") depth++;
    else if (t.t === "}") {
      if (--depth === 0) return i + 1;
    } else if (t.t === "word" && toks[i + 1]?.t === "=") {
      const val = toks[i + 2];
      if (val?.t === "word") {
        out.push(val.v);
        i += 2;
      }
    }
  }
  return i;
}

function parseTypeBody(toks: Tok[], i: number, type: CwtType): number {
  let depth = 1; // caller consumed the opening brace
  while (i < toks.length) {
    const t = toks[i];
    if (t.t === "}") {
      if (--depth === 0) return i + 1;
      i++;
      continue;
    }
    if (t.t !== "word" || toks[i + 1]?.t !== "=") {
      i++;
      continue;
    }
    const key = t.v;
    const val = toks[i + 2];
    if (val?.t === "{") {
      if (key === "localisation") i = collectLeaves(toks, i + 2, type.loc);
      else {
        type.blockFields.add(key.replace(/\[.*$/, ""));
        i = skipBlock(toks, i + 2);
      }
      continue;
    }
    if (val?.t === "word") {
      if (key === "path") type.paths.push(val.v);
      else type.fields.set(key, val.v);
      i += 3;
      continue;
    }
    i++;
  }
  return i;
}

function parseFile(file: string, rel: string, types: CwtType[]): void {
  const toks = tokenize(fs.readFileSync(file, "utf8"));
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "{") depth++;
    else if (t.t === "}") depth--;
    else if (
      depth === 0 &&
      t.t === "word" &&
      t.v === "types" &&
      toks[i + 1]?.t === "=" &&
      toks[i + 2]?.t === "{"
    ) {
      i = parseTypesBlock(toks, i + 3, rel, types) - 1;
    }
  }
}

function parseTypesBlock(toks: Tok[], i: number, rel: string, types: CwtType[]): number {
  let pending: string[] = [];
  let depth = 1;
  while (i < toks.length) {
    const t = toks[i];
    if (t.t === "}") {
      if (--depth === 0) return i + 1;
      i++;
      continue;
    }
    if (t.t === "opt") {
      pending.push(t.v);
      i++;
      continue;
    }
    const m = t.t === "word" ? /^type\[(.+)\]$/.exec(t.v) : null;
    if (m && toks[i + 1]?.t === "=" && toks[i + 2]?.t === "{") {
      const type: CwtType = {
        name: m[1],
        file: rel,
        paths: [],
        fields: new Map(),
        blockFields: new Set(),
        options: pending,
        loc: [],
      };
      types.push(type);
      pending = [];
      i = parseTypeBody(toks, i + 3, type);
      continue;
    }
    // Anything else in a types block (there is nothing else in practice).
    if (toks[i + 1]?.t === "=" && toks[i + 2]?.t === "{") i = skipBlock(toks, i + 2);
    else i++;
  }
  return i;
}

// ------------------------------------------------------------------ mapping

/** CWT type name -> schema kind (conformance: /^[a-z0-9_]+$/). */
function toKind(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Folder name a kind would own, for conflict resolution (laws <-> law). */
function singular(folder: string): string {
  if (folder.endsWith("ies")) return folder.slice(0, -3) + "y";
  if (folder.endsWith("sses") || folder.endsWith("ches") || folder.endsWith("shes")) {
    return folder.slice(0, -2);
  }
  if (folder.endsWith("s") && !folder.endsWith("ss")) return folder.slice(0, -1);
  return folder;
}

/**
 * Type-level constructs with no NameExtraction equivalent. Each one means the
 * definition names are NOT the top-level keys of every file in the folder, so
 * importing them would produce wrong names, not merely fewer.
 */
function dropReason(type: CwtType): string | null {
  const f = type.fields;
  if (f.has("name_field")) {
    return `name_field = ${f.get("name_field")} (name comes from a body field, not the top-level key)`;
  }
  if (f.has("type_per_file")) return "type_per_file (one definition per file, named after the file)";
  if (f.has("skip_root_key") || type.blockFields.has("skip_root_key")) {
    const v = f.get("skip_root_key") ?? "{ ... }";
    return `skip_root_key = ${v} (definitions nest one level below the file root)`;
  }
  if (f.has("type_key_prefix")) {
    return `type_key_prefix = ${f.get("type_key_prefix")} (only prefixed keys are definitions)`;
  }
  if (f.has("starts_with"))
    return `starts_with = ${f.get("starts_with")} (only matching keys are definitions)`;
  if (f.has("path_file")) {
    return `path_file = ${f.get("path_file")} (one file, not a folder scan)`;
  }
  const filter = type.options.find((o) => o.startsWith("type_key_filter"));
  if (filter) return `## ${filter} (only that literal root key is a definition)`;
  return null;
}

interface Emitted {
  path: string;
  kind: string;
  ext?: string;
  extraction?: string;
  loc: string[];
  from: string;
}

// --------------------------------------------------------------------- main

const clone = process.argv[2];
if (!clone) {
  console.error("usage: node dist/import-cwt-types.cjs <path-to-cwtools-eu5-config-clone>");
  process.exit(1);
}
const configRoot = fs.existsSync(path.join(clone, "config")) ? path.join(clone, "config") : clone;

const files: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".cwt")) files.push(full);
  }
})(configRoot);
files.sort();

const types: CwtType[] = [];
for (const file of files) {
  parseFile(file, path.relative(clone, file).split(path.sep).join("/"), types);
}
console.log(`parsed ${files.length} .cwt files -> ${types.length} type declarations`);

const dropped: string[] = [];
const conflicts: string[] = [];
const renamedKinds: string[] = [];
const byPath = new Map<string, Emitted>();

/**
 * Events are the one type worth hand-mapping: EU5 uses `namespace.N` ids, so
 * the top-level keys are only partly definitions (see games/vic3/schema.ts).
 */
const EVENT_TYPES = new Set(["event"]);

for (const type of types) {
  const reason = dropReason(type);
  if (reason) {
    dropped.push(`${type.name} (${type.file}): ${reason}`);
    continue;
  }
  if (type.paths.length === 0) {
    dropped.push(`${type.name} (${type.file}): no path declared`);
    continue;
  }
  const kind = toKind(type.name);
  if (!KIND_RE.test(kind)) {
    dropped.push(`${type.name} (${type.file}): type name is not expressible as a kind`);
    continue;
  }
  if (kind !== type.name) renamedKinds.push(`${type.name} -> ${kind}`);

  const rawExt = type.fields.get("path_extension");
  const ext = rawExt && rawExt !== ".txt" ? rawExt : undefined;
  if (ext && !/^\.[a-z0-9]+$/.test(ext)) {
    dropped.push(`${type.name} (${type.file}): unusable path_extension ${ext}`);
    continue;
  }

  for (const raw of new Set(type.paths)) {
    if (FOREIGN_ROOTS.test(raw)) {
      dropped.push(`${type.name} (${type.file}): path ${raw} belongs to another game`);
      continue;
    }
    // "game/" is CWT's virtual root; a handful of upstream paths omit it and
    // are already mod-root-relative (gfx/...).
    const p = raw.startsWith(GAME_ROOT) ? raw.slice(GAME_ROOT.length) : raw;
    if (!PATH_RE.test(p)) {
      dropped.push(`${type.name} (${type.file}): path ${raw} is not a plain folder path`);
      continue;
    }
    const entry: Emitted = {
      path: p,
      kind,
      ext,
      extraction: EVENT_TYPES.has(type.name) ? "event-id" : undefined,
      loc: type.loc,
      from: type.file,
    };
    const prev = byPath.get(p);
    if (!prev) {
      byPath.set(p, entry);
      continue;
    }
    // Two types claiming one folder: the one named after the folder wins.
    const folder = singular(p.slice(p.lastIndexOf("/") + 1));
    const prevFits = folder === prev.kind;
    const nextFits = folder === entry.kind;
    const winner = prevFits === nextFits ? prev : nextFits ? entry : prev;
    conflicts.push(
      `${p}: ${prev.kind} vs ${entry.kind} -> kept ${winner.kind}` +
        (prevFits === nextFits ? " (no folder-name match; first declaration wins)" : "")
    );
    byPath.set(p, winner);
  }
}

/**
 * Localization: the CWT config declares no localization root (CWTools handles
 * loc natively), so these follow the load-stage convention every other EU5
 * type uses. American spelling on disk, "localisation" only in CWT rule keys.
 */
const LOC_ROOTS = [
  "localization",
  "in_game/localization",
  "main_menu/localization",
  "loading_screen/localization",
];
for (const p of LOC_ROOTS) {
  if (byPath.has(p)) {
    conflicts.push(`${p}: localization root also claimed by ${byPath.get(p)!.kind} -> kept loc_key`);
  }
  byPath.set(p, { path: p, kind: "loc_key", ext: ".yml", extraction: "loc-key", loc: [], from: "importer" });
}

/** Load-stage root a path belongs to, "" for the flat root. Also the sort group. */
const STAGE_ROOTS = ["in_game", "main_menu", "loading_screen"];
function rootOf(p: string): string {
  const head = p.slice(0, p.indexOf("/") === -1 ? p.length : p.indexOf("/"));
  return STAGE_ROOTS.includes(head) ? head : "";
}

// Grouped by load-stage root, then by path: alphabetical alone would split the
// flat root into three runs (gfx/, localization, map_data/ sort after in_game/).
const entries = [...byPath.values()].sort(
  (a, b) =>
    STAGE_ROOTS.indexOf(rootOf(a.path)) - STAGE_ROOTS.indexOf(rootOf(b.path)) || a.path.localeCompare(b.path)
);
const kinds = new Set(entries.map((e) => e.kind));

// ---------------------------------------------------------------- rendering

const ROOT_TITLE: Record<string, string> = {
  "": "Flat root (content loaded in every stage)",
  in_game: "in_game/ (gameplay stage)",
  main_menu: "main_menu/ (main-menu stage)",
  loading_screen: "loading_screen/ (loading-screen stage)",
};

function renderEntry(e: Emitted): string {
  const parts = [`path: ${JSON.stringify(e.path)}`, `kind: ${JSON.stringify(e.kind)}`];
  if (e.ext) parts.push(`ext: ${JSON.stringify(e.ext)}`);
  if (e.extraction) parts.push(`extraction: ${JSON.stringify(e.extraction)}`);
  const line = `  { ${parts.join(", ")} },`;
  if (e.loc.length === 0) return line;
  // Unmeasurable without a live install: kept as documentation only.
  const pats = [...new Set(e.loc)].map((p) => JSON.stringify(p)).join(", ");
  return `  // requiredLoc: [${pats}] (CWT localisation block, unverified against vanilla)\n${line}`;
}

const body: string[] = [];
let lastRoot: string | null = null;
for (const e of entries) {
  const root = rootOf(e.path);
  if (root !== lastRoot) {
    body.push(`${body.length ? "\n" : ""}  // --- ${ROOT_TITLE[root]} ---`);
    lastRoot = root;
  }
  body.push(renderEntry(e));
}

const wrap = (prefix: string, items: string[]) =>
  items.map((s) => `${prefix}${s}`).join("\n") || `${prefix}(none)`;

const out = `/**
 * GENERATED FILE, do not edit by hand. Europa Universalis V schema table,
 * imported from the community CWT rules for CWTools.
 *
 *   upstream:     ${UPSTREAM_REPO}
 *   commit:       ${UPSTREAM_COMMIT}
 *   game version: EU5 ${UPSTREAM_GAME_VERSION}
 *   imported:     ${IMPORT_DATE}
 *   license:      MIT, (c) 2025 Chris Kaiser (see THIRD-PARTY-NOTICES.md)
 *
 * Regenerate:
 *   npx esbuild scripts/import-cwt-types.ts --bundle --platform=node \\
 *     --outfile=dist/import-cwt-types.cjs && node dist/import-cwt-types.cjs <clone>
 *
 * ${entries.length} entries across ${kinds.size} kinds. EU5 loads content from a flat root plus
 * three load-stage roots (in_game/, main_menu/, loading_screen/); the CWT
 * config declares all four for nearly every type, so each becomes its own
 * entry. Nothing here has been verified against a live install; the table
 * is only as right as the upstream rules are.
 *
 * Path conflicts resolved at import time (two CWT types claiming one folder):
${wrap(" *   - ", conflicts)}
 */
import type { SchemaEntry } from "../../schema/types";

export const EU5_SCHEMA: SchemaEntry[] = [
${body.join("\n")}
];

// Not covered (importer skipped): CWT type constructs with no equivalent among
// the five NameExtraction modes. Importing them would yield wrong definition
// names rather than fewer, so they are dropped until a matching mode exists.
${wrap("//   - ", dropped)}
`;

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, out, "utf8");
// The output is committed, so it has to survive `pnpm run lint` (prettier
// --check); a few of the longest entries exceed printWidth on one line.
execSync(`npx prettier --write "${OUT_FILE}"`, { stdio: "inherit" });

console.log(`\ndropped ${dropped.length} types:`);
for (const d of dropped) console.log(`  - ${d}`);
console.log(`\npath conflicts (${conflicts.length}):`);
for (const c of conflicts) console.log(`  - ${c}`);
if (renamedKinds.length) console.log(`\nsnake-cased kinds: ${renamedKinds.join(", ")}`);
console.log(`\nwrote ${entries.length} entries / ${kinds.size} kinds -> ${OUT_FILE}`);
