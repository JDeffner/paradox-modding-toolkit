/**
 * Machine-specific paths for dev scripts and corpus-gated tests, resolved from
 * ONE central place so no personal path is ever hardcoded in the repo:
 *
 *   1. environment variable (CI, one-off overrides);
 *   2. dev-paths.json at the repo root (gitignored; copy dev-paths.example.json);
 *   3. null — tests skip, scripts print usage and exit.
 *
 * The extension itself never reads this: at runtime paths come from the user's
 * VS Code settings with auto-inference (packages/vscode/src/setup).
 */
import * as fs from "fs";
import * as path from "path";

const ENV_VARS = {
  /** The game's `game/` data folder (…/steamapps/common/Crusader Kings III/game). */
  gamePath: "CK3_GAME_PATH",
  /** The game's logs folder holding the `script_docs` dumps and error.log. */
  logsPath: "CK3_LOGS_PATH",
  /** Your own mod's folder (default subject for the audit scripts). */
  modPath: "CK3_MOD_PATH",
  /** A large third-party mod used as eval corpus (rank-eval, modCorpus tests). */
  corpusPath: "CK3_MOD_CORPUS",
  /** The ck3-tiger binary, for gen-skill's `<tiger>` placeholder. */
  tigerPath: "CK3_TIGER_PATH",
} as const;

export type DevPathKey = keyof typeof ENV_VARS;

// __dirname is scripts/ under vitest/tsx and dist/ in esbuild-bundled scripts —
// one level below the repo root either way.
const CONFIG_FILE = path.join(__dirname, "..", "dev-paths.json");

let fileConfig: Partial<Record<DevPathKey, string>> | null = null;

function configFromFile(): Partial<Record<DevPathKey, string>> {
  if (fileConfig === null) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch {
      fileConfig = {};
    }
  }
  return fileConfig!;
}

/** The configured path, or null when neither env var nor dev-paths.json has it. */
export function devPath(key: DevPathKey): string | null {
  return process.env[ENV_VARS[key]] ?? configFromFile()[key] ?? null;
}

/** As devPath, but exits with a usage message — for scripts that cannot run without it. */
export function requireDevPath(key: DevPathKey, scriptName: string): string {
  const value = devPath(key);
  if (!value) {
    console.error(
      `${scriptName}: no ${key} configured — pass it as an argument, set ${ENV_VARS[key]}, ` +
        `or add "${key}" to dev-paths.json (copy dev-paths.example.json).`
    );
    process.exit(1);
  }
  return value;
}
