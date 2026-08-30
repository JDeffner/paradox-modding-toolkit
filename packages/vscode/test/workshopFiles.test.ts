/**
 * The workshop folder as the listing's file store (steam/workshopFiles.ts):
 * the CI-repo layout round-trips, changenotes resolve from the changelog
 * folder or a big changelog file, and Markdown converts to Steam BBCode.
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  extractVersionSection,
  hasListingFiles,
  mdToBBCode,
  readItemJson,
  readListingFiles,
  resolveChangeNote,
  resolveWorkshopDir,
  upsertItemJson,
  writeListingFiles,
} from "../src/steam/workshopFiles";

const tmps: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-workshop-"));
  tmps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("workshop dir resolution", () => {
  it("defaults to the sibling workshop folder (mod/ + workshop/ layout)", () => {
    const root = path.join("F:", "Projets", "My Mod", "mod");
    expect(resolveWorkshopDir(root, undefined)).toBe(path.join("F:", "Projets", "My Mod", "workshop"));
    expect(resolveWorkshopDir(root, "")).toBe(path.join("F:", "Projets", "My Mod", "workshop"));
  });

  it("accepts relative and absolute overrides", () => {
    const root = path.join("F:", "Projets", "My Mod", "mod");
    expect(resolveWorkshopDir(root, "listing")).toBe(path.join(root, "listing"));
    const abs = path.join("D:", "somewhere", "else");
    expect(resolveWorkshopDir(root, abs)).toBe(abs);
  });
});

describe("listing files", () => {
  it("round-trips description and translations in the CI layout", () => {
    const dir = tmp();
    writeListingFiles(dir, {
      description: "[h1]Hello[/h1]",
      translations: {
        german: { title: "Hallo", description: "[b]Deutsch[/b]" },
        french: { description: "Français" },
      },
    });
    expect(fs.readFileSync(path.join(dir, "description.bbcode"), "utf8")).toBe("[h1]Hello[/h1]");
    expect(fs.readFileSync(path.join(dir, "german", "title.txt"), "utf8")).toBe("Hallo\n");
    expect(fs.existsSync(path.join(dir, "french", "title.txt"))).toBe(false);

    const back = readListingFiles(dir);
    expect(back.description).toBe("[h1]Hello[/h1]");
    expect(back.translations.german).toEqual({ title: "Hallo", description: "[b]Deutsch[/b]" });
    expect(back.translations.french).toEqual({ description: "Français" });
  });

  it("removes the files of a language whose draft went empty", () => {
    const dir = tmp();
    writeListingFiles(dir, {
      description: "d",
      translations: { german: { title: "Hallo", description: "x" } },
    });
    writeListingFiles(dir, { description: "d", translations: {} });
    expect(fs.existsSync(path.join(dir, "german"))).toBe(false);
    expect(hasListingFiles(dir)).toBe(true);
  });

  it("merges item.json without dropping unknown keys", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "item.json"), JSON.stringify({ custom: 1, title: "Old" }), "utf8");
    upsertItemJson(dir, { title: "New", publishedfileid: "42" });
    expect(readItemJson(dir)).toEqual({ custom: 1, title: "New", publishedfileid: "42" });
  });
});

describe("changenote resolution", () => {
  it("picks the version-named file from the changelog folder", () => {
    const dir = tmp();
    const log = path.join(dir, "changelog");
    fs.mkdirSync(log);
    fs.writeFileSync(path.join(log, "1.1.md"), "old", "utf8");
    fs.writeFileSync(path.join(log, "v1.2.md"), "- Fixed **a bug**", "utf8");
    const note = resolveChangeNote(dir, undefined, "1.2");
    expect(note?.text).toBe("[list]\n[*] Fixed [b]a bug[/b]\n[/list]");
    expect(note?.source).toBe("changelog/v1.2.md");
  });

  it("never falls back to the newest file when no name matches", () => {
    const dir = tmp();
    const log = path.join(dir, "changelog");
    fs.mkdirSync(log);
    fs.writeFileSync(path.join(log, "1.1.md"), "old note", "utf8");
    expect(resolveChangeNote(dir, undefined, "1.2")).toBeNull();
  });

  it("extracts the version's section from one big changelog file", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## 1.2.0",
        "",
        "- New thing",
        "",
        "### Fixed",
        "",
        "- A fix",
        "",
        "## 1.1.0",
        "",
        "- Old",
      ].join("\n"),
      "utf8"
    );
    const note = resolveChangeNote(dir, "CHANGELOG.md", "1.2.0");
    expect(note?.text).toContain("[*] New thing");
    expect(note?.text).toContain("[*] A fix");
    expect(note?.text).not.toContain("Old");
  });

  it("extracts bbcode headline sections too", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "notes.bbcode"),
      ["[h2]1.2[/h2]", "[b]new[/b]", "[h2]1.1[/h2]", "old"].join("\n"),
      "utf8"
    );
    expect(resolveChangeNote(dir, "notes.bbcode", "1.2")?.text).toBe("[b]new[/b]");
  });

  it("uses a headline-free file whole, but not a headline file without a match", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "note.txt"), "just this note", "utf8");
    expect(resolveChangeNote(dir, "note.txt", "9.9")?.text).toBe("just this note");
    fs.writeFileSync(path.join(dir, "log.md"), "## 1.0\nstuff", "utf8");
    expect(resolveChangeNote(dir, "log.md", "9.9")).toBeNull();
  });
});

describe("extractVersionSection", () => {
  it("keeps deeper sub-headlines inside the section", () => {
    const text = "## 2.0\nA\n### Details\nB\n## 1.0\nC";
    expect(extractVersionSection(text, "2.0")).toBe("A\n### Details\nB");
  });

  it("runs to the end when the version is the last section", () => {
    expect(extractVersionSection("## 1.0\nA\nB", "1.0")).toBe("A\nB");
  });
});

describe("mdToBBCode", () => {
  it("converts the changenote staples", () => {
    const md = [
      "# Big",
      "Some *emphasis* and **bold** and ~~gone~~ and `code`.",
      "- one",
      "- [link](https://example.com)",
      "1. first",
      "---",
      "```",
      "raw **stays**",
      "```",
    ].join("\n");
    expect(mdToBBCode(md)).toBe(
      [
        "[h1]Big[/h1]",
        "Some [i]emphasis[/i] and [b]bold[/b] and [strike]gone[/strike] and code.",
        "[list]",
        "[*] one",
        "[*] [url=https://example.com]link[/url]",
        "[/list]",
        "[olist]",
        "[*] first",
        "[/olist]",
        "[hr][/hr]",
        "[code]",
        "raw **stays**",
        "[/code]",
      ].join("\n")
    );
  });
});
