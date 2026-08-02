/**
 * Host-side texture resolution for the GUI editor.
 *
 * The webview never sees a .dds: the host resolves the engine's mod-relative
 * path (mod first, then the game folder, matching the game's own override),
 * decodes DDS to PNG with the bundled decoder, and writes the result into the
 * extension's global storage. The cache key is source path + mtime + byte size,
 * so re-exporting a texture invalidates it without any explicit refresh.
 *
 * Deliberately small: full-size decodes, no budget, no eviction. Sizing the
 * cache and capping the decode work belongs to G3.4.
 */
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { decodeDds, encodePng } from "@px-lsp/server/dds";

/** Skip textures beyond this pixel count (loading screens, atlases). */
const MAX_TEXTURE_PIXELS = 4096 * 4096;

export interface TextureRoots {
  gamePath: string | null;
  modPath: string | null;
}

export class GuiTextureCache {
  private readonly dir: string;
  private readonly roots: TextureRoots;
  /** cache key -> absolute PNG path (or null: unresolvable / too large). */
  private readonly resolved = new Map<string, string | null>();

  constructor(storageDir: string, roots: TextureRoots) {
    this.dir = path.join(storageDir, "guiTextures");
    this.roots = roots;
  }

  /** The one folder the webview needs read access to. */
  get cacheDir(): string {
    return this.dir;
  }

  /** Absolute path of the PNG for a mod-relative texture path, or null. */
  resolve(rel: string): string | null {
    const source = this.locate(rel);
    if (!source) return null;
    const cached = this.resolved.get(source.key);
    if (cached !== undefined) return cached;
    const out = path.join(this.dir, `${source.key}.png`);
    if (fs.existsSync(out)) {
      this.resolved.set(source.key, out);
      return out;
    }
    const png = this.convert(source.abs);
    if (!png) {
      this.resolved.set(source.key, null);
      return null;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(out, png);
    this.resolved.set(source.key, out);
    return out;
  }

  /** First root that has the file, with its content-identifying key. */
  private locate(rel: string): { abs: string; key: string } | null {
    for (const root of [this.roots.modPath, this.roots.gamePath]) {
      if (!root) continue;
      const abs = path.join(root, rel);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      const key = createHash("sha1").update(`${abs}|${stat.mtimeMs}|${stat.size}`).digest("hex").slice(0, 20);
      return { abs, key };
    }
    return null;
  }

  private convert(abs: string): Uint8Array | null {
    try {
      const bytes = fs.readFileSync(abs);
      if (/\.png$/i.test(abs)) return new Uint8Array(bytes);
      if (!/\.dds$/i.test(abs)) return null;
      const img = decodeDds(new Uint8Array(bytes));
      if (img.width * img.height > MAX_TEXTURE_PIXELS) return null;
      return encodePng(img.width, img.height, img.pixels);
    } catch {
      return null;
    }
  }
}
