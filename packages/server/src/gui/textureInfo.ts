/**
 * Frame-sheet facts for the inspector: where a widget's texture file is, how
 * big the sheet is, and which cell of it the widget draws.
 *
 * The sheet's pixel size is the only thing that needs the file, and a DDS
 * carries it in its 128-byte header, so this reads exactly that prefix and
 * never decodes: an inspector row must not cost a 4096x4096 BC7 decode.
 *
 * The grid comes from `framesize = { w h }` plus `frame` (Studio §L, L22),
 * which is what the vanilla trees carry: the default profile's gui tree has
 * 111 files with a `framesize` and neither harvested vanilla tree (nor either
 * harvested guiSchema.json) contains a `noofframes`, so no second spelling is
 * invented here. The cell math itself is computeFrameCell's, shared with the renderer.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type { GuiTextureInfo } from "@px-lsp/protocol/protocol";
import { ddsFormatInfo } from "../dds/decoder";
import { computeFrameCell } from "./fillGeometry";

/** Roots a mod-relative texture path is resolved against. */
export interface TextureRoots {
  gamePath: string | null;
  modPath: string | null;
  /** Parent/dependency mods in load order, base first. */
  parentPaths?: string[];
  /** Engine (jomini) roots, below the game. */
  engineRoots?: string[];
}

/**
 * A DDS header is 128 bytes, 148 with the DX10 extension. Read a round 256 so
 * a header read is one syscall and never depends on the file's total size.
 */
const HEADER_BYTES = 256;

/**
 * First root that has the file. Load order for a plain asset is last-in-wins,
 * so the mod is tried first, then parent mods from the last loaded back, then
 * the game, then the engine folder.
 */
export function resolveTextureFile(rel: string, roots: TextureRoots): string | null {
  const parents = [...(roots.parentPaths ?? [])].reverse();
  const order = [roots.modPath, ...parents, roots.gamePath, ...(roots.engineRoots ?? [])];
  for (const root of order) {
    if (!root) continue;
    const abs = path.join(root, rel);
    try {
      if (fs.statSync(abs).isFile()) return abs;
    } catch {
      /* not under this root */
    }
  }
  return null;
}

/** Width/height from the file's header alone; null when it is not a readable DDS. */
export function readTextureSize(file: string): { width: number; height: number } | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    const info = ddsFormatInfo(new Uint8Array(buf.subarray(0, read)));
    if (!info || info.width <= 0 || info.height <= 0) return null;
    return { width: info.width, height: info.height };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** What the inspector shows for one fill: the path, the sheet, the current cell. */
export function describeTexture(
  fill: { texture: string; framesize?: [number, number]; frame?: number },
  source: "fill" | "background",
  roots?: TextureRoots
): GuiTextureInfo {
  const info: GuiTextureInfo = { path: fill.texture, source };
  if (fill.framesize) {
    info.framesize = fill.framesize;
    info.frame = fill.frame ?? 1;
  }
  const file = roots ? resolveTextureFile(fill.texture, roots) : null;
  if (!file) return info;
  info.file = file;
  const size = readTextureSize(file);
  if (!size) return info;
  info.width = size.width;
  info.height = size.height;
  if (!fill.framesize) return info;
  const [fw, fh] = fill.framesize;
  if (fw <= 0 || fh <= 0) return info;
  info.columns = Math.max(1, Math.floor(size.width / fw));
  info.rows = Math.max(1, Math.floor(size.height / fh));
  const cell = computeFrameCell(fill.framesize, info.frame ?? 1, size.width, size.height);
  info.cell = { x: cell.sx, y: cell.sy, w: cell.sw, h: cell.sh };
  return info;
}
