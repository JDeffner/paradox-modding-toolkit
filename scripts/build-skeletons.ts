/**
 * Definition-skeleton builder: walks the vanilla tree and, for every definition
 * kind the active game's schema table knows, derives the canonical shape of ONE
 * definition of that kind from what the game's own files do. The measurement
 * itself is scripts/skeletonHarvest.ts (unit-tested); this file is the walk,
 * the classification and the emit.
 *
 * Emits packages/server/data/<gameId>/skeletons.json. Deterministic: files are
 * sorted, every tie is broken by count then name, and object keys are written
 * in sorted order, so two runs over an unchanged game folder differ only in
 * `meta.generated`. A game with no configured vanilla path writes an EMPTY
 * kinds table rather than failing, which is the honest answer for a game whose
 * files nobody here can measure.
 *
 * SHIPPED ARTIFACT: the output IS committed and inlined into the server bundle
 * (games/<id>/index.ts imports it).
 *
 * Run:
 *   npx esbuild scripts/build-skeletons.ts --bundle --platform=node \
 *     --outfile=dist/build-skeletons.cjs && node dist/build-skeletons.cjs [--game <id>]
 */
import * as fs from "fs";
import * as path from "path";
import { classifyFile } from "../packages/server/src/index/indexer";
import { decode } from "../packages/server/src/parser";
import { resolveProfile } from "../packages/server/src/games/registry";
import { setActiveProfile } from "../packages/server/src/games/active";
import {
  SKELETON_MAJORITY,
  type KindSkeleton,
  type SkeletonData,
} from "../packages/server/src/schema/skeletons";
import { SkeletonHarvest, SUPPORTED_EXTRACTION, type Extraction } from "./skeletonHarvest";
import { devPath, parseGameArg } from "./devPaths";

const { gameId } = parseGameArg(process.argv.slice(2));
const profile = resolveProfile(gameId);
setActiveProfile(profile);
const gamePath = devPath("gamePath", gameId);

function collect(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, out);
    else if (e.name.toLowerCase().endsWith(".txt") && !e.name.endsWith(".info")) out.push(full);
  }
}

const harvests = new Map<string, SkeletonHarvest>();

function scanTree(root: string): number {
  // Only the folders the schema table itself names, so a game's own layout
  // decides what is walked (and .txt-only keeps the gui/loc trees out).
  const roots = new Set<string>();
  for (const entry of profile.schema) {
    if ((entry.ext ?? ".txt") !== ".txt") continue;
    const first = entry.path.split("/")[0];
    if (first) roots.add(first);
  }
  const files: string[] = [];
  for (const dir of [...roots].sort()) collect(path.join(root, dir), files);

  let scanned = 0;
  for (const file of files) {
    const entry = classifyFile(root, file, profile.schema);
    if (!entry) continue;
    const extraction = entry.extraction ?? "top-level-key";
    if (!SUPPORTED_EXTRACTION.has(extraction)) continue;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    let harvest = harvests.get(entry.kind);
    if (!harvest) harvests.set(entry.kind, (harvest = new SkeletonHarvest()));
    harvest.addFile(decode(buf).text, extraction as Extraction);
    scanned++;
  }
  return scanned;
}

const sources: string[] = [];
if (gamePath) {
  const t0 = Date.now();
  const files = scanTree(gamePath);
  sources.push(`vanilla (${files} files)`);
  console.error(`scanned vanilla: ${files} files (${Date.now() - t0} ms)`);
} else {
  console.error(`no gamePath configured for ${gameId} — writing an empty skeleton table`);
}

const kinds: Record<string, KindSkeleton> = {};
const skipped: string[] = [];
for (const kind of [...harvests.keys()].sort()) {
  const harvest = harvests.get(kind)!;
  const skel = harvest.finish();
  if (skel) kinds[kind] = skel;
  else skipped.push(`${kind} (${harvest.sampled} definitions)`);
}

const data: SkeletonData = {
  meta: { generated: new Date().toISOString().slice(0, 10), sources, majority: SKELETON_MAJORITY },
  kinds,
};

const outFile = path.join(__dirname, "..", "packages", "server", "data", gameId, "skeletons.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(data));
console.error(
  `wrote ${outFile}: ${Object.keys(kinds).length} kinds, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`
);
for (const [kind, skel] of Object.entries(kinds).slice(0, 8)) {
  console.error(
    `  ${kind}: ${skel.keys.length} keys over ${skel.sampled} definitions` +
      `${skel.blocks ? `, blocks: ${Object.keys(skel.blocks).join(", ")}` : ""}`
  );
}
if (skipped.length > 0) console.error(`too few definitions to measure: ${skipped.join("; ")}`);
