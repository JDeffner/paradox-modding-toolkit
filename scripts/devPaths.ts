/**
 * Machine-specific paths for dev scripts and corpus-gated tests, resolved from
 * ONE central place so no personal path is ever hardcoded in the repo:
 *
 *   1. environment variable `PX_<GAMEID>_<KEY>` (CI, one-off overrides);
 *   2. the legacy `CK3_<KEY>` env var (ck3 only, kept working);
 *   3. `dev-paths.json` at the repo root, `games.<gameId>.<slot>`
 *      (gitignored; copy dev-paths.example.json);
 *   4. the legacy flat `dev-paths.json` slots (ck3 only, kept working);
 *   5. null — tests skip, scripts print usage and exit.
 *
 * Every accessor takes an optional game id and defaults to "ck3", so callers
 * that predate multi-game support behave exactly as before.
 *
 * The extension itself never reads this: at runtime paths come from the user's
 * VS Code settings with auto-inference (packages/vscode/src/setup).
 */
import * as fs from "fs";
import * as path from "path";

/** key → env-var suffix; the dev-paths.json slot name matches the key, except
 * corpusPath, whose per-game slot is spelled `modCorpus` (the flat legacy shape
 * used `corpusPath`, and both spellings are accepted). */
const ENV_SUFFIX = {
  /** The game's `game/` data folder (…/steamapps/common/<Game>/game). */
  gamePath: "GAME_PATH",
  /** The game's logs folder holding the `script_docs` dumps and error.log. */
  logsPath: "LOGS_PATH",
  /** Your own mod's folder (default subject for the audit scripts). */
  modPath: "MOD_PATH",
  /** A large third-party mod used as eval corpus (rank-eval, modCorpus tests). */
  corpusPath: "MOD_CORPUS",
  /** The tiger binary, for gen-skill's `<tiger>` placeholder. */
  tigerPath: "TIGER_PATH",
} as const;

/** dev-paths.json slot name for a key (per-game shape). */
const SLOT: Record<DevPathKey, string> = {
  gamePath: "gamePath",
  logsPath: "logsPath",
  modPath: "modPath",
  corpusPath: "modCorpus",
  tigerPath: "tigerPath",
};

export type DevPathKey = keyof typeof ENV_SUFFIX;

export const DEFAULT_GAME_ID = "ck3";

type GameSlots = Record<string, string | undefined>;
type DevPathsFile = GameSlots & { games?: Record<string, GameSlots> };

// __dirname is scripts/ under vitest/tsx and dist/ in esbuild-bundled scripts —
// one level below the repo root either way.
const CONFIG_FILE = path.join(__dirname, "..", "dev-paths.json");

let fileConfig: DevPathsFile | null = null;

function configFromFile(): DevPathsFile {
  if (fileConfig === null) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as DevPathsFile;
    } catch {
      fileConfig = {};
    }
  }
  return fileConfig;
}

function envName(gameId: string, key: DevPathKey): string {
  return `PX_${gameId.toUpperCase()}_${ENV_SUFFIX[key]}`;
}

/** The configured path, or null when neither env var nor dev-paths.json has it. */
export function devPath(key: DevPathKey, gameId: string = DEFAULT_GAME_ID): string | null {
  const legacy = gameId === DEFAULT_GAME_ID;
  const config = configFromFile();
  const slots = config.games?.[gameId];
  return (
    process.env[envName(gameId, key)] ??
    (legacy ? process.env[`CK3_${ENV_SUFFIX[key]}`] : undefined) ??
    slots?.[SLOT[key]] ??
    slots?.[key] ??
    (legacy ? config[key] : undefined) ??
    null
  );
}

/** As devPath, but exits with a usage message — for scripts that cannot run without it. */
export function requireDevPath(
  key: DevPathKey,
  scriptName: string,
  gameId: string = DEFAULT_GAME_ID
): string {
  const value = devPath(key, gameId);
  if (!value) {
    console.error(
      `${scriptName}: no ${key} configured for ${gameId} — pass it as an argument, ` +
        `set ${envName(gameId, key)}, or add "${SLOT[key]}" under games.${gameId} in ` +
        `dev-paths.json (copy dev-paths.example.json).`
    );
    process.exit(1);
  }
  return value;
}

/** `--game <id>` from argv, defaulting to ck3; returns the id and argv without it. */
export function parseGameArg(argv: string[]): { gameId: string; rest: string[] } {
  const rest: string[] = [];
  let gameId = DEFAULT_GAME_ID;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--game" && argv[i + 1]) {
      gameId = argv[++i];
    } else if (argv[i].startsWith("--game=")) {
      gameId = argv[i].slice("--game=".length);
    } else {
      rest.push(argv[i]);
    }
  }
  return { gameId, rest };
}
