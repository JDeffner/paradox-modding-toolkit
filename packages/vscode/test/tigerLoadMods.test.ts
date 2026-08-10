/**
 * Dependency mods in tiger runs (Discord report, 2026-08-04): parentPaths
 * become `load_mod` conf blocks, keyed per game family — CK3-style `.mod`
 * games point `modfile` at the dependency's descriptor.mod (tiger resolves
 * that to the directory), `.metadata` games point `mod` at the directory.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { renderLoadModBlocks } from "../src/tiger/loadMods";

let root: string;
let submod: string;
let parentA: string;
let parentB: string;
let noDescriptor: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-loadmods-"));
  const mkMod = (name: string, descriptor: boolean) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    if (descriptor) fs.writeFileSync(path.join(dir, "descriptor.mod"), 'version="1"\n');
    return dir;
  };
  submod = mkMod("my-submod", true);
  parentA = mkMod("Base Framework", true);
  parentB = mkMod("ExtraEvents", true);
  noDescriptor = mkMod("bare-folder", false);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("renderLoadModBlocks", () => {
  it("renders one modfile block per dependency, load order kept, forward slashes", () => {
    const r = renderLoadModBlocks("mod", [parentA, parentB], submod);
    expect(r.loaded).toEqual([parentA, parentB]);
    expect(r.skipped).toEqual([]);
    expect(r.conf).toBe(
      [
        "load_mod = {",
        '\tlabel = "Base Framework"',
        `\tmodfile = "${parentA.replace(/\\/g, "/")}/descriptor.mod"`,
        "}",
        "load_mod = {",
        '\tlabel = "ExtraEvents"',
        `\tmodfile = "${parentB.replace(/\\/g, "/")}/descriptor.mod"`,
        "}",
        "",
      ].join("\n")
    );
  });

  it("uses mod = <dir> for metadata-descriptor games, existing dirs only", () => {
    const r = renderLoadModBlocks("metadata", [parentA, path.join(root, "gone")], submod);
    expect(r.loaded).toEqual([parentA]);
    expect(r.skipped).toEqual([path.join(root, "gone")]);
    expect(r.conf).toContain(`mod = "${parentA.replace(/\\/g, "/")}"`);
    expect(r.conf).not.toContain("modfile");
  });

  it("excludes the validated mod itself and duplicates, case- and separator-insensitively", () => {
    const r = renderLoadModBlocks("mod", [submod.toUpperCase() + path.sep, parentA, parentA], submod);
    expect(r.loaded).toEqual([parentA]);
    expect(r.conf.match(/load_mod = \{/g)).toHaveLength(1);
  });

  it("skips a .mod-game dependency without descriptor.mod instead of emitting a broken block", () => {
    const r = renderLoadModBlocks("mod", [noDescriptor], submod);
    expect(r).toEqual({ conf: "", loaded: [], skipped: [noDescriptor] });
  });

  it("returns empty conf for no dependencies", () => {
    expect(renderLoadModBlocks("mod", [], submod).conf).toBe("");
  });
});
