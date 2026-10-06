import { afterEach, describe, expect, it, type TestContext } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { iterFiles, listFiles, WALK_TICK } from "../src/fsWalk";

const dirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "px-fswalk-"));
  dirs.push(d);
  return d;
}

/**
 * Windows makes directory links as junctions without elevation, but FILE
 * symlinks need admin or Developer Mode. Tests that cannot create their link
 * skip rather than fail on an unprivileged machine.
 */
function link(ctx: TestContext, target: string, linkPath: string, type: "dir" | "file"): void {
  try {
    fs.symlinkSync(target, linkPath, type === "dir" && process.platform === "win32" ? "junction" : type);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      ctx.skip(`Symlink creation is not permitted (${code})`);
    }
    throw error;
  }
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("finds plain nested files", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "events"));
    fs.writeFileSync(path.join(root, "events", "a.txt"), "namespace = a");
    fs.writeFileSync(path.join(root, "events", "skip.yml"), "");
    expect(listFiles(root, ".txt")).toEqual([path.join(root, "events", "a.txt")]);
  });

  it("skips dot-directories", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "a.txt"), "");
    expect(listFiles(root, ".txt")).toEqual([]);
  });

  // The Linux mod workflow: the mod lives in a dev folder and is symlinked into
  // Paradox's mod/ directory. A Dirent reports the link as neither file nor
  // directory, so gating on isDirectory() alone made the whole mod invisible.
  it("follows a symlinked directory and keeps the link path", (ctx) => {
    const root = tmp();
    const real = path.join(root, "real");
    fs.mkdirSync(path.join(real, "events"), { recursive: true });
    fs.writeFileSync(path.join(real, "events", "a.txt"), "namespace = a");
    const container = path.join(root, "mod");
    fs.mkdirSync(container);
    link(ctx, real, path.join(container, "my_mod"), "dir");

    expect(listFiles(container, ".txt")).toEqual([path.join(container, "my_mod", "events", "a.txt")]);
  });

  it("follows a symlinked file", (ctx) => {
    const root = tmp();
    const target = path.join(root, "source.txt");
    fs.writeFileSync(target, "namespace = a");
    const dir = path.join(root, "events");
    fs.mkdirSync(dir);
    link(ctx, target, path.join(dir, "linked.txt"), "file");

    expect(listFiles(dir, ".txt")).toEqual([path.join(dir, "linked.txt")]);
  });

  it("ignores a dangling symlink instead of throwing", (ctx) => {
    const root = tmp();
    link(ctx, path.join(root, "nowhere"), path.join(root, "broken.txt"), "file");
    expect(listFiles(root, ".txt")).toEqual([]);
  });

  it("terminates on a symlink cycle", (ctx) => {
    const root = tmp();
    const a = path.join(root, "a");
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, "one.txt"), "");
    link(ctx, a, path.join(a, "loop"), "dir");

    // Would recurse forever without the visited-target guard.
    expect(listFiles(root, ".txt")).toEqual([path.join(a, "one.txt")]);
  });

  for (const aliasName of ["a-alias", "z-alias"]) {
    it(`prefers an ordinary directory over ${aliasName}`, (ctx) => {
      const root = tmp();
      const real = path.join(root, "real");
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, "one.txt"), "");
      link(ctx, real, path.join(root, aliasName), "dir");
      expect(listFiles(root, ".txt")).toEqual([path.join(real, "one.txt")]);
    });
  }

  it("prefers an ordinary descendant over an alias in an earlier subtree", (ctx) => {
    const root = tmp();
    const real = path.join(root, "z", "real");
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(path.join(root, "a"));
    fs.writeFileSync(path.join(real, "one.txt"), "");
    link(ctx, real, path.join(root, "a", "alias"), "dir");
    expect(listFiles(root, ".txt")).toEqual([path.join(real, "one.txt")]);
  });

  it("chooses the first sorted sibling link and preserves a linked root", (ctx) => {
    const target = tmp();
    fs.writeFileSync(path.join(target, "one.txt"), "");
    const root = tmp();
    link(ctx, target, path.join(root, "z"), "dir");
    link(ctx, target, path.join(root, "a"), "dir");
    expect(listFiles(root, ".txt")).toEqual([path.join(root, "a", "one.txt")]);
    expect(listFiles(path.join(root, "z"), ".txt")).toEqual([path.join(root, "z", "one.txt")]);
  });

  it("matches the extension case-insensitively", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "A.TXT"), "");
    expect(listFiles(root, ".txt")).toEqual([path.join(root, "A.TXT")]);
  });

  it("terminates when external sibling links form a cycle", (ctx) => {
    const root = tmp();
    const a = tmp();
    const b = tmp();
    fs.writeFileSync(path.join(a, "a.txt"), "");
    fs.writeFileSync(path.join(b, "b.txt"), "");
    link(ctx, a, path.join(root, "first"), "dir");
    link(ctx, b, path.join(a, "next"), "dir");
    link(ctx, a, path.join(b, "back"), "dir");
    expect(listFiles(root, ".txt")).toEqual([
      path.join(root, "first", "a.txt"),
      path.join(root, "first", "next", "b.txt"),
    ]);
  });
});

describe("iterFiles", () => {
  it("ticks on entries visited, so a subtree with no match still paces a caller", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "gfx"));
    for (let i = 0; i < WALK_TICK * 2; i++) fs.writeFileSync(path.join(root, "gfx", `p${i}.dds`), "");

    let ticks = 0;
    let files = 0;
    for (const file of iterFiles(root, ".txt")) {
      if (file === null) ticks++;
      else files++;
    }
    expect(files).toBe(0);
    expect(ticks).toBe(2);
  });
});
