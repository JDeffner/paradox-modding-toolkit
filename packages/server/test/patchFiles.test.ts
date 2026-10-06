import { promises as fs } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPatchSourcesFresh,
  capturePatchSources,
  preparePatchOutput,
  type PatchSourceBindings,
} from "../src/compatch/node";
import type { PatchDesiredOutput, PatchPolicy, PatchProject } from "../src/compatch/model";

const policy: PatchPolicy = {
  revision: "test-1",
  scriptFolders: [{ path: "common/test", kind: "definition" }],
  localizationFolder: "localization",
  fileRules: [{ path: "gui", precedence: "first" }],
  evidence: ["test fixture"],
};
const project = (): PatchProject => ({
  version: 1,
  id: "fixture",
  gameId: "ck3",
  name: "Patch fixture",
  inputs: ["a", "b", "c"].map((id) => ({ id, name: `Source ${id}` })),
  decisions: {},
  generated: {},
  custom: { keep: true },
});

describe("patch source capture", () => {
  let scratch: string;
  let bindings: PatchSourceBindings;
  beforeEach(async () => {
    const parent = path.resolve(".local/testing");
    await fs.mkdir(parent, { recursive: true });
    scratch = await fs.mkdtemp(path.join(parent, "patch-files-"));
    bindings = { output: path.join(scratch, "output"), sources: {} };
    await fs.mkdir(bindings.output);
    for (const id of ["a", "b", "c"]) {
      const root = (bindings.sources[id] = path.join(scratch, id));
      await fs.mkdir(path.join(root, "common/test"), { recursive: true });
      await fs.writeFile(path.join(root, "common/test/data.txt"), `\uFEFFshared = { value = ${id} }\n`);
      await fs.writeFile(
        path.join(root, "descriptor.mod"),
        `name = "Actual ${id}"\nversion = "1.2"\ndependencies = { "Base # one" "Other" }\nreplace_path = "common/test"\n`
      );
    }
  });
  afterEach(async () => {
    if (!scratch.startsWith(path.resolve(".local/testing") + path.sep)) throw new Error("Unsafe cleanup");
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("captures three ordered sources and exact text, with descriptor metadata", async () => {
    const captured = await capturePatchSources(project(), bindings, policy);
    expect(captured.snapshot.sources.map((source) => source.id)).toEqual(["a", "b", "c"]);
    expect(captured.snapshot.sources[0]).toMatchObject({
      name: "Actual a",
      version: "1.2",
      dependencies: ["Base # one", "Other"],
      replacePaths: ["common/test"],
      files: [{ path: "common/test/data.txt", text: "\uFEFFshared = { value = a }\n" }],
    });
    expect(captured.bindings.output).toBe(await fs.realpath(bindings.output));
    await expect(assertPatchSourcesFresh(captured, project(), bindings, policy)).resolves.toBeUndefined();
    const reordered = project();
    reordered.inputs.reverse();
    await expect(assertPatchSourcesFresh(captured, reordered, bindings, policy)).rejects.toThrow(
      /sources changed/
    );
  });

  it("captures dirty buffers and new unsaved files, including a dirty descriptor", async () => {
    const documents = [
      {
        sourceId: "b",
        path: "common/test/data.txt",
        text: "unsaved = { value = 2 }\n",
        version: 4,
        dirty: true,
      },
      { sourceId: "b", path: "common/test/new.txt", text: "new = { value = 3 }\n", version: 1, dirty: true },
      {
        sourceId: "b",
        path: "descriptor.mod",
        text: 'name = "Unsaved name"\nversion = "2"',
        version: 2,
        dirty: true,
      },
    ];
    const captured = await capturePatchSources(project(), bindings, policy, { documents });
    expect(captured.snapshot.sources[1]).toMatchObject({
      name: "Unsaved name",
      version: "2",
      files: [
        { path: "common/test/data.txt", text: "\uFEFFunsaved = { value = 2 }\n" },
        { path: "common/test/new.txt", text: "new = { value = 3 }\n" },
      ],
    });
    await fs.writeFile(path.join(bindings.sources.b, "common/test/data.txt"), "disk changed behind buffer");
    await expect(
      assertPatchSourcesFresh(captured, project(), bindings, policy, { documents })
    ).rejects.toThrow(/sources changed/);
    expect(await fs.readFile(path.join(bindings.sources.b, "common/test/data.txt"), "utf8")).toBe(
      "disk changed behind buffer"
    );
  });

  it("invalidates on source creation, deletion, descriptor, editor version and policy changes", async () => {
    const captured = await capturePatchSources(project(), bindings, policy);
    const extra = path.join(bindings.sources.c, "common/test/new.txt");
    await fs.writeFile(extra, "new = {}\n");
    await expect(assertPatchSourcesFresh(captured, project(), bindings, policy)).rejects.toThrow(
      /sources changed/
    );
    await fs.unlink(extra);
    await expect(assertPatchSourcesFresh(captured, project(), bindings, policy)).resolves.toBeUndefined();
    await fs.unlink(path.join(bindings.sources.c, "common/test/data.txt"));
    await expect(assertPatchSourcesFresh(captured, project(), bindings, policy)).rejects.toThrow(
      /sources changed/
    );
    await fs.writeFile(
      path.join(bindings.sources.c, "common/test/data.txt"),
      "\uFEFFshared = { value = c }\n"
    );
    await fs.appendFile(path.join(bindings.sources.a, "descriptor.mod"), "# changed metadata\n");
    await expect(assertPatchSourcesFresh(captured, project(), bindings, policy)).rejects.toThrow(
      /sources changed/
    );
    const document = {
      sourceId: "a",
      path: "common/test/data.txt",
      text: "shared = { value = a }\n",
      version: 1,
      dirty: false,
    };
    const editorCapture = await capturePatchSources(project(), bindings, policy, { documents: [document] });
    await expect(
      assertPatchSourcesFresh(editorCapture, project(), bindings, policy, {
        documents: [{ ...document, version: 2 }],
      })
    ).rejects.toThrow(/sources changed/);
    await expect(
      assertPatchSourcesFresh(
        editorCapture,
        project(),
        bindings,
        { ...policy, revision: "test-2" },
        { documents: [document] }
      )
    ).rejects.toThrow(/sources changed/);
  });

  it("inventories binary paths without decoding them and reports the limitation", async () => {
    await fs.mkdir(path.join(bindings.sources.a, "gfx"));
    await fs.writeFile(path.join(bindings.sources.a, "gfx/texture.dds"), new Uint8Array([0xff, 0xfe, 0xfd]));
    const captured = await capturePatchSources(project(), bindings, policy);
    expect(captured.snapshot.sources[0].files.some((file) => file.path.endsWith(".dds"))).toBe(false);
    expect(captured.snapshot.sources[0].issues).toContain(
      "Binary file requires external review and is not generated: gfx/texture.dds"
    );
    expect(captured.inventory).toContainEqual(
      expect.objectContaining({ sourceId: "a", path: "gfx/texture.dds", kind: "binary", size: 3 })
    );
  });

  it("rejects overlapping roots, case aliases, source links and invalid UTF-8", async () => {
    await expect(
      capturePatchSources(project(), { ...bindings, output: bindings.sources.a }, policy)
    ).rejects.toThrow(/overlap/);
    await expect(
      capturePatchSources(
        project(),
        { ...bindings, sources: { ...bindings.sources, b: bindings.sources.a } },
        policy
      )
    ).rejects.toThrow(/overlap/);
    await expect(
      capturePatchSources(project(), bindings, policy, {
        documents: [{ sourceId: "a", path: "common/test/DATA.txt", text: "alias", version: 1, dirty: true }],
      })
    ).rejects.toThrow(/collision|alias/);
    const link = path.join(bindings.sources.b, "link");
    await fs.symlink(bindings.sources.c, link, "junction");
    await expect(capturePatchSources(project(), bindings, policy)).rejects.toThrow(/Links/);
    await fs.unlink(link);
    await fs.writeFile(path.join(bindings.sources.c, "common/test/data.txt"), new Uint8Array([0xff]));
    await expect(capturePatchSources(project(), bindings, policy)).rejects.toThrow(/valid UTF-8/);
  });

  it("rejects oversized text before reading and honors cancellation", async () => {
    const handle = await fs.open(path.join(bindings.sources.a, "common/test/large.txt"), "w");
    try {
      await handle.truncate(33 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    await expect(capturePatchSources(project(), bindings, policy)).rejects.toThrow(/limit exceeded/);
    const controller = new AbortController();
    controller.abort();
    await expect(
      capturePatchSources(project(), bindings, policy, { signal: controller.signal })
    ).rejects.toThrow(/cancelled/);
  });
});

describe("maintained patch output", () => {
  const filename = "common/test/patch.txt";
  const base = "\uFEFFalpha = 1\nkeep_a = 1\nkeep_b = 2\nkeep_c = 3\nkeep_d = 4\nbeta = 1\n";
  const desired = (text: string): PatchDesiredOutput => ({
    files: [{ path: filename, text, entries: ["definition:test:alpha"] }],
    issues: [],
  });
  const owned = (): PatchProject => ({
    ...project(),
    generated: { [filename]: { text: base, entries: ["definition:test:alpha"], custom: "retained" } },
  });

  it("merges independent manual edits while recording only the pure new baseline", async () => {
    const current = base.replace("alpha = 1", "alpha = manual");
    const generated = base.replace("beta = 1", "beta = upstream");
    const plan = await preparePatchOutput(owned(), desired(generated), [
      { path: filename, text: current },
      { path: "unrelated.txt", text: "leave alone" },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.files).toEqual([
      { path: filename, before: current, after: current.replace("beta = 1", "beta = upstream") },
    ]);
    expect(plan.project.generated[filename]).toMatchObject({ text: generated, custom: "retained" });
    expect(plan.project.custom).toEqual({ keep: true });
    const repeat = await preparePatchOutput(plan.project, desired(generated), [
      { path: filename, text: plan.files[0].after! },
    ]);
    expect(repeat.files).toEqual([]);
  });

  it("reports overlapping edits and supports explicit current or generated choices", async () => {
    const current = base.replace("alpha = 1", "alpha = manual");
    const generated = base.replace("alpha = 1", "alpha = upstream");
    const input = [{ path: filename, text: current }];
    expect((await preparePatchOutput(owned(), desired(generated), input)).conflicts).toEqual([
      { path: filename, reason: "Manual edits overlap the new generated changes.", current, generated },
    ]);
    const keep = await preparePatchOutput(owned(), desired(generated), input, { [filename]: "current" });
    expect(keep.files).toEqual([]);
    expect(keep.project.generated[filename].text).toBe(generated);
    const replace = await preparePatchOutput(owned(), desired(generated), input, { [filename]: "generated" });
    expect(replace.files).toEqual([{ path: filename, before: current, after: generated }]);
  });

  it("removes only unchanged owned obsolete files and preserves edited obsolete files", async () => {
    const empty: PatchDesiredOutput = { files: [], issues: [] };
    expect((await preparePatchOutput(owned(), empty, [{ path: filename, text: base }])).files).toEqual([
      { path: filename, before: base, after: undefined },
    ]);
    const current = base + "# manual work\n";
    expect(
      (await preparePatchOutput(owned(), empty, [{ path: filename, text: current }])).conflicts[0].reason
    ).toMatch(/manual edits/);
    const keep = await preparePatchOutput(owned(), empty, [{ path: filename, text: current }], {
      [filename]: "current",
    });
    expect(keep.files).toEqual([]);
    expect(keep.project.generated).toEqual({});
    const remove = await preparePatchOutput(owned(), empty, [{ path: filename, text: current }], {
      [filename]: "generated",
    });
    expect(remove.files).toEqual([{ path: filename, before: current, after: undefined }]);
  });

  it("requires a choice for deleted owned files and advances the baseline for keep deletion", async () => {
    const generated = base.replace("beta = 1", "beta = 2");
    expect((await preparePatchOutput(owned(), desired(generated), [])).conflicts[0].reason).toMatch(
      /deleted/
    );
    const keep = await preparePatchOutput(owned(), desired(generated), [], { [filename]: "current" });
    expect(keep.files).toEqual([]);
    expect(keep.project.generated[filename].text).toBe(generated);
    const restore = await preparePatchOutput(owned(), desired(generated), [], { [filename]: "generated" });
    expect(restore.files).toEqual([{ path: filename, before: undefined, after: generated }]);
  });

  it("requires explicit adoption of unowned collisions and restores their original content later", async () => {
    const original = base.replace("alpha = 1", "alpha = original");
    const input = [{ path: filename, text: original }];
    expect((await preparePatchOutput(project(), desired(base), input)).conflicts[0].reason).toMatch(
      /not owned/
    );
    const adopted = await preparePatchOutput(project(), desired(base), input, { [filename]: "generated" });
    expect(adopted.project.generated[filename]).toMatchObject({ text: base, original });
    const removed = await preparePatchOutput(adopted.project, { files: [], issues: [] }, [
      { path: filename, text: base },
    ]);
    expect(removed.conflicts).toEqual([]);
    expect(removed.files).toEqual([{ path: filename, before: base, after: original }]);
    expect(removed.project.generated).toEqual({});
  });

  it("preserves later independent manual changes when restoring an adopted original file", async () => {
    const original = base.replace("alpha = 1", "alpha = original");
    const adopted = await preparePatchOutput(project(), desired(base), [{ path: filename, text: original }], {
      [filename]: "generated",
    });
    const current = base.replace("beta = 1", "beta = manual");
    const removed = await preparePatchOutput(adopted.project, { files: [], issues: [] }, [
      { path: filename, text: current },
    ]);
    expect(removed.conflicts).toEqual([]);
    expect(removed.files[0].after).toBe(original.replace("beta = 1", "beta = manual"));
    const competing = base.replace("alpha = 1", "alpha = manual");
    expect(
      (
        await preparePatchOutput(adopted.project, { files: [], issues: [] }, [
          { path: filename, text: competing },
        ])
      ).conflicts[0].reason
    ).toMatch(/overlap/);
  });

  it("preserves unknown baseline fields, caller inputs and manual changes with unchanged generation", async () => {
    const inputProject = owned();
    const inputDesired = desired(base);
    const current = base + "# manual\n";
    const plan = await preparePatchOutput(inputProject, inputDesired, [{ path: filename, text: current }]);
    expect(plan.files).toEqual([]);
    expect(plan.project.generated[filename]).toMatchObject({ text: base, custom: "retained" });
    expect(inputProject.generated[filename].text).toBe(base);
    expect(inputDesired.files[0].text).toBe(base);
    expect(plan.project).not.toBe(inputProject);
  });

  it("rejects duplicate and case-aliased output paths", async () => {
    await expect(
      preparePatchOutput(project(), desired(base), [
        { path: filename, text: base },
        { path: filename, text: "duplicate" },
      ])
    ).rejects.toThrow(/Invalid current/);
    await expect(
      preparePatchOutput(project(), desired(base), [{ path: "common/test/PATCH.txt", text: base }])
    ).rejects.toThrow(/collision|alias/);
  });
});
