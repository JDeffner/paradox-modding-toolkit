import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectGameId } from "../src/gameDetect";

/** Fixture mod roots, one per detection-ladder rung. */
let root: string;
const dirs: Record<string, string> = {};

function makeMod(name: string, files: string[], folders: string[] = []): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of folders) fs.mkdirSync(path.join(dir, f), { recursive: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), f.endsWith(".json") ? "{}" : "");
  }
  return dir;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-detect-"));
  dirs.ck3 = makeMod("ck3mod", ["descriptor.mod"], ["common", "events"]);
  dirs.vic3 = makeMod("vic3mod", [".metadata/metadata.json"], ["common", "events"]);
  dirs.eu5 = makeMod("eu5mod", [".metadata/metadata.json"], ["in_game/common"]);
  dirs.eu5MainMenuOnly = makeMod("eu5menu", [".metadata/metadata.json"], ["main_menu"]);
  // Both descriptors present: launcher .mod wins (not a metadata-style mod).
  dirs.both = makeMod("bothmod", ["descriptor.mod", ".metadata/metadata.json"], ["common"]);
  dirs.bare = makeMod("baremod", [], ["common"]);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("detectGameId", () => {
  it("honors an explicit game id over any detection", () => {
    expect(detectGameId("eu5", dirs.ck3)).toBe("eu5");
    expect(detectGameId("vic3", dirs.eu5)).toBe("vic3");
    expect(detectGameId("ck3", dirs.vic3)).toBe("ck3");
  });

  it("rung 1: descriptor.mod means ck3", () => {
    expect(detectGameId("auto", dirs.ck3)).toBe("ck3");
  });

  it("rung 2: metadata descriptor plus a stage folder means eu5", () => {
    expect(detectGameId("auto", dirs.eu5)).toBe("eu5");
    expect(detectGameId("auto", dirs.eu5MainMenuOnly)).toBe("eu5");
  });

  it("rung 3: metadata descriptor alone means vic3", () => {
    expect(detectGameId("auto", dirs.vic3)).toBe("vic3");
  });

  it("rung 4: everything else falls back to ck3", () => {
    expect(detectGameId("auto", dirs.bare)).toBe("ck3");
    expect(detectGameId("auto", null)).toBe("ck3");
    expect(detectGameId("auto", path.join(root, "does-not-exist"))).toBe("ck3");
  });

  it("a launcher descriptor next to .metadata/ stays ck3 (not metadata-style)", () => {
    expect(detectGameId("auto", dirs.both)).toBe("ck3");
  });

  it("unknown explicit values fall back to detection, not to a crash", () => {
    expect(detectGameId("hoi4", dirs.vic3)).toBe("vic3");
    expect(detectGameId("", dirs.ck3)).toBe("ck3");
  });
});
