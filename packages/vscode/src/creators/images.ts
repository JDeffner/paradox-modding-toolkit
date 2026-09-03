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
