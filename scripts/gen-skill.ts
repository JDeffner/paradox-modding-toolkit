/**
 * Personalized-skill generator. The skill at `skills/ck3-modding/` is a portable template that
 * uses the placeholders `<game>`, `<logs>`, `<mods>`, `<workshop>`, `<tiger>`; this script writes
 * a machine-specific copy with those substituted for the paths in dev-paths.json, normalizing all
 * line endings to LF. The template is the single source of truth — never hand-edit a generated copy.
 *
 * Placeholder derivation (from dev-paths.json):
 *   <game>     = gamePath  (the …/Crusader Kings III/game DATA dir — every `<game>\…` reference in
 *                the skill depends on this; the install ROOT is its parent, derived where needed)
 *   <logs>     = logsPath
 *   <mods>     = sibling `mod` dir of logsPath
 *   <workshop> = <steam library>/steamapps/workshop/content/1158310 (from gamePath)
 *   <tiger>    = tigerPath if set, else a clearly-marked placeholder the user must fill in
 *
 * Run (no npm script — same esbuild+node dance as the other scripts/ harvests, see AGENTS.md):
 *   npx esbuild scripts/gen-skill.ts --bundle --platform=node --outfile=dist/gen-skill.cjs \
 *     && node dist/gen-skill.cjs [destDir]
 *   (destDir defaults to C:\Users\joeld\.claude\skills\ck3-modding; pass a temp dir when testing.)
 */
import * as fs from "fs";
import * as path from "path";
import { devPath } from "./devPaths";

export interface DevPaths {
  gamePath: string;
  logsPath: string;
  tigerPath?: string;
}

export interface GenResult {
  filesWritten: number;
  substitutions: number;
  /** Any of the five tokens still present after substitution (should always be empty). */
  unresolved: string[];
  /** True when tigerPath was missing and `<tiger>` fell back to a marker. */
  tigerMissing: boolean;
}

const TOKENS = ["<game>", "<logs>", "<mods>", "<workshop>", "<tiger>"] as const;
const TIGER_MARKER = "<SET tigerPath IN dev-paths.json>";

/** Windows-style path (backslashes), matching the skill's own path notation. */
const toWin = (p: string): string => p.replace(/\//g, "\\").replace(/\\+/g, "\\");

/** …/steamapps/workshop/content/1158310, derived from the game data dir. */
function deriveWorkshop(gamePath: string): string {
  const parts = gamePath.replace(/\\/g, "/").split("/");
  const i = parts.lastIndexOf("steamapps");
  if (i === -1) return "<workshop: gamePath has no steamapps/ segment>";
  return [...parts.slice(0, i + 1), "workshop", "content", "1158310"].join("/");
}

/** Sibling `mod` folder of the logs folder. */
function deriveMods(logsPath: string): string {
  const parts = logsPath.replace(/\\/g, "/").split("/");
  parts[parts.length - 1] = "mod";
  return parts.join("/");
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Core routine, exported so tests can drive it with a fake DevPaths into a temp dir. */
export function generateSkill(paths: DevPaths, srcDir: string, destDir: string): GenResult {
  const tigerMissing = !paths.tigerPath;
  const values: Record<(typeof TOKENS)[number], string> = {
    "<game>": toWin(paths.gamePath),
    "<logs>": toWin(paths.logsPath),
    "<mods>": toWin(deriveMods(paths.logsPath)),
    "<workshop>": toWin(deriveWorkshop(paths.gamePath)),
    "<tiger>": tigerMissing ? TIGER_MARKER : toWin(paths.tigerPath!),
  };

  let substitutions = 0;
  const unresolved = new Set<string>();
  const files = collectFiles(srcDir);

  for (const file of files) {
    const rel = path.relative(srcDir, file);
    let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const token of TOKENS) {
      const hits = text.split(token).length - 1;
      if (hits > 0) {
        substitutions += hits;
        text = text.split(token).join(values[token]);
      }
    }
    for (const token of TOKENS) if (text.includes(token)) unresolved.add(`${rel}: ${token}`);

    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, "utf8");
  }

  return { filesWritten: files.length, substitutions, unresolved: [...unresolved], tigerMissing };
}

function main(): void {
  const repoRoot = path.join(__dirname, "..");
  const srcDir = path.join(repoRoot, "packages", "vscode", "skills", "ck3-modding");
  const destDir = process.argv[2] ?? "C:/Users/joeld/.claude/skills/ck3-modding";

  // Via devPaths so env-var overrides work here like everywhere else; reading
  // dev-paths.json directly is what let tigerPath drift out of its schema.
  const cfg: DevPaths = {
    gamePath: devPath("gamePath") ?? "",
    logsPath: devPath("logsPath") ?? "",
    tigerPath: devPath("tigerPath") ?? undefined,
  };
  if (!cfg.gamePath || !cfg.logsPath) {
    console.error("gen-skill: dev-paths.json needs gamePath and logsPath.");
    process.exit(1);
  }

  const r = generateSkill(cfg, srcDir, destDir);
  console.log(`gen-skill: wrote ${r.filesWritten} files to ${destDir} (${r.substitutions} substitutions).`);
  if (r.tigerMissing) {
    console.warn(`gen-skill: WARNING no tigerPath in dev-paths.json — <tiger> left as "${TIGER_MARKER}".`);
  }
  if (r.unresolved.length) {
    console.warn(`gen-skill: WARNING ${r.unresolved.length} unresolved placeholder(s):`);
    for (const u of r.unresolved) console.warn(`  ${u}`);
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main();
}
