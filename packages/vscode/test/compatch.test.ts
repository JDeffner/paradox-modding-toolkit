import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";
import { parseScript, parseLoc } from "@px-lsp/server/parser";
import {
  addFile,
  emptyInventory,
  fingerprint,
  status,
  scan,
  validateRoots,
  createResult,
  resultPath,
  seedFile,
  hasVanillaLoc,
  localizationSeed,
  type Session,
} from "../src/compatch/core";

const support = ck3Meta.compatch;
const event = (gold: number) =>
  `namespace = demo\n@amount = 2\ndemo.1 = {\n immediate = { add_gold = ${gold} }\n}\n`;

describe("compatch identities", () => {
  it("matches an event across renamed files and keeps its file context", () => {
    const inventory = emptyInventory();
    addFile(inventory, "A", "events/original.txt", event(1), support);
    addFile(inventory, "B", "events/overrides/new.txt", event(2), support);
    const entry = [...inventory.entries.values()].find((e) => e.kind === "event")!;
    expect(entry.sites.A[0].path).toBe("events/original.txt");
    expect(entry.sites.B[0].path).toBe("events/overrides/new.txt");
    expect(entry.sites.A[0].text).toContain("@amount = 2");
    expect(status(entry)).toBe("different");
    expect([...inventory.entries.values()].filter((e) => e.kind === "file")).toHaveLength(2);
  });

  it("preserves duplicates in one file and across files without choosing a winner", () => {
    const inventory = emptyInventory();
    addFile(inventory, "A", "events/a.txt", `${event(1)}\ndemo.1 = { hidden = yes }`, support);
    addFile(inventory, "A", "events/b.txt", event(3), support);
    const entry = [...inventory.entries.values()].find((e) => e.kind === "event")!;
    expect(entry.sites.A).toHaveLength(3);
    expect(status(entry)).toBe("multiple definitions");
  });

  it("matches localization across replace and ordinary folders, with separate languages", () => {
    const inventory = emptyInventory();
    addFile(
      inventory,
      "A",
      "localization/replace/a_l_english.yml",
      '\uFEFFl_english:\n key:0 "A"\n',
      support
    );
    addFile(inventory, "B", "localization/english/b_l_english.yml", 'l_english:\n key:0 "B"\n', support);
    addFile(inventory, "B", "localization/french/b_l_french.yml", 'l_french:\n key:0 "B"\n', support);
    const entries = [...inventory.entries.values()].filter((e) => e.kind === "localization");
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === "english:key")!.sites.B[0].path).toContain("english/b_");
    expect(status(entries.find((e) => e.name === "french:key")!)).toBe("B only");
  });

  it("compares raw GUI files and gates semantic matching per game profile", () => {
    for (const meta of [vic3Meta, eu5Meta]) {
      expect(meta.compatch).toBeNull();
      const inventory = emptyInventory();
      addFile(inventory, "A", "events/a.txt", event(1), meta.compatch);
      addFile(inventory, "B", "gui/window.gui", "types = {}", meta.compatch);
      expect([...inventory.entries.values()].map((e) => e.kind)).toEqual(["file", "file"]);
    }
  });

  it("ignores BOM and line endings for equality but retains exact review snapshots", () => {
    const inventory = emptyInventory();
    addFile(inventory, "A", "common/a.txt", "\uFEFFx = 1\r\n", support);
    addFile(inventory, "B", "common/a.txt", "x = 1\n", support);
    const entry = [...inventory.entries.values()][0];
    expect(status(entry)).toBe("same");
    const review = {
      status: "skipped" as const,
      fingerprint: fingerprint(entry),
      sites: structuredClone(entry.sites),
    };
    expect(status(entry, review)).toBe("skipped");
    entry.sites.B[0].text = "x = 2\n";
    expect(status(entry, review)).toBe("sources changed");
    expect(review.sites.B[0].text).toBe("x = 1\n");
  });

  it("reports malformed source text while preserving the full file for manual comparison", () => {
    const inventory = emptyInventory();
    addFile(inventory, "A", "events/bad.txt", "namespace = bad\nbad.1 = {", support);
    addFile(inventory, "B", "localization/bad_l_english.yml", "broken", support);
    expect(inventory.issues).toHaveLength(2);
    expect(inventory.files.A.get("events/bad.txt")).toContain("bad.1");
  });
});

