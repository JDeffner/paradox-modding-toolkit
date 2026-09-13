import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Definition } from "@px-lsp/protocol/types";
import { loadIndexCache, saveIndexCache } from "../src/index/indexer";
import { createIndexCacheIdentity, indexCacheKey } from "../src/index/cacheIdentity";
import type { SchemaEntry } from "../src/schema/types";

const entries: SchemaEntry[] = [{ path: "common/cache_test", kind: "cache_test" }];

describe("vanilla index cache identity", () => {
  let scratch: string;
  let cacheFile: string;
  let gameRoot: string;
  let defs: Definition[];

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "px-index-cache-"));
    cacheFile = path.join(scratch, "cache.json");
    gameRoot = path.join(scratch, "install", "game");
    defs = [
      {
        name: "cache_test_definition",
        kind: "cache_test",
        file: path.join(gameRoot, "common/cache_test/example.txt"),
        source: "vanilla",
        line: 3,
        value: "value",
        params: ["VALUE"],
        doc: "Cache round-trip fixture.",
        tags: [{ tag: "param", text: "VALUE" }],
      },
    ];
  });

  afterEach(() => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(scratch));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Cache scratch directory escaped the temporary root");
    fs.rmSync(path.resolve(scratch), { recursive: true, force: true });
  });

  it("round-trips definitions and records installation and schema metadata", () => {
    const identity = createIndexCacheIdentity(gameRoot, entries);
    saveIndexCache(cacheFile, "same-version", identity, defs);
    expect(loadIndexCache(cacheFile, "same-version", identity)).toEqual(defs);
    expect(JSON.parse(fs.readFileSync(cacheFile, "utf8")).identity).toEqual(identity);
    expect(loadIndexCache(cacheFile, "new-version", identity)).toBeNull();
  });

  it("rejects legacy caches with no installation identity", () => {
    const identity = createIndexCacheIdentity(gameRoot, entries);
    saveIndexCache(cacheFile, "same-version", identity, defs);
    const payload = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    delete payload.identity;
    fs.writeFileSync(cacheFile, JSON.stringify(payload));
    expect(loadIndexCache(cacheFile, "same-version", identity)).toBeNull();
  });

  it("rejects a different installation even at the same game version", () => {
    const identity = createIndexCacheIdentity(gameRoot, entries);
    const other = createIndexCacheIdentity(path.join(scratch, "other", "game"), entries);
    saveIndexCache(cacheFile, "same-version", identity, defs);
    expect(indexCacheKey(other)).not.toBe(indexCacheKey(identity));
    expect(loadIndexCache(cacheFile, "same-version", other)).toBeNull();
  });

  it("reuses the cache for equivalent absolute and relative roots", () => {
    const identity = createIndexCacheIdentity(gameRoot, entries);
    const equivalent = createIndexCacheIdentity(
      path.relative(process.cwd(), gameRoot) + `${path.sep}child${path.sep}..${path.sep}`,
      entries
    );
    expect(equivalent).toEqual(identity);
    expect(indexCacheKey(equivalent)).toBe(indexCacheKey(identity));
    saveIndexCache(cacheFile, "same-version", identity, defs);
    expect(loadIndexCache(cacheFile, "same-version", equivalent)).toEqual(defs);
  });

  it("folds case only on Windows", () => {
    const lower = createIndexCacheIdentity(path.join(scratch, "game"), entries);
    const upper = createIndexCacheIdentity(path.join(scratch, "GAME"), entries);
    expect(indexCacheKey(lower) === indexCacheKey(upper)).toBe(process.platform === "win32");
  });

  it.each<Partial<SchemaEntry>>([
    { path: "common/other_cache_test" },
    { kind: "other_cache_test" },
    { ext: ".gui" },
    { extraction: "named-block" },
  ])("invalidates changed extraction schema: %j", (change) => {
    const identity = createIndexCacheIdentity(gameRoot, entries);
    const changed = createIndexCacheIdentity(gameRoot, [{ ...entries[0], ...change }]);
    saveIndexCache(cacheFile, "same-version", identity, defs);
    expect(indexCacheKey(changed)).not.toBe(indexCacheKey(identity));
    expect(loadIndexCache(cacheFile, "same-version", changed)).toBeNull();
  });

  it("normalizes schema defaults without including unrelated completion metadata", () => {
    expect(
      createIndexCacheIdentity(gameRoot, [
        { ...entries[0], ext: ".txt", extraction: "top-level-key", completable: false },
      ])
    ).toEqual(createIndexCacheIdentity(gameRoot, entries));
  });

  it("preserves engine-before-game definition order and paths across a round trip", () => {
    const engine = { ...defs[0], file: path.join(scratch, "install/jomini/example.txt") };
    const identity = createIndexCacheIdentity(gameRoot, entries);
    saveIndexCache(cacheFile, "same-version", identity, [engine, ...defs]);
    expect(loadIndexCache(cacheFile, "same-version", identity)).toEqual([engine, ...defs]);
  });
});
