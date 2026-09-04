/**
 * Pictures for the visual creators: a game-relative asset path in, a URL the
 * webview may load out.
 *
 * The creators all need the same thing (a trait's icon, a legacy's track
 * picture, a tradition's sprite) and it is the same thing the GUI editor
 * already solved: the host resolves the path against the load-order roots,
 * decodes DDS/TGA to PNG through the shared `GuiTextureCache`, and hands the
 * webview a `webview.asWebviewUri` of the decoded file. The cache dir must be
 * in the panel's `localResourceRoots` (see `flagBuilder/panel.ts`).
 *
 * Load order, not search order: the LAST root that has the file wins, which is
 * the game's own rule (mods override the game, and a later mod overrides an
 * earlier one), so the roots arrive game-first.
 */
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import type { GuiTextureCache } from "../webviews/guiEditor/textureCache";
import type { CreatorImagesRequest } from "../webviews/shared/creatorMessages";
import { CONVERTIBLE_IMAGE_EXT, convertImageToDds } from "../ddsConvert";

/** One place assets are looked up in: the game folder, or a mod's root. */
export interface ImageRoot {
  /** "game" or the mod's descriptor name; for messages, not for resolution. */
  label: string;
  path: string;
}

/**
 * True for a path that stays inside a root. `rel` comes out of a webview
 * message, so an absolute path or a `..` segment is REFUSED rather than read:
 * without this a creator would be a file reader for anything on the machine
 * (the same guard `flagBuilder/database.ts` puts on its texture names).
 */
function safeRelative(rel: string): boolean {
  if (rel === "" || rel.includes("\\") || rel.includes("\0")) return false;
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return false;
  return !rel.split("/").includes("..");
}

/**
 * The decoded PNG for a game-relative asset path, or null when no root has it
 * (or the file is not a picture the decoder reads). `maxDim` caps the decode's
 * longest edge: a grid of thumbnails must not pay a full-size decode each.
 */
export function resolveImage(
  roots: readonly ImageRoot[],
  rel: string,
  maxDim: number,
  textures: GuiTextureCache
): string | null {
  if (!safeRelative(rel)) return null;
  for (let i = roots.length - 1; i >= 0; i--) {
    const abs = path.join(roots[i].path, rel);
    if (!fs.existsSync(abs)) continue;
    const png = textures.resolveFile(abs, maxDim);
    if (png) return png;
  }
  return null;
}

/** `resolveImage` with the decode on a worker thread (textureCache.resolveFileAsync). */
async function resolveImageAsync(
  roots: readonly ImageRoot[],
  rel: string,
  maxDim: number,
  textures: GuiTextureCache
): Promise<string | null> {
  if (!safeRelative(rel)) return null;
  for (let i = roots.length - 1; i >= 0; i--) {
    const abs = path.join(roots[i].path, rel);
    if (!fs.existsSync(abs)) continue;
    const png = await textures.resolveFileAsync(abs, maxDim);
    if (png) return png;
  }
  return null;
}

/**
 * Answer one `{ type: "images" }` request on `panel`: the pattern every creator
 * panel's message switch calls, so the resolution, the safety guard and the
 * reply shape are written once. The decodes run off the extension host: a
 * tradition layer folder is 81 files of 545x285, and a synchronous loop over
 * them kept every other request of VS Code waiting.
 */
export function wireImages(
  panel: vscode.WebviewPanel,
  roots: readonly ImageRoot[],
  textures: GuiTextureCache,
  message: CreatorImagesRequest
): void {
  const maxDim = message.maxDim ?? 0;
  void Promise.all(message.keys.map((key) => resolveImageAsync(roots, key, maxDim, textures))).then(
    (files) => {
      const urls: Record<string, string | null> = {};
      message.keys.forEach((key, i) => {
        const png = files[i];
        urls[key] = png ? panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
      });
      try {
        void panel.webview.postMessage({
          type: "images",
          urls,
          ...(message.maxDim !== undefined ? { maxDim } : {}),
        });
      } catch {
        // The panel closed while the decodes ran; nobody is waiting for them.
      }
    }
  );
}

