import { describe, it, expect } from "vitest";
import { launcherPath, pointerModText, projectFolderName, slugify } from "../src/modProjects/core";
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

  it("launcherPath uses forward slashes", () => {
    expect(launcherPath("C:\\a\\b")).toBe("C:/a/b");
  });
});
