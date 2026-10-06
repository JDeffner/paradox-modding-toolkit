import { describe, expect, it } from "vitest";
import type { MigrationCheck, MigrationInspection } from "@px-lsp/protocol/migration";
import {
  discoverMigration,
  hashPlan,
  hashSnapshot,
  inspectMigration,
  prepareMigration,
  validateMigrationManifest,
  verifyPreparedMigration,
} from "../src/migrations/engine";
import type {
  MigrationChange,
  MigrationEntry,
  MigrationGroup,
  MigrationProposal,
  MigrationRecipe,
  MigrationSnapshot,
} from "../src/migrations/sdk";
import { assertMigrationIdempotent, runMigrationFixture } from "../src/migrations/testing";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
const inspection = (): MigrationInspection => ({
  applicability: "applicable",
  findings: [],
  questions: [],
  coverage: [],
});
const snapshot = (text = "\uFEFFold = yes\r\n# untouched\n"): MigrationSnapshot => ({
  gameId: "ck3",
  files: [{ root: "mod", path: "common/example.txt", bytes: encode(text) }],
  metadata: { "source:identity": "base", "target:identity": "target", "mod:absent-directory": "events" },
});
const group = (id: string, changes: MigrationChange[], dependsOn: string[] = []): MigrationGroup => ({
  id,
  title: id,
  changes,
  dependsOn,
});
function recipe(groups: MigrationGroup[] = [], checks: MigrationCheck[] = []): MigrationRecipe {
  return {
    manifest: {
      id: "fixture",
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
      title: "Fixture",
      description: "Engine fixture",
      evidence: [],
      inputs: [{ root: "mod", path: "common" }],
    },
    inspect: () => inspection(),
    prepare: () => ({ groups, checks, unresolved: [] }),
  };
}
const rename = () =>
  group("rename", [{ kind: "text", path: "common/example.txt", edits: [{ start: 1, end: 4, text: "new" }] }]);

