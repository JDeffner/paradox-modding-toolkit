import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { sanitizeStringList } from "@px-lsp/protocol/suppression";
import { hasMetadataDescriptor } from "@px-lsp/protocol/descriptorMetadata";
import { findGameFolder } from "./steamDetect";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";

export interface PxConfig {
  /** Active game profile id: "ck3", or "vic3" behind px.vic3Preview. */
  gameId: string;
  /** Path to `Crusader Kings III/game`, or null if unset/invalid. */
  gamePath: string | null;
  /** Folder holding script_docs logs, or null if it cannot be found. */
  logsPath: string | null;
  /** ck3-tiger binary, or null (diagnostics disabled). */
  tigerPath: string | null;
  /** Mod folder; defaults to the first workspace folder that looks like a mod
   * (containers of mods expand to their child mods). */
  modPath: string | null;
  /** Parent/dependency mod roots: `px.parentMods` plus any additional
   * workspace mod (see workspaceMods). Load order, base first. */
  parentPaths: string[];
  /** Every mod root that comes from the workspace itself (folders that look
   * like mods, plus child mods of container folders), minus modPath. These are
   * the mods the user is EDITING — per-file features (tiger runs, loc writes,
   * reference indexing) treat them like the mod, unlike px.parentMods
   * dependencies which are read-only context. */
  workspaceMods: string[];
  /** `px.excludedMods`: workspace mod roots skipped entirely (sanitized). */
  excludedMods: string[];
  locLanguage: string;
  scopeInlayHints: boolean;
  tigerRunOn: "save" | "manual";
  enableForWorkspace: boolean;
  /** Diagnostic codes (ours + tiger keys) to suppress everywhere. */
  diagnosticsIgnore: string[];
  /** Glob patterns matched against workspace-relative paths to suppress. */
  diagnosticsIgnorePatterns: string[];
  /** When false (default) tiger/our diagnostics skip files under the game path. */
  diagnosticsVanilla: boolean;
  /** True when this workspace actually holds CK3 content (a mod or a game
   * install) and the extension is enabled — the gate for all visible UI
   * (status bar, sidebar views, palette commands). The machine-scope
   * px.gamePath setting deliberately does NOT count: it is set once per
   * machine and would light the extension up in every window. */
  isCk3Workspace: boolean;
  /** Human-readable problems found while validating paths. */
  warnings: string[];
}

/**
 * The Documents folder can be redirected away from %USERPROFILE%\Documents
 * (OneDrive, or a plain move to another drive), so ask the shell via the
 * registry first and fall back to the conventional location.
 */
function windowsDocumentsFolder(): string {
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
    const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
    if (m) {
      const expanded = m[1].trim().replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
      if (fs.existsSync(expanded)) return expanded;
    }
  } catch {
    // reg query unavailable or failed; use the conventional path.
  }
  return path.join(os.homedir(), "Documents");
}

