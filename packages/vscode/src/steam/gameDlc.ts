/**
 * The game's own DLC list, read from the install instead of from Steam.
 *
 * Every Jomini title ships one folder per DLC under `<gameDir>/dlc/`, each
 * holding a `.dlc` file with `name`, `path` and `steam_id` (verified on the
 * CK3 and Victoria 3 installs). Steam's DLC list for the same app also carries
 * Chapter bundles and the Subscription, which are not requirements a mod can
 * declare; those never get a folder here, so reading the install excludes them
 * by construction.
 *
 * Icons: the folder number (`dlc003_fp1` -> `003`) names a file in the game's
 * DLC icon folder, which each game's GameMeta points at (`dlcIconDir`). The
 * file is `dlc_003.dds` on CK3 and `dlc003.dds` on Victoria 3, so both
 * spellings are tried; a game whose install ships no icon there falls back to
 * the promo `thumbnail.png` inside the DLC folder itself.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";

export interface GameDlc {
  /** The DLC's Steam app id: what a Workshop item declares as a requirement. */
  steamId: number;
  name: string;
  /** Absolute path of the DLC's folder under `<gameDir>/dlc`. */
  dir: string;
  /** Absolute path of an image to show, or null when the install ships none. */
  iconPath: string | null;
}

/** `name` and `steam_id` of one `.dlc` file, or null when either is missing. */
export function parseDlcFile(text: string): { name: string; steamId: number } | null {
  const value = (key: string): string | null => {
    const m = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(?:"([^"]*)"|(\\S+))`, "m").exec(text);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };
  const name = value("name");
  const steamId = Number.parseInt(value("steam_id") ?? "", 10);
  if (!name || !Number.isInteger(steamId) || steamId <= 0) return null;
  return { name, steamId };
}

/** The three-digit number of a DLC folder name (`dlc003_fp1` -> `003`), or null. */
export function dlcFolderNumber(folder: string): string | null {
  const m = /^dlc(\d+)/i.exec(folder);
  return m ? m[1].padStart(3, "0").slice(-3) : null;
}

/**
 * Every DLC the install carries, by folder order (which is release order).
 * An unreadable or absent `dlc/` folder yields an empty list, and the caller
 * then falls back to asking Steam.
 */
export function readGameDlc(gameDir: string, iconDir: string | undefined): GameDlc[] {
  const root = path.join(gameDir, "dlc");
  let folders: fs.Dirent[];
  try {
    folders = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: GameDlc[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = path.join(root, folder.name);
    let parsed: ReturnType<typeof parseDlcFile> = null;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".dlc")) continue;
      try {
        parsed = parseDlcFile(fs.readFileSync(path.join(dir, name), "utf8"));
      } catch {
        parsed = null;
      }
      if (parsed) break;
    }
    if (!parsed) continue;
    out.push({ ...parsed, dir, iconPath: dlcIconPath(gameDir, dir, folder.name, iconDir) });
  }
  return out;
}

function dlcIconPath(
  gameDir: string,
  dlcDir: string,
  folderName: string,
  iconDir: string | undefined
): string | null {
  const num = dlcFolderNumber(folderName);
  const candidates: string[] = [];
  if (iconDir && num) {
    candidates.push(
      path.join(gameDir, iconDir, `dlc_${num}.dds`),
      path.join(gameDir, iconDir, `dlc${num}.dds`)
    );
  }
  candidates.push(path.join(dlcDir, "thumbnail.png"));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
