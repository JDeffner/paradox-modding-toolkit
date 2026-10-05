import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyFileChanges, restoreFileChanges, type FrozenFileChange } from "../src/migrations/node/files";

const bytes = (text: string) => Buffer.from(text, "utf8");

describe("frozen file transactions", () => {
  let scratch: string;
  let root: string;
  let protectedRoots: string[];
  let journalPath: string;
  beforeEach(async () => {
    const parent = path.resolve(".local/testing");
    await fs.mkdir(parent, { recursive: true });
    scratch = await fs.mkdtemp(path.join(parent, "file-transaction-"));
    root = path.join(scratch, "output");
    protectedRoots = ["base", "first", "second", "third"].map((name) => path.join(scratch, name));
    journalPath = path.join(scratch, "journal.json");
    for (const directory of [root, ...protectedRoots]) await fs.mkdir(directory);
    await fs.writeFile(path.join(root, "first.txt"), bytes("\uFEFFbefore\n"));
    for (const directory of protectedRoots) await fs.writeFile(path.join(directory, "input.txt"), "input");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (!scratch.startsWith(path.resolve(".local/testing") + path.sep)) throw new Error("Unsafe cleanup");
    await fs.rm(scratch, { recursive: true, force: true });
  });
  const first = (): FrozenFileChange => ({
    path: "first.txt",
    before: bytes("\uFEFFbefore\n"),
    after: bytes("\uFEFFafter\n"),
  });
  const options = () => ({ root, protectedRoots, journalPath, planId: "patch-1" });

  it("supports any number of read-only roots, exact bytes and caller order", async () => {
    const applied: string[] = [];
    expect(
      await applyFileChanges(
        [
          first(),
          { path: "nested/new.txt", after: bytes("\uFEFFnew\n") },
          { path: "metadata.json", after: bytes("{}") },
        ],
        {
          ...options(),
          onApplied: (file) => {
            applied.push(file.path);
            file.after?.fill(0);
          },
        }
      )
    ).toMatchObject({ status: "applied", completed: ["first.txt", "nested/new.txt", "metadata.json"] });
    expect(applied).toEqual(["first.txt", "nested/new.txt", "metadata.json"]);
    expect(await fs.readFile(path.join(root, "first.txt"))).toEqual(first().after);
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    expect(journal).toMatchObject({
      version: 2,
      root: await fs.realpath(root),
      protectedRoots: await Promise.all(protectedRoots.map((directory) => fs.realpath(directory))),
      planId: "patch-1",
    });
    expect(await restoreFileChanges(journalPath)).toMatchObject({
      status: "restored",
      completed: ["metadata.json", "nested/new.txt", "first.txt"],
    });
    expect(await fs.readFile(path.join(root, "first.txt"))).toEqual(first().before);
    for (const directory of protectedRoots)
      expect(await fs.readFile(path.join(directory, "input.txt"), "utf8")).toBe("input");
  });

  it("rejects stale inputs before destination validation or journal creation", async () => {
    const result = await applyFileChanges([first()], {
      ...options(),
      assertFresh: async () => {
        throw new Error("Inputs changed");
      },
    });
    expect(result).toMatchObject({ status: "failed", completed: [], error: "Inputs changed" });
    await expect(fs.stat(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks inputs before each write and keeps the partial journal recoverable", async () => {
    let checks = 0;
    const result = await applyFileChanges([first(), { path: "metadata.json", after: bytes("{}") }], {
      ...options(),
      assertFresh: async () => {
        checks++;
        if ((await fs.readFile(path.join(protectedRoots[3], "input.txt"), "utf8")) !== "input")
          throw new Error("Source changed");
      },
      onApplied: async () => {
        await fs.writeFile(path.join(protectedRoots[3], "input.txt"), "external edit");
      },
    });
    expect(result).toMatchObject({ status: "failed", completed: ["first.txt"], error: "Source changed" });
    expect(checks).toBe(3);
    await expect(fs.stat(path.join(root, "metadata.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await fs.readFile(journalPath, "utf8")).files.map((file: { state: string }) => file.state)
    ).toEqual(["applied", "planned"]);
    expect(await restoreFileChanges(journalPath)).toMatchObject({
      status: "restored",
      completed: ["first.txt"],
    });
    expect(await fs.readFile(path.join(protectedRoots[3], "input.txt"), "utf8")).toBe("external edit");
  });

  it("checks inputs after the last write and reports the written file on failure", async () => {
    let fresh = true;
    const result = await applyFileChanges([first()], {
      ...options(),
      assertFresh: async () => {
        if (!fresh) throw new Error("Late source change");
      },
      onApplied: () => {
        fresh = false;
      },
    });
    expect(result).toMatchObject({ status: "failed", completed: ["first.txt"], error: "Late source change" });
    expect(await restoreFileChanges(journalPath)).toMatchObject({ status: "restored" });
  });

  it("freezes caller bytes, paths, roots and callbacks before awaiting", async () => {
    const changes = [first()];
    const input = options();
    const capturedRoot = root;
    let checks = 0;
    const settings = {
      ...input,
      assertFresh: async () => {
        if (checks++ !== 0) return;
        changes[0].after!.fill(0);
        changes[0].path = "wrong.txt";
        input.protectedRoots[0] = root;
        settings.root = protectedRoots[1];
        settings.journalPath = path.join(protectedRoots[1], "wrong.json");
        settings.assertFresh = async () => {
          throw new Error("Wrong callback");
        };
      },
    };
    expect(await applyFileChanges(changes, settings)).toMatchObject({ status: "applied", journalPath });
    expect(checks).toBe(3);
    expect(await fs.readFile(path.join(capturedRoot, "first.txt"))).toEqual(first().after);
  });

  it("rejects overlapping boundaries and journals inside any protected input", async () => {
    expect(
      await applyFileChanges([first()], { ...options(), protectedRoots: [...protectedRoots, root] })
    ).toMatchObject({ status: "failed", error: expect.stringMatching(/overlap/) });
    expect(
      await applyFileChanges([first()], {
        ...options(),
        journalPath: path.join(protectedRoots[3], "journal.json"),
      })
    ).toMatchObject({ status: "failed", error: expect.stringMatching(/outside/) });
    expect(
      await applyFileChanges([first()], {
        ...options(),
        protectedRoots: [...protectedRoots, path.join(protectedRoots[0], "nested")],
      })
    ).toMatchObject({ status: "failed" });
    expect(await fs.readFile(path.join(root, "first.txt"))).toEqual(first().before);
  });

  it("rejects linked roots on apply and boundary changes before restore", async () => {
    const alias = path.join(scratch, "alias");
    await fs.symlink(protectedRoots[0], alias, "junction");
    expect(await applyFileChanges([first()], { ...options(), protectedRoots: [alias] })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/Links/),
    });
    expect(await applyFileChanges([first()], options())).toMatchObject({ status: "applied" });
    const original = protectedRoots[3];
    const moved = path.join(scratch, "moved");
    await fs.rename(original, moved);
    await fs.symlink(moved, original, "junction");
    expect(await restoreFileChanges(journalPath)).toMatchObject({ status: "failed", completed: [] });
    expect(await fs.readFile(path.join(root, "first.txt"))).toEqual(first().after);
  });

  it("does not overwrite disk edits or newly opened dirty buffers during restore", async () => {
    expect(
      await applyFileChanges([first(), { path: "new.txt", after: bytes("generated") }], options())
    ).toMatchObject({ status: "applied" });
    await fs.writeFile(path.join(root, "first.txt"), "manual edit");
    const document = { path: "new.txt", text: "unsaved edit", version: 1, dirty: true };
    expect(
      await restoreFileChanges(journalPath, {
        documentHost: {
          read: async (filename) => (filename === document.path ? document : undefined),
          write: async () => {
            throw new Error("Must not write");
          },
        },
      })
    ).toMatchObject({ status: "conflict", completed: [], conflicts: ["new.txt", "first.txt"] });
    expect(await fs.readFile(path.join(root, "first.txt"), "utf8")).toBe("manual edit");
  });

  it("explains how to close an unchanged created-file editor and completes recovery on retry", async () => {
    const filename = path.join(root, "new.txt");
    const generated = bytes("\uFEFFgenerated\n");
    expect(await applyFileChanges([{ path: "new.txt", after: generated }], options())).toMatchObject({
      status: "applied",
    });
    const document = { path: "new.txt", text: "generated\n", version: 1, dirty: false };
    const documentHost = {
      read: async () => document,
      write: async () => {
        throw new Error("Must not edit the generated buffer");
      },
    };
    expect(await restoreFileChanges(journalPath, { documentHost })).toMatchObject({
      status: "conflict",
      conflicts: ["new.txt"],
      completed: [],
      error: expect.stringMatching(/Close.*new\.txt/),
    });
    expect(await fs.readFile(filename)).toEqual(generated);
    expect(JSON.parse(await fs.readFile(journalPath, "utf8")).files[0].state).toBe("applied");
    document.dirty = true;
    document.text = "manual edit";
    const dirty = await restoreFileChanges(journalPath, { documentHost });
    expect(dirty).toMatchObject({ status: "conflict", conflicts: ["new.txt"], completed: [] });
    expect(dirty.error).toBeUndefined();
    expect(document.text).toBe("manual edit");
    expect(await fs.readFile(filename)).toEqual(generated);
    expect(await restoreFileChanges(journalPath)).toMatchObject({
      status: "restored",
      completed: ["new.txt"],
    });
    await expect(fs.stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await fs.readFile(journalPath, "utf8")).files[0].state).toBe("restored");
  });
  it("creates recovery journals exclusively before any output mutation", async () => {
    await fs.writeFile(journalPath, "existing recovery journal");
    expect(await applyFileChanges([first()], options())).toMatchObject({ status: "failed", completed: [] });
    expect(await fs.readFile(journalPath, "utf8")).toBe("existing recovery journal");
    expect(await fs.readFile(path.join(root, "first.txt"))).toEqual(first().before);
  });

  it.each(["apply", "restore"])("preserves edits made while persisting the %s journal", async (stage) => {
    if (stage === "restore")
      expect(await applyFileChanges([first()], options())).toMatchObject({ status: "applied" });
    const journalFilename = path.join(await fs.realpath(scratch), "journal.json");
    const rename = fs.rename.bind(fs);
    let edited = false;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (to !== journalFilename || edited) return;
      const journal = JSON.parse(await fs.readFile(journalFilename, "utf8"));
      if (journal.files[0].state !== (stage === "apply" ? "pending" : "restoring")) return;
      edited = true;
      await fs.writeFile(path.join(root, "first.txt"), "new manual edit");
    });
    const result =
      stage === "apply"
        ? await applyFileChanges([first()], options())
        : await restoreFileChanges(journalPath);
    expect(result).toMatchObject({ status: stage === "apply" ? "failed" : "conflict", completed: [] });
    expect(edited).toBe(true);
    expect(await fs.readFile(path.join(root, "first.txt"), "utf8")).toBe("new manual edit");
    expect(await restoreFileChanges(journalPath)).toMatchObject({
      status: "conflict",
      conflicts: ["first.txt"],
    });
  });
});
