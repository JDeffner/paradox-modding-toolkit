/**
 * The creators' save decisions, the half that has no vscode in it: the default
 * file name, the BOM rule and the refusal that stops a modder from replacing a
 * whole vanilla file by naming a mod file after it.
 */
import { describe, expect, it } from "vitest";
import {
  BOM,
  defaultDefinitionFileName,
  isPlainScriptFileName,
  stripBom,
  vanillaNameClash,
  withBom,
} from "../src/creators/saveTargets";

describe("defaultDefinitionFileName", () => {
  it("names the file after the mod prefix and the kind", () => {
    expect(defaultDefinitionFileName("mymod", "trait")).toBe("mymod_traits.txt");
    expect(defaultDefinitionFileName("agot", "culture")).toBe("agot_cultures.txt");
  });
});

describe("vanillaNameClash", () => {
  const gameFiles = ["00_traits.txt", "01_traits.txt"];

  it("refuses a name the game's own folder already uses, and says why", () => {
    const reason = vanillaNameClash("00_traits.txt", gameFiles, "common/traits");
    expect(reason).toContain("replaces the whole game file");
    expect(reason).toContain("common/traits");
  });

  it("matches case-insensitively, like the file systems the games run on", () => {
    expect(vanillaNameClash("00_TRAITS.TXT", gameFiles, "common/traits")).not.toBeNull();
  });

  it("passes a name of the modder's own", () => {
    expect(vanillaNameClash("mymod_traits.txt", gameFiles, "common/traits")).toBeNull();
  });

  it("refuses nothing when the game folder could not be read", () => {
    expect(vanillaNameClash("00_traits.txt", [], "common/traits")).toBeNull();
  });
});

describe("file names and the BOM", () => {
  it("takes a bare .txt name and nothing that could leave the folder", () => {
    expect(isPlainScriptFileName("mymod_traits.txt")).toBe(true);
    expect(isPlainScriptFileName("../evil.txt")).toBe(false);
    expect(isPlainScriptFileName("sub/mymod.txt")).toBe(false);
    expect(isPlainScriptFileName("mymod.yml")).toBe(false);
  });

  it("adds a BOM once and takes it off again", () => {
    expect(withBom("a = {}")).toBe(BOM + "a = {}");
    expect(withBom(BOM + "a = {}")).toBe(BOM + "a = {}");
    expect(stripBom(withBom("a = {}"))).toBe("a = {}");
    expect(stripBom("a = {}")).toBe("a = {}");
  });
});
