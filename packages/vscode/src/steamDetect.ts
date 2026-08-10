/**
 * Locate the CK3 installation automatically: Steam's install path from the
 * registry (or platform defaults), then every library folder from
 * libraryfolders.vdf, then the game folder inside one of them.
 *
 * Pure parsing is separated from filesystem probing for unit tests.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

/** Library root paths out of a Steam libraryfolders.vdf. */
export function parseLibraryFoldersVdf(content: string): string[] {
  const roots: string[] = [];
  const re = /"path"\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    roots.push(m[1].replace(/\\\\/g, "\\"));
  }
  return roots;
}

function regQuery(keyPath: string, value: string): string | null {
  try {
    const out = execFileSync("reg", ["query", keyPath, "/v", value], { encoding: "utf8", windowsHide: true });
    const m = new RegExp(`${value}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`).exec(out);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/** Steam's own install folder, or null. */
export function findSteamRoot(): string | null {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const hkcu = regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath");
    if (hkcu) candidates.push(hkcu.replace(/\//g, "\\"));
    const hklm = regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath");
    if (hklm) candidates.push(hklm);
    candidates.push("C:\\Program Files (x86)\\Steam");
  } else if (process.platform === "darwin") {
    candidates.push(path.join(os.homedir(), "Library", "Application Support", "Steam"));
  } else {
    candidates.push(path.join(os.homedir(), ".steam", "steam"));
    candidates.push(path.join(os.homedir(), ".local", "share", "Steam"));
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** All Steam library roots (the main install plus everything in libraryfolders.vdf). */
export function findSteamLibraries(): string[] {
  const root = findSteamRoot();
  if (!root) return [];
  const libraries = new Set<string>([root]);
  try {
    const vdf = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const lib of parseLibraryFoldersVdf(vdf)) {
      if (fs.existsSync(lib)) libraries.add(lib);
    }
  } catch {
    // No vdf: fall back to just the root.
  }
  return [...libraries];
}

/** A game's `game` data folder by Steam folder name ("Crusader Kings III",
 * "Victoria 3"), or null when not found in any library. */
export function findGameFolder(steamFolderName: string): string | null {
  for (const lib of findSteamLibraries()) {
    const game = path.join(lib, "steamapps", "common", steamFolderName, "game");
    if (fs.existsSync(game)) return game;
  }
  return null;
}

/** The CK3 `game` data folder, or null if the game is not found in any library. */
export function findCk3GamePath(): string | null {
  return findGameFolder("Crusader Kings III");
}
