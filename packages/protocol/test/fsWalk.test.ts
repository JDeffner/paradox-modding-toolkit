import { afterEach, describe, expect, it } from "vitest";
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
function link(target: string, linkPath: string, type: "dir" | "file"): boolean {
  try {
    fs.symlinkSync(target, linkPath, type === "dir" && process.platform === "win32" ? "junction" : type);
    return true;
  } catch {
    return false;
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
  it("follows a symlinked directory and keeps the link path", () => {
    const root = tmp();
    const real = path.join(root, "real");
    fs.mkdirSync(path.join(real, "events"), { recursive: true });
    fs.writeFileSync(path.join(real, "events", "a.txt"), "namespace = a");
    const container = path.join(root, "mod");
    fs.mkdirSync(container);
    if (!link(real, path.join(container, "my_mod"), "dir")) return;

    expect(listFiles(container, ".txt")).toEqual([path.join(container, "my_mod", "events", "a.txt")]);
  });

  it("follows a symlinked file", () => {
    const root = tmp();
    const target = path.join(root, "source.txt");
    fs.writeFileSync(target, "namespace = a");
    const dir = path.join(root, "events");
    fs.mkdirSync(dir);
    if (!link(target, path.join(dir, "linked.txt"), "file")) return;

    expect(listFiles(dir, ".txt")).toEqual([path.join(dir, "linked.txt")]);
  });

  it("ignores a dangling symlink instead of throwing", () => {
    const root = tmp();
    if (!link(path.join(root, "nowhere"), path.join(root, "broken.txt"), "file")) return;
    expect(listFiles(root, ".txt")).toEqual([]);
  });

  it("terminates on a symlink cycle", () => {
    const root = tmp();
    const a = path.join(root, "a");
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, "one.txt"), "");
    if (!link(a, path.join(a, "loop"), "dir")) return;

    // Would recurse forever without the visited-target guard.
    expect(listFiles(root, ".txt")).toEqual([path.join(a, "one.txt")]);
  });

  it("matches the extension case-insensitively", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "A.TXT"), "");
    expect(listFiles(root, ".txt")).toEqual([path.join(root, "A.TXT")]);
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