function defaultLogsPath(docsFolderName: string, steamAppId: number): string | null {
  const suffix = ["Paradox Interactive", docsFolderName, "logs"];
  const candidates: string[] = [];
  if (process.platform === "win32") {
    candidates.push(path.join(windowsDocumentsFolder(), ...suffix));
  } else if (process.platform === "darwin") {
    candidates.push(path.join(os.homedir(), "Documents", ...suffix));
  } else {
    candidates.push(path.join(os.homedir(), ".local", "share", ...suffix));
    // Steam Proton prefix (documented fallback; the setting covers exotic setups).
    candidates.push(
      path.join(
        os.homedir(),
        `.steam/steam/steamapps/compatdata/${steamAppId}/pfx/drive_c/users/steamuser/Documents`,
        ...suffix
      )
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** A Vic3-style mod: metadata descriptor, no launcher .mod descriptor. */
function looksLikeMetadataMod(dir: string): boolean {
  try {
    return hasMetadataDescriptor(dir) && !fs.existsSync(path.join(dir, "descriptor.mod"));
  } catch {
    return false;
  }
}

export function readConfig(): PxConfig {
  const cfg = vscode.workspace.getConfiguration("px");
  const warnings: string[] = [];

  const readPath = (key: string, label: string): string | null => {
    const value = (cfg.get<string>(key) ?? "").trim();
    if (value === "") return null;
    if (!fs.existsSync(value)) {
      warnings.push(`${label} ("px.${key}") does not exist: ${value}`);
      return null;
    }
    return value;
  };

  // A CK3 game install opened as a workspace folder can stand in for an unset
  // or invalid px.gamePath (data dir directly, or the install root resolved to
  // its game/ subfolder). Not a warning: setup.ts reports the effective path.
  let workspaceGameDir: string | null = null;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const g = gameDataDir(folder.uri.fsPath);
    if (g) {
      workspaceGameDir = g;
      break;
    }
  }

  let gamePath = readPath("gamePath", "Game path") ?? workspaceGameDir;
  let logsPath = readPath("logsPath", "script_docs logs path");

  let tigerPath = readPath("tigerPath", "ck3-tiger path");

  let modPath = readPath("modPath", "Mod path");

  // `px.excludedMods`: workspace mods the user opted out of indexing.
  const excludedMods = sanitizeStringList(cfg.get("excludedMods"))
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const excludedKeys = new Set(excludedMods.map(normKey));
  const isExcluded = (p: string) => excludedKeys.has(normKey(p));

  // Mod roots contributed by the workspace: each folder that looks like a mod,
  // or — for a folder that HOLDS mods (the "one parent directory with 20 mod
  // folders" layout) — its direct children that look like mods. Excluded mods
  // are dropped here, so nothing downstream (indexing, tiger, views) sees them.
  const workspaceRoots: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    workspaceRoots.push(...expandModContainer(folder.uri.fsPath).filter((p) => !isExcluded(p)));
  }
  // An explicitly configured modPath may itself be such a container: expand it
  // and treat the first child as the mod so tiger/descriptor features work.
  if (modPath !== null && !looksLikeMod(modPath)) {
    const children = expandModContainer(modPath).filter((p) => !isExcluded(p));
    if (children.length > 0 && children[0].toLowerCase() !== modPath.toLowerCase()) {
      workspaceRoots.unshift(...children);
      modPath = children[0];
    }
  }
  if (modPath === null && (cfg.get<string>("modPath") ?? "").trim() === "") {
    // Default: the first workspace mod; a non-mod folder keeps the old
    // first-folder fallback so setup warnings stay meaningful. Game installs are
    // never a mod, so they never become the default modPath.
    const firstNonGameFolder = (vscode.workspace.workspaceFolders ?? [])
      .map((f) => f.uri.fsPath)
      .find((p) => !looksLikeGameDir(p) && !isExcluded(p));
    modPath = workspaceRoots[0] ?? firstNonGameFolder ?? null;
  }

  const workspaceMods: string[] = [];
  const seenWs = new Set<string>();
  for (const p of workspaceRoots) {
    const key = p.toLowerCase();
    if (seenWs.has(key)) continue;
    if (modPath && key === modPath.toLowerCase()) continue;
    if (gamePath && key === gamePath.toLowerCase()) continue;
    seenWs.add(key);
    workspaceMods.push(p);
  }

  // Parent mods (submod / compatibility-patch workflow): the explicit setting
  // first (load order), then every additional workspace mod — open the submod
  // plus its parents as workspace folders and the whole playset resolves,
  // CW Tools style.
  const parentPaths: string[] = [];
  const seenParents = new Set<string>();
  const addParent = (p: string) => {
    const key = p.toLowerCase();
    if (seenParents.has(key)) return;
    if (modPath && key === modPath.toLowerCase()) return;
    if (gamePath && key === gamePath.toLowerCase()) return;
    seenParents.add(key);
    parentPaths.push(p);
  };
  for (const raw of sanitizeStringList(cfg.get("parentMods"))) {
    const value = raw.trim();
    if (value === "") continue;
    if (!fs.existsSync(value)) {
      warnings.push(`Parent mod ("px.parentMods") does not exist: ${value}`);
      continue;
    }
    addParent(value);
  }
  for (const p of workspaceMods) addParent(p);

  // Game selection (M4 preview): a workspace whose mod-of-record carries a
  // .metadata/metadata.json descriptor (and no launcher .mod file) is a
  // Victoria 3 mod — honored only behind px.vic3Preview. The px.* path
  // settings describe CK3 and are deliberately IGNORED for a Vic3 workspace:
  // game/logs resolve from Steam/Documents, tiger from the vic3-tiger
  // download (see extension.ts).
  const vic3Preview = cfg.get<boolean>("vic3Preview") ?? false;
  const primaryRoot = modPath ?? workspaceRoots[0] ?? null;
  const gameId =
    vic3Preview && primaryRoot !== null && looksLikeMetadataMod(primaryRoot) ? vic3Meta.id : ck3Meta.id;
  if (gameId === vic3Meta.id) {
    gamePath = findGameFolder(vic3Meta.name);
    logsPath = defaultLogsPath(vic3Meta.docsFolderName, vic3Meta.steamAppId);
    tigerPath = null;
  } else if (logsPath === null && (cfg.get<string>("logsPath") ?? "").trim() === "") {
    logsPath = defaultLogsPath(ck3Meta.docsFolderName, ck3Meta.steamAppId);
  }

  const tigerRunOn = cfg.get<string>("tigerRunOn") === "manual" ? "manual" : "save";
  const enableForWorkspace = cfg.get<boolean>("enableForWorkspace") ?? true;
  const isCk3Workspace =
    enableForWorkspace &&
    (workspaceGameDir !== null || (modPath !== null && looksLikeMod(modPath)) || workspaceMods.length > 0);

  return {
    gameId,
    gamePath,
    logsPath,
    tigerPath,
    modPath,
    parentPaths,
    workspaceMods,
    excludedMods,
    locLanguage: (cfg.get<string>("locLanguage") ?? "english").trim().toLowerCase() || "english",
    scopeInlayHints: cfg.get<boolean>("scopeInlayHints") ?? false,
    tigerRunOn,
    enableForWorkspace,
    diagnosticsIgnore: sanitizeStringList(cfg.get("diagnostics.ignore")),
    diagnosticsIgnorePatterns: sanitizeStringList(cfg.get("diagnostics.ignorePatterns")),
    diagnosticsVanilla: cfg.get<boolean>("diagnostics.vanilla") ?? false,
    isCk3Workspace,
    warnings,
  };
}

/** Trailing-separator-free lowercase key for path comparisons. */
function normKey(p: string): string {
  return path
    .normalize(p)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/**
 * Every workspace mod root candidate, IGNORING `px.excludedMods` — the
 * exclusion picker needs the full list so excluded mods can be re-included.
 */
export function allWorkspaceModCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const p of expandModContainer(folder.uri.fsPath)) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/**
 * A workspace folder as a list of mod roots: itself when it looks like a mod,
 * else its direct children that do (a folder holding many mod folders).
 */
function expandModContainer(dir: string): string[] {
  // A game install shares the mod content dirs (common/, events/, ...) but is
  // never a mod; keep it and its game/ subfolder out of the mod roots.
  if (looksLikeGameDir(dir)) return [];
  if (looksLikeMod(dir)) return [dir];
  const mods: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (!isDirEntry(child, entry)) continue;
      if (looksLikeGameDir(child)) continue;
      if (looksLikeMod(child)) mods.push(child);
    }
  } catch {
    // Unreadable folder: contributes nothing.
  }
  return mods;
}

