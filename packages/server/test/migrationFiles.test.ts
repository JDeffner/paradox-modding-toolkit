import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MigrationManifest } from "@px-lsp/protocol/migration";
import type { PreparedMigration, PreparedMigrationFile } from "../src/migrations/sdk";
import { hashPlan, hashSnapshot } from "../src/migrations/engine";
import {
  applyFileChanges,
  applyMigration,
  assertMigrationFresh,
  captureMigration,
  restoreMigration,
  type MigrationDocument,
  type MigrationDocumentHost,
} from "../src/migrations/node/files";

const bytes = (text: string) => Buffer.from(text, "utf8");
const manifest: MigrationManifest = {
  id: "test",
  revision: "1",
  sdkVersion: 1,
  gameId: "ck3",
  fromVersion: "1.0",
  toVersion: "1.1",
  kind: "recipe",
  detection: "script",
  requirement: "required",
  guidance: "",
  limitations: [],
  dependsOn: [],
  title: "Test",
  description: "Test",
  evidence: [],
  inputs: [
    { root: "mod", path: "events" },
    { root: "source", path: "events" },
  ],
};
describe("migration filesystem adapter", () => {
  let scratch: string;
  let mod: string;
  let source: string;
  let journalPath: string;
  beforeEach(async () => {
    const parent = path.resolve(".local/testing");
    await fs.mkdir(parent, { recursive: true });
    scratch = await fs.mkdtemp(path.join(parent, "migration-files-"));
    mod = path.join(scratch, "mod");
    source = path.join(scratch, "source");
    journalPath = path.join(scratch, "journal.json");
    await fs.mkdir(path.join(mod, "events"), { recursive: true });
    await fs.mkdir(path.join(source, "events"), { recursive: true });
    await fs.writeFile(path.join(mod, "events/a.txt"), bytes("\uFEFFnamespace = old\n"));
    await fs.writeFile(path.join(source, "events/base.txt"), bytes("base"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (!scratch.startsWith(path.resolve(".local/testing") + path.sep))
      throw new Error("Unsafe scratch cleanup");
    await fs.rm(scratch, { recursive: true, force: true });
  });
  async function plan(
    files: PreparedMigrationFile[],
    documents: MigrationDocument[] = [],
    entry: MigrationManifest = manifest
  ): Promise<PreparedMigration> {
    const unsigned: Omit<PreparedMigration, "hash"> = {
      version: 1,
      recipe: { id: "test", revision: "1", codeHash: "test" },
      snapshotHash: await hashSnapshot(await captureMigration({ mod, source }, entry, "ck3", documents)),
      answers: {},
      selectedGroups: [],
      files,
      inspection: { applicability: "applicable", findings: [], questions: [], coverage: [] },
      checks: [],
      unresolved: [],
    };
    return { ...unsigned, hash: await hashPlan(unsigned) };
  }
  const change = (): PreparedMigrationFile => ({
    path: "events/a.txt",
    before: bytes("\uFEFFnamespace = old\n"),
    after: bytes("\uFEFFnamespace = new\n"),
  });
  function options(documents?: MigrationDocument[], documentHost?: MigrationDocumentHost) {
    return { roots: { mod, source }, manifest, gameId: "ck3", journalPath, documents, documentHost };
  }

  it("filters before reading bytes, lists large unrelated binaries and applies frozen exact reads", async () => {
    await fs.mkdir(path.join(mod, "gfx"));
    await fs.mkdir(path.join(source, "gfx"));
    await fs.writeFile(path.join(mod, "gfx/a.dds"), new Uint8Array([1, 2, 3, 4]));
    const huge = path.join(source, "gfx/unrelated.dds");
    const handle = await fs.open(huge, "w");
    try {
      await handle.truncate(40 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    const entry: MigrationManifest = {
      ...manifest,
      sdkVersion: 2,
      inputs: [
        { root: "mod", path: "events", extensions: [".txt"] },
        { root: "mod", path: "gfx", extensions: [".dds"], capture: "prefix", prefixBytes: 2 },
        {
          root: "source",
          path: "gfx",
          extensions: [".dds"],
          capture: "prefix",
          prefixBytes: 2,
          matchModFiles: true,
        },
      ],
    };
    const read = vi.spyOn(fs, "readFile");
    const seed = await captureMigration({ mod, source }, entry, "ck3");
    expect(read.mock.calls.some(([name]) => String(name).endsWith("unrelated.dds"))).toBe(false);
    expect(seed.files.find((file) => file.path === "gfx/a.dds")?.bytes).toEqual(Buffer.from([1, 2]));
    expect(seed.listings?.find((file) => file.path === "gfx/a.dds")?.size).toBe(4);
    const capture = { selected: [{ root: "mod" as const, path: "gfx/a.dds" }] };
    const snapshot = await captureMigration({ mod, source }, entry, "ck3", [], { capture });
    const unsigned: Omit<PreparedMigration, "hash"> = {
      version: 1,
      recipe: { id: "test", revision: "1", codeHash: "test" },
      snapshotHash: await hashSnapshot(snapshot),
      capture,
      answers: {},
      selectedGroups: [],
      files: [
        { path: "gfx/a.dds", before: new Uint8Array([1, 2, 3, 4]), after: new Uint8Array([5, 6, 7]) },
        { path: "events/new.txt", after: bytes("\uFEFFnamespace = new") },
      ],
      inspection: { applicability: "applicable", findings: [], questions: [], coverage: [] },
      checks: [],
      unresolved: [],
    };
    const result = await applyMigration(
      { ...unsigned, hash: await hashPlan(unsigned) },
      { ...options(), manifest: entry }
    );
    expect(result).toMatchObject({ status: "applied", completed: ["gfx/a.dds", "events/new.txt"] });
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
    expect(await fs.readFile(path.join(mod, "gfx/a.dds"))).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("lists names and sizes without file reads and detects missing counterpart appearance", async () => {
    const entry: MigrationManifest = {
      ...manifest,
      sdkVersion: 2,
      inputs: [
        { root: "mod", path: "events", capture: "listing" },
        { root: "source", path: "events/missing.dds", capture: "listing" },
      ],
    };
    const read = vi.spyOn(fs, "readFile");
    const seed = await captureMigration({ mod, source }, entry, "ck3");
    expect(read).not.toHaveBeenCalled();
    expect(seed.files).toEqual([]);
    expect(seed.listings).toEqual([
      { root: "mod", path: "events/a.txt", size: bytes("\uFEFFnamespace = old\n").length },
    ]);
    const capture = { selected: [{ root: "source" as const, path: "events/missing.dds" }] };
    const snapshot = await captureMigration({ mod, source }, entry, "ck3", [], { capture });
    await fs.writeFile(path.join(source, "events/missing.dds"), new Uint8Array([1]));
    await expect(
      assertMigrationFresh({ mod, source }, entry, await hashSnapshot(snapshot), [], capture)
    ).rejects.toThrow("inputs changed");
    await expect(
      captureMigration({ mod, source }, entry, "ck3", [], {
        capture: { selected: [{ root: "mod", path: "outside.bin" }] },
      })
    ).rejects.toThrow("outside declared listing");
  });

  it("upgrades an unsaved prefix buffer to exact capture without duplicating it", async () => {
    const entry: MigrationManifest = {
      ...manifest,
      sdkVersion: 2,
      inputs: [{ root: "mod", path: "events", capture: "prefix", prefixBytes: 2 }],
    };
    const document = { path: "events/new-unsaved.txt", text: "new = yes", version: 1, dirty: true };
    const snapshot = await captureMigration({ mod, source }, entry, "ck3", [document], {
      capture: { selected: [{ root: "mod", path: document.path }] },
    });
    expect(snapshot.files.filter((file) => file.path === document.path)).toHaveLength(1);
    await expect(hashSnapshot(snapshot)).resolves.toBeTypeOf("string");
  });

  it("enforces aggregate capture limits before reading the next file", async () => {
    await fs.writeFile(path.join(mod, "events/b.txt"), "second");
    const read = vi.spyOn(fs, "readFile");
    await expect(
      captureMigration({ mod, source }, manifest, "ck3", [], {
        limits: { inputBytes: bytes("\uFEFFnamespace = old\n").length },
      })
    ).rejects.toThrow("Select a smaller migration batch");
    expect(read.mock.calls.some(([name]) => String(name).endsWith("b.txt"))).toBe(false);
  });

  it("checks each traversed directory once and filters unrelated files before ancestor guards", async () => {
    await fs.mkdir(path.join(mod, "events/nested"));
    for (let n = 0; n < 30; n++)
      await fs.writeFile(path.join(mod, `events/nested/unused_${n}.dds`), "unused");
    const entry: MigrationManifest = {
      ...manifest,
      inputs: [{ root: "mod", path: "events", extensions: [".txt"] }],
    };
    const directories = vi.spyOn(fs, "readdir");
    const realpaths = vi.spyOn(fs, "realpath");
    const stats = vi.spyOn(fs, "lstat");
    const captured = await captureMigration({ mod }, entry, "ck3");
    expect(captured.files.map((file) => file.path)).toEqual(["events/a.txt"]);
    expect(
      directories.mock.calls.filter(([name]) => String(name).endsWith(path.join("mod", "events/nested")))
    ).toHaveLength(1);
    expect(realpaths.mock.calls.some(([name]) => String(name).endsWith(".dds"))).toBe(false);
    expect(stats.mock.calls.some(([name]) => String(name).endsWith(".dds"))).toBe(false);
    expect(captured.metadata["listing:mod:events:.txt:bytes"]).toBe(
      JSON.stringify(["events/a.txt:file", "events/nested:directory", "events:directory"].sort())
    );
  });

  it("cancels capture before reads and between directory visits", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.spyOn(fs, "readFile");
    await expect(
      captureMigration({ mod, source }, manifest, "ck3", [], { signal: controller.signal })
    ).rejects.toThrow("cancelled");
    await expect(
      assertMigrationFresh({ mod, source }, manifest, "unused", [], undefined, controller.signal)
    ).rejects.toThrow("cancelled");
    expect(read).not.toHaveBeenCalled();
    const during = new AbortController();
    const original = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
      const result = await original(...args);
      if (String(args[0]).endsWith(path.join("mod", "events"))) during.abort();
      return result;
    });
    await expect(
      captureMigration({ mod, source }, manifest, "ck3", [], { signal: during.signal })
    ).rejects.toThrow("cancelled");
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["failure", "cancellation"])("drains bounded metadata work before reporting %s", async (reason) => {
    for (let n = 0; n < 25; n++)
      await fs.writeFile(path.join(mod, `events/batch_${String(n).padStart(2, "0")}.txt`), "input");
    const entry = { ...manifest, inputs: [{ root: "mod" as const, path: "events" }] };
    const inputDirectory = path.join(await fs.realpath(mod), "events") + path.sep;
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const batch = new Promise<void>((resolve) => (entered = resolve));
    let active = 0;
    let maximum = 0;
    const original = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation((async (filename: Parameters<typeof fs.lstat>[0]) => {
      if (!String(filename).startsWith(inputDirectory) || !String(filename).endsWith(".txt"))
        return original(filename);
      active++;
      maximum = Math.max(maximum, active);
      if (active === 16) entered();
      try {
        await gate;
        if (reason === "failure" && String(filename).endsWith("batch_00.txt"))
          throw new Error("Metadata read failed");
        return await original(filename);
      } finally {
        active--;
      }
    }) as typeof fs.lstat);
    const read = vi.spyOn(fs, "readFile");
    let settled = false;
    const captured = captureMigration({ mod }, entry, "ck3", [], { signal: controller.signal }).then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    await batch;
    if (reason === "cancellation") controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect(await captured).toMatchObject({
      message: reason === "failure" ? "Metadata read failed" : "Migration cancelled.",
    });
    expect(maximum).toBe(16);
    expect(active).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects case collisions and junctions in recursively enumerated input directories", async () => {
    const entry: MigrationManifest = {
      ...manifest,
      inputs: [{ root: "mod", path: "events", extensions: [".txt"] }],
    };
    const original = fs.readdir.bind(fs);
    const directories = vi.spyOn(fs, "readdir").mockImplementation((async (
      filename: Parameters<typeof fs.readdir>[0],
      options?: { withFileTypes?: boolean }
    ) => {
      if (!options?.withFileTypes) return original(filename);
      const result = await original(filename, { withFileTypes: true });
      if (!String(filename).endsWith(path.join("mod", "events"))) return result;
      const collision = Object.create(result[0]) as (typeof result)[number];
      collision.name = "A.TXT";
      return [...result, collision];
    }) as typeof fs.readdir);
    await expect(captureMigration({ mod }, entry, "ck3")).rejects.toThrow("Case collision");
    directories.mockRestore();
    await fs.symlink(
      source,
      path.join(mod, "events/unselected.dds"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(captureMigration({ mod }, entry, "ck3")).rejects.toThrow("Links");
  });

  it("rejects an ancestor junction changed after enumeration and before a content read", async () => {
    const nested = path.join(await fs.realpath(mod), "events/nested");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, "owned.txt"), "mod bytes");
    await fs.writeFile(path.join(source, "events/owned.txt"), "reference bytes");
    const original = fs.lstat.bind(fs);
    let visits = 0;
    vi.spyOn(fs, "lstat").mockImplementation((async (filename: Parameters<typeof fs.lstat>[0]) => {
      const stat = await original(filename);
      if (String(filename) === path.join(nested, "owned.txt") && ++visits === 2) {
        await fs.rename(nested, nested + "-original");
        await fs.symlink(
          path.join(source, "events"),
          nested,
          process.platform === "win32" ? "junction" : "dir"
        );
      }
      return stat;
    }) as typeof fs.lstat);
    const read = vi.spyOn(fs, "readFile");
    await expect(captureMigration({ mod, source }, manifest, "ck3")).rejects.toThrow("Reparse");
    expect(read.mock.calls.some(([name]) => String(name) === path.join(nested, "owned.txt"))).toBe(false);
    expect(await fs.readFile(path.join(source, "events/owned.txt"), "utf8")).toBe("reference bytes");
  });

  it("detects a new unsaved input opened during an owned write", async () => {
    const original = { path: "events/a.txt", text: "namespace = old\n", version: 1, dirty: false };
    let current = { ...original };
    const documents = [current];
    const host: MigrationDocumentHost = {
      list: async () => documents.map((document) => ({ ...document })),
      read: async (relative) => documents.find((document) => document.path === relative),
      write: async (_relative, text) => {
        current = { ...current, text, version: 2 };
        documents[0] = current;
        documents.push({ path: "events/new-unsaved.txt", text: "new = yes", version: 1, dirty: true });
        await fs.writeFile(path.join(mod, "events/a.txt"), bytes("\uFEFF" + text));
        return { ...current };
      },
    };
    const prepared = await plan(
      [change(), { path: "events/second.txt", after: bytes("\uFEFFnamespace = second") }],
      [original]
    );
    expect(await applyMigration(prepared, options([original], host))).toMatchObject({
      status: "failed",
      completed: ["events/a.txt"],
      error: expect.stringContaining("inputs changed during apply"),
    });
    await expect(fs.stat(path.join(mod, "events/second.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies and restores replacements, creations and deletions with exact BOM bytes", async () => {
    const before = await fs.readFile(path.join(mod, "events/a.txt"));
    await fs.writeFile(path.join(mod, "events/remove.txt"), "remove");
    const prepared = await plan([
      change(),
      { path: "events/new.txt", after: bytes("\uFEFFnew") },
      { path: "events/remove.txt", before: bytes("remove") },
    ]);
    expect(await applyMigration(prepared, options())).toMatchObject({
      status: "applied",
      completed: ["events/a.txt", "events/new.txt", "events/remove.txt"],
    });
    expect(await fs.readFile(path.join(mod, "events/a.txt"))).toEqual(bytes("\uFEFFnamespace = new\n"));
    expect(await fs.readFile(path.join(source, "events/base.txt"), "utf8")).toBe("base");
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
    expect(await fs.readFile(path.join(mod, "events/a.txt"))).toEqual(before);
    await expect(fs.stat(path.join(mod, "events/new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(mod, "events/remove.txt"), "utf8")).toBe("remove");
  });

  it.each(["replace", "create"] as const)(
    "preserves a concurrent destination edit while staging an apply %s",
    async (operation) => {
      const file = operation === "replace" ? change() : { path: "events/new.txt", after: bytes("new") };
      const prepared = await plan([file]);
      const destination = path.join(await fs.realpath(mod), file.path);
      const concurrent = bytes("\uFEFFnew user work during staging\n");
      const write = fs.writeFile.bind(fs);
      let injected = false;
      vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
        await write(name, ...args);
        if (
          String(name).includes(`.${path.basename(destination)}.`) &&
          String(name).endsWith(".migration-tmp")
        ) {
          injected = true;
          await write(destination, concurrent);
        }
      });
      expect(await applyMigration(prepared, options())).toMatchObject({ status: "failed", completed: [] });
      expect(injected).toBe(true);
      expect(await fs.readFile(destination)).toEqual(concurrent);
      expect(
        (await fs.readdir(path.dirname(destination))).some((name) => name.endsWith(".migration-tmp"))
      ).toBe(false);
      expect(await restoreMigration(journalPath)).toMatchObject({
        status: "conflict",
        conflicts: [file.path],
      });
      expect(await fs.readFile(destination)).toEqual(concurrent);
    }
  );

  it("rejects a changed source before publishing caller-frozen staged output", async () => {
    const sourceFile = path.join(source, "events/base.txt");
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
      await write(name, ...args);
      if (String(name).includes(".a.txt.") && String(name).endsWith(".migration-tmp"))
        await write(sourceFile, "changed source during staging");
    });
    const result = await applyFileChanges([change()], {
      root: mod,
      protectedRoots: [source],
      journalPath,
      assertFresh: async () => {
        if ((await fs.readFile(sourceFile, "utf8")) !== "base") throw new Error("Source changed");
      },
    });
    expect(result).toMatchObject({ status: "failed", completed: [], error: "Source changed" });
    expect(await fs.readFile(path.join(mod, change().path))).toEqual(change().before);
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
  });

  it.each(["source", "mod-input", "other-temporary-file"] as const)(
    "rejects %s changes during staging with full-root migration capture",
    async (input) => {
      const entry = {
        ...manifest,
        inputs: [{ root: "mod" as const, path: "" }, ...manifest.inputs.slice(1)],
      };
      const prepared = await plan([change()], [], entry);
      const inputFile =
        input === "source"
          ? path.join(source, "events/base.txt")
          : path.join(mod, input === "mod-input" ? "events/read-input.txt" : ".other.migration-tmp");
      const write = fs.writeFile.bind(fs);
      vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
        await write(name, ...args);
        if (String(name).includes(".a.txt.") && String(name).endsWith(".migration-tmp"))
          await write(inputFile, "external input during staging");
      });
      expect(await applyMigration(prepared, { ...options(), manifest: entry })).toMatchObject({
        status: "failed",
        completed: [],
        error: "Migration inputs changed during apply",
      });
      expect(await fs.readFile(path.join(mod, change().path))).toEqual(change().before);
      expect(await fs.readFile(inputFile, "utf8")).toBe("external input during staging");
      expect(
        (await fs.readdir(mod)).filter((name) => name.includes(".a.txt.") && name.endsWith(".migration-tmp"))
      ).toEqual([]);
    }
  );

  it("excludes only its owned staged file from full-root capture when creating nested output", async () => {
    const entry = { ...manifest, inputs: [{ root: "mod" as const, path: "" }, ...manifest.inputs.slice(1)] };
    const files = [change(), { path: "new-parent/nested/new.txt", after: bytes("new output") }];
    expect(
      await applyMigration(await plan(files, [], entry), { ...options(), manifest: entry })
    ).toMatchObject({
      status: "applied",
      completed: files.map((file) => file.path),
    });
    expect((await fs.readdir(mod)).some((name) => name.endsWith(".migration-tmp"))).toBe(false);
    expect(await fs.readFile(path.join(mod, files[1].path))).toEqual(files[1].after);
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
    expect(await fs.readFile(path.join(mod, change().path))).toEqual(change().before);
  });

  it("preserves a dirty buffer opened while staging an apply", async () => {
    const prepared = await plan([change()]);
    let current: MigrationDocument | undefined;
    const host: MigrationDocumentHost = { read: async () => current, write: vi.fn() };
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
      await write(name, ...args);
      if (String(name).includes(".a.txt.") && String(name).endsWith(".migration-tmp"))
        current = { path: change().path, text: "unsaved concurrent user work", version: 1, dirty: true };
    });
    expect(await applyMigration(prepared, options([], host))).toMatchObject({
      status: "failed",
      completed: [],
      error: expect.stringContaining("Editor changed during apply"),
    });
    expect(current?.text).toBe("unsaved concurrent user work");
    expect(await fs.readFile(path.join(mod, change().path))).toEqual(change().before);
    expect(host.write).not.toHaveBeenCalled();
  });

  it("creates absent destinations exclusively after the final check", async () => {
    const prepared = await plan([{ path: "events/new.txt", after: bytes("reviewed output") }]);
    const destination = path.join(await fs.realpath(mod), "events/new.txt");
    const concurrent = bytes("user work created before publication");
    const link = fs.link.bind(fs);
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (to === destination) await fs.writeFile(destination, concurrent, { flag: "wx" });
      return link(from, to);
    });
    expect(await applyMigration(prepared, options())).toMatchObject({ status: "failed", completed: [] });
    expect(await fs.readFile(destination)).toEqual(concurrent);
  });

  it.each(["replace", "recreate"] as const)(
    "preserves a concurrent destination edit while staging a restore %s",
    async (operation) => {
      const file = operation === "replace" ? change() : { ...change(), after: undefined };
      expect(await applyMigration(await plan([file]), options())).toMatchObject({ status: "applied" });
      const destination = path.join(await fs.realpath(mod), file.path);
      const concurrent = bytes("\uFEFFuser work during restore staging\n");
      const write = fs.writeFile.bind(fs);
      let injected = false;
      vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
        await write(name, ...args);
        if (String(name).includes(".a.txt.") && String(name).endsWith(".migration-tmp")) {
          injected = true;
          await write(destination, concurrent);
        }
      });
      expect(await restoreMigration(journalPath)).toMatchObject({
        status: "conflict",
        completed: [],
        conflicts: [file.path],
      });
      expect(injected).toBe(true);
      expect(await fs.readFile(destination)).toEqual(concurrent);
      expect(
        (await fs.readdir(path.dirname(destination))).some((name) => name.endsWith(".migration-tmp"))
      ).toBe(false);
    }
  );

  it("preserves a dirty buffer opened while staging a restore", async () => {
    expect(await applyMigration(await plan([change()]), options())).toMatchObject({ status: "applied" });
    let current: MigrationDocument | undefined;
    const host: MigrationDocumentHost = { read: async () => current, write: vi.fn() };
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
      await write(name, ...args);
      if (String(name).includes(".a.txt.") && String(name).endsWith(".migration-tmp"))
        current = { path: change().path, text: "unsaved concurrent restore work", version: 1, dirty: true };
    });
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
      status: "conflict",
      completed: [],
      conflicts: [change().path],
    });
    expect(current?.text).toBe("unsaved concurrent restore work");
    expect(await fs.readFile(path.join(mod, change().path))).toEqual(change().after);
    expect(host.write).not.toHaveBeenCalled();
  });
  it("rejects changed inputs and new files, including absent prefixes", async () => {
    const prepared = await plan([change()]);
    await fs.writeFile(path.join(mod, "events/added.txt"), "new");
    expect(await applyMigration(prepared, options())).toMatchObject({
      status: "failed",
      completed: [],
      error: expect.stringContaining("inputs changed"),
    });
    await expect(fs.stat(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    const withMissing = {
      ...manifest,
      inputs: [...manifest.inputs, { root: "mod" as const, path: "missing.txt" }],
    };
    const capturedHash = await hashSnapshot(await captureMigration({ mod, source }, withMissing, "ck3"));
    await fs.writeFile(path.join(mod, "missing.txt"), "appeared");
    await expect(assertMigrationFresh({ mod, source }, withMissing, capturedHash)).rejects.toThrow(
      "inputs changed"
    );
  });
  it("rejects overlapping roots, traversal and symlinks", async () => {
    await expect(
      captureMigration({ mod, source: path.join(mod, "events") }, manifest, "ck3")
    ).rejects.toThrow("overlap");
    await expect(
      captureMigration({ mod, source }, { ...manifest, inputs: [{ root: "mod", path: "../source" }] }, "ck3")
    ).rejects.toThrow();
    await fs.symlink(
      source,
      path.join(mod, "events/link"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await expect(captureMigration({ mod, source }, manifest, "ck3")).rejects.toThrow("Links");
  });
  it("reads dirty text with its disk BOM and blocks writes without a document host", async () => {
    const documents = [{ path: "events/a.txt", text: "namespace = dirty\n", version: 3, dirty: true }];
    const snapshot = await captureMigration({ mod, source }, manifest, "ck3", documents);
    expect(snapshot.files.find((file) => file.root === "mod")?.bytes).toEqual(
      bytes("\uFEFFnamespace = dirty\n")
    );
    const prepared = await plan([{ ...change(), before: bytes("\uFEFFnamespace = dirty\n") }], documents);
    expect(await applyMigration(prepared, options(documents))).toMatchObject({
      status: "failed",
      error: expect.stringContaining("safely saved"),
    });
    expect(await fs.readFile(path.join(mod, "events/a.txt"))).toEqual(change().before);
  });
  it("rejects stale editor versions", async () => {
    const document = { path: "events/a.txt", text: "namespace = old\n", version: 1, dirty: false };
    const prepared = await plan([change()], [document]);
    const host = { read: async () => ({ ...document, version: 2 }), write: vi.fn() };
    expect(await applyMigration(prepared, options([document], host))).toMatchObject({
      status: "failed",
      error: expect.stringContaining("inputs changed"),
    });
    expect(host.write).not.toHaveBeenCalled();
  });
  it("freezes the restored editor state before staging exact disk recovery", async () => {
    const original = { path: change().path, text: "namespace = dirty\n", version: 5, dirty: true };
    let current = { ...original };
    const host: MigrationDocumentHost = {
      read: async () => current,
      write: async (_file, text, version) => {
        current = { ...current, text, version: version + 1, dirty: false };
        await fs.writeFile(path.join(mod, current.path), bytes("\uFEFF" + text));
        return current;
      },
      restore: async (_file, document, version) => (current = { ...document, version: version + 1 }),
    };
    const prepared = await plan([{ ...change(), before: bytes("\uFEFF" + original.text) }], [original]);
    expect(await applyMigration(prepared, options([original], host))).toMatchObject({ status: "applied" });
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (name, ...args) => {
      await write(name, ...args);
      if (String(name).includes(".a.txt.") && String(name).endsWith(".migration-tmp")) {
        current.text = "new user work after buffer restoration";
        current.version++;
      }
    });
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
      status: "conflict",
      completed: [],
      conflicts: [original.path],
    });
    expect(current.text).toBe("new user work after buffer restoration");
    expect(await fs.readFile(path.join(mod, original.path))).toEqual(change().after);
  });

  it("restores dirty buffers separately from original disk bytes and reports save failures", async () => {
    const original = { path: "events/a.txt", text: "namespace = dirty\n", version: 3, dirty: true };
    let current = { ...original };
    let failSave = true;
    const host: MigrationDocumentHost = {
      read: async () => ({ ...current }),
      write: async (_file, text, version) => {
        expect(current.version).toBe(version);
        current = { ...current, text, version: version + 1, dirty: true };
        if (failSave) throw new Error("injected save failure");
        await fs.writeFile(path.join(mod, current.path), bytes("\uFEFF" + text));
        current.dirty = false;
        return { ...current };
      },
      restore: async (_file, document, version) => {
        expect(current.version).toBe(version);
        current = { ...document, version: version + 1 };
        return { ...current };
      },
    };
    const prepared = await plan([{ ...change(), before: bytes("\uFEFFnamespace = dirty\n") }], [original]);
    expect(await applyMigration(prepared, options([original], host))).toMatchObject({
      status: "failed",
      completed: [],
      error: "injected save failure",
      journalPath,
    });
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({ status: "restored" });
    expect(current).toMatchObject({ text: original.text, dirty: true });
    expect(await fs.readFile(path.join(mod, original.path))).toEqual(change().before);
    await fs.unlink(journalPath);
    failSave = false;
    const successful = await plan([{ ...change(), before: bytes("\uFEFFnamespace = dirty\n") }], [current]);
    expect(await applyMigration(successful, options([current], host))).toMatchObject({ status: "applied" });
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({ status: "restored" });
    expect(current).toMatchObject({ text: original.text, dirty: true });
  });
  it.each(["failed-save", "wrong-success-result"])("preserves newer user text after %s", async (failure) => {
    const original = { path: "events/a.txt", text: "namespace = dirty\n", version: 3, dirty: true };
    let current = { ...original };
    const restore = vi.fn(async (_file: string, document: MigrationDocument) => ({ ...document }));
    const host: MigrationDocumentHost = {
      read: async () => ({ ...current }),
      write: async (_file, text, version) => {
        expect(current.version).toBe(version);
        current = { ...current, text, version: version + 1 };
        if (failure === "wrong-success-result")
          await fs.writeFile(path.join(mod, current.path), bytes("\uFEFF" + text));
        current = { ...current, text: "newer user text", version: current.version + 1, dirty: true };
        if (failure === "failed-save") throw new Error("save failed after user edit");
        return { ...current, dirty: false };
      },
      restore,
    };
    const prepared = await plan([{ ...change(), before: bytes("\uFEFF" + original.text) }], [original]);
    expect(await applyMigration(prepared, options([original], host))).toMatchObject({ status: "failed" });
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    expect(journal.files[0].documentAfter).toBeUndefined();
    const disk = await fs.readFile(path.join(mod, original.path));
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
      status: "conflict",
      conflicts: [original.path],
    });
    expect(current.text).toBe("newer user text");
    expect(await fs.readFile(path.join(mod, original.path))).toEqual(disk);
    expect(restore).not.toHaveBeenCalled();
  });
  it("stops on locked writes and retains a recovery journal and completed paths", async () => {
    const prepared = await plan([change(), { path: "events/b.txt", after: bytes("new") }]);
    const link = fs.link.bind(fs);
    const canonicalMod = await fs.realpath(mod);
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (to === path.join(canonicalMod, "events/b.txt"))
        throw Object.assign(new Error("locked file"), { code: "EACCES" });
      return link(from, to);
    });
    expect(await applyMigration(prepared, options())).toMatchObject({
      status: "failed",
      completed: ["events/a.txt"],
      journalPath,
      error: "locked file",
    });
    expect(
      JSON.parse(await fs.readFile(journalPath, "utf8")).files.map((file: { state: string }) => file.state)
    ).toEqual(["applied", "pending"]);
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
    expect(await fs.readFile(path.join(mod, "events/a.txt"))).toEqual(change().before);
  });
  it.each(["change-read-input", "add-file"])(
    "stops before another write after external %s",
    async (mutation) => {
      await fs.writeFile(path.join(mod, "events/read-input.txt"), "read by recipe");
      const prepared = await plan([change(), { path: "events/b.txt", after: bytes("derived output") }]);
      const rename = fs.rename.bind(fs);
      const canonicalMod = await fs.realpath(mod);
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await rename(from, to);
        if (to === path.join(canonicalMod, "events/a.txt")) {
          await fs.writeFile(
            path.join(mod, mutation === "add-file" ? "events/conflict.txt" : "events/read-input.txt"),
            "external edit"
          );
        }
      });
      expect(await applyMigration(prepared, options())).toMatchObject({
        status: "failed",
        completed: ["events/a.txt"],
        error: "Migration inputs changed during apply",
      });
      await expect(fs.stat(path.join(mod, "events/b.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await fs.readFile(
          path.join(mod, mutation === "add-file" ? "events/conflict.txt" : "events/read-input.txt"),
          "utf8"
        )
      ).toBe("external edit");
    }
  );
  it("accounts only for planned new directories and absent-prefix files between writes", async () => {
    const nestedManifest = {
      ...manifest,
      inputs: [
        ...manifest.inputs,
        { root: "mod" as const, path: "missing" },
        { root: "mod" as const, path: "events/new.txt" },
      ],
    };
    const prepared = await plan([
      { path: "missing/nested/a.txt", after: bytes("a") },
      { path: "events/new.txt", after: bytes("new") },
      change(),
    ]);
    prepared.snapshotHash = await hashSnapshot(
      await captureMigration({ mod, source }, nestedManifest, "ck3")
    );
    const { hash: _hash, ...unsigned } = prepared;
    prepared.hash = await hashPlan(unsigned);
    expect(await applyMigration(prepared, { ...options(), manifest: nestedManifest })).toMatchObject({
      status: "applied",
      completed: ["missing/nested/a.txt", "events/new.txt", "events/a.txt"],
    });
  });
  it("preserves later edits on restore, including a newly opened dirty buffer", async () => {
    expect(await applyMigration(await plan([change()]), options())).toMatchObject({ status: "applied" });
    await fs.writeFile(path.join(mod, "events/a.txt"), "later disk edit");
    expect(await restoreMigration(journalPath)).toMatchObject({
      status: "conflict",
      conflicts: ["events/a.txt"],
    });
    expect(await fs.readFile(path.join(mod, "events/a.txt"), "utf8")).toBe("later disk edit");
    await fs.writeFile(path.join(mod, "events/a.txt"), change().after!);
    const host = {
      read: async () => ({ path: "events/a.txt", text: "later buffer edit", version: 1, dirty: true }),
      write: vi.fn(),
    };
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
      status: "conflict",
      conflicts: ["events/a.txt"],
    });
  });
  it("restores matching clean reopened documents with reset versions and preserves changed text", async () => {
    const original = { path: "events/a.txt", text: "namespace = old\n", version: 42, dirty: false };
    let current = { ...original };
    const host: MigrationDocumentHost = {
      read: async () => ({ ...current }),
      write: async (_file, text, version) => {
        expect(current.version).toBe(version);
        current = { ...current, text, version: version + 1, dirty: false };
        await fs.writeFile(path.join(mod, current.path), bytes("\uFEFF" + text));
        return { ...current };
      },
    };
    expect(await applyMigration(await plan([change()], [original]), options([original], host))).toMatchObject(
      { status: "applied" }
    );
    current.version = 1;
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({ status: "restored" });
    expect(current.text).toBe(original.text);
    expect(await fs.readFile(path.join(mod, original.path))).toEqual(change().before);
    await fs.unlink(journalPath);
    expect(await applyMigration(await plan([change()], [current]), options([current], host))).toMatchObject({
      status: "applied",
    });
    current = { ...current, text: "subsequent edit", version: 1, dirty: true };
    expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
      status: "conflict",
      conflicts: [original.path],
    });
    expect(current.text).toBe("subsequent edit");
  });
  it.each(["buffer", "disk"])(
    "retains recoverable state after a partial %s restore failure",
    async (failure) => {
      const original = { path: "events/a.txt", text: "namespace = dirty\n", version: 5, dirty: true };
      let current = { ...original };
      let failRestore = true;
      const host: MigrationDocumentHost = {
        read: async () => ({ ...current }),
        write: async (_file, text, version) => {
          expect(current.version).toBe(version);
          current = { ...current, text, version: version + 1, dirty: false };
          await fs.writeFile(path.join(mod, current.path), bytes("\uFEFF" + text));
          return { ...current };
        },
        restore: async (_file, document, version) => {
          expect(current.version).toBe(version);
          current = { ...document, version: version + 1 };
          if (failure === "buffer" && failRestore) {
            failRestore = false;
            throw new Error("restore buffer failure");
          }
          return { ...current };
        },
      };
      const prepared = await plan([{ ...change(), before: bytes("\uFEFF" + original.text) }], [original]);
      expect(await applyMigration(prepared, options([original], host))).toMatchObject({ status: "applied" });
      current.version = 1;
      const rename = fs.rename.bind(fs);
      const canonicalMod = await fs.realpath(mod);
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (failure === "disk" && failRestore && to === path.join(canonicalMod, original.path)) {
          failRestore = false;
          throw new Error("restore disk failure");
        }
        await rename(from, to);
      });
      expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
        status: "failed",
        error: `restore ${failure} failure`,
      });
      expect(current).toMatchObject({ text: original.text, dirty: true });
      expect(await fs.readFile(path.join(mod, original.path))).toEqual(change().after);
      expect(await restoreMigration(journalPath, { documentHost: host })).toMatchObject({
        status: "restored",
      });
      expect(current).toMatchObject({ text: original.text, dirty: true });
      expect(await fs.readFile(path.join(mod, original.path))).toEqual(change().before);
    }
  );
  it("recovers pending crash entries matching either before or after", async () => {
    expect(await applyMigration(await plan([change()]), options())).toMatchObject({ status: "applied" });
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    journal.files[0].state = "pending";
    await fs.writeFile(journalPath, JSON.stringify(journal));
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
    journal.files[0].state = "pending";
    await fs.writeFile(journalPath, JSON.stringify(journal));
    expect(await restoreMigration(journalPath)).toMatchObject({ status: "restored" });
  });
  it("accepts no-ops without a journal and rejects tampered plans", async () => {
    expect(
      await applyMigration(await plan([{ ...change(), after: change().before }]), options())
    ).toMatchObject({ status: "applied", completed: [] });
    await expect(fs.stat(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    const prepared = await plan([change()]);
    prepared.files[0].after = bytes("tampered");
    expect(await applyMigration(prepared, options())).toMatchObject({
      status: "failed",
      error: expect.stringContaining("hash"),
    });
  });
});
