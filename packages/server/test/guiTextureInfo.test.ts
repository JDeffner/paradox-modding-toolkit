/**
 * G5 texture inspector: the frame-sheet facts behind a widget's texture.
 *
 * Two claims are worth pinning. The sheet's pixel size is read from the DDS
 * HEADER, so the inspector must answer for a file whose pixel data is not even
 * there (the fixtures below are 128 bytes of header and nothing else) — that is
 * the whole point of not decoding. And the grid it reports must be the grid the
 * canvas draws, so the cell comes out of the same computeFrameCell the renderer
 * uses, row-major and 1-based.
 */
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { computeGuiWidgetInfo } from "../src/gui/widgetInfo";
import { resolveTextureFile } from "../src/gui/textureInfo";

const DDPF_RGB = 0x40;

/** A valid DDS header and NOTHING else: the reader must never need more. */
function ddsHeader(width: number, height: number): Uint8Array {
  const h = new Uint8Array(128);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x20534444, true); // "DDS "
  dv.setUint32(4, 124, true);
  dv.setUint32(12, height, true);
  dv.setUint32(16, width, true);
  dv.setUint32(76, 32, true); // pixel format size
  dv.setUint32(80, DDPF_RGB, true);
  dv.setUint32(88, 24, true); // 24bpp R8G8B8
  dv.setUint32(92, 0xff0000, true);
  dv.setUint32(96, 0x00ff00, true);
  dv.setUint32(100, 0x0000ff, true);
  return h;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-tex-"));
function writeTexture(rel: string, width: number, height: number): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ddsHeader(width, height));
}
writeTexture("gfx/px/sheet.dds", 108, 72); // 3 x 2 grid of 36x36 cells
writeTexture("gfx/px/flat.dds", 64, 32);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const roots = { gamePath: root, modPath: null };

function textures(text: string, line: number, withRoots = true) {
  const info = computeGuiWidgetInfo(text, line, undefined, withRoots ? { roots } : undefined);
  if (!info) throw new Error("no widget info");
  return info.textures ?? [];
}

describe("frame sheets", () => {
  const sheet = [
    "icon = {",
    '\tname = "framed"',
    '\ttexture = "gfx/px/sheet.dds"',
    "\tframesize = { 36 36 }",
    "\tframe = 5",
    "}",
  ].join("\n");

  it("reports the grid shape, the frame and the cell", () => {
    const [tex] = textures(sheet, 0);
    expect(tex.path).toBe("gfx/px/sheet.dds");
    expect(tex.source).toBe("fill");
    expect(tex.width).toBe(108);
    expect(tex.height).toBe(72);
    expect(tex.framesize).toEqual([36, 36]);
    expect(tex.columns).toBe(3);
    expect(tex.rows).toBe(2);
    expect(tex.frame).toBe(5);
    // Row-major and 1-based: frame 5 is the second cell of the second row.
    expect(tex.cell).toEqual({ x: 36, y: 36, w: 36, h: 36 });
  });

  it("an unwritten `frame` is the first cell", () => {
    const [tex] = textures(sheet.replace("\tframe = 5\n", ""), 0);
    expect(tex.frame).toBe(1);
    expect(tex.cell).toEqual({ x: 0, y: 0, w: 36, h: 36 });
  });

  it("a frame past the last cell clamps instead of reading off the sheet", () => {
    const [tex] = textures(sheet.replace("frame = 5", "frame = 99"), 0);
    expect(tex.cell).toEqual({ x: 72, y: 36, w: 36, h: 36 });
  });

  it("an @constant framesize resolves like every other value", () => {
    const text = ["@PxCell = 36", ...sheet.split("\n")]
      .join("\n")
      .replace("framesize = { 36 36 }", "framesize = { @PxCell @PxCell }");
    const [tex] = textures(text, 1);
    expect(tex.framesize).toEqual([36, 36]);
    expect(tex.columns).toBe(3);
  });
});

describe("plain textures and backgrounds", () => {
  it("a texture with no framesize reports its size and no grid", () => {
    const [tex] = textures('icon = {\n\ttexture = "gfx/px/flat.dds"\n}', 0);
    expect(tex.width).toBe(64);
    expect(tex.columns).toBeUndefined();
    expect(tex.cell).toBeUndefined();
  });

  it("a background is its own row, after the widget's own fill", () => {
    const text = [
      "widget = {",
      '\ttexture = "gfx/px/flat.dds"',
      '\tbackground = { texture = "gfx/px/sheet.dds" framesize = { 36 36 } frame = 2 }',
      "}",
    ].join("\n");
    const rows = textures(text, 0);
    expect(rows.map((t) => t.source)).toEqual(["fill", "background"]);
    expect(rows[1].columns).toBe(3);
    expect(rows[1].cell).toEqual({ x: 36, y: 0, w: 36, h: 36 });
  });

  it("a background reached through `using` resolves like the canvas resolves it", () => {
    const text = [
      'template PxBg { background = { texture = "gfx/px/flat.dds" } }',
      "widget = {",
      "\tusing = PxBg",
      "}",
    ].join("\n");
    const rows = textures(text, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("background");
    expect(rows[0].width).toBe(64);
  });

  it("a widget with no texture has no rows", () => {
    expect(textures("widget = {\n\tsize = { 10 10 }\n}", 0)).toEqual([]);
  });
});

describe("resolution", () => {
  it("without roots the path is all there is: no file, no size", () => {
    const [tex] = textures('icon = {\n\ttexture = "gfx/px/sheet.dds"\n\tframesize = { 36 36 }\n}', 0, false);
    expect(tex.path).toBe("gfx/px/sheet.dds");
    expect(tex.file).toBeUndefined();
    expect(tex.width).toBeUndefined();
    // The authored grid is still known; only what needs the sheet is missing.
    expect(tex.framesize).toEqual([36, 36]);
    expect(tex.columns).toBeUndefined();
  });

  it("an unresolvable path answers with the path alone", () => {
    const [tex] = textures('icon = {\n\ttexture = "gfx/px/absent.dds"\n}', 0);
    expect(tex.file).toBeUndefined();
    expect(tex.width).toBeUndefined();
  });

  it("the mod wins over the game, and a later parent over an earlier one", () => {
    const mod = fs.mkdtempSync(path.join(os.tmpdir(), "px-tex-mod-"));
    const early = fs.mkdtempSync(path.join(os.tmpdir(), "px-tex-p1-"));
    const late = fs.mkdtempSync(path.join(os.tmpdir(), "px-tex-p2-"));
    for (const dir of [mod, early, late]) {
      fs.mkdirSync(path.join(dir, "gfx", "px"), { recursive: true });
      fs.writeFileSync(path.join(dir, "gfx", "px", "flat.dds"), ddsHeader(8, 8));
    }
    const rel = "gfx/px/flat.dds";
    expect(resolveTextureFile(rel, { gamePath: root, modPath: mod })).toBe(path.join(mod, rel));
    // parentPaths are load order, base first, so the LAST one wins.
    expect(resolveTextureFile(rel, { gamePath: root, modPath: null, parentPaths: [early, late] })).toBe(
      path.join(late, rel)
    );
    expect(resolveTextureFile(rel, { gamePath: root, modPath: null })).toBe(path.join(root, rel));
    for (const dir of [mod, early, late]) fs.rmSync(dir, { recursive: true, force: true });
  });
});
