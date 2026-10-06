import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ck3PortraitMaskMigration,
  maskBatchKey,
  maskKeepNoteKey,
  maskPolicyKey,
} from "../src/games/ck3/migrations/masks";
import { inspectDdsResource } from "../src/dds/migrateMips";
import { discoverMigration, inspectMigration, prepareMigration } from "../src/migrations/engine";
import {
  assertMigrationIdempotent,
  createMigrationSnapshot,
  runMigrationFixture,
} from "../src/migrations/testing";
import type { MigrationContext, MigrationSnapshot } from "../src/migrations/sdk";
import { captureMigration } from "../src/migrations/node/files";

const TEXTURE = "gfx/custom/texture_without_a_mask_filename.dds";
const ASSET = "gfx/custom/consumer.asset";
const VARIATION = "gfx/portraits/accessory_variations/custom.txt";

// Authored fixtures follow the consumer shapes measured in target vanilla.
function asset(path: string, name = "example_entity"): string {
  return `\uFEFFentity = { name = "${name}" game_data = { portrait_entity_user_data = { portrait_accessory = { pattern_mask = "${path}" variation = "example_variation" } } } }`;
}
function variation(path: string): string {
  return `\uFEFFpattern_textures = { name = example_pattern colormask = "${path}" normal = "gfx/unrelated.dds" }`;
}
function dds(width: number, count: number, format: "bc3" | "bc7" = "bc3", height = width): Uint8Array {
  let length = format === "bc7" ? 148 : 128;
  let w = width,
    h = height;
  for (let n = 0; n < count; n++) {
    length += Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  const bytes = new Uint8Array(length);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 0x20534444, true);
  dv.setUint32(4, 124, true);
  dv.setUint32(8, 0xa1007, true);
  dv.setUint32(12, height, true);
  dv.setUint32(16, width, true);
  dv.setUint32(20, Math.ceil(width / 4) * Math.ceil(height / 4) * 16, true);
  dv.setUint32(28, count, true);
  dv.setUint32(76, 32, true);
  dv.setUint32(80, 4, true);
  dv.setUint32(84, format === "bc7" ? 0x30315844 : 0x35545844, true);
  dv.setUint32(108, count > 1 ? 0x401008 : 0x1000, true);
  if (format === "bc7") {
    dv.setUint32(128, 98, true);
    dv.setUint32(132, 3, true);
    dv.setUint32(140, 1, true);
  }
  bytes.fill(0x37, format === "bc7" ? 148 : 128);
  return bytes;
}

function snapshot(
  width = 512,
  oldCount = 10,
  newCount = 2,
  format: "bc3" | "bc7" = "bc3"
): MigrationSnapshot {
  return createMigrationSnapshot({
    gameId: "ck3",
    mod: { [TEXTURE]: dds(width, oldCount, format), "gfx/unrelated_mask.dds": dds(8, 4) },
    source: { [TEXTURE]: dds(width, oldCount, format) },
    target: { [ASSET]: asset(TEXTURE), [TEXTURE]: dds(width, newCount, format) },
  });
}

function prefixContext(snapshot: MigrationSnapshot, fullPaths: string[] = []): MigrationContext {
  return {
    gameId: snapshot.gameId,
    list(root, prefix = "") {
      return snapshot.files
        .filter(
          (file) =>
            file.root === root && (!prefix || file.path === prefix || file.path.startsWith(`${prefix}/`))
        )
        .map((file) => file.path);
    },
    fileInfo(root, path) {
      const file = snapshot.files.find((file) => file.root === root && file.path === path);
      return file && { size: file.bytes.length };
    },
    readBytes(root, path) {
      const bytes = snapshot.files.find((file) => file.root === root && file.path === path)?.bytes;
      return bytes && /\.dds$/iu.test(path) && !(root === "mod" && fullPaths.includes(path))
        ? bytes.slice(0, 148)
        : bytes;
    },
    readText(root, path) {
      const bytes = this.readBytes(root, path);
      return bytes && new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    },
  };
}

