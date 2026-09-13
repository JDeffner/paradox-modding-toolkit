import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compositeTexturePreview, ddsToPngDataUri, decodeDds, encodeDds } from "../../src/dds";
import { provideTextureHover } from "../../src/features/textureHover";
import { readTexturePreviewBackground } from "@px-lsp/protocol/texturePreview";
import type { ParadoxSettings } from "@px-lsp/protocol/protocol";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "px-preview-background-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function pngPixel(uri: string): number[] {
  const png = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  return [...inflateSync(Buffer.concat(chunks)).subarray(1, 5)];
}

describe("texture display backgrounds", () => {
  it("composites alpha and keeps source pixels intact", () => {
    const pixels = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 128, 20, 30, 40, 255]);
    const original = pixels.slice();
    const result = compositeTexturePreview({ width: 3, height: 1, pixels }, "#204060");
    expect([...result.pixels]).toEqual([32, 64, 96, 255, 144, 32, 48, 255, 20, 30, 40, 255]);
    expect(pixels).toEqual(original);
  });

  it("shows both checker colors through transparent pixels", () => {
    const result = compositeTexturePreview(
      { width: 16, height: 16, pixels: new Uint8Array(16 * 16 * 4) },
      "checkerboard"
    );
    const pixel = (x: number, y: number) => [
      ...result.pixels.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4),
    ];
    expect(pixel(0, 0)).toEqual([192, 192, 192, 255]);
    expect(pixel(8, 0)).toEqual([128, 128, 128, 255]);
    expect(pixel(0, 8)).toEqual(pixel(8, 0));
    expect(pixel(8, 8)).toEqual(pixel(0, 0));
  });

  it("defaults invalid settings to checkerboard and normalizes custom colors", () => {
    for (const value of [undefined, null, "default", "#fff", "url(x)", {}])
      expect(readTexturePreviewBackground(value)).toBe("checkerboard");
    expect(readTexturePreviewBackground("#ABCDEF")).toBe("#abcdef");
  });

  it("updates the hover for the same unchanged file when the setting changes", () => {
    const file = path.join(scratch, "transparent.dds");
    const dds = encodeDds(1, 1, new Uint8Array([0, 0, 0, 0]), "bgra8");
    fs.writeFileSync(file, dds);
    const doc = TextDocument.create(
      URI.file(path.join(scratch, "preview.txt")).toString(),
      "paradox",
      1,
      'icon = "transparent.dds"'
    );
    const settings: ParadoxSettings = {
      gamePath: null,
      logsPath: null,
      modPath: scratch,
      parentPaths: [],
      locLanguage: "english",
      scopeInlayHints: false,
      diagnosticsIgnore: [],
      diagnosticsIgnorePatterns: [],
      diagnosticsVanilla: false,
    };
    const preview = (background?: ParadoxSettings["texturePreviewBackground"]) => {
      const hover = provideTextureHover({ ...settings, texturePreviewBackground: background }, doc, {
        line: 0,
        character: 12,
      });
      const markdown = (hover!.contents as { value: string }).value;
      return pngPixel(/data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(markdown)![0]);
    };
    expect(preview()).toEqual([192, 192, 192, 255]);
    expect(preview("dark")).toEqual([24, 24, 24, 255]);
    expect(preview("light")).toEqual([242, 242, 242, 255]);
    expect(preview("#376694")).toEqual([55, 102, 148, 255]);
    expect(preview("dark")).toEqual([24, 24, 24, 255]);
    expect([...decodeDds(fs.readFileSync(file)).pixels]).toEqual([0, 0, 0, 0]);
    expect(pngPixel(ddsToPngDataUri(dds)!)).toEqual([0, 0, 0, 0]);
  });
});
