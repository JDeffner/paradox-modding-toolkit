/**
 * The texture inspector's frame-sheet grid, and the texture browser's rows.
 *
 * PURE (no DOM, no host, no file system). Textures stay opaque to the app: it
 * is handed a URL and a `GuiTextureInfo`, and everything here is arithmetic
 * over the numbers the server already read out of the DDS header. Nothing
 * decodes, nothing resolves a path, nothing invents a sheet shape.
 *
 * The grid itself is the server's (`GuiTextureInfo.columns` / `rows` / `cell`,
 * from `framesize`); this module only maps it onto the box a thumbnail is drawn
 * in, which is the one number the server cannot know.
 */
import type { GuiTextureInfo } from "@px-lsp/protocol/protocol";
import type { TextureEntry } from "../messages";

export interface ThumbRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ThumbGrid {
  /** Where the sheet is drawn inside the box, aspect preserved, centred. */
  image: ThumbRect;
  columns: number;
  rows: number;
  /** Cell size in THUMBNAIL pixels, so the grid lines need no further maths. */
  cellW: number;
  cellH: number;
  /** The cell the widget's `frame` shows; absent when the texture is not a sheet. */
  current?: ThumbRect;
}

/**
 * Fit the sheet into `box` and place the grid on it. Null when the server could
 * not read the sheet's size, which is exactly when there is nothing truthful to
 * draw: a grid over an unknown image would be a guess at both the aspect and
 * the cell count.
 */
export function thumbGrid(info: GuiTextureInfo, box: { w: number; h: number }): ThumbGrid | null {
  const texW = info.width;
  const texH = info.height;
  if (!texW || !texH || box.w <= 0 || box.h <= 0) return null;
  const scale = Math.min(box.w / texW, box.h / texH);
  const w = texW * scale;
  const h = texH * scale;
  const image: ThumbRect = { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  const columns = info.columns ?? 1;
  const rows = info.rows ?? 1;
  const grid: ThumbGrid = {
    image,
    columns,
    rows,
    cellW: columns > 0 ? w / columns : w,
    cellH: rows > 0 ? h / rows : h,
  };
  if (info.cell) {
    // The server's cell is in TEXTURE pixels; the same scale that fitted the
    // sheet fits the cell, so the highlight cannot drift from the grid lines.
    grid.current = {
      x: image.x + info.cell.x * scale,
      y: image.y + info.cell.y * scale,
      w: info.cell.w * scale,
      h: info.cell.h * scale,
    };
  }
  return grid;
}

/** The one-line summary a texture row shows above its thumbnail. */
export function textureSummary(info: GuiTextureInfo): string {
  if (!info.width || !info.height) {
    return info.file ? "the file is there, but its size could not be read" : "not found under any root";
  }
  const size = `${info.width} x ${info.height}`;
  if (!info.framesize || !info.columns || !info.rows) return size;
  const total = info.columns * info.rows;
  return `${size} · ${info.columns} x ${info.rows} frames of ${info.framesize[0]} x ${info.framesize[1]} · showing ${info.frame ?? 1} of ${total}`;
}

// ---- the browser ------------------------------------------------------------

/**
 * How many rows the texture browser shows at once. A UI budget like the
 * palette's: the host caps its own answer too, and this is what bounds the
 * THUMBNAILS, which are the expensive half (one decode each, through the host's
 * cache). Typing narrows the list; scrolling a thousand decoded sprites is not
 * a thing this panel offers.
 */
export const TEXTURE_PAGE = 30;

/** The rows to show and the paths to ask thumbnails for: the same bounded slice. */
export function texturePage(
  entries: readonly TextureEntry[],
  limit = TEXTURE_PAGE
): { rows: TextureEntry[]; paths: string[] } {
  const rows = entries.slice(0, limit);
  return { rows, paths: rows.map((e) => e.path) };
}

/** `gfx/interface/icons/faith/foo.dds` -> `foo.dds`, for the row's strong half. */
export function textureName(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? path : path.slice(at + 1);
}

/** Everything before the file name, which is what tells two `frame.dds` apart. */
export function textureFolder(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/**
 * The value a `texture` property takes for this path: the engine reads a
 * root-relative path with forward slashes, quoted. Built here rather than at
 * the call site so the one place that knows the format is the one place tested
 * for it.
 */
export function textureValue(path: string): string {
  return `"${path}"`;
}