describe("CK3 portrait and clothing mip migration", () => {
  it("lists target-only masks without reading their bytes during bounded SDK 2 capture", async () => {
    const parent = path.resolve(".local/testing");
    await fs.mkdir(parent, { recursive: true });
    const scratch = await fs.mkdtemp(path.join(parent, "migration-masks-"));
    if (!scratch.startsWith(parent + path.sep)) throw new Error("Unsafe scratch cleanup");
    const roots = {
      mod: path.join(scratch, "mod"),
      source: path.join(scratch, "source"),
      target: path.join(scratch, "target"),
    };
    const other = "gfx/custom/unchanged_target_only.dds";
    try {
      for (const root of Object.values(roots))
        await fs.mkdir(path.join(root, "gfx/custom"), { recursive: true });
      await fs.writeFile(path.join(roots.mod, TEXTURE), dds(512, 10));
      await fs.writeFile(path.join(roots.source, TEXTURE), dds(512, 10));
      await fs.writeFile(path.join(roots.target, TEXTURE), dds(512, 2));
      await fs.writeFile(
        path.join(roots.target, ASSET),
        asset(TEXTURE) + "\n" + asset(other, "unchanged_target_entity")
      );
      // An unrelated reference file exceeds the entire input budget, but only its name and size are needed.
      const handle = await fs.open(path.join(roots.target, other), "w");
      try {
        await handle.truncate(129 * 1024 * 1024);
      } finally {
        await handle.close();
      }
      const seed = await captureMigration(roots, ck3PortraitMaskMigration.manifest, "ck3", [], {
        limits: { inputBytes: 4096 },
      });
      expect(seed.listings).toContainEqual({ root: "target", path: other, size: 129 * 1024 * 1024 });
      expect(seed.files.some((file) => file.root === "target" && file.path === other)).toBe(false);
      expect(
        seed.files.filter((file) => /\.dds$/iu.test(file.path)).map((file) => file.bytes.length)
      ).toEqual([148, 148, 148]);
      const inspection = await inspectMigration(ck3PortraitMaskMigration, seed, {});
      expect(inspection.inspection.applicability).toBe("applicable");
      expect(inspection.inspection.findings.filter((finding) => finding.severity === "error")).toEqual([]);
      const answers = { [maskBatchKey]: "all" };
      const selected = await discoverMigration(ck3PortraitMaskMigration, seed, answers);
      expect(selected).toEqual([{ root: "mod", path: TEXTURE }]);
      const captured = await captureMigration(roots, ck3PortraitMaskMigration.manifest, "ck3", [], {
        capture: { selected },
      });
      const plan = await prepareMigration(ck3PortraitMaskMigration, captured, answers, "fixture");
      expect(plan.files.map((file) => file.path)).toEqual([TEXTURE]);
      expect(inspectDdsResource(plan.files[0].after!).mipLevelCount).toBe(2);
      expect(captured.files.some((file) => file.root === "target" && file.path === other)).toBe(false);
      await fs.unlink(path.join(roots.target, other));
      const missing = await inspectMigration(
        ck3PortraitMaskMigration,
        await captureMigration(roots, ck3PortraitMaskMigration.manifest, "ck3"),
        {}
      );
      // An absent texture used only by an unrelated target consumer is outside this migration.
      expect(missing.inspection.applicability).toBe("applicable");
      expect(missing.inspection.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });

  it("ignores unrelated target aliases and duplicate definitions when migrating a known mod texture", async () => {
    const input = snapshot();
    input.files.push(
      {
        root: "target",
        path: "gfx/unrelated.asset",
        bytes: new TextEncoder().encode(asset("/gfx/unrelated.dds", "unrelated_entity")),
      },
      {
        root: "target",
        path: "gfx/portraits/accessory_variations/one.txt",
        bytes: new TextEncoder().encode(variation("gfx/one.dds")),
      },
      {
        root: "target",
        path: "gfx/portraits/accessory_variations/two.txt",
        bytes: new TextEncoder().encode(variation("gfx/two.dds")),
      }
    );
    const inspection = await inspectMigration(ck3PortraitMaskMigration, input, {});
    expect(inspection.inspection.applicability).toBe("applicable");
    expect(inspection.inspection.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    const plan = await prepareMigration(
      ck3PortraitMaskMigration,
      input,
      { [maskBatchKey]: "all" },
      "fixture"
    );
    expect(plan.files.map((file) => file.path)).toEqual([TEXTURE]);
  });

  it.each([
    asset("/" + TEXTURE),
    asset(TEXTURE).replace('name = "example_entity"', ""),
    `pattern_mask = "${TEXTURE}"`,
    asset(TEXTURE).slice(0, -1),
  ])("blocks target anomalies that refer to a mod texture", async (text) => {
    const input = snapshot();
    input.files.find((file) => file.root === "target" && file.path === ASSET)!.bytes =
      new TextEncoder().encode(text);
    const inspection = await inspectMigration(ck3PortraitMaskMigration, input, {});
    expect(inspection.inspection.applicability).toBe("unknown");
    expect(inspection.inspection.findings.some((finding) => finding.severity === "error")).toBe(true);
    await expect(
      prepareMigration(ck3PortraitMaskMigration, input, { [maskBatchKey]: "all" }, "fixture")
    ).rejects.toThrow();
  });

  it("blocks conflicting target duplicates if any definition uses a mod texture", async () => {
    const input = snapshot();
    input.files.push(
      {
        root: "target",
        path: "gfx/portraits/accessory_variations/one.txt",
        bytes: new TextEncoder().encode(variation(TEXTURE)),
      },
      {
        root: "target",
        path: "gfx/portraits/accessory_variations/two.txt",
        bytes: new TextEncoder().encode(variation("gfx/other.dds")),
      }
    );
    const inspection = await inspectMigration(ck3PortraitMaskMigration, input, {});
    expect(inspection.inspection.findings).toContainEqual(
      expect.objectContaining({
        id: "mask.duplicate:target:pattern_textures:example_pattern",
        severity: "error",
      })
    );
  });

  it("keeps target anomalies relevant when a mod overrides their consumer identity", async () => {
    const input = snapshot();
    input.files.find((file) => file.root === "target" && file.path === ASSET)!.bytes =
      new TextEncoder().encode(asset("/gfx/unrelated.dds"));
    input.files.push({ root: "mod", path: "gfx/mod.asset", bytes: new TextEncoder().encode(asset(TEXTURE)) });
    const inspection = await inspectMigration(ck3PortraitMaskMigration, input, {});
    expect(
      inspection.inspection.findings.some((finding) => finding.id.startsWith("mask.reference:target:"))
    ).toBe(true);
    expect(inspection.inspection.applicability).toBe("unknown");
  });

  it.each([
    [512, 10, 2],
    [1024, 11, 3],
    [2048, 12, 4],
  ])(
    "uses exact target counts for %i square textures and preserves mod pixels",
    async (width, oldCount, newCount) => {
      const input = snapshot(width, oldCount, newCount);
      const result = await assertMigrationIdempotent({
        recipe: ck3PortraitMaskMigration,
        snapshot: input,
        answers: { [maskBatchKey]: "all" },
      });
      expect(result.plan.files.map((file) => file.path)).toEqual([TEXTURE]);
      expect(result.plan.continuation).toBe(false);
      const changed = result.plan.files[0];
      const resource = inspectDdsResource(changed.after!);
      expect(resource.mipLevelCount).toBe(newCount);
      expect(
        Buffer.compare(
          changed.after!.subarray(resource.dataOffset),
          changed.before!.subarray(resource.dataOffset, changed.after!.length)
        )
      ).toBe(0);
      const references = result.snapshot.files.filter((file) => file.root !== "mod");
      const originalReferences = input.files.filter((file) => file.root !== "mod");
      expect(references.map((file) => ({ ...file, bytes: undefined }))).toEqual(
        originalReferences.map((file) => ({ ...file, bytes: undefined }))
      );
      for (const [index, file] of references.entries())
        expect(Buffer.compare(file.bytes, originalReferences[index].bytes)).toBe(0);
      expect(
        Buffer.compare(
          result.snapshot.files.find((file) => file.path === "gfx/unrelated_mask.dds")!.bytes,
          input.files.find((file) => file.path === "gfx/unrelated_mask.dds")!.bytes
        )
      ).toBe(0);
      expect(result.plan.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "mask.structure", status: "passed" }),
          expect.objectContaining({ id: "mask.render", status: "not-run" }),
        ])
      );
    }
  );

  it("traces colormask variation consumers and leaves BOM text and other texture keys untouched", async () => {
    const input = snapshot();
    input.files = input.files.filter((file) => file.path !== ASSET);
    const text = variation(TEXTURE);
    input.files.push({ root: "target", path: VARIATION, bytes: new TextEncoder().encode(text) });
    input.files.push({ root: "mod", path: VARIATION, bytes: new TextEncoder().encode(text) });
    const result = await runMigrationFixture({
      recipe: ck3PortraitMaskMigration,
      snapshot: input,
      answers: { [maskBatchKey]: "all" },
    });
    expect(result.plan.files.map((file) => file.path)).toEqual([TEXTURE]);
    expect(
      result.snapshot.files.find((file) => file.root === "mod" && file.path === VARIATION)!.bytes
    ).toEqual(new TextEncoder().encode(text));
  });

  it("keeps a proven full-chain target counterexample without a universal stop-at-256 rule", async () => {
    const result = await inspectMigration(ck3PortraitMaskMigration, snapshot(1024, 11, 11), {});
    expect(result.inspection.applicability).toBe("not-applicable");
    expect(result.inspection.questions).toEqual([]);
    expect(result.inspection.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: `mask.evidence:${TEXTURE}`, severity: "info" })])
    );
  });

  it("requires explicit custom policies before requesting a full binary batch", async () => {
    const input = createMigrationSnapshot({
      gameId: "ck3",
      mod: { [ASSET]: asset(TEXTURE), [TEXTURE]: dds(1024, 11) },
    });
    const context = prefixContext(input);
    expect(await ck3PortraitMaskMigration.discover(context, {})).toEqual([]);
    const inspection = await ck3PortraitMaskMigration.inspect(context, {});
    expect(inspection.applicability).toBe("applicable");
    expect(inspection.questions[0]).toMatchObject({ id: maskPolicyKey(TEXTURE), group: TEXTURE });
    const policies = { [maskPolicyKey(TEXTURE)]: "stop-at-256" };
    expect(await ck3PortraitMaskMigration.discover(context, policies)).toEqual([]);
    const answers = { ...policies, [maskBatchKey]: "all" };
    expect(await ck3PortraitMaskMigration.discover(context, answers)).toEqual([
      { root: "mod", path: TEXTURE },
    ]);
    const result = await assertMigrationIdempotent({
      recipe: ck3PortraitMaskMigration,
      snapshot: input,
      answers,
    });
    expect(inspectDdsResource(result.plan.files[0].after!).mipLevelCount).toBe(3);
  });

  it("asks for a policy when resolution changed and allows a specific level count", async () => {
    const input = snapshot();
    input.files.find((file) => file.root === "mod" && file.path === TEXTURE)!.bytes = dds(1024, 11);
    const initial = await inspectMigration(ck3PortraitMaskMigration, input, {});
    expect(initial.inspection.questions.map((question) => question.id)).toContain(maskPolicyKey(TEXTURE));
    const result = await runMigrationFixture({
      recipe: ck3PortraitMaskMigration,
      snapshot: input,
      answers: { [maskPolicyKey(TEXTURE)]: "count:4", [maskBatchKey]: "all" },
    });
    expect(inspectDdsResource(result.plan.files[0].after!).mipLevelCount).toBe(4);
  });

  it("requires a custom policy when a texture gains a consumer class absent from the target", async () => {
    const input = snapshot();
    input.files.push({ root: "mod", path: VARIATION, bytes: new TextEncoder().encode(variation(TEXTURE)) });
    const result = await ck3PortraitMaskMigration.inspect(prefixContext(input), {});
    expect(result.questions.map((question) => question.id)).toContain(maskPolicyKey(TEXTURE));
  });

  it("rejects impossible counts and requires a reason for keeping a custom mask", async () => {
    const input = createMigrationSnapshot({
      gameId: "ck3",
      mod: { [ASSET]: asset(TEXTURE), [TEXTURE]: dds(512, 10) },
    });
    const invalid = await inspectMigration(ck3PortraitMaskMigration, input, {
      [maskPolicyKey(TEXTURE)]: "count:11",
    });
    expect(invalid.invalidAnswers).toContain(maskPolicyKey(TEXTURE));
    expect(invalid.inspection.findings.some((finding) => finding.id === `mask.policy:${TEXTURE}`)).toBe(true);
    await expect(
      prepareMigration(ck3PortraitMaskMigration, input, { [maskPolicyKey(TEXTURE)]: "count:11" }, "fixture")
    ).rejects.toThrow();
    const emptyNote = await ck3PortraitMaskMigration.inspect(prefixContext(input), {
      [maskPolicyKey(TEXTURE)]: "keep",
    });
    expect(emptyNote.applicability).toBe("unknown");
    const kept = await ck3PortraitMaskMigration.inspect(prefixContext(input), {
      [maskPolicyKey(TEXTURE)]: "keep",
      [maskKeepNoteKey(TEXTURE)]: "This custom accessory is tested with its full chain.",
    });
    expect(kept.applicability).toBe("not-applicable");
    expect(kept.findings.some((finding) => finding.id === `mask.kept:${TEXTURE}`)).toBe(true);
  });

  it("does not offer stop-at-256 for unsupported dimensions", async () => {
    const input = createMigrationSnapshot({
      gameId: "ck3",
      mod: { [ASSET]: asset(TEXTURE), [TEXTURE]: dds(512, 5, "bc3", 256) },
    });
    const result = await ck3PortraitMaskMigration.inspect(prefixContext(input), {});
    expect(result.questions[0].options?.some((option) => option.value === "stop-at-256")).toBe(false);
  });

  it("trims BC7 without decoding and reports unsupported BC7 tail generation", async () => {
    const result = await runMigrationFixture({
      recipe: ck3PortraitMaskMigration,
      snapshot: snapshot(512, 10, 2, "bc7"),
      answers: { [maskBatchKey]: "all" },
    });
    expect(inspectDdsResource(result.plan.files[0].after!).format).toBe("BC7 (DXGI 98)");
    await expect(
      prepareMigration(
        ck3PortraitMaskMigration,
        snapshot(512, 1, 2, "bc7"),
        { [maskBatchKey]: "all" },
        "fixture"
      )
    ).rejects.toThrow("generation is unsupported");
  });

  it("generates missing BC3 levels while retaining the original base", async () => {
    const input = snapshot(512, 1, 2);
    const result = await runMigrationFixture({
      recipe: ck3PortraitMaskMigration,
      snapshot: input,
      answers: { [maskBatchKey]: "all" },
    });
    const changed = result.plan.files[0];
    const before = inspectDdsResource(changed.before!);
    expect(inspectDdsResource(changed.after!).mipLevelCount).toBe(2);
    expect(changed.after!.subarray(before.dataOffset, changed.before!.length)).toEqual(
      changed.before!.subarray(before.dataOffset)
    );
  });

  it("detects malformed payload boundaries before a full binary read", async () => {
    const input = snapshot();
    const file = input.files.find((file) => file.root === "mod" && file.path === TEXTURE)!;
    file.bytes = file.bytes.slice(0, file.bytes.length - 1);
    const result = await ck3PortraitMaskMigration.inspect(prefixContext(input), {});
    expect(result.applicability).toBe("unknown");
    expect(result.findings.some((finding) => finding.message.includes("payload boundaries"))).toBe(true);
    expect(await ck3PortraitMaskMigration.discover(prefixContext(input), { [maskBatchKey]: "all" })).toEqual(
      []
    );
  });

  it.each([
    `pattern_mask = "${TEXTURE}"`,
    'entity = { name = example game_data = { portrait_entity_user_data = { portrait_accessory = { pattern_mask = "../escape.dds" } } } }',
    'entity = { name = example game_data = { portrait_entity_user_data = { portrait_accessory = { pattern_mask = "gfx/missing.dds" } } } }',
    "entity = { name = example game_data = { portrait_entity_user_data = { portrait_accessory = { pattern_mask = { dynamic = yes } } } } }",
  ])("reports unsupported, escaping, missing and non-scalar consumers", async (text) => {
    const input = createMigrationSnapshot({ gameId: "ck3", mod: { [ASSET]: text, [TEXTURE]: dds(512, 10) } });
    const result = await ck3PortraitMaskMigration.inspect(prefixContext(input), {});
    expect(result.applicability).toBe("unknown");
    expect(result.findings.some((finding) => finding.severity === "error")).toBe(true);
  });

  it("uses effective mod definitions across files and resolves texture case portably", async () => {
    const replaced = "gfx/custom/old.dds";
    const input = createMigrationSnapshot({
      gameId: "ck3",
      mod: { [ASSET]: asset(TEXTURE.toUpperCase()), [TEXTURE]: dds(512, 10), [replaced]: dds(512, 10) },
      target: { "gfx/base.asset": asset(replaced), [replaced]: dds(512, 2) },
    });
    const result = await ck3PortraitMaskMigration.inspect(prefixContext(input), {});
    expect(result.questions.map((question) => question.id)).toEqual([maskPolicyKey(TEXTURE)]);
    expect(result.coverage.join(" ")).toContain("Traced 1 mod textures");
  });

  it("discovers only exact selected mod paths and keeps other batches pending", async () => {
    const second = "gfx/other/second.dds";
    const input = snapshot();
    input.files.push(
      { root: "mod", path: second, bytes: dds(512, 10) },
      { root: "target", path: second, bytes: dds(512, 2) },
      {
        root: "target",
        path: "gfx/other/consumer.asset",
        bytes: new TextEncoder().encode(asset(second, "second_entity")),
      }
    );
    const answers = { [maskBatchKey]: `texture:${TEXTURE}` };
    const requests = await discoverMigration(ck3PortraitMaskMigration, input, answers);
    expect(requests).toEqual([{ root: "mod", path: TEXTURE }]);
    const result = await runMigrationFixture({ recipe: ck3PortraitMaskMigration, snapshot: input, answers });
    expect(result.plan.continuation).toBe(true);
    expect(result.plan.files.map((file) => file.path)).toEqual([TEXTURE]);
    const after = await ck3PortraitMaskMigration.inspect(prefixContext(result.snapshot), {});
    expect(after.applicability).toBe("applicable");
    expect(
      after.questions
        .find((question) => question.id === maskBatchKey)!
        .options!.some((option) => option.value === `texture:${TEXTURE}`)
    ).toBe(false);
    const finished = await runMigrationFixture({
      recipe: ck3PortraitMaskMigration,
      snapshot: result.snapshot,
      answers: { [maskBatchKey]: "all" },
    });
    expect(finished.plan.continuation).toBe(false);
    expect((await ck3PortraitMaskMigration.inspect(prefixContext(finished.snapshot), {})).applicability).toBe(
      "not-applicable"
    );
  });

  it("does not advertise an all-texture batch above the aggregate input limit", async () => {
    const input = createMigrationSnapshot({ gameId: "ck3", mod: {}, target: {} });
    // Header-only test contexts represent large files without allocating their payloads.
    const large = dds(4096, 1);
    for (let n = 0; n < 9; n++) {
      const path = `gfx/group/texture_${n}.dds`;
      input.files.push(
        { root: "mod", path, bytes: large.subarray(0, 148) },
        { root: "target", path, bytes: dds(4096, 1).subarray(0, 148) },
        {
          root: "target",
          path: `gfx/group/consumer_${n}.asset`,
          bytes: new TextEncoder().encode(asset(path, `entity_${n}`)),
        }
      );
      new DataView(
        input.files[input.files.length - 2].bytes.buffer,
        input.files[input.files.length - 2].bytes.byteOffset
      ).setUint32(28, 5, true);
    }
    const context = prefixContext(input);
    const originalInfo = context.fileInfo.bind(context);
    context.fileInfo = (root, path) =>
      /\.dds$/iu.test(path)
        ? { size: root === "target" ? 128 + 16777216 + 4194304 + 1048576 + 262144 + 65536 : 128 + 16777216 }
        : originalInfo(root, path);
    const result = await ck3PortraitMaskMigration.inspect(context, {});
    expect(result.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    const options = result.questions.find((question) => question.id === maskBatchKey)!.options!;
    expect(options.some((option) => option.value === "all")).toBe(false);
    expect(options.filter((option) => option.value.startsWith("texture:"))).toHaveLength(9);
    expect(options.filter((option) => option.value.startsWith("folder:"))).toHaveLength(2);
  });
});
