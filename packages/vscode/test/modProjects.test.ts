import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  findPointerFor,
  launcherPath,
  listGameFolderMods,
  moveDir,
  pointerModText,
  projectContentRoot,
  projectFolderName,
  slugify,
} from "../src/modProjects/core";
import { scaffoldDescriptor, parseDescriptor } from "@px-lsp/protocol/descriptorMod";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-modprojects-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("names", () => {
  it("slugify makes launcher-friendly identifiers", () => {
    expect(slugify("Cultivation: The Path to Immortality")).toBe("cultivation_the_path_to_immortality");
    expect(slugify("  ")).toBe("my_mod");
  });

  it("projectFolderName keeps human names but strips illegal characters", () => {
    expect(projectFolderName("Cultivation Mod")).toBe("Cultivation Mod");
    expect(projectFolderName('What? A "Mod"...')).toBe("What A Mod");
  });
});

describe("pointerModText", () => {
  it("appends a forward-slash path to the descriptor fields", () => {
    const text = pointerModText(scaffoldDescriptor("My Mod", "1.19.*"), "F:\\Mods\\My Mod\\mod");
    const entries = parseDescriptor(text);
    expect(entries.find((e) => e.key === "path")?.value).toBe('"F:/Mods/My Mod/mod"');
    expect(entries.find((e) => e.key === "name")?.value).toBe('"My Mod"');
  });
});

describe("findPointerFor", () => {
  it("matches absolute and user-dir-relative path values, else null", () => {
    const gameModDir = path.join(tmp, "mod");
    const content = path.join(tmp, "projects", "My Mod", "mod");
    fs.mkdirSync(gameModDir, { recursive: true });
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(path.join(gameModDir, "other.mod"), 'name="Other"\npath="mod/other"\n');
    fs.writeFileSync(path.join(gameModDir, "my_mod.mod"), `name="My Mod"\npath="${launcherPath(content)}"\n`);
    expect(findPointerFor(gameModDir, content)).toBe(path.join(gameModDir, "my_mod.mod"));
    expect(findPointerFor(gameModDir, path.join(tmp, "elsewhere"))).toBeNull();
    // Relative to the game user dir (the launcher's own convention).
    fs.writeFileSync(path.join(gameModDir, "rel.mod"), 'name="Rel"\npath="mod/rel_content"\n');
    fs.mkdirSync(path.join(gameModDir, "rel_content"), { recursive: true });
    expect(findPointerFor(gameModDir, path.join(tmp, "mod", "rel_content"))).toBe(
      path.join(gameModDir, "rel.mod")
    );
  });
});

describe("layout probing", () => {
  it("projectContentRoot prefers <project>/mod, falls back to the root, else null", () => {
    const nested = path.join(tmp, "Nested");
    fs.mkdirSync(path.join(nested, "mod"), { recursive: true });
    fs.writeFileSync(path.join(nested, "mod", "descriptor.mod"), 'name="N"\n');
    expect(projectContentRoot(nested)).toBe(path.join(nested, "mod"));

    const flat = path.join(tmp, "Flat");
    fs.mkdirSync(path.join(flat, "events"), { recursive: true });
    expect(projectContentRoot(flat)).toBe(flat);

    const empty = path.join(tmp, "Empty");
    fs.mkdirSync(empty);
    expect(projectContentRoot(empty)).toBeNull();
  });

  it("listGameFolderMods returns mod directories only, not files or plain folders", () => {
    const gameModDir = path.join(tmp, "mod");
    fs.mkdirSync(path.join(gameModDir, "real_mod"), { recursive: true });
    fs.writeFileSync(path.join(gameModDir, "real_mod", "descriptor.mod"), 'name="R"\n');
    fs.mkdirSync(path.join(gameModDir, "not_a_mod"));
    fs.writeFileSync(path.join(gameModDir, "pointer.mod"), 'name="P"\npath="x"\n');
    expect(listGameFolderMods(gameModDir)).toEqual([path.join(gameModDir, "real_mod")]);
  });
});

describe("moveDir", () => {
  it("moves a tree and creates the destination's parent", () => {
    const src = path.join(tmp, "src");
    fs.mkdirSync(path.join(src, "events"), { recursive: true });
    fs.writeFileSync(path.join(src, "events", "a.txt"), "x");
    const dest = path.join(tmp, "projects", "Src", "mod");
    moveDir(src, dest);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(path.join(dest, "events", "a.txt"), "utf8")).toBe("x");
  });
});
