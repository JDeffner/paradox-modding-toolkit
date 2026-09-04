/**
 * The creators' save decisions, the half that has no vscode in it: the default
 * file name, the bare-name rule and the refusal that stops a modder from
 * replacing a whole vanilla file by naming a mod file after it.
 */
import { describe, expect, it } from "vitest";
import {
  defaultDefinitionFileName,
  defaultTargetFileName,
  isPlainScriptFileName,
  vanillaNameClash,
} from "../src/creators/saveTargets";

describe("defaultDefinitionFileName", () => {
  it("names the file after the mod prefix and the kind", () => {
    expect(defaultDefinitionFileName("mymod", "trait")).toBe("mymod_traits.txt");
    expect(defaultDefinitionFileName("agot", "culture")).toBe("agot_cultures.txt");
    // `dynastys` is not a word; the one irregular the creators' kinds hit.
    expect(defaultDefinitionFileName("mymod", "dynasty")).toBe("mymod_dynasties.txt");
  });
});

describe("defaultTargetFileName", () => {
  it("writes an edited definition back to the file it came from", () => {
    expect(defaultTargetFileName({ sourceFile: "10_my_traits.txt", prefix: "px", kind: "trait" })).toBe(
      "10_my_traits.txt"
    );
  });

  it("falls back to the kind's default name when nothing was loaded", () => {
    expect(defaultTargetFileName({ prefix: "px", kind: "trait" })).toBe("px_traits.txt");
    expect(defaultTargetFileName({ sourceFile: "  ", prefix: "px", kind: "trait" })).toBe("px_traits.txt");
    // A source that is not a bare .txt name: a save may not write there.
    expect(defaultTargetFileName({ sourceFile: "../game/00_traits.txt", prefix: "px", kind: "trait" })).toBe(
      "px_traits.txt"
    );
  });
});

describe("vanillaNameClash", () => {
  const gameFiles = ["00_traits.txt", "01_traits.txt"];

  it("refuses a name the game's own folder already uses, and says why", () => {
    const reason = vanillaNameClash("00_traits.txt", gameFiles, "common/traits");
    expect(reason).toContain("replaces the whole game file");
    expect(reason).toContain("common/traits");
    // Case-insensitively, like the file systems the games run on.
    expect(vanillaNameClash("00_TRAITS.TXT", gameFiles, "common/traits")).not.toBeNull();
  });

  it("passes a name of the modder's own, and refuses nothing when the game folder could not be read", () => {
    expect(vanillaNameClash("mymod_traits.txt", gameFiles, "common/traits")).toBeNull();
    expect(vanillaNameClash("00_traits.txt", [], "common/traits")).toBeNull();
  });
});

describe("file names", () => {
  it("takes a bare .txt name and nothing that could leave the folder", () => {
    expect(isPlainScriptFileName("mymod_traits.txt")).toBe(true);
    expect(isPlainScriptFileName("../evil.txt")).toBe(false);
    expect(isPlainScriptFileName("sub/mymod.txt")).toBe(false);
    expect(isPlainScriptFileName("mymod.yml")).toBe(false);
  });
});
