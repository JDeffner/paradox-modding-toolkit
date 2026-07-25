/**
 * Build-time harvest of the PdxGui vocabulary from the vanilla gui/ tree:
 * which keys are used as widget/container blocks, and which properties each
 * carries (with usage counts for ranking). `type X = base { }` declarations
 * fold their property stats into the base type, so derived types enrich the
 * base vocabulary. Output: packages/server/data/ck3/guiSchema.json (bundled).
 *
 * Run:
 *   npx esbuild scripts/build-gui-schema.ts --bundle --platform=node \
 *     --outfile=dist/build-gui-schema.cjs && node dist/build-gui-schema.cjs [gamePath]
 */
import * as fs from "fs";
import * as path from "path";
import { decode, parseScript, type BlockNode, type Statement } from "../packages/server/src/parser";
import { requireDevPath } from "./devPaths";

const gamePath = process.argv[2] ?? requireDevPath("gamePath", "build-gui-schema");

const NAME_OK = /^[a-z][a-z0-9_]*$/;
const MAX_PROPS_PER_TYPE = 100;
const MIN_TYPE_COUNT = 2;
const MIN_PROP_COUNT = 2;

// --- Enum-value harvest thresholds (see header + report) ------------------
// A property qualifies as an enum only if EVERY observed scalar value (each
// `|`-segment) is a bare lowercase word token (NAME_OK) — i.e. the property is
// never seen holding a number, quoted string, path, %-size or [datafunction].
// Of the surviving tokens we keep those seen ≥ MIN_ENUM_VALUE_COUNT times, and
// accept the property when the kept set has 2..MAX_ENUM_VALUES members.
const MIN_ENUM_VALUE_COUNT = 3;
const MAX_ENUM_VALUES = 30;
const MIN_ENUM_DISTINCT = 2;
// A tiny fraction of dirty values is tolerated so a lone typo (vanilla ships
// `layoutpolicy_horizontal = expanding;`) does not disqualify an otherwise
// pure enum. Dirty values never enter the value list — only the frequent clean
// tokens do — so this only widens which PROPERTIES qualify, not their sets.
const MAX_ENUM_DIRTY_RATIO = 0.01;

interface EnumStat {
  counts: Map<string, number>;
  /** Values that were NOT clean enum tokens (numbers, paths, datafunctions…). */
  dirty: number;
  /** The property was seen with a `|`-combined value at least once. */
  combinable: boolean;
}
const enumStats = new Map<string, EnumStat>();

function recordValue(key: string, value: string): void {
  let stat = enumStats.get(key);
  if (!stat) enumStats.set(key, (stat = { counts: new Map(), dirty: 0, combinable: false }));
  if (value.length === 0) {
    stat.dirty++;
    return;
  }
  // Quotes are already stripped from scalar text, so a quoted anchor like
  // `"top|right"` is tested exactly as its bare form; free text ("My Window")
  // still fails NAME_OK on its spaces and disqualifies the property.
  const segments = value.split("|");
  if (segments.length > 1) stat.combinable = true;
  if (!segments.every((s) => NAME_OK.test(s))) {
    stat.dirty++;
    return;
  }
  for (const seg of segments) bump(stat.counts, seg);
}

/** Attribute blocks (`size = { 100% 100% }`) — data, never widget types. */
const ATTRIBUTE_BLOCKS = new Set([
  "size",
  "position",
  "framesize",
  "spriteborder",
  "color",
  "disabledcolor",
  "uv_scale",
  "margin",
  "padding",
  "mipmaplodbias",
  "modify_texture",
  "resizeparent",
  "cursor_properties",
  "min_width",
  "max_width",
  "spriteborder_top",
  "spriteborder_bottom",
]);

const typeCount = new Map<string, number>();
const baseOf = new Map<string, string>();
const props = new Map<string, Map<string, number>>();
const globalProps = new Map<string, number>();

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function childBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

