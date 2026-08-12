/**
 * The two descriptor conventions where they meet: the mod-name ladder every UI
 * surface reads (B5) and the metadata.json writer/reader pair (B6).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readModName } from "../src/modName";
import { readMetadata, scaffoldMetadata, METADATA_REL_PATH } from "../src/descriptorMetadata";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-descriptors-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A mod folder named after its Workshop id, as a subscription looks on disk. */
function modDir(name = "3385002128"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMetadata(dir: string, body: Record<string, unknown>): void {
  const file = path.join(dir, ...METADATA_REL_PATH.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
}

describe("readModName", () => {
  it("prefers the launcher descriptor's name", () => {
    const dir = modDir();
    fs.writeFileSync(path.join(dir, "descriptor.mod"), 'name="A Game of Thrones"\nversion="0.1"\n', "utf8");
    writeMetadata(dir, { name: "metadata name" });
    expect(readModName(dir)).toBe("A Game of Thrones");
  });

  it("falls back to metadata.json when there is no descriptor.mod", () => {
    const dir = modDir();
    writeMetadata(dir, { name: "[1.13] Community Mod Framework" });
    expect(readModName(dir)).toBe("[1.13] Community Mod Framework");
  });

  it("falls back to the folder name when neither descriptor names the mod", () => {
    const dir = modDir();
    writeMetadata(dir, { name: "   " });
    expect(readModName(dir)).toBe("3385002128");
    expect(readModName(modDir("plain_folder"))).toBe("plain_folder");
  });
});

describe("scaffoldMetadata", () => {
  it("writes the corpus field set, and reads back as the same mod", () => {
    const dir = modDir("my_mod");
    fs.mkdirSync(path.join(dir, ".metadata"));
    fs.writeFileSync(
      path.join(dir, ...METADATA_REL_PATH.split("/")),
      scaffoldMetadata({ name: "My Mod", id: "my_mod", supportedGameVersion: "1.13.*" }),
      "utf8"
    );

    const parsed = readMetadata(dir);
    expect(parsed).toEqual({
      name: "My Mod",
      id: "my_mod",
      version: "0.1.0",
      supported_game_version: "1.13.*",
      tags: [],
      relationships: [],
      game_custom_data: { multiplayer_synchronized: true },
    });
    expect(readModName(dir)).toBe("My Mod");
  });

  it("carries a dependency relationship and replace paths through", () => {
    const json = scaffoldMetadata({
      name: "Big Mod (German Translation)",
      id: "big_mod_german_translation",
      supportedGameVersion: "*",
      tags: ["Translation"],
      relationships: [
        {
          rel_type: "dependency",
          id: "com.github.example.Big-Mod",
          display_name: "Big Mod",
          resource_type: "mod",
          version: "*",
        },
      ],
      replacePaths: ["localization"],
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.relationships).toEqual([
      {
        rel_type: "dependency",
        id: "com.github.example.Big-Mod",
        display_name: "Big Mod",
        resource_type: "mod",
        version: "*",
      },
    ]);
    expect(parsed.game_custom_data).toEqual({
      multiplayer_synchronized: true,
      replace_paths: ["localization"],
    });
    expect(json.endsWith("\n")).toBe(true);
  });

  it("readMetadata is null for a folder without one, and for broken JSON", () => {
    const dir = modDir("no_metadata");
    expect(readMetadata(dir)).toBeNull();
    const broken = modDir("broken");
    fs.mkdirSync(path.join(broken, ".metadata"));
    fs.writeFileSync(path.join(broken, ...METADATA_REL_PATH.split("/")), "{ not json", "utf8");
    expect(readMetadata(broken)).toBeNull();
    expect(readModName(broken)).toBe("broken");
  });
});
