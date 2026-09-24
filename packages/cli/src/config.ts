import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { gameMetas } from "@px-lsp/server/games/metaRegistry";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { findGameFolder } from "@px-lsp/protocol/steam";
import { resolveConfigDir } from "@px-lsp/protocol/configDir";
import { ToolError } from "./errors";

export const configSchema = z
  .object({
    game: z.string().min(1).optional(),
    mod: z.string().min(1).optional(),
    gamePath: z.string().min(1).nullable().optional(),
    logsPath: z.string().min(1).nullable().optional(),
    tigerPath: z.string().min(1).nullable().optional(),
    parents: z.array(z.string().min(1)).optional(),
    language: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
    tigerConfig: z.string().min(1).nullable().optional(),
    timeout: z.number().int().min(1).max(3600).optional(),
  })
  .strict();
export type ConfigInput = z.infer<typeof configSchema>;
export interface Configuration {
  game: string;
  meta: GameMeta;
  mod: string;
  gamePath: string | null;
  logsPath: string | null;
  tigerPath: string | null;
  tigerConfig: string | null;
  parents: string[];
  language: string;
  timeoutMs: number;
  configFile: string | null;
  issues: string[];
}
export interface ResolveOptions {
  config?: string;
  cwd?: string;
  overrides?: ConfigInput;
  env?: NodeJS.ProcessEnv;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function findConfig(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    const file = path.join(dir, ".px-toolkit", "pxtk.json");
    if (await exists(file)) return file;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
export function isWithin(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel));
}
function documentsFolder(): string {
  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "reg",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
          "/v",
          "Personal",
        ],
        { encoding: "utf8", windowsHide: true }
      );
      const match = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
      if (match)
        return match[1].trim().replace(/%([^%]+)%/g, (_, key: string) => process.env[key] ?? `%${key}%`);
    } catch {
      /* Non-Windows hosts and absent registry values use the conventional directory. */
    }
  }
  return path.join(os.homedir(), "Documents");
}
export async function resolveConfig(options: ResolveOptions = {}): Promise<Configuration> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const configFile = options.config ? path.resolve(cwd, options.config) : await findConfig(cwd);
  const configDir = configFile ? path.dirname(configFile) : cwd;
  const fileBase =
    configFile && path.basename(configDir) === ".px-toolkit" ? path.dirname(configDir) : configDir;
  let file: ConfigInput = {};
  if (configFile) {
    try {
      file = configSchema.parse(JSON.parse((await fs.readFile(configFile, "utf8")).replace(/^\uFEFF/, "")));
    } catch (error) {
      throw new ToolError("invalid_config", `Cannot read ${configFile}: ${String(error)}`);
    }
  }
  const flags = configSchema.parse(options.overrides ?? {});
  const game = flags.game ?? env.PX_GAME_ID ?? file.game;
  if (!game || !Object.hasOwn(gameMetas, game))
    throw new ToolError(
      "game_required",
      `Select a supported game with --game or the config file: ${Object.keys(gameMetas).join(", ")}.`
    );
  const meta = gameMetas[game];
  const prefix = `PX_${game.toUpperCase()}_`;
  function resolved(
    key: "mod" | "gamePath" | "logsPath" | "tigerPath" | "tigerConfig",
    envKey: string
  ): string | null | undefined {
    if (flags[key] !== undefined) return flags[key] === null ? null : path.resolve(cwd, flags[key]);
    if (env[prefix + envKey]) return path.resolve(cwd, env[prefix + envKey]!);
    return file[key] === undefined
      ? undefined
      : file[key] === null
        ? null
        : path.resolve(fileBase, file[key]);
  }
  const issues: string[] = [];
  async function directory(value: string | null | undefined, label: string): Promise<string | null> {
    if (!value) return null;
    try {
      const real = await fs.realpath(value);
      if (!(await fs.stat(real)).isDirectory()) throw new Error("not a directory");
      return real;
    } catch (error) {
      issues.push(`${label}: ${value} (${String(error)})`);
      return null;
    }
  }
  const modInput = resolved("mod", "MOD_PATH") ?? fileBase;
  const mod = (await directory(modInput, "Mod folder")) ?? path.resolve(modInput);
  const descriptor = meta.descriptor === "mod" ? "descriptor.mod" : ".metadata/metadata.json";
  if (!(await exists(path.join(mod, descriptor))))
    issues.push(`Mod descriptor missing: ${path.join(mod, descriptor)}`);
  const configuredGame = resolved("gamePath", "GAME_PATH");
  let gamePath = await directory(
    configuredGame === undefined ? findGameFolder(meta.docsFolderName) : configuredGame,
    "Game folder"
  );
  if (gamePath && (await exists(path.join(gamePath, "game"))))
    gamePath = await directory(path.join(gamePath, "game"), "Game data");
  const configuredLogs = resolved("logsPath", "LOGS_PATH");
  const defaultLogs = path.join(
    documentsFolder(),
    "Paradox Interactive",
    meta.docsFolderName,
    meta.scriptDocsSubdir ?? "logs"
  );
  const logsPath = await directory(
    configuredLogs === undefined ? ((await exists(defaultLogs)) ? defaultLogs : null) : configuredLogs,
    "Script docs"
  );
  const parentBase = flags.parents ? cwd : fileBase;
  const parents: string[] = [];
  for (const parent of flags.parents ?? file.parents ?? []) {
    const dir = await directory(path.resolve(parentBase, parent), "Dependency mod");
    if (dir) parents.push(dir);
  }
  // The LSP merges this overlay after the configured parents. Tiger must see
  // the same ordered roots, including when a project already uses the editor.
  const playset = path.join(resolveConfigDir(mod, meta), "playset.json");
  if (await exists(playset)) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(playset, "utf8"));
      const list = z.union([z.array(z.string()), z.object({ parents: z.array(z.string()) })]).parse(parsed);
      for (const parent of Array.isArray(list) ? list : list.parents) {
        const dir = await directory(path.resolve(mod, parent), "Playset dependency");
        if (dir) parents.push(dir);
      }
    } catch (error) {
      issues.push(`Cannot read ${playset}: ${String(error)}`);
    }
  }
  parents.splice(
    0,
    parents.length,
    ...parents.filter(
      (parent, index) => parents.findIndex((other) => other.toLowerCase() === parent.toLowerCase()) === index
    )
  );
  for (const readOnly of [gamePath, ...parents].filter((x): x is string => x !== null)) {
    if (isWithin(readOnly, mod) || isWithin(mod, readOnly))
      issues.push(`Editable mod and read-only source overlap: ${readOnly}`);
  }
  const tigerPath = resolved("tigerPath", "TIGER_PATH") ?? null;
  const tigerConfig = resolved("tigerConfig", "TIGER_CONFIG") ?? null;
  for (const supplied of [tigerPath, tigerConfig]) {
    if (supplied && !(await exists(supplied))) issues.push(`File does not exist: ${supplied}`);
  }
  return {
    game,
    meta,
    mod,
    gamePath,
    logsPath,
    tigerPath,
    tigerConfig,
    parents,
    language: flags.language ?? file.language ?? "english",
    timeoutMs: (flags.timeout ?? file.timeout ?? 300) * 1000,
    configFile,
    issues,
  };
}
export function requireWorkspace(config: Configuration): void {
  if (config.issues.length) throw new ToolError("invalid_workspace", config.issues.join("\n"));
}
export function digest(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}
