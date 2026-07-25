/**
 * CI guard for the GameProfile boundary (docs/PLAN.md §3): outside
 * packages/server/src/games/ and packages/vscode/, game-name strings may not
 * appear in engine/protocol source. This is what keeps the boundary from
 * rotting after M2.
 *
 * Allowlist entries are deliberate wire/user-file compatibility carve-outs,
 * each matched per line so new violations in the same file still fail.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOTS = ["packages/protocol/src", "packages/server/src"];
const EXCLUDED_DIRS = [path.join("packages", "server", "src", "games")];
const PATTERN = /ck3|crusader|vic3|victoria|hoi4|stellaris/i;

/** file (repo-relative, forward slashes) -> line-level allow pattern. */
const ALLOW = new Map();

const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.some((ex) => full === ex || full.startsWith(ex + path.sep))) continue;
      walk(full);
      continue;
    }
    if (!/\.(ts|mts|cts|js|mjs|json)$/.test(entry.name)) continue;
    const rel = full.split(path.sep).join("/");
    if (PATTERN.test(entry.name)) violations.push(`${rel}: game string in file name`);
    const allow = ALLOW.get(rel);
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!PATTERN.test(line)) return;
      if (allow && allow.test(line)) return;
      violations.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}

for (const root of ROOTS) walk(root);

if (violations.length > 0) {
  console.error(`Game-boundary violations (${violations.length}):`);
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nGame-specific strings belong in packages/server/src/games/<id>/ or packages/vscode/." +
      "\nDeliberate wire-compat exceptions go on the allowlist in scripts/check-game-boundary.mjs."
  );
  process.exit(1);
}
console.log("game boundary clean: no game strings outside games/ and vscode/");