describe("compatch filesystem and output", () => {
  let root: string;
  let session: Session;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "px-compatch-"));
    for (const dir of ["a", "b", "base", "output", "game"]) await fs.mkdir(path.join(root, dir));
    session = {
      version: 1,
      gameId: "ck3",
      localizationLanguage: "english",
      roots: { A: path.join(root, "a"), B: path.join(root, "b"), base: null },
      output: path.join(root, "output"),
      protectedRoots: [path.join(root, "game")],
      reviews: {},
      results: {},
    };
  });
  afterEach(async () => {
    // mkdtemp returns an absolute task-owned directory, never a computed parent.
    expect(path.dirname(root)).toBe(os.tmpdir());
    expect(path.basename(root)).toMatch(/^px-compatch-/);
    await fs.rm(root, { recursive: true, force: true });
  });

  async function file(relative: string, text: string | Uint8Array) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }

  it("protects sources, game files, ancestors, and paths escaping the result", async () => {
    await expect(validateRoots(session)).resolves.toBeUndefined();
    await expect(validateRoots({ ...session, output: session.roots.A! })).rejects.toThrow("separate");
    await expect(validateRoots({ ...session, output: root })).rejects.toThrow("separate");
    await expect(validateRoots({ ...session, output: path.join(root, "game") })).rejects.toThrow("separate");
    await expect(resultPath(session, "../a/stolen.txt")).rejects.toThrow("relative");
    await expect(resultPath(session, session.roots.A!)).rejects.toThrow("relative");
  });

  it("rejects output junctions into a source and does not follow source links", async () => {
    await fs.symlink(session.roots.A!, path.join(session.output, "linked"), "junction");
    await expect(createResult(session, "linked/file.txt", "changed")).rejects.toThrow("link");
    await file("b/common/original.txt", "original");
    await fs.symlink(session.roots.B!, path.join(session.roots.A!, "linked"), "junction");
    const inventory = await scan(
      session,
      support,
      () => {},
      () => false
    );
    expect(inventory.issues.join("\n")).toContain("symbolic link skipped");
    expect(inventory.files.A.size).toBe(0);
  });

  it("never overwrites an edited result or a source", async () => {
    const target = await createResult(
      session,
      "events/demo.txt",
      seedFile("events/demo.txt", event(1), support)
    );
    await fs.writeFile(target, "manual work");
    await expect(createResult(session, "events/demo.txt", "replacement")).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await fs.readFile(target, "utf8")).toBe("manual work");
    expect(await fs.readdir(session.roots.A!)).toEqual([]);
  });

  it("retains removed reviews and optional base content without treating absence as deletion", async () => {
    await file("a/events/a.txt", event(1));
    await file("base/events/old.txt", event(0));
    session.roots.base = path.join(root, "base");
    const first = await scan(
      session,
      support,
      () => {},
      () => false
    );
    const entry = [...first.entries.values()].find((e) => e.kind === "event")!;
    session.reviews[entry.id] = {
      status: "reviewed",
      fingerprint: fingerprint(entry),
      sites: structuredClone(entry.sites),
    };
    await fs.unlink(path.join(root, "a/events/a.txt"));
    await fs.unlink(path.join(root, "base/events/old.txt"));
    const second = await scan(
      session,
      support,
      () => {},
      () => false
    );
    expect(second.entries.get(entry.id)!.sites).toEqual({ A: [], B: [], base: [] });
    expect(status(second.entries.get(entry.id)!, session.reviews[entry.id])).toBe("sources changed");
    expect(session.reviews[entry.id].sites.base[0].text).toContain("add_gold = 0");
  });

  it("cancels scans and reports binary/invalid UTF-8 text instead of decoding replacement characters", async () => {
    await file("a/common/bad.txt", Uint8Array.from([255, 254, 1]));
    await file("b/common/nul.txt", "a\0b");
    const inventory = await scan(
      session,
      support,
      () => {},
      () => false
    );
    expect(inventory.issues).toHaveLength(2);
    expect(inventory.entries.size).toBe(0);
    await expect(
      scan(
        session,
        support,
        () => {},
        () => true
      )
    ).rejects.toThrow("cancelled");
  });

  it("scans one localization language without reopening reviews for omitted languages", async () => {
    await file("a/localization/english/a_l_english.yml", 'l_english:\n key:0 "English"\n');
    await file("a/localization/french/a_l_french.yml", 'l_french:\n key:0 "French"\n');
    const english = await scan(
      session,
      support,
      () => {},
      () => false
    );
    const entry = [...english.entries.values()].find((e) => e.kind === "localization")!;
    expect(entry.name).toBe("english:key");
    expect(english.files.A.size).toBe(1);
    session.reviews[entry.id] = { status: "reviewed", fingerprint: fingerprint(entry), sites: entry.sites };
    session.localizationLanguage = "french";
    const french = await scan(
      session,
      support,
      () => {},
      () => false
    );
    expect(french.entries.has(entry.id)).toBe(false);
    expect([...french.entries.values()].find((e) => e.kind === "localization")!.name).toBe("french:key");
    session.localizationLanguage = "english";
    const restored = await scan(
      session,
      support,
      () => {},
      () => false
    );
    expect(status(restored.entries.get(entry.id)!, session.reviews[entry.id])).toBe("reviewed");
  });

  it("writes full event files with BOM, namespace first, and every original event intact", () => {
    const original = `# comment\n${event(1)}\ndemo.2 = { hidden = yes }\n`;
    const seeded = seedFile("events/a.txt", original, support);
    expect(seeded.startsWith("\uFEFFnamespace = demo\n")).toBe(true);
    expect(seeded).toContain("# comment");
    expect(seeded).toContain("demo.2");
    expect(parseScript(seeded).errors).toEqual([]);
    expect(() => seedFile("events/a.txt", "demo.1 = {}", support)).toThrow("namespace");
    expect(() => seedFile("events/a.txt", "namespace = demo\ndemo.1 = {", support)).toThrow("errors");
  });

  it("routes selected localization using actual vanilla ownership and keeps the language/BOM", async () => {
    await file("game/localization/english/base_l_english.yml", '\uFEFFl_english:\n vanilla_key:0 "Base"\n');
    const directory = path.join(root, "game/localization");
    expect(await hasVanillaLoc(directory, "english", "vanilla_key")).toBe(true);
    expect(await hasVanillaLoc(directory, "english", "new_key")).toBe(false);
    expect(await hasVanillaLoc(directory, "french", "vanilla_key")).toBe(false);
    for (const vanilla of [true, false]) {
      const seed = localizationSeed('l_english:\n vanilla_key:0 "Edited"\n', "localization", vanilla);
      expect(seed.relative).toBe(`localization/${vanilla ? "replace" : "english"}/px_compatch_l_english.yml`);
      const target = await createResult(session, seed.relative, seed.text);
      const bytes = await fs.readFile(target);
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
      expect(parseLoc(bytes.toString("utf8")).errors).toEqual([]);
    }
  });
});
