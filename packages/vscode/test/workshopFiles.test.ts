/**
 * The workshop folder as the listing's file store (steam/workshopFiles.ts):
 * the CI-repo layout round-trips, the description file is Markdown unless
 * the folder already keeps BBCode, and changenotes resolve from the changelog
 * folder or a big changelog file.
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  changelogCandidates,
  extractVersionSection,
  hasListingFiles,
  descriptionFile,
  readItemJson,
  moveListing,
  writePreviewOrder,
  readDependencies,
  readListingFiles,
  readPreviews,
  resolveChangeNote,
  resolveWorkshopDir,
  upsertItemJson,
  writeDependencies,
  writeListingFiles,
  writeVideos,
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
  // path.resolve, so the roots are absolute on the platform running the test:
  // users are on Windows, CI is Linux, and a drive letter is relative there.
  const root = path.resolve(path.join("Projets", "My Mod", "mod"));
  const configDir = path.join(root, ".px-toolkit");

  it("defaults to the in-mod config dir", () => {
    expect(resolveWorkshopDir(root, undefined, configDir)).toBe(path.join(configDir, "workshop"));
    expect(resolveWorkshopDir(root, "", configDir)).toBe(path.join(configDir, "workshop"));
  });

  it("keeps an existing sibling workshop folder (mod/ + workshop/ layout)", () => {
    const project = tmp();
    const mod = path.join(project, "mod");
    fs.mkdirSync(mod);
    fs.mkdirSync(path.join(project, "workshop"));
    expect(resolveWorkshopDir(mod, "", path.join(mod, ".px-toolkit"))).toBe(path.join(project, "workshop"));
  });

  it("accepts relative and absolute overrides", () => {
    expect(resolveWorkshopDir(root, "listing", configDir)).toBe(path.join(root, "listing"));
    const abs = path.resolve(path.join("somewhere", "else"));
    expect(resolveWorkshopDir(root, abs, configDir)).toBe(abs);
  });
});

describe("listing files", () => {
  it("round-trips description and translations in the CI layout", () => {
    const dir = tmp();
    writeListingFiles(dir, {
      description: "# Hello",
      translations: {
        german: { title: "Hallo", description: "**Deutsch**" },
        french: { description: "Français" },
      },
    });
    expect(fs.readFileSync(path.join(dir, "description.md"), "utf8")).toBe("# Hello");
    expect(fs.readFileSync(path.join(dir, "translations", "german", "title.txt"), "utf8")).toBe("Hallo\n");
    expect(fs.existsSync(path.join(dir, "translations", "french", "title.txt"))).toBe(false);

    const back = readListingFiles(dir);
    expect(back.description).toBe("# Hello");
    expect(back.translations.german).toEqual({ title: "Hallo", description: "**Deutsch**" });
    expect(back.translations.french).toEqual({ description: "Français" });
    expect(back.markdown.sort()).toEqual(["", "french", "german"]);
  });

  it("removes the files of a language whose draft went empty", () => {
    const dir = tmp();
    writeListingFiles(dir, {
      description: "d",
      translations: { german: { title: "Hallo", description: "x" } },
    });
    writeListingFiles(dir, { description: "d", translations: {} });
    expect(fs.existsSync(path.join(dir, "translations", "german"))).toBe(false);
    expect(hasListingFiles(dir)).toBe(true);
  });

  it("merges item.json without dropping unknown keys", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "item.json"), JSON.stringify({ custom: 1, title: "Old" }), "utf8");
    upsertItemJson(dir, { title: "New", publishedfileid: "42" });
    expect(readItemJson(dir)).toEqual({ custom: 1, title: "New", publishedfileid: "42" });
  });
});

describe("translations folder", () => {
  it("writes languages under translations/ and clears the pre-0.4.0 root folder", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "german"));
    fs.writeFileSync(path.join(dir, "german", "title.txt"), "Alt\n");
    expect(readListingFiles(dir).translations.german).toEqual({ title: "Alt" });
    writeListingFiles(dir, { description: "d", translations: { german: { title: "Neu" } } });
    expect(fs.existsSync(path.join(dir, "german"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "translations", "german", "title.txt"), "utf8")).toBe("Neu\n");
    expect(readListingFiles(dir).translations.german).toEqual({ title: "Neu" });
  });
});

describe("preview order and links", () => {
  it("orders previews by order.txt, then by name", () => {
    const dir = tmp();
    const previews = path.join(dir, "previews");
    fs.mkdirSync(previews);
    for (const f of ["a.png", "b.png", "c.png"]) fs.writeFileSync(path.join(previews, f), "");
    writePreviewOrder(dir, ["c.png", "a.png", "gone.png"]);
    expect(readPreviews(dir)!.images.map((p) => path.basename(p))).toEqual(["c.png", "a.png", "b.png"]);
  });
});

describe("moveListing", () => {
  it("moves an existing folder and refuses to overwrite", () => {
    const project = tmp();
    const from = path.join(project, "workshop");
    writeListingFiles(from, { description: "d", translations: { german: { title: "t" } } });
    const to = path.join(project, "mod", ".px-toolkit", "workshop");
    moveListing(from, to, { description: "", translations: {} });
    expect(hasListingFiles(from)).toBe(false);
    expect(readListingFiles(to).translations.german).toEqual({ title: "t" });
    expect(() => moveListing(to, to, { description: "", translations: {} })).toThrow(/already exists/);
  });

  it("creates the target from the drafts when no folder exists yet", () => {
    const project = tmp();
    const to = path.join(project, "workshop");
    moveListing(path.join(project, "nowhere"), to, { description: "from json", translations: {} });
    expect(readListingFiles(to).description).toBe("from json");
  });
});

describe("previews and dependencies", () => {
  it("reads the previews folder in file-name order, or null without one", () => {
    const dir = tmp();
    expect(readPreviews(dir)).toBeNull();
    const previews = path.join(dir, "previews");
    fs.mkdirSync(previews);
    for (const f of ["10.png", "2.jpg", "notes.txt", "x.PNG"]) fs.writeFileSync(path.join(previews, f), "");
    fs.writeFileSync(path.join(previews, "videos.txt"), "# comment\nabc123def\n\nxyz789ghi\n");
    const got = readPreviews(dir)!;
    expect(got.images.map((p) => path.basename(p))).toEqual(["2.jpg", "10.png", "x.PNG"]);
    expect(got.videos).toEqual(["abc123def", "xyz789ghi"]);
  });

  it("writes and clears videos.txt", () => {
    const dir = tmp();
    writeVideos(dir, ["abc123def"]);
    expect(readPreviews(dir)!.videos).toEqual(["abc123def"]);
    writeVideos(dir, []);
    expect(fs.existsSync(path.join(dir, "previews", "videos.txt"))).toBe(false);
  });

  it("round-trips dependencies.json and drops malformed entries", () => {
    const dir = tmp();
    expect(readDependencies(dir)).toBeNull();
    writeDependencies(dir, { apps: [1158310], items: ["123"] });
    expect(readDependencies(dir)).toEqual({ apps: [1158310], items: ["123"] });
    fs.writeFileSync(
      path.join(dir, "dependencies.json"),
      JSON.stringify({ apps: [1, "x"], items: ["9", "no"] })
    );
    expect(readDependencies(dir)).toEqual({ apps: [1], items: ["9"] });
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

describe("description file choice", () => {
  it("writes Markdown into a folder that has neither file", () => {
    const dir = tmp();
    expect(descriptionFile(dir)).toEqual({ file: path.join(dir, "description.md"), markdown: true });
    writeListingFiles(dir, { description: "# Hi", translations: {} });
    expect(fs.existsSync(path.join(dir, "description.bbcode"))).toBe(false);
  });

  it("leaves a folder that already keeps BBCode on BBCode", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "description.bbcode"), "[h1]Hi[/h1]", "utf8");
    expect(descriptionFile(dir).markdown).toBe(false);
    writeListingFiles(dir, { description: "[h1]Bye[/h1]", translations: {} });
    expect(fs.readFileSync(path.join(dir, "description.bbcode"), "utf8")).toBe("[h1]Bye[/h1]");
    expect(fs.existsSync(path.join(dir, "description.md"))).toBe(false);
    expect(readListingFiles(dir).markdown).toEqual([]);
  });

  it("prefers .md when a folder has both", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "description.bbcode"), "[h1]Old[/h1]", "utf8");
    fs.writeFileSync(path.join(dir, "description.md"), "# New", "utf8");
    const listing = readListingFiles(dir);
    expect(listing.description).toBe("# New");
    expect(listing.markdown).toEqual([""]);
  });
});

describe("changelog candidates", () => {
  it("finds a hand-kept changelog at the mod root and in the workshop folder", () => {
    const root = tmp();
    const workshopDir = path.join(root, ".px-toolkit", "workshop");
    fs.mkdirSync(workshopDir, { recursive: true });
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), "# 1.0", "utf8");
    fs.mkdirSync(path.join(workshopDir, "changelog"));

    const found = changelogCandidates(root, workshopDir, path.join(workshopDir, "changelog"));
    // The workshop folder is searched first, and the resolved setting is flagged.
    expect(found.map((c) => [path.basename(c.path), c.kind, c.current])).toEqual([
      ["changelog", "folder", true],
      ["CHANGELOG.md", "file", false],
    ]);
  });

  it("finds nothing for a mod that keeps no changelog", () => {
    const root = tmp();
    expect(changelogCandidates(root, path.join(root, "workshop"), path.join(root, "workshop"))).toEqual([]);
  });
});
