import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensurePxIgnore, pxIgnoreFilter, stageContent } from "../src/steam/pxignore";

const tmpMod = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "px-ignore-"));
const put = (root: string, rel: string, text = "x"): void => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe("pxignore", () => {
  it("creates the file once and reports only the first time", () => {
    const root = tmpMod();
    expect(ensurePxIgnore(root)).toBe(true);
    expect(fs.readFileSync(path.join(root, ".pxignore"), "utf8")).toContain("Paradox launcher");
    expect(ensurePxIgnore(root)).toBe(false);
  });

  it("applies the defaults without a file", () => {
    const keep = pxIgnoreFilter(tmpMod());
    expect(keep(".git", true)).toBe(false);
    expect(keep(path.join(".vscode", "settings.json"), false)).toBe(false);
    expect(keep("art.psd", false)).toBe(false);
    expect(keep(path.join("common", "traits", "x.txt"), false)).toBe(true);
  });

  it("uses the file as the full list, with negation", () => {
    const root = tmpMod();
    put(root, ".pxignore", "*.txt\n!keep.txt\nnotes/\n");
    const keep = pxIgnoreFilter(root);
    expect(keep("drop.txt", false)).toBe(false);
    expect(keep("keep.txt", false)).toBe(true);
    expect(keep("notes", true)).toBe(false);
    expect(keep(".git", true)).toBe(true); // no longer in the list, so it ships
  });

  it("never uploads its own files and never drops the descriptor", () => {
    const root = tmpMod();
    put(root, ".pxignore", "!.pxignore\n!.px-toolkit/\ndescriptor.mod\n.metadata/\n");
    const keep = pxIgnoreFilter(root);
    expect(keep(".pxignore", false)).toBe(false);
    expect(keep(path.join(".px-toolkit", "workshop.json"), false)).toBe(false);
    expect(keep(".ck3modding", true)).toBe(false);
    expect(keep("descriptor.mod", false)).toBe(true);
    expect(keep(path.join(".metadata", "metadata.json"), false)).toBe(true);
  });

  it("stages the mod with the excluded entries left out", () => {
    const root = tmpMod();
    put(root, "descriptor.mod", 'name="m"');
    put(root, "common/decisions/a.txt");
    put(root, ".git/HEAD");
    put(root, ".px-toolkit/workshop/description.bbcode");
    put(root, "listing/item.json");
    const staging = path.join(tmpMod(), "stage");
    stageContent(root, staging, [path.join(root, "listing")]);
    const listed = fs.readdirSync(staging).sort();
    expect(listed).toEqual(["common", "descriptor.mod"]);
    expect(fs.existsSync(path.join(staging, "common", "decisions", "a.txt"))).toBe(true);
  });
});