function recordBlock(typeName: string, block: BlockNode): void {
  // A widget block carries key = value assignments; attribute blocks
  // (`size = { 100% 100% }`) hold bare scalars and are not widget types.
  if (ATTRIBUTE_BLOCKS.has(typeName)) return;
  if (!block.statements.some((s) => s.kind === "assignment")) return;
  bump(typeCount, typeName);
  let bag = props.get(typeName);
  if (!bag) props.set(typeName, (bag = new Map()));
  for (const child of block.statements) {
    if (child.kind !== "assignment" || child.key.quoted) continue;
    const key = child.key.text.toLowerCase();
    if (!NAME_OK.test(key)) continue;
    bump(bag, key);
    bump(globalProps, key);
    // Scalar RHS feeds the enum-value harvest (blocks/tagged-blocks are not
    // enum values). Values keep their original case; anchors etc. are lower.
    if (child.value && child.value.kind === "scalar") {
      recordValue(key, child.value.text.toLowerCase());
    }
  }
}

function walk(statements: Statement[]): void {
  let pendingDecl: string | null = null;
  for (const stmt of statements) {
    if (stmt.kind !== "assignment") {
      if (
        stmt.value.kind === "scalar" &&
        ["type", "template", "types", "block", "blockoverride"].includes(stmt.value.text.toLowerCase())
      ) {
        pendingDecl = stmt.value.text.toLowerCase();
      } else if (stmt.value.kind === "block") {
        walk(stmt.value.statements);
        pendingDecl = null;
      }
      continue;
    }
    const block = childBlock(stmt);
    if (!block) {
      pendingDecl = null;
      continue;
    }
    const key = stmt.key.text.toLowerCase();
    if (pendingDecl === "type" && stmt.value?.kind === "tagged-block") {
      // type X = base { ... }: stats fold into the BASE type.
      const base = stmt.value.tag.text.toLowerCase();
      if (NAME_OK.test(base)) {
        baseOf.set(key, base);
        recordBlock(base, block);
      }
    } else if (pendingDecl === null && NAME_OK.test(key)) {
      // Regular child widget: resolve derived types to their base for stats.
      recordBlock(baseOf.get(key) ?? key, block);
    }
    walk(block.statements);
    pendingDecl = null;
  }
}

const files: string[] = [];
const collect = (dir: string) => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full);
    else if (e.name.endsWith(".gui")) files.push(full);
  }
};
collect(path.join(gamePath, "gui"));

for (const file of files) {
  try {
    walk(parseScript(decode(fs.readFileSync(file)).text).root.statements);
  } catch {
    /* tolerant: skip unreadable file */
  }
}

const types: Record<string, { count: number; props: Record<string, number> }> = {};
for (const [name, count] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
  if (count < MIN_TYPE_COUNT) continue;
  const bag = props.get(name) ?? new Map();
  const kept = [...bag.entries()]
    .filter(([, n]) => n >= MIN_PROP_COUNT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PROPS_PER_TYPE);
  types[name] = { count, props: Object.fromEntries(kept) };
}
const global = Object.fromEntries([...globalProps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200));

// Enum properties: pure (never dirty) keys whose frequent value tokens form a
// small bounded set. Values sorted alphabetically for a stable, readable list.
const enums: Record<string, string[]> = {};
const enumCombinable: string[] = [];
for (const [key, stat] of [...enumStats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const cleanObs = [...stat.counts.values()].reduce((a, b) => a + b, 0);
  if (stat.dirty > (stat.dirty + cleanObs) * MAX_ENUM_DIRTY_RATIO) continue;
  const kept = [...stat.counts.entries()]
    .filter(([, n]) => n >= MIN_ENUM_VALUE_COUNT)
    .map(([v]) => v)
    .sort();
  if (kept.length < MIN_ENUM_DISTINCT || kept.length > MAX_ENUM_VALUES) continue;
  enums[key] = kept;
  if (stat.combinable) enumCombinable.push(key);
}

const out = {
  meta: { generated: new Date().toISOString().slice(0, 10), files: files.length },
  types,
  globalProps: global,
  enums,
  enumCombinable,
};
const target = path.join(__dirname, "..", "packages", "server", "data", "ck3", "guiSchema.json");
fs.writeFileSync(target, JSON.stringify(out, null, 1), "utf8");
console.log(
  `wrote ${target}: ${Object.keys(types).length} widget types, ` +
    `${Object.keys(enums).length} enum properties, from ${files.length} files`
);