describe("migration engine", () => {
  it("marks a selected subset as continuation even if the author declares a complete proposal", async () => {
    const entry = recipe([
      rename(),
      group("second", [{ kind: "create", path: "common/second.txt", bytes: encode("second = yes") }]),
    ]);
    const original = entry.prepare;
    entry.prepare = async (context, answers) => ({
      ...(await original(context, answers)),
      continuation: false,
    });
    const plan = await prepareMigration(entry, snapshot(), {}, "hash", ["rename"]);
    expect(plan.continuation).toBe(true);
    expect(plan.files.map((file) => file.path)).toEqual(["common/example.txt"]);
  });

  it("exposes listing sizes without bytes and validates exact discovery requests", async () => {
    const entry = recipe();
    entry.manifest.sdkVersion = 2;
    entry.manifest.inputs = [{ root: "mod", path: "gfx", extensions: [".dds"], capture: "listing" }];
    const seed: MigrationSnapshot = {
      gameId: "ck3",
      files: [],
      metadata: {},
      listings: [{ root: "mod", path: "gfx/a.dds", size: 1000 }],
    };
    entry.discover = (context, answers) => {
      expect(context.list("mod")).toEqual(["gfx/a.dds"]);
      expect(context.fileInfo("mod", "gfx/a.dds")).toEqual({ size: 1000 });
      expect(context.readText("mod", "gfx/a.dds")).toBeUndefined();
      expect(context.readBytes("mod", "gfx/a.dds")).toBeUndefined();
      return answers.batch
        ? [
            { root: "mod", path: "gfx/a.dds" },
            { root: "mod", path: "gfx/a.dds" },
          ]
        : [];
    };
    expect(await discoverMigration(entry, seed, {})).toEqual([]);
    expect(await discoverMigration(entry, seed, { batch: true })).toEqual([
      { root: "mod", path: "gfx/a.dds" },
    ]);
    entry.discover = () => [{ root: "mod", path: "gfx/a.txt" }];
    await expect(discoverMigration(entry, seed, {})).rejects.toThrow("outside declared listing");
    entry.discover = () => [{ root: "source", path: "gfx/a.dds" }];
    await expect(discoverMigration(entry, seed, {})).rejects.toThrow("outside declared listing");
  });

  it("requires full capture before changing a prefix and freezes exact reads in the plan hash", async () => {
    const entry = recipe([
      group("binary", [{ kind: "replace", path: "common/a.bin", bytes: new Uint8Array([2]) }]),
    ]);
    entry.manifest.sdkVersion = 2;
    entry.manifest.inputs = [{ root: "mod", path: "common", capture: "prefix", prefixBytes: 1 }];
    const seed: MigrationSnapshot = {
      gameId: "ck3",
      metadata: {},
      files: [{ root: "mod", path: "common/a.bin", bytes: new Uint8Array([1]) }],
      listings: [{ root: "mod", path: "common/a.bin", size: 3 }],
    };
    await expect(prepareMigration(entry, seed, {}, "hash")).rejects.toThrow("exact full-file capture");
    const full = {
      ...seed,
      capture: { selected: [{ root: "mod" as const, path: "common/a.bin" }] },
      files: [{ root: "mod" as const, path: "common/a.bin", bytes: new Uint8Array([1, 2, 3]) }],
    };
    const plan = await prepareMigration(entry, full, {}, "hash");
    expect(plan.capture).toEqual(full.capture);
    expect(await verifyPreparedMigration(plan)).toBe(true);
    plan.capture!.selected = [];
    expect(await verifyPreparedMigration(plan)).toBe(false);
  });

  it("inspects data-only advisories without fabricated applicability or findings and refuses preparation", async () => {
    const advisory: MigrationEntry = {
      manifest: {
        ...recipe().manifest,
        kind: "advisory",
        detection: "none",
        guidance: "Review the changed definitions manually.",
        limitations: ["This note does not scan mod files."],
        inputs: [],
      },
    };
    const result = await inspectMigration(advisory, snapshot(), { oldAnswer: true });
    expect(result).toEqual({
      inspection: {
        applicability: "unknown",
        findings: [],
        questions: [],
        coverage: ["Review the changed definitions manually.", "This note does not scan mod files."],
      },
      answers: {},
      invalidAnswers: ["oldAnswer"],
      missingAnswers: [],
    });
    await expect(prepareMigration(advisory, snapshot(), {}, "hash")).rejects.toThrow(
      "advisory entries cannot prepare edits"
    );
  });

  it("allows script detection in advisories while forbidding write capability", async () => {
    const advisory: MigrationEntry = {
      manifest: { ...recipe().manifest, kind: "advisory" },
      inspect: () => inspection(),
    };
    expect((await inspectMigration(advisory, snapshot(), {})).inspection.applicability).toBe("applicable");
    expect(() => validateMigrationManifest({ ...advisory, prepare: recipe().prepare })).toThrow(
      "advisory cannot prepare edits"
    );
    expect(() =>
      validateMigrationManifest({ ...advisory, manifest: { ...advisory.manifest, detection: "none" } })
    ).toThrow("data-only detection cannot inspect");
  });

  it.each(["1", "1.*", "1.2-beta", " 1.2", "01.2", "1.2.3.4.5", "1.9007199254740992"])(
    "rejects an inexact or invalid game build %s",
    (version) => {
      const author = recipe();
      author.manifest.fromVersion = version;
      expect(() => validateMigrationManifest(author)).toThrow("invalid exact game version");
    }
  );

  it("applies exact UTF-16 offsets and preserves BOM, mixed newlines and unrelated bytes", async () => {
    const source = snapshot('\uFEFFold = "😀"\r\n# café untouched\n');
    const before = source.files[0].bytes.slice();
    const plan = await prepareMigration(recipe([rename()]), source, {}, "hash");
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].before).toEqual(before);
    expect(plan.files[0].after).toEqual(encode('\uFEFFnew = "😀"\r\n# café untouched\n'));
    expect(source.files[0].bytes).toEqual(before);
    expect(await verifyPreparedMigration(plan)).toBe(true);
    plan.files[0].after![4] = 0;
    expect(await verifyPreparedMigration(plan)).toBe(false);
  });

  it("omits empty and byte-identical changes, including a no-op on a file without BOM", async () => {
    const source = snapshot("old = yes\n");
    const plan = await prepareMigration(
      recipe([
        group("noop", [
          { kind: "text", path: "common/example.txt", edits: [{ start: 0, end: 3, text: "old" }] },
        ]),
      ]),
      source,
      {},
      "hash"
    );
    expect(plan.files).toEqual([]);
    expect((await prepareMigration(recipe(), source, {}, "hash")).files).toEqual([]);
  });

  it("adds required BOM only to changed script and localization outputs", async () => {
    const plan = await prepareMigration(
      recipe([
        group("create", [
          { kind: "create", path: "events/new.txt", bytes: encode("namespace = example\n") },
          {
            kind: "create",
            path: "localization/new_l_english.yml",
            bytes: encode('l_english:\n key:0 "value"\n'),
          },
          { kind: "create", path: "gfx/example.bin", bytes: new Uint8Array([0, 255, 0xc0]) },
        ]),
      ]),
      snapshot(),
      {},
      "hash"
    );
    expect(plan.files.find((file) => file.path.endsWith("new.txt"))!.after).toEqual(
      encode("\uFEFFnamespace = example\n")
    );
    expect(plan.files.find((file) => file.path.endsWith(".yml"))!.after).toEqual(
      encode('\uFEFFl_english:\n key:0 "value"\n')
    );
    expect(plan.files.find((file) => file.path.endsWith(".bin"))!.after).toEqual(
      new Uint8Array([0, 255, 0xc0])
    );
  });

  it("rejects structurally invalid script and localization output, including header/filename mismatch", async () => {
    for (const [path, text] of [
      ["common/broken.txt", "definition = {"],
      ["localization/broken_l_english.yml", ' key:0 "value"'],
      ["localization/broken_l_english.yml", 'l_french:\n key:0 "value"'],
    ]) {
      await expect(
        prepareMigration(
          recipe([group("create", [{ kind: "create", path, bytes: encode(text) }])]),
          snapshot(),
          {},
          "hash"
        )
      ).rejects.toThrow(/invalid (script|localization) output/);
    }
  });

  it("inspects the answer draft and invalidates removed questions and dependent choices", async () => {
    const author = recipe();
    author.inspect = (_context, answers) => ({
      ...inspection(),
      questions: [
        { id: "mode", label: "Mode", kind: "choice", required: true, options: [{ value: "b", label: "B" }] },
        {
          id: "dependent",
          label: "Dependent",
          kind: "choice",
          required: true,
          options: [{ value: answers.mode === "b" ? "new" : "old", label: "Choice" }],
        },
        { id: "confirm", label: "Confirm", kind: "boolean", required: true },
        { id: "note", label: "Note", kind: "text", required: true },
      ],
    });
    const result = await inspectMigration(author, snapshot(), {
      mode: "b",
      dependent: "old",
      removed: "value",
      confirm: false,
      note: "  ",
    });
    expect(result.answers).toEqual({ mode: "b", confirm: false, note: "  " });
    expect(result.invalidAnswers).toEqual(["dependent", "removed"]);
    expect(result.missingAnswers).toEqual(["dependent", "note"]);
    await expect(
      prepareMigration(
        author,
        snapshot(),
        { mode: "b", dependent: "old", confirm: false, note: "ok" },
        "hash"
      )
    ).rejects.toThrow("invalid or missing answers");
    const valid = await prepareMigration(
      author,
      snapshot(),
      { mode: "b", dependent: "new", confirm: false, note: "ok" },
      "hash"
    );
    expect(valid.answers.confirm).toBe(false);
  });

  it("returns missing required booleans instead of treating absence as false", async () => {
    const author = recipe();
    author.inspect = () => ({
      ...inspection(),
      questions: [{ id: "confirm", label: "Confirm", kind: "boolean", required: true }],
    });
    expect((await inspectMigration(author, snapshot(), {})).missingAnswers).toEqual(["confirm"]);
    expect((await inspectMigration(author, snapshot(), { confirm: false })).missingAnswers).toEqual([]);
  });

  it("exposes only declared prefixes across roots and returns independent byte copies", async () => {
    const source = snapshot();
    // Buffer.slice() shares memory. A Node host's input must still be copied.
    source.files[0].bytes = Buffer.from(source.files[0].bytes);
    source.files.push(
      { root: "mod", path: "commonplace/hidden.txt", bytes: encode("hidden") },
      { root: "source", path: "common/reference.txt", bytes: encode("base") },
      { root: "target", path: "common/reference.txt", bytes: encode("target") }
    );
    const before = new Uint8Array(source.files[0].bytes);
    const author = recipe();
    author.manifest.inputs.push({ root: "source", path: "common/reference.txt" });
    author.inspect = (context, answers) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(answers)).toBe(true);
      expect(context.list("mod")).toEqual(["common/example.txt"]);
      expect(context.list("mod", "common")).toEqual(["common/example.txt"]);
      expect(context.readText("mod", "commonplace/hidden.txt")).toBeUndefined();
      expect(context.readText("source", "common/reference.txt")).toBe("base");
      expect(context.readText("target", "common/reference.txt")).toBeUndefined();
      expect(context.readBytes("source", "missing.txt")).toBeUndefined();
      context.readBytes("mod", "common/example.txt")!.fill(0);
      expect(context.readBytes("mod", "common/example.txt")).toEqual(before);
      return inspection();
    };
    await prepareMigration(author, source, {}, "hash");
    expect(new Uint8Array(source.files[0].bytes)).toEqual(before);
  });

  it("reads exact text including BOM, and reports unsupported text decoding as unavailable", async () => {
    const source = snapshot();
    source.files.push({ root: "mod", path: "common/binary.bin", bytes: new Uint8Array([255]) });
    const author = recipe();
    author.inspect = (context) => {
      expect(context.readText("mod", "common/example.txt")).toBe("\uFEFFold = yes\r\n# untouched\n");
      expect(context.readText("mod", "common/binary.bin")).toBeUndefined();
      return inspection();
    };
    await inspectMigration(author, source, {});
  });

  it("resolves group dependency closure and applies all edits to original offsets", async () => {
    const source = snapshot("\uFEFFa = old\r\nb = old\r\n");
    const plan = await prepareMigration(
      recipe([
        group("base", [
          { kind: "text", path: "common/example.txt", edits: [{ start: 5, end: 8, text: "longer" }] },
        ]),
        group(
          "dependent",
          [{ kind: "text", path: "common/example.txt", edits: [{ start: 14, end: 17, text: "new" }] }],
          ["base"]
        ),
        group("omit", [{ kind: "create", path: "omitted.bin", bytes: new Uint8Array([1]) }]),
      ]),
      source,
      {},
      "hash",
      ["dependent"]
    );
    expect(plan.selectedGroups).toEqual(["base", "dependent"]);
    expect(plan.files).toHaveLength(1);
    expect(decode(plan.files[0].after!)).toBe("\uFEFFa = longer\r\nb = new\r\n");
  });

  it("allows an explicit empty selection without selecting every group", async () => {
    const plan = await prepareMigration(recipe([rename()]), snapshot(), {}, "hash", []);
    expect(plan.selectedGroups).toEqual([]);
    expect(plan.files).toEqual([]);
  });

  it.each([
    ["missing", [group("a", [], ["missing"])]],
    ["cyclic", [group("a", [], ["b"]), group("b", [], ["a"])]],
    ["duplicate", [group("a", []), group("a", [])]],
  ] as const)("rejects %s dependency graphs even when omitted", async (message, groups) => {
    await expect(prepareMigration(recipe([...groups]), snapshot(), {}, "hash", [])).rejects.toThrow(message);
  });

  it("rejects unknown group selections", async () => {
    await expect(prepareMigration(recipe(), snapshot(), {}, "hash", ["unknown"])).rejects.toThrow(
      "missing group"
    );
  });

  it.each([
    [
      { start: 1, end: 4, text: "new" },
      { start: 2, end: 3, text: "x" },
    ],
    [
      { start: 1, end: 1, text: "a" },
      { start: 1, end: 1, text: "b" },
    ],
  ])("rejects overlapping text changes instead of dropping them", async (...edits) => {
    const groups = edits.map((edit, index) =>
      group(String(index), [{ kind: "text", path: "common/example.txt", edits: [edit] }])
    );
    await expect(prepareMigration(recipe(groups), snapshot(), {}, "hash")).rejects.toThrow("overlapping");
  });

  it("rejects offset overflow, split surrogate pairs, malformed replacement text and invalid UTF-8", async () => {
    for (const edit of [
      { start: 0, end: 100, text: "" },
      { start: 1, end: 2, text: "" },
      { start: 0, end: 0, text: "\uD800" },
    ]) {
      await expect(
        prepareMigration(
          recipe([group("bad", [{ kind: "text", path: "common/example.txt", edits: [edit] }])]),
          snapshot("😀"),
          {},
          "hash"
        )
      ).rejects.toThrow("UTF-16");
    }
    const source = snapshot();
    source.files[0].bytes = new Uint8Array([0xff]);
    await expect(prepareMigration(recipe([rename()]), source, {}, "hash")).rejects.toThrow("valid UTF-8");
    await expect(
      prepareMigration(
        recipe([
          group("bad", [{ kind: "replace", path: "common/example.txt", bytes: new Uint8Array([0xff]) }]),
        ]),
        snapshot(),
        {},
        "hash"
      )
    ).rejects.toThrow("valid UTF-8");
  });

  it.each([
    "../escape.txt",
    "/absolute.txt",
    "C:/outside.txt",
    "common\\file.txt",
    "common/./file.txt",
    "common//file.txt",
    "common/trailing.",
    "common/NUL.txt",
  ])("rejects invalid output path %s", async (path) => {
    await expect(
      prepareMigration(
        recipe([group("bad", [{ kind: "create", path, bytes: encode("x") }])]),
        snapshot(),
        {},
        "hash"
      )
    ).rejects.toThrow("invalid relative path");
  });

  it("rejects case collisions in files and parent directory spelling", async () => {
    await expect(
      prepareMigration(
        recipe([group("bad", [{ kind: "create", path: "Common/new.bin", bytes: encode("x") }])]),
        snapshot(),
        {},
        "hash"
      )
    ).rejects.toThrow("case-colliding");
    const source = snapshot();
    source.files.push({ root: "mod", path: "COMMON/example.txt", bytes: encode("duplicate") });
    await expect(hashSnapshot(source)).rejects.toThrow(/case-colliding/);
  });

  it.each([
    [{ kind: "create", path: "common/example.txt", bytes: encode("x") }],
    [{ kind: "delete", path: "missing.txt" }],
    [{ kind: "replace", path: "missing.txt", bytes: encode("x") }],
    [{ kind: "text", path: "missing.txt", edits: [] }],
    [
      { kind: "delete", path: "common/example.txt" },
      { kind: "create", path: "common/example.txt", bytes: encode("x") },
    ],
    [
      { kind: "create", path: "new.bin", bytes: encode("x") },
      { kind: "create", path: "new.bin", bytes: encode("x") },
    ],
    [{ kind: "create", path: "common/example.txt/child.bin", bytes: encode("x") }],
  ] satisfies MigrationChange[][])("rejects missing, duplicate and conflicting paths", async (...changes) => {
    await expect(prepareMigration(recipe([group("bad", changes)]), snapshot(), {}, "hash")).rejects.toThrow(
      /path|changes|collision/
    );
  });

  it("records byte replacement and deletion with exact before bytes", async () => {
    const source = snapshot();
    source.files.push({ root: "mod", path: "image.bin", bytes: new Uint8Array([255, 4]) });
    const plan = await prepareMigration(
      recipe([
        group("bytes", [
          { kind: "delete", path: "common/example.txt" },
          { kind: "replace", path: "image.bin", bytes: new Uint8Array([0, 255]) },
        ]),
      ]),
      source,
      {},
      "hash"
    );
    expect(plan.files).toEqual([
      { path: "common/example.txt", before: source.files[0].bytes },
      { path: "image.bin", before: new Uint8Array([255, 4]), after: new Uint8Array([0, 255]) },
    ]);
  });

  it.each(["failed", "not-run"] as const)(
    "blocks required before-apply checks that are %s",
    async (status) => {
      await expect(
        prepareMigration(
          recipe(
            [],
            [
              {
                id: "tiger",
                label: "Tiger",
                stage: "before-apply",
                necessity: "required",
                status,
                detail: "Check common/example.txt: invalid field",
              },
            ]
          ),
          snapshot(),
          {},
          "hash"
        )
      ).rejects.toThrow(
        `checks have not passed: tiger (${status}): Tiger: Check common/example.txt: invalid field`
      );
    }
  );

  it("retains required after-apply checks and advisory failures", async () => {
    const checks: MigrationCheck[] = [
      { id: "before", label: "Before", stage: "before-apply", necessity: "required", status: "passed" },
      { id: "after", label: "After", stage: "after-apply", necessity: "required", status: "not-run" },
      {
        id: "advisory",
        label: "Advisory",
        stage: "before-apply",
        necessity: "advisory",
        status: "failed",
        detail: "Expected",
      },
    ];
    expect((await prepareMigration(recipe([], checks), snapshot(), {}, "hash")).checks).toEqual(checks);
  });

  it("blocks unresolved inspection or proposal errors but retains warnings", async () => {
    const finding = {
      id: "gap",
      severity: "error" as const,
      path: "common/example.txt",
      line: 3,
      message: "Unresolved field",
    };
    const author = recipe();
    author.inspect = () => ({ ...inspection(), findings: [finding] });
    await expect(prepareMigration(author, snapshot(), {}, "hash")).rejects.toThrow(
      "inspection contains unresolved errors: gap (common/example.txt:3): Unresolved field"
    );
    author.inspect = () => inspection();
    author.prepare = () => ({ groups: [], checks: [], unresolved: [finding] });
    await expect(prepareMigration(author, snapshot(), {}, "hash")).rejects.toThrow(
      "proposal contains unresolved errors: gap (common/example.txt:3): Unresolved field"
    );
    author.prepare = () => ({ groups: [], checks: [], unresolved: [{ ...finding, severity: "warning" }] });
    expect((await prepareMigration(author, snapshot(), {}, "hash")).unresolved).toHaveLength(1);
  });

  it.each(["unknown", "not-applicable"] as const)(
    "blocks %s applicability without running preparation",
    async (applicability) => {
      const author = recipe();
      author.inspect = () => ({ ...inspection(), applicability, coverage: ["Source root unavailable"] });
      author.prepare = () => {
        throw new Error("must not run");
      };
      await expect(prepareMigration(author, snapshot(), {}, "hash")).rejects.toThrow(
        `applicability is ${applicability}`
      );
    }
  );

  it("rejects a recipe for another game", async () => {
    const author = recipe();
    author.manifest.gameId = "vic3";
    await expect(inspectMigration(author, snapshot(), {})).rejects.toThrow("does not match");
  });

  it("validates manifests before loading without running recipe callbacks", () => {
    const author = recipe();
    author.inspect = () => {
      throw new Error("inspection must not run during load");
    };
    author.prepare = () => {
      throw new Error("preparation must not run during load");
    };
    const manifest = validateMigrationManifest(author);
    expect(manifest).toEqual(author.manifest);
    expect(manifest).not.toBe(author.manifest);
    const malformed = {
      ...author,
      manifest: { ...author.manifest, evidence: undefined },
    } as unknown as MigrationRecipe;
    expect(() => validateMigrationManifest(malformed)).toThrow("invalid manifest documentation");
  });

  it("validates runtime recipe and proposal shapes at the boundary", async () => {
    const malformed = [
      { ...recipe(), manifest: { ...recipe().manifest, sdkVersion: 3 } },
      {
        ...recipe(),
        inspect: () => ({
          ...inspection(),
          questions: [{ id: "a", label: "A", kind: "choice", required: true }],
        }),
      },
      {
        ...recipe(),
        prepare: () => ({
          groups: [
            { id: "a", title: "A", dependsOn: [], changes: [{ kind: "replace", path: "a.bin", bytes: [1] }] },
          ],
          checks: [],
          unresolved: [],
        }),
      },
      {
        ...recipe(),
        prepare: () => ({
          groups: [],
          checks: [{ id: "a", label: "A", stage: "before-apply", necessity: "required", status: "success" }],
          unresolved: [],
        }),
      },
      {
        ...recipe(),
        prepare: () => ({
          groups: [],
          checks: [],
          unresolved: [{ id: "a", severity: "fatal", message: "Bad" }],
        }),
      },
    ];
    for (const value of malformed)
      await expect(prepareMigration(value as MigrationRecipe, snapshot(), {}, "hash")).rejects.toThrow(
        "Migration:"
      );
  });

  it("hashes every root and metadata deterministically regardless of capture order", async () => {
    const source = snapshot();
    source.files.push({ root: "source", path: "base.bin", bytes: new Uint8Array([0, 255]) });
    const reordered = {
      ...source,
      files: [...source.files].reverse(),
      metadata: Object.fromEntries(Object.entries(source.metadata).reverse()),
    };
    expect(await hashSnapshot(source)).toBe(await hashSnapshot(reordered));
    reordered.metadata["mod:absent-directory"] = "gui";
    expect(await hashSnapshot(source)).not.toBe(await hashSnapshot(reordered));
    const changedRoot = structuredClone(source);
    changedRoot.files[1].bytes[0] = 1;
    expect(await hashSnapshot(source)).not.toBe(await hashSnapshot(changedRoot));
  });

  it("produces deterministic plans and hashes code, answers, selection and exact bytes", async () => {
    const author = recipe([rename()]);
    author.inspect = () => ({
      ...inspection(),
      questions: [{ id: "note", label: "Note", kind: "text", required: false }],
    });
    const first = await prepareMigration(author, snapshot(), { note: "x" }, "code");
    const second = await prepareMigration(author, snapshot(), { note: "x" }, "code");
    expect(first).toEqual(second);
    expect((await prepareMigration(author, snapshot(), { note: "y" }, "code")).hash).not.toBe(first.hash);
    expect((await prepareMigration(author, snapshot(), { note: "x" }, "other-code")).hash).not.toBe(
      first.hash
    );
    expect((await prepareMigration(author, snapshot(), { note: "x" }, "code", [])).hash).not.toBe(first.hash);
    const { hash, ...content } = first;
    expect(await hashPlan(content)).toBe(hash);
    expect(await verifyPreparedMigration({ ...first, files: [{ path: "../bad", after: encode("x") }] })).toBe(
      false
    );
  });

  it("detaches plan bytes and fields from author-owned objects", async () => {
    const bytes = new Uint8Array([1, 2]);
    const proposal: MigrationProposal = {
      groups: [group("create", [{ kind: "create", path: "image.bin", bytes }])],
      checks: [],
      unresolved: [],
    };
    const author = recipe();
    author.prepare = () => proposal;
    const plan = await prepareMigration(author, snapshot(), {}, "hash");
    bytes.fill(9);
    proposal.groups[0].id = "changed";
    expect(plan.files[0].after).toEqual(new Uint8Array([1, 2]));
    expect(plan.selectedGroups).toEqual(["create"]);
    expect(await verifyPreparedMigration(plan)).toBe(true);
  });

  it("uses the same engine for fixtures and proves idempotence without changing reference roots", async () => {
    const source = snapshot();
    source.files.push({ root: "target", path: "common/example.txt", bytes: encode("reference") });
    const author = recipe();
    author.inspect = (context) => ({
      ...inspection(),
      applicability: context.readText("mod", "common/example.txt")!.includes("old")
        ? "applicable"
        : "not-applicable",
    });
    author.prepare = () => ({ groups: [rename()], checks: [], unresolved: [] });
    const result = await assertMigrationIdempotent({ recipe: author, snapshot: source });
    expect(result.snapshot.files.find((file) => file.root === "mod")!.bytes).toEqual(
      encode("\uFEFFnew = yes\r\n# untouched\n")
    );
    expect(result.snapshot.files.find((file) => file.root === "target")!.bytes).toEqual(encode("reference"));
    expect(decode(source.files[0].bytes)).toContain("old");
    const fixture = await runMigrationFixture({ recipe: author, snapshot: source });
    expect(fixture.plan).toEqual(result.plan);
  });

  it("detects recipes that continue changing output on a second fixture run", async () => {
    const author = recipe([
      group("append", [
        { kind: "text", path: "common/example.txt", edits: [{ start: 1, end: 1, text: "# append\n" }] },
      ]),
    ]);
    await expect(assertMigrationIdempotent({ recipe: author, snapshot: snapshot() })).rejects.toThrow(
      "not idempotent: the second run changes files: common/example.txt"
    );
    expect((await assertMigrationIdempotent({ recipe: recipe(), snapshot: snapshot() })).plan.files).toEqual(
      []
    );
  });
});
