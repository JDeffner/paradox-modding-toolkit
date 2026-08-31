/**
 * The GUI editor's texture cache: resolution, the thumbnail cap and the budget.
 *
 * The cache writes into the user's global storage and nothing else ever cleans
 * that folder up, so "bounded" is the property under test here, not an
 * implementation detail. Textures are synthesized with the bundled DDS encoder
 * rather than copied from a game install, so the whole suite runs everywhere.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { encodeDds } from "@px-lsp/server/dds";
import { GuiTextureCache, THUMBNAIL_MAX_DIM } from "../src/webviews/guiEditor/textureCache";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-gui-textures-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** A .dds of `size` x `size` noise, written under a root, at a mod-relative path. */
function writeDds(dir: string, rel: string, size: number): void {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 251;
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodeDds(size, size, pixels, "bgra8"));
}

/** A PNG's own IHDR, so the decode cap is read off the file rather than trusted. */
function pngSize(file: string): { w: number; h: number } {
  const bytes = fs.readFileSync(file);
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

function cacheIn(sub: string, roots: { gamePath?: string; modPath?: string }, budget?: number) {
  return new GuiTextureCache(
    path.join(root, sub),
    { gamePath: roots.gamePath ?? null, modPath: roots.modPath ?? null },
    budget
  );
}

describe("resolving a texture", () => {
  it("decodes a .dds to a PNG the webview can load, at full size", () => {
    const game = path.join(root, "game");
    writeDds(game, "gfx/interface/window.dds", 64);
    const cache = cacheIn("storage", { gamePath: game });

    const png = cache.resolve("gfx/interface/window.dds")!;
    expect(png).not.toBeNull();
    expect(path.dirname(png)).toBe(cache.cacheDir);
    expect(pngSize(png)).toEqual({ w: 64, h: 64 });
  });

  it("refuses a texture path that escapes the roots: the path is mod content", () => {
    const game = path.join(root, "game");
    fs.mkdirSync(game, { recursive: true });
    // A real image OUTSIDE the game root, reachable only by traversal.
    writeDds(root, "loot/secret.dds", 16);
    const cache = cacheIn("storage", { gamePath: game });

    expect(cache.resolve("../loot/secret.dds")).toBeNull();
    expect(cache.resolve(path.join(root, "loot/secret.dds"))).toBeNull();
    expect(cache.resolve("a/../../loot/secret.dds")).toBeNull();
    // A path that stays inside the root may still use a redundant segment.
    writeDds(game, "gfx/window.dds", 16);
    expect(cache.resolve("gfx/extra/../window.dds")).not.toBeNull();
  });

  it("the mod's copy wins over the game's, like the engine's own override", () => {
    const game = path.join(root, "game");
    const mod = path.join(root, "mod");
    writeDds(game, "gfx/interface/window.dds", 64);
    writeDds(mod, "gfx/interface/window.dds", 32);

    const png = cacheIn("storage", { gamePath: game, modPath: mod }).resolve("gfx/interface/window.dds")!;
    expect(pngSize(png)).toEqual({ w: 32, h: 32 });
  });

  it("a texture no root has resolves to null instead of throwing", () => {
    expect(cacheIn("storage", { gamePath: path.join(root, "game") }).resolve("gfx/nope.dds")).toBeNull();
  });

  it("a second resolve of the same texture reuses the file it already wrote", () => {
    const game = path.join(root, "game");
    writeDds(game, "gfx/interface/window.dds", 64);
    const cache = cacheIn("storage", { gamePath: game });

    const first = cache.resolve("gfx/interface/window.dds")!;
    const written = fs.statSync(first).mtimeMs;
    expect(cache.resolve("gfx/interface/window.dds")).toBe(first);
    expect(fs.statSync(first).mtimeMs).toBe(written);
    expect(fs.readdirSync(cache.cacheDir)).toHaveLength(1);
  });

  it("a re-exported texture invalidates itself: same path, new bytes, new file", () => {
    const game = path.join(root, "game");
    writeDds(game, "gfx/interface/window.dds", 64);
    const cache = cacheIn("storage", { gamePath: game });
    const before = cache.resolve("gfx/interface/window.dds")!;

    writeDds(game, "gfx/interface/window.dds", 128);
    const after = cache.resolve("gfx/interface/window.dds")!;
    expect(after).not.toBe(before);
    expect(pngSize(after)).toEqual({ w: 128, h: 128 });
  });
});

describe("the thumbnail cap", () => {
  it("caps the longest edge, and keeps its own entry beside the full-size one", () => {
    const game = path.join(root, "game");
    writeDds(game, "gfx/interface/big.dds", 1024);
    const cache = cacheIn("storage", { gamePath: game });

    const thumb = cache.resolve("gfx/interface/big.dds", THUMBNAIL_MAX_DIM)!;
    expect(pngSize(thumb)).toEqual({ w: THUMBNAIL_MAX_DIM, h: THUMBNAIL_MAX_DIM });

    const full = cache.resolve("gfx/interface/big.dds")!;
    expect(full).not.toBe(thumb);
    expect(pngSize(full)).toEqual({ w: 1024, h: 1024 });
    // The point of the cap: the thumbnail costs a fraction of the full decode.
    expect(fs.statSync(thumb).size).toBeLessThan(fs.statSync(full).size / 4);
  });

  it("leaves a texture already smaller than the cap alone", () => {
    const game = path.join(root, "game");
    writeDds(game, "gfx/interface/small.dds", 32);
    const thumb = cacheIn("storage", { gamePath: game }).resolve("gfx/interface/small.dds", 256)!;
    expect(pngSize(thumb)).toEqual({ w: 32, h: 32 });
  });
});

describe("the budget", () => {
  it("evicts the least recently used decode once the folder is over it", () => {
    const game = path.join(root, "game");
    for (const name of ["a", "b", "c"]) writeDds(game, `gfx/${name}.dds`, 64);
    const one = cacheIn("storage-probe", { gamePath: game }).resolve("gfx/a.dds")!;
    const each = fs.statSync(one).size;

    // Room for two decodes, asked for three.
    const cache = cacheIn("storage", { gamePath: game }, each * 2 + 1);
    const a = cache.resolve("gfx/a.dds")!;
    const b = cache.resolve("gfx/b.dds")!;
    // `a` is used again, so `b` becomes the oldest and goes when `c` arrives.
    expect(cache.resolve("gfx/a.dds")).toBe(a);
    const c = cache.resolve("gfx/c.dds")!;

    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(c)).toBe(true);
    expect(fs.existsSync(b)).toBe(false);
    expect(cache.cachedBytes).toBeLessThanOrEqual(each * 2 + 1);
  });

  it("an evicted texture is decoded again rather than handed out as a dead path", () => {
    const game = path.join(root, "game");
    for (const name of ["a", "b"]) writeDds(game, `gfx/${name}.dds`, 64);
    const each = fs.statSync(cacheIn("storage-probe", { gamePath: game }).resolve("gfx/a.dds")!).size;

    const cache = cacheIn("storage", { gamePath: game }, each + 1);
    const a = cache.resolve("gfx/a.dds")!;
    cache.resolve("gfx/b.dds");
    expect(fs.existsSync(a)).toBe(false);

    const again = cache.resolve("gfx/a.dds")!;
    expect(fs.existsSync(again)).toBe(true);
    expect(pngSize(again)).toEqual({ w: 64, h: 64 });
  });

  it("counts what an earlier session left behind instead of starting from zero", () => {
    const game = path.join(root, "game");
    for (const name of ["a", "b"]) writeDds(game, `gfx/${name}.dds`, 64);
    const first = cacheIn("storage", { gamePath: game });
    const a = first.resolve("gfx/a.dds")!;
    const each = fs.statSync(a).size;

    // A new panel over the same folder: `a` is on disk, `b` pushes past the budget.
    const second = cacheIn("storage", { gamePath: game }, each + 1);
    expect(second.cachedBytes).toBe(each);
    second.resolve("gfx/b.dds");
    expect(fs.existsSync(a)).toBe(false);
    expect(second.cachedBytes).toBe(each);
  });

  it("never evicts the only decode it has, even when it alone is over budget", () => {
    const game = path.join(root, "game");
    writeDds(game, "gfx/a.dds", 64);
    const cache = cacheIn("storage", { gamePath: game }, 1);
    const a = cache.resolve("gfx/a.dds")!;
    expect(fs.existsSync(a)).toBe(true);
  });
});
