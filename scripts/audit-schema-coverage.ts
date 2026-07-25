/**
 * Schema-coverage audit: compare the extension's knowledge (CK3_SCHEMA +
 * structures.json) against what the game actually ships — every `_*.info`
 * schema doc and every common/ subfolder — and report the gaps.
 *
 * For each uncovered folder the script also PROBES the on-disk layout
 * (parsing up to 3 vanilla files) to say whether the standard top-level
 * `name = { ... }` extraction would fit, i.e. whether adding a schema entry
 * is safe or needs a dedicated extraction mode.
 *
 * Run (see AGENTS.md "Regenerating bundled data"):
 *   npx esbuild scripts/audit-schema-coverage.ts --bundle --platform=node \
 *     --outfile=dist/audit-schema-coverage.cjs && node dist/audit-schema-coverage.cjs [gamePath]
 */
import * as fs from "fs";
import * as path from "path";
import { CK3_SCHEMA } from "../packages/server/src/games/ck3/schema";
import { parseScript } from "../packages/server/src/parser";
import structuresJson from "../packages/server/data/ck3/structures.json";
import { requireDevPath } from "./devPaths";

const gamePath = process.argv[2] ?? requireDevPath("gamePath", "audit-schema-coverage");

/** Folders the schema deliberately skips (see ck3Schema.ts "Not covered"). */
const INTENTIONAL = [
  "common/defines",
  "common/named_colors",
  "common/modifier_definition_formats",
  "common/genes",
  "common/ethnicities",
  "common/coat_of_arms/dynamic_definitions",
  "common/coat_of_arms/options",
  "common/coat_of_arms/template_lists",
  "common/dna_data",
  // engine/UI config, not script-referenced named definitions:
  "common/console_groups",
  "common/connection_arrows",
  "common/modifier_icons",
  "common/portrait_types",
  "common/graphical_unit_types",
  "common/ai_goaltypes",
  "common/guest_system",
  "common/courtier_guest_management",
  // portrait data (332 files), never referenced from script:
  "common/bookmark_portraits",
  // no parseable defs / non-standard layout (would need a dedicated mode):
  "common/accolade_icons",
  "common/artifacts/blueprints",
  "common/province_terrain",
  // history state keyed by DATES (identity = filename), unindexable as-is:
  "history/cultures",
  "history/situations",
  "history/struggles",
  // art/engine data, not script-referenced:
  "music",
  "dlc_metadata",
  "reader_export",
  "gfx/map/flat_map_styles",
  "gfx/map/province_effects",
  "gfx/map/table_styles",
  "gfx/models/units",
  "gfx/models/units/entity_links",
  "gfx/portraits/accessory_variations",
  "gfx/skins/hud_skins",
  "gfx/interface/illustrations/loading_screens",
];

function rel(p: string): string {
  return path.relative(gamePath, p).replace(/\\/g, "/").toLowerCase();
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const covered = (dir: string): boolean =>
  CK3_SCHEMA.some((e) => dir === e.path || dir.startsWith(e.path + "/") || e.path.startsWith(dir + "/"));
const intentional = (dir: string): boolean => INTENTIONAL.some((e) => dir === e || dir.startsWith(e + "/"));

/** Does the folder's layout fit the standard `name = { ... }` extraction? */
function probeFolder(dir: string): { files: number; defs: number; standard: boolean; sample: string[] } {
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".txt") && !e.name.startsWith("_"))
    .map((e) => path.join(dir, e.name));
  let defs = 0;
  let standard = files.length > 0;
  const sample: string[] = [];
  for (const f of files.slice(0, 3)) {
    try {
      const text = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
      const result = parseScript(text);
      for (const stmt of result.root.statements) {
        if (stmt.kind !== "assignment") continue;
        const isBlock = stmt.value?.kind === "block" || stmt.value?.kind === "tagged-block";
        const nameOk = /^[A-Za-z][A-Za-z0-9_.\-]*$/.test(stmt.key.text) && !stmt.key.text.startsWith("@");
        if (isBlock && nameOk) {
          defs++;
          if (sample.length < 3) sample.push(stmt.key.text);
        } else if (!stmt.key.text.startsWith("@")) {
          standard = false;
        }
      }
    } catch {
      standard = false;
    }
  }
  return { files: files.length, defs, standard, sample };
}

// ---- 1. every _*.info file vs schema coverage -------------------------------
const infoFiles = walk(gamePath).filter((p) => /_[^\\/]*\.info$/.test(p));
const uncoveredInfos: string[] = [];
for (const info of infoFiles) {
  const dir = rel(path.dirname(info));
  if (!covered(dir) && !intentional(dir)) uncoveredInfos.push(rel(info));
}

// ---- 2. every common/ subfolder with script files vs schema -----------------
interface Gap {
  dir: string;
  files: number;
  defs: number;
  standard: boolean;
  sample: string[];
  hasInfo: boolean;
}
const gaps: Gap[] = [];
const seen = new Set<string>();
const commonDirs = walk(path.join(gamePath, "common"))
  .filter((p) => p.endsWith(".txt") && !path.basename(p).startsWith("_"))
  .map((p) => rel(path.dirname(p)));
for (const dir of commonDirs) {
  if (seen.has(dir)) continue;
  seen.add(dir);
  if (covered(dir) || intentional(dir)) continue;
  const abs = path.join(gamePath, dir);
  const probe = probeFolder(abs);
  const hasInfo = fs.readdirSync(abs).some((n) => /^_.*\.info$/.test(n));
  gaps.push({ dir, ...probe, hasInfo });
}
gaps.sort((a, b) => b.defs - a.defs);

// ---- 3. schema kinds whose folder ships an .info but structures.json lacks them
const harvestedKinds = new Set(Object.keys((structuresJson as { kinds: Record<string, unknown> }).kinds));
const infoDirs = new Set(infoFiles.map((p) => rel(path.dirname(p))));
const kindsMissingHarvest: string[] = [];
for (const entry of CK3_SCHEMA) {
  if (harvestedKinds.has(entry.kind)) continue;
  if (infoDirs.has(entry.path) || [...infoDirs].some((d) => entry.path.startsWith(d + "/"))) {
    kindsMissingHarvest.push(`${entry.kind} (${entry.path})`);
  }
}

// ---- report ------------------------------------------------------------------
console.log(`# Schema coverage audit — ${new Date().toISOString().slice(0, 10)}`);
console.log(`game: ${gamePath}`);
console.log(`schema entries: ${CK3_SCHEMA.length} · .info files in game: ${infoFiles.length}`);
console.log(`structures.json kinds: ${harvestedKinds.size}`);
console.log("");
console.log(`## common/ folders with definitions but NO schema entry (${gaps.length})`);
for (const g of gaps) {
  console.log(
    `- ${g.dir}: ${g.files} files, ~${g.defs} defs${g.hasInfo ? ", has .info" : ""}` +
      ` · ${g.standard ? "STANDARD layout (safe to add)" : "non-standard layout (needs a mode)"}` +
      (g.sample.length ? ` · e.g. ${g.sample.join(", ")}` : "")
  );
}
console.log("");
console.log(`## .info files in folders without schema coverage (${uncoveredInfos.length})`);
for (const p of uncoveredInfos) console.log(`- ${p}`);
console.log("");
console.log(
  `## schema kinds with an .info in reach but missing from structures.json (${kindsMissingHarvest.length})`
);
for (const p of kindsMissingHarvest) console.log(`- ${p}`);