// ---------------------------------------------------------------------------
// A picture of the modder's own, into the mod
// ---------------------------------------------------------------------------

/** Every picture a creator's "Custom picture…" dialog accepts. */
export const IMPORT_IMAGE_EXT = [...CONVERTIBLE_IMAGE_EXT, "tga", "dds"];

export interface ImportPictureOptions {
  /** The mod the picture goes into: the one the definition is saved to. */
  modPath: string;
  /** Where the game reads the picture from, mod-relative (`gfx/interface/icons/traits`). */
  folder: string;
  /** The file name the game derives, without extension (the definition's key). */
  name: string;
  /** The dialog's title ("Picture for brave"). */
  title: string;
  /** Decodes a TGA (the game's other picture format) to PNG on the way in. */
  textures: GuiTextureCache;
}

export interface ImportedPicture {
  abs: string;
  /** Mod-relative, forward slashes: what a definition or a toast names. */
  rel: string;
  /** True when it landed in `folder`, where the game finds it by name. */
  inPlace: boolean;
}

/**
 * The folder the modder chose the last time they did not take the default,
 * per game folder, for the session: a modder keeping their art under one
 * folder of their own should not have to browse to it for every picture.
 */
const chosenDirs = new Map<string, string>();

/**
 * Ask for a picture, ask where it goes, and write it as DDS.
 *
 * Any format Chromium decodes is accepted (PNG, JPEG, WebP, GIF, BMP, AVIF,
 * ICO, SVG) and turned into a DDS by the toolkit's own encoder; a TGA is
 * decoded by the texture cache first; a DDS is copied as it is. The default
 * destination is `<folder>/<name>.dds` in the mod, which is the path the game
 * builds from the key. "Another folder" writes the same DDS elsewhere in the
 * mod, for a modder who keeps their own art tree and references it by hand.
 *
 * Returns null when the modder cancelled; throws with a readable message when
 * the write failed (the caller toasts it).
 */
export async function importPicture(o: ImportPictureOptions): Promise<ImportedPicture | null> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Images: IMPORT_IMAGE_EXT },
    title: o.title,
  });
  const source = picked?.[0]?.fsPath;
  if (!source) return null;

  const defaultDir = path.join(o.modPath, ...o.folder.split("/"));
  const OTHER = "$(folder-opened) Another folder in the mod…";
  const remembered = chosenDirs.get(o.folder);
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: `$(folder) ${o.folder}/${o.name}.dds`,
        description: "where the game looks for it, by the key's name",
        dir: defaultDir,
      },
      ...(remembered
        ? [
            {
              label: `$(folder) ${toRel(o.modPath, remembered)}/${o.name}.dds`,
              description: "the folder you chose last time",
              dir: remembered,
            },
          ]
        : []),
      {
        label: OTHER,
        description: "the game will not find it there by name; reference it yourself",
        dir: "",
      },
    ],
    { placeHolder: `Where does ${path.basename(source)} go?` }
  );
  if (!choice) return null;
  let dir = choice.dir;
  if (choice.label === OTHER) {
    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(o.modPath),
      title: "Folder inside the mod",
      openLabel: "Put the picture here",
    });
    dir = folder?.[0]?.fsPath ?? "";
    if (!dir) return null;
    const inside = path.relative(o.modPath, dir);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      throw new Error(`${dir} is outside the mod, so the game could never load it.`);
    }
    chosenDirs.set(o.folder, dir);
  }

  const target = path.join(dir, `${o.name}.dds`);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(source).toLowerCase();
  if (ext === ".dds") {
    if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
  } else if (ext === ".tga") {
    const png = o.textures.resolveFile(source, 0);
    if (!png) throw new Error(`${path.basename(source)} could not be decoded.`);
    await convertImageToDds(vscode.Uri.file(png), vscode.Uri.file(target));
  } else {
    await convertImageToDds(vscode.Uri.file(source), vscode.Uri.file(target));
  }
  if (!fs.existsSync(target)) throw new Error("no picture was written.");
  return {
    abs: target,
    rel: toRel(o.modPath, target),
    inPlace: path.resolve(dir) === path.resolve(defaultDir),
  };
}

function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}
