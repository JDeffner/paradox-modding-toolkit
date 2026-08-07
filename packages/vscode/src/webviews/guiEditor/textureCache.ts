/**
 * Host-side texture resolution for the GUI editor.
 *
 * The webview never sees a .dds: the host resolves the engine's mod-relative
 * path (mod first, then the game folder, matching the game's own override),
 * decodes DDS to PNG with the bundled decoder, and writes the result into the
 * extension's global storage. The cache key is source path + mtime + byte size
 * (plus the decode cap), so re-exporting a texture invalidates it without any
 * explicit refresh.
 *
 * Bounded since G3.4. The cache is a folder in the user's global storage that
 * nothing else ever cleans up, and a vanilla window pulls in hundreds of
 * megabytes of decoded sprite once every texture on it is full size, so:
 *
 * - decoded bytes are counted and the least recently used are deleted past
 *   CACHE_BUDGET_BYTES;
 * - a caller that only needs a thumbnail says so and the decode is capped at
 *   THUMBNAIL_MAX_DIM, which is what keeps a future tree or inspector row from
 *   paying a 4096x4096 decode to draw 16 pixels.
 *
 * Recency is in-session; across sessions the order is write time, because
 * touching a file on every cache hit is a syscall per texture per re-layout and
 * a wrong eviction costs exactly one re-decode.
 */
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { decodeDds, downscale, encodePng } from "@px-lsp/server/dds";

/** Skip textures beyond this pixel count (loading screens, atlases). */
const MAX_TEXTURE_PIXELS = 4096 * 4096;

/**
 * Longest edge of a thumbnail decode: the cap the plan sets for tree and
 * inspector rows, against full size for the canvas fills. Same number the DDS
 * hover previews use.
 */
export const THUMBNAIL_MAX_DIM = 256;

/**
 * Decoded PNGs kept on disk. Sized to hold a whole vanilla window's sprites
 * (window_character resolves ~200 textures) with room for a few more documents,
 * and small enough that a folder nobody ever looks at stays a nuisance rather
 * than a problem.
 */
const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

export interface TextureRoots {
  gamePath: string | null;
  modPath: string | null;
}

/** One decoded PNG on disk. `used` orders eviction: lowest goes first. */
interface CacheEntry {
  size: number;
  used: number;
}

export class GuiTextureCache {
  private readonly dir: string;
  private readonly roots: TextureRoots;
  private readonly budget: number;
  /** cache key -> absolute PNG path (or null: unresolvable / too large). */
  private readonly resolved = new Map<string, string | null>();
  /** cache key -> its file, for every PNG in the folder. Read from disk once. */
  private entries: Map<string, CacheEntry> | null = null;
  private bytes = 0;
  private clock = 0;

  constructor(storageDir: string, roots: TextureRoots, budgetBytes = CACHE_BUDGET_BYTES) {
    this.dir = path.join(storageDir, "guiTextures");
    this.roots = roots;
    this.budget = budgetBytes;
  }

  /** The one folder the webview needs read access to. */
  get cacheDir(): string {
    return this.dir;
  }

  /** Decoded bytes currently on disk (the number the budget bounds). */
  get cachedBytes(): number {
    this.index();
    return this.bytes;
  }

  /**
   * Absolute path of the PNG for a mod-relative texture path, or null.
   *
   * `maxDim` caps the longest edge of the decode (THUMBNAIL_MAX_DIM for a
   * thumbnail, 0 for the canvas's full-size fill). It only bites on a DDS: a
   * source that is already a PNG is passed through, since decoding one back to
   * pixels to shrink it would cost more than the caller saves.
   */
  resolve(rel: string, maxDim = 0): string | null {
    const source = this.locate(rel, maxDim);
    if (!source) return null;
    const cached = this.resolved.get(source.key);
    if (cached !== undefined) {
      this.touch(source.key);
      return cached;
    }
    this.index();
    const out = this.fileFor(source.key);
    if (this.entries!.has(source.key) && fs.existsSync(out)) {
      this.touch(source.key);
      this.resolved.set(source.key, out);
      return out;
    }
    const png = this.convert(source.abs, maxDim);
    if (!png) {
      this.resolved.set(source.key, null);
      return null;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(out, png);
    this.record(source.key, png.byteLength);
    this.resolved.set(source.key, out);
    this.evict();
    return out;
  }

  private fileFor(key: string): string {
    return path.join(this.dir, `${key}.png`);
  }

  /** First root that has the file, with its content-identifying key. */
  private locate(rel: string, maxDim: number): { abs: string; key: string } | null {
    for (const root of [this.roots.modPath, this.roots.gamePath]) {
      if (!root) continue;
      const abs = path.join(root, rel);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      const key = createHash("sha1")
        .update(`${abs}|${stat.mtimeMs}|${stat.size}|${maxDim}`)
        .digest("hex")
        .slice(0, 20);
      return { abs, key };
    }
    return null;
  }

  private convert(abs: string, maxDim: number): Uint8Array | null {
    try {
      const bytes = fs.readFileSync(abs);
      if (/\.png$/i.test(abs)) return new Uint8Array(bytes);
      if (!/\.dds$/i.test(abs)) return null;
      const decoded = decodeDds(new Uint8Array(bytes));
      if (decoded.width * decoded.height > MAX_TEXTURE_PIXELS) return null;
      const img = maxDim > 0 ? downscale(decoded, maxDim) : decoded;
      return encodePng(img.width, img.height, img.pixels);
    } catch {
      return null;
    }
  }

  /** What the folder already holds, read once per panel: name, size, write time. */
  private index(): void {
    if (this.entries) return;
    this.entries = new Map();
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith(".png")) continue;
      try {
        const stat = fs.statSync(path.join(this.dir, name));
        this.entries.set(name.slice(0, -4), { size: stat.size, used: stat.mtimeMs });
        this.bytes += stat.size;
      } catch {
        /* raced with another window's eviction */
      }
    }
    this.clock = Date.now();
  }

  private record(key: string, size: number): void {
    // Re-recording happens when the file was deleted under us (another window's
    // eviction, a user clearing the folder): the old count has to go first.
    this.bytes -= this.entries!.get(key)?.size ?? 0;
    this.entries!.set(key, { size, used: ++this.clock });
    this.bytes += size;
  }

  private touch(key: string): void {
    const entry = this.entries?.get(key);
    if (entry) entry.used = ++this.clock;
  }

  /**
   * Delete least-recently-used PNGs until the folder is back inside its budget.
   * The last entry is never evicted: a single texture bigger than the whole
   * budget would otherwise be deleted the moment it was written and decoded
   * again on the next layout, forever.
   */
  private evict(): void {
    while (this.bytes > this.budget && this.entries!.size > 1) {
      let oldest: string | undefined;
      let oldestUsed = Infinity;
      for (const [key, entry] of this.entries!) {
        if (entry.used < oldestUsed) {
          oldest = key;
          oldestUsed = entry.used;
        }
      }
      if (!oldest) return;
      const entry = this.entries!.get(oldest)!;
      try {
        fs.unlinkSync(this.fileFor(oldest));
      } catch {
        /* already gone */
      }
      this.entries!.delete(oldest);
      this.bytes -= entry.size;
      // The memo hands out paths: dropping the file without dropping the memo
      // would leave the webview loading an image that is no longer there.
      this.resolved.delete(oldest);
    }
  }
}
