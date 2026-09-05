import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  copyTreeVerified,
  detectLayout,
  launcherPath,
  listingDirIn,
  planMove,
  pointerModText,
  projectFolderName,
  retireSource,
  slugify,
} from "../src/modProjects/core";
import { scaffoldDescriptor, parseDescriptor } from "@px-lsp/protocol/descriptorMod";

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

const NAMES = { configDirName: ".px-toolkit", legacyConfigDirName: ".ck3modding" };

describe("moving between the two layouts", () => {
  let tmp: string;
  const write = (file: string, text = "x") => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "px-move-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("detects the game folder layout and the projects layout", () => {
    const gameModDir = path.join(tmp, "docs", "mod");
    const projectsDir = path.join(tmp, "Projects");
    const gameMod = path.join(gameModDir, "my_mod");
    const project = path.join(projectsDir, "My Mod");
    write(path.join(gameMod, "descriptor.mod"), 'name="My Mod"\n');
    write(path.join(project, "mod", "descriptor.mod"), 'name="My Mod"\n');
    const opts = { gameModDir, projectsDir, descriptor: "mod" as const };

    expect(detectLayout(gameMod, opts).layout).toBe("game");
    const inProject = detectLayout(path.join(project, "mod"), opts);
    expect(inProject.layout).toBe("project");
    expect(inProject.projectDir).toBe(project);
    expect(detectLayout(path.join(tmp, "elsewhere"), opts).layout).toBe("unknown");
  });

  it("a pointer file makes a folder anywhere count as the projects layout", () => {
    const gameModDir = path.join(tmp, "docs", "mod");
    const content = path.join(tmp, "Anywhere", "mod");
    write(path.join(content, "descriptor.mod"), 'name="My Mod"\n');
    write(path.join(gameModDir, "my_mod.mod"), `name="My Mod"\npath="${launcherPath(content)}"\n`);
    const info = detectLayout(content, { gameModDir, projectsDir: null, descriptor: "mod" });
    expect(info.layout).toBe("project");
    expect(info.pointer).toBe(path.join(gameModDir, "my_mod.mod"));
  });

  it("lifts the listing out of the mod when moving into a project", () => {
    const src = path.join(tmp, "mod", "my_mod");
    write(path.join(src, ".px-toolkit", "workshop", "item.json"), "{}");
    const destRoot = path.join(tmp, "Projects", "My Mod");
    const plan = planMove({ direction: "toProjects", srcContent: src, destRoot, names: NAMES });
    expect(plan.destContent).toBe(path.join(destRoot, "mod"));
    expect(plan.relocate).toEqual([
      {
        from: path.join(destRoot, "mod", ".px-toolkit", "workshop"),
        to: path.join(destRoot, "workshop"),
      },
    ]);
    expect(plan.retire).toEqual([src]);
  });

  it("folds the sibling listing back into the mod when moving into the game folder", () => {
    const project = path.join(tmp, "Projects", "My Mod");
    const src = path.join(project, "mod");
    write(path.join(src, "descriptor.mod"), 'name="My Mod"\n');
    write(path.join(project, "workshop", "item.json"), "{}");
    const destRoot = path.join(tmp, "docs", "mod", "my_mod");
    const plan = planMove({
      direction: "toGame",
      srcContent: src,
      destRoot,
      projectDir: project,
      names: NAMES,
    });
    expect(plan.destContent).toBe(destRoot);
    expect(plan.copies[1]).toEqual({
      from: path.join(project, "workshop"),
      to: path.join(destRoot, ".px-toolkit", "workshop"),
    });
    expect(plan.retire).toContain(path.join(project, "workshop"));
    expect(plan.pruneIfEmpty).toBe(project);
    // The new root finds the listing with no setting change.
    expect(listingDirIn(destRoot, NAMES)).toBe(plan.copies[1].to);
  });

  it("leaves the listing alone when px.workshop.dir pins it", () => {
    const src = path.join(tmp, "mod", "my_mod");
    write(path.join(src, ".px-toolkit", "workshop", "item.json"), "{}");
    const plan = planMove({
      direction: "toProjects",
      srcContent: src,
      destRoot: path.join(tmp, "Projects", "My Mod"),
      names: NAMES,
      workshopDirSetting: "../listing",
    });
    expect(plan.listingPinned).toBe(true);
    expect(plan.relocate).toEqual([]);
  });

  it("copyTreeVerified copies every file and reports the count", () => {
    const src = path.join(tmp, "src");
    write(path.join(src, "descriptor.mod"), 'name="My Mod"\n');
    write(path.join(src, "events", "a.txt"), "namespace = a\n");
    const dest = path.join(tmp, "dest", "mod");
    expect(copyTreeVerified(src, dest).files).toBe(2);
    expect(fs.readFileSync(path.join(dest, "events", "a.txt"), "utf8")).toBe("namespace = a\n");
  });

  it("copyTreeVerified removes the destination and keeps the source when it fails", () => {
    const dest = path.join(tmp, "dest");
    expect(() => copyTreeVerified(path.join(tmp, "missing"), dest)).toThrow();
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("retireSource removes a verified source", () => {
    const src = path.join(tmp, "src");
    write(path.join(src, "a.txt"));
    expect(retireSource(src)).toEqual({ removed: true });
    expect(fs.existsSync(src)).toBe(false);
    // An already-gone folder is a no-op, not an error.
    expect(retireSource(src)).toEqual({ removed: true });
  });
});