/**
 * True for a real directory AND for a symlink/junction resolving to one. A
 * Dirent reports a link as neither file nor directory, and symlinking a mod
 * into the Paradox `mod/` folder is the standard Linux workflow, so gating on
 * `isDirectory()` alone makes those mods invisible.
 */
function isDirEntry(full: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(full).isDirectory();
  } catch {
    return false; // dangling link
  }
}

/** The workspace mod root a file belongs to (modPath first), or null. */
export function modRootFor(file: string, cfg: PxConfig): string | null {
  for (const root of [cfg.modPath, ...cfg.workspaceMods]) {
    if (root && isUnder(root, file)) return root;
  }
  return null;
}

/** A folder counts as a mod if it has a descriptor (either convention) or the
 * usual content dirs. */
export function looksLikeMod(dir: string): boolean {
  try {
    if (fs.existsSync(path.join(dir, "descriptor.mod"))) return true;
    if (hasMetadataDescriptor(dir)) return true;
    return ["common", "events", "localization", "gui", "history"].some((d) =>
      fs.existsSync(path.join(dir, d))
    );
  } catch {
    return false;
  }
}

/**
 * The `game` data folder for a CK3 install directory, or null if `dir` is not a
 * game install. Two accepted shapes: the data dir itself (`.../Crusader Kings
 * III/game`) and the install root (`.../Crusader Kings III`, resolved to its
 * game/ child). Markers verified against a real install: the data dir carries
 * the engine artifacts checksum_manifest.txt + paths.settings; the root carries
 * binaries/ alongside the game/ data folder.
 */
export function gameDataDir(dir: string): string | null {
  try {
    if (
      fs.existsSync(path.join(dir, "checksum_manifest.txt")) &&
      fs.existsSync(path.join(dir, "paths.settings"))
    ) {
      return dir;
    }
    const child = path.join(dir, "game");
    if (
      fs.existsSync(path.join(dir, "binaries")) &&
      fs.existsSync(path.join(child, "checksum_manifest.txt"))
    ) {
      return child;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when `dir` is a CK3 game install (data dir or install root). */
export function looksLikeGameDir(dir: string): boolean {
  return gameDataDir(dir) !== null;
}

export function isUnder(root: string | null, file: string): boolean {
  if (!root) return false;
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
