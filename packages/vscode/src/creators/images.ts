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
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { GuiTextureCache } from "../webviews/guiEditor/textureCache";
import type { CreatorImagesRequest } from "../webviews/shared/creatorMessages";
import { CONVERTIBLE_IMAGE_EXT, pickDdsEncoding } from "../ddsConvert";
import { ImageCodec } from "../imageCodec";

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
 * per mod and game folder, for the session: a modder keeping their art under one
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
  if (!safeRelative(o.folder) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(o.name))
    throw new Error("The picture needs a relative folder and a plain file name.");
  const modRoot = fs.realpathSync(o.modPath);
  const memoryKey = `${pathKey(modRoot)}\0${o.folder}`;
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Images: IMPORT_IMAGE_EXT },
    title: o.title,
  });
  const source = picked?.[0]?.fsPath;
  if (!source) return null;

  const defaultDir = path.join(o.modPath, ...o.folder.split("/"));
  const OTHER = "$(folder-opened) Another folder in the mod…";
  const rememberedRelative = chosenDirs.get(memoryKey);
  const remembered =
    rememberedRelative === undefined ? undefined : path.resolve(o.modPath, rememberedRelative);
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
  }

  const target = path.join(dir, `${o.name}.dds`);
  assertDestination(o.modPath, modRoot, target);
  const ext = path.extname(source).toLowerCase();
  let encoded: Uint8Array;
  if (ext === ".dds") {
    if (fs.existsSync(target) && pathKey(fs.realpathSync(source)) === pathKey(fs.realpathSync(target)))
      return { abs: target, rel: toRel(o.modPath, target), inPlace: pathKey(dir) === pathKey(defaultDir) };
    encoded = fs.readFileSync(source);
  } else {
    const choice = await pickDdsEncoding(true);
    if (!choice) return null;
    if (
      choice.referenceFile &&
      fs.existsSync(target) &&
      pathKey(fs.realpathSync(choice.referenceFile)) === pathKey(fs.realpathSync(target))
    )
      throw new Error("The destination is the reference texture. Choose a different destination.");
    let input = source;
    if (ext === ".tga") {
      const png = o.textures.resolveFile(source, 0);
      if (!png) throw new Error(`${path.basename(source)} could not be decoded.`);
      input = png;
    }
    const codec = new ImageCodec();
    try {
      const image = await codec.decode(fs.readFileSync(input), path.extname(input).toLowerCase());
      encoded = await codec.encode(image, choice.encoding);
    } finally {
      codec.dispose();
    }
  }
  assertDestination(o.modPath, modRoot, target);
  const previous = readExistingPicture(target);
  if (previous !== null) {
    const replace = await vscode.window.showWarningMessage(
      `Replace ${toRel(o.modPath, target)}? The existing picture will be overwritten.`,
      "Replace Picture",
      "Cancel"
    );
    if (replace !== "Replace Picture") return null;
  }
  assertDestination(o.modPath, modRoot, target);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.px-image-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, encoded, { flag: "wx" });
    assertDestination(o.modPath, modRoot, target);
    if (previous === null) {
      // A file created while the importer was open must not be overwritten.
      fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
    } else {
      const current = readExistingPicture(target);
      if (current === null || !current.equals(previous))
        throw new Error(
          "The destination picture changed during import. Import it again to review the replacement."
        );
      fs.renameSync(temporary, target);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  if (choice.label === OTHER) chosenDirs.set(memoryKey, path.relative(o.modPath, dir));
  return {
    abs: target,
    rel: toRel(o.modPath, target),
    inPlace: pathKey(dir) === pathKey(defaultDir),
  };
}

function pathKey(file: string): string {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function outside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** Check both lexical paths and existing directory aliases, including remembered destinations. */
function assertDestination(modPath: string, modRoot: string, target: string): void {
  if (outside(modPath, target) || pathKey(fs.realpathSync(modPath)) !== pathKey(modRoot))
    throw new Error("The picture destination is outside the selected mod.");
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (outside(modRoot, fs.realpathSync(ancestor)))
    throw new Error("The picture destination links to a folder outside the selected mod.");
  readExistingPicture(target);
}

function readExistingPicture(target: string): Buffer | null {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("The picture destination is not a regular file.");
    return fs.readFileSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}
