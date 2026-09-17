import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LocalizationCoverage } from "../src/overview/locCoverageCache";
import { ServerData } from "../src/serverData";
import { DefinitionIndex } from "../src/index/indexer";
import type { SchemaEntry } from "../src/schema/types";
import { allProfiles } from "../src/games/registry";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const relative = path.relative(os.tmpdir(), root);
    if (!relative.startsWith("px-coverage-") || relative.includes(path.sep))
      throw new Error("Unsafe fixture path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture(
  schema: SchemaEntry[] = [{ path: "localization", kind: "loc_key", ext: ".yml", extraction: "loc-key" }]
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "px-coverage-"));
  fixtures.push(root);
  const data = new ServerData();
  const reads: string[] = [];
  const cache = new LocalizationCoverage(data, async (file) => {
    reads.push(file);
    return fs.promises.readFile(file, "utf8");
  });
  const locRoot = schema.find((e) => e.kind === "loc_key")!.path;
  const write = (name: string, language: string, entries: string) => {
    const file = path.join(root, locRoot, `${name}_l_${language}.yml`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `\uFEFFl_${language}:\n${entries}\n`);
    return file;
  };
  const get = () => cache.get(root, "english", schema);
  return { root, data, cache, reads, schema, write, get };
}

describe("localization coverage", () => {
  it.each(allProfiles())("loads all languages using the $id profile's folders", async (profile) => {
    const f = fixture(profile.schema);
    f.write("source", "english", ' used:0 "Same"\n unused:0 "Unused"');
    f.write("translation", "french", ' used:0 "Same"');
    f.data.refIndex.addAll([
      {
        name: "used",
        kinds: ["loc_key"],
        file: path.join(f.root, "script.txt"),
        line: 3,
        startChar: 0,
        endChar: 4,
      },
    ]);
    const result = await f.get();
    expect(result.map((l) => [l.language, l.defined])).toEqual([
      ["english", 2],
      ["french", 1],
    ]);
    expect(result[0].orphaned.map((i) => i.key)).toEqual(["unused"]);
    expect(result[1].untranslated.map((i) => i.key)).toEqual(["used"]);
  });

  it("reuses translations after script edits, but recomputes required and inherited keys", async () => {
    const f = fixture();
    f.schema.push({ path: "definitions", kind: "test_kind", requiredLoc: ["$.name"] });
    f.write("source", "english", ' used:0 "Value"');
    await f.get();
    f.data.index.addAll([
      {
        name: "test",
        kind: "test_kind",
        file: path.join(f.root, "definitions/x.txt"),
        line: 2,
        source: "mod",
      },
    ]);
    expect((await f.get())[0].missing.map((i) => i.key)).toEqual(["test.name"]);
    f.data.index.addAll([
      { name: "test.name", kind: "loc_key", file: "/vanilla/a.yml", line: 0, source: "vanilla" },
    ]);
    expect((await f.get())[0].missing).toEqual([]);
    expect(f.reads).toHaveLength(1);
    // Revisions can repeat when the server installs a fresh index.
    f.data.index = new DefinitionIndex();
    f.data.index.addAll([
      {
        name: "other",
        kind: "test_kind",
        file: path.join(f.root, "definitions/x.txt"),
        line: 2,
        source: "mod",
      },
    ]);
    expect((await f.get())[0].missing.map((i) => i.key)).toEqual(["other.name"]);
  });

  it("rereads only the changed language and handles create, rename, and delete", async () => {
    const f = fixture();
    f.write("source", "english", ' key:0 "Source"');
    const french = f.write("translation", "french", ' key:0 "Source"');
    await f.get();
    f.reads.length = 0;
    f.write("translation", "french", ' key:0 "Traduit"');
    f.cache.invalidate(french);
    expect((await f.get())[1].untranslated).toEqual([]);
    expect(f.reads).toEqual([french]);
    const added = f.write("added", "french", ' new:0 "Nouveau"');
    f.cache.invalidate(added);
    expect((await f.get())[1].defined).toBe(2);
    const renamed = path.join(path.dirname(added), "added_l_german.yml");
    fs.renameSync(added, renamed);
    f.cache.invalidate(added);
    f.cache.invalidate(renamed);
    expect((await f.get()).map((l) => [l.language, l.defined])).toEqual([
      ["english", 1],
      ["french", 1],
      ["german", 1],
    ]);
    fs.unlinkSync(renamed);
    f.cache.invalidate(renamed);
    expect((await f.get()).map((l) => l.language)).toEqual(["english", "french"]);
  });

  it("preserves duplicate-key precedence when a later file changes or is removed", async () => {
    const f = fixture();
    f.write("source", "english", ' key:0 "Source"');
    f.write("a", "french", ' key:0 "Traduit"');
    const later = f.write("z", "french", ' key:0 "Source"');
    expect((await f.get())[1].untranslated).toHaveLength(1);
    fs.unlinkSync(later);
    f.cache.invalidate(later);
    expect((await f.get())[1].untranslated).toEqual([]);
  });

  it("shares concurrent loads and retries edits arriving during a read", async () => {
    const f = fixture();
    const file = f.write("source", "english", ' old:0 "Old"');
    const unchanged = f.write("unchanged", "english", ' stable:0 "Stable"');
    let release!: () => void;
    let entered!: () => void;
    const enteredRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads: string[] = [];
    const cache = new LocalizationCoverage(f.data, async (name) => {
      const text = await fs.promises.readFile(name, "utf8");
      reads.push(name);
      if (name === file && reads.filter((read) => read === file).length === 1) {
        entered();
        await gate;
      }
      return text;
    });
    const first = cache.get(f.root, "english", f.schema);
    const second = cache.get(f.root, "english", f.schema);
    await enteredRead;
    f.write("source", "english", ' new:0 "New"');
    cache.invalidate(file);
    release();
    const results = await Promise.all([first, second]);
    expect(results[0][0].orphaned.map((i) => i.key)).toEqual(["new", "stable"]);
    expect(results[1]).toEqual(results[0]);
    expect(reads.filter((read) => read === file)).toHaveLength(2);
    expect(reads.filter((read) => read === unchanged)).toHaveLength(1);
  });

  it("keeps issue caps and lets other work run during a large coverage calculation", async () => {
    const f = fixture();
    f.write("source", "english", Array.from({ length: 6000 }, (_, i) => ` key_${i}:0 "Value"`).join("\n"));
    let turns = 0;
    let running = true;
    const tick = () => {
      if (running) {
        turns++;
        setImmediate(tick);
      }
    };
    setImmediate(tick);
    const result = await f.get();
    running = false;
    expect(result[0].defined).toBe(6000);
    expect(result[0].orphaned).toHaveLength(500);
    expect(turns).toBeGreaterThan(1);
  });

  it("restarts pending readers after clear and includes edits made after the reset", async () => {
    const f = fixture();
    const file = f.write("source", "english", ' old:0 "Old"');
    let release!: () => void;
    let entered!: () => void;
    const enteredRead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const cache = new LocalizationCoverage(f.data, async (name) => {
      const text = await fs.promises.readFile(name, "utf8");
      if (++reads === 1) {
        entered();
        await gate;
      }
      return text;
    });
    const first = cache.get(f.root, "english", f.schema);
    const joined = cache.get(f.root, "english", f.schema);
    await enteredRead;
    cache.clear();
    f.write("source", "english", ' new:0 "New"');
    expect(cache.invalidate(file)).toBe(false);
    release();
    const results = await Promise.all([first, joined]);
    expect(results[0][0].orphaned.map((issue) => issue.key)).toEqual(["new"]);
    expect(results[1]).toEqual(results[0]);
    expect(reads).toBe(2);
    // The restarted request belongs to the live cache, so later edits reach it too.
    f.write("source", "english", ' newest:0 "Newest"');
    expect(cache.invalidate(file)).toBe(true);
    expect((await cache.get(f.root, "english", f.schema))[0].orphaned.map((issue) => issue.key)).toEqual([
      "newest",
    ]);
    expect(reads).toBe(3);
  });

  it("evicts old mod caches and drops cached translations on rebuild", async () => {
    const mods = [fixture(), fixture(), fixture()];
    for (const f of mods) f.write("source", "english", ' key:0 "Value"');
    const { cache, schema, reads } = mods[0];
    for (const f of mods) await cache.get(f.root, "english", schema);
    expect(reads).toHaveLength(3);
    await cache.get(mods[1].root, "english", schema);
    expect(reads).toHaveLength(3);
    await cache.get(mods[0].root, "english", schema);
    expect(reads).toHaveLength(4);
    cache.clear();
    await cache.get(mods[0].root, "english", schema);
    expect(reads).toHaveLength(5);
  });
});
