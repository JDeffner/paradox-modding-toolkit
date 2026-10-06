import { describe, expect, it } from "vitest";
import { createAuthorExample } from "../examples/migrations/authorExample";
import { createFolderExample } from "../examples/migrations/folderExample";
import { inspectMigration, prepareMigration } from "../src/migrations/engine";
import type { MigrationRecipe } from "../src/migrations/sdk";
import { assertMigrationIdempotent, createMigrationSnapshot } from "../src/migrations/testing";

const first =
  "\uFEFF# px migration author example: example_value\r\n  demo_old = first # keep comment\r\nother = unchanged\n";
const nested =
  "\uFEFF# before\n# px migration author example: example_value\n\tdemo_old\t= second\t# keep tabs\n";
const answers = { example_value: "chosen_value" };
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe("migration author fixtures", () => {
  it("migrates nested files as one group, preserving bytes outside the marked key and value", async () => {
    const snapshot = createMigrationSnapshot({
      gameId: "ck3",
      mod: {
        "migration-demo/first.txt": first,
        "migration-demo/nested/second.txt": nested,
        "migration-demo/unmarked.txt": "\uFEFFdemo_old = unrelated\r\n",
        "migration-demo/converted.txt":
          "\uFEFF# px migration author example: example_value\ndemo_new = done\n",
        "migration-demo/image.bin": new Uint8Array([255]),
        "migration-demo-other/sibling.txt": first,
        "unrelated.txt": nested,
      },
      source: { "migration-demo/first.txt": first },
      target: { "migration-demo/nested/second.txt": nested },
      metadata: { fixture: "literal" },
    });
    const before = structuredClone(snapshot);
    const recipe = createFolderExample();
    const inspected = await inspectMigration(recipe, snapshot, {});
    expect(inspected.inspection.applicability).toBe("applicable");
    expect(inspected.inspection.questions.map((question) => question.id)).toEqual(["example_value"]);
    const result = await assertMigrationIdempotent({ recipe, snapshot, answers });
    expect(result.plan.selectedGroups).toEqual(["example-field"]);
    expect(result.plan.files.map((file) => file.path)).toEqual([
      "migration-demo/first.txt",
      "migration-demo/nested/second.txt",
    ]);
    expect(decode(result.plan.files[0].after!)).toBe(
      "\uFEFF# px migration author example: example_value\r\n  demo_new = chosen_value # keep comment\r\nother = unchanged\n"
    );
    expect(decode(result.plan.files[1].after!)).toBe(
      "\uFEFF# before\n# px migration author example: example_value\n\tdemo_new\t= chosen_value\t# keep tabs\n"
    );
    for (const file of before.files) {
      if (file.root === "mod" && result.plan.files.some((change) => change.path === file.path)) continue;
      expect(
        result.snapshot.files.find((entry) => entry.root === file.root && entry.path === file.path)
      ).toEqual(file);
    }
    expect(snapshot).toEqual(before);
    expect(result.snapshot.metadata).toEqual(before.metadata);
  });

  it("keeps the existing single-file example behavior", async () => {
    const snapshot = createMigrationSnapshot({
      gameId: "vic3",
      mod: { "migration-demo.txt": first, "unrelated.txt": nested },
    });
    const result = await assertMigrationIdempotent({
      recipe: createAuthorExample("vic3"),
      snapshot,
      answers,
    });
    expect(result.plan.files.map((file) => file.path)).toEqual(["migration-demo.txt"]);
    expect(decode(result.plan.files[0].after!)).toBe(
      "\uFEFF# px migration author example: example_value\r\n  demo_new = chosen_value # keep comment\r\nother = unchanged\n"
    );
  });

  it.each([
    [createAuthorExample("ck3"), "migration-demo.txt"],
    [createFolderExample(), "migration-demo/nested/bad.txt"],
  ] as const)(
    "reports a listed malformed UTF-8 input as unknown and cannot prepare a plan",
    async (recipe, path) => {
      const snapshot = createMigrationSnapshot({
        gameId: "ck3",
        mod: { [path]: new Uint8Array([0xc3, 0x28]) },
      });
      const inspected = await inspectMigration(recipe, snapshot, {});
      expect(inspected.inspection.applicability).toBe("unknown");
      expect(inspected.inspection.findings[0]).toMatchObject({
        path,
        message: expect.stringContaining(path),
      });
      await expect(prepareMigration(recipe, snapshot, {}, "fixture")).rejects.toThrow(path);
    }
  );

  it("blocks a mixed folder when one listed text file is unreadable", async () => {
    const snapshot = createMigrationSnapshot({
      gameId: "ck3",
      mod: { "migration-demo/first.txt": first, "migration-demo/bad.txt": new Uint8Array([255]) },
    });
    await expect(prepareMigration(createFolderExample(), snapshot, answers, "fixture")).rejects.toThrow(
      /unknown.*bad\.txt.*UTF-8/
    );
    expect(decode(snapshot.files.find((file) => file.path.endsWith("first.txt"))!.bytes)).toBe(first);
  });

  it.each([createAuthorExample("ck3"), createFolderExample()])(
    "marks absent input inapplicable",
    async (recipe) => {
      const snapshot = createMigrationSnapshot({
        gameId: "ck3",
        mod: { "migration-demo-other/sibling.txt": first },
      });
      expect((await inspectMigration(recipe, snapshot, {})).inspection.applicability).toBe("not-applicable");
      await expect(prepareMigration(recipe, snapshot, {}, "fixture")).rejects.toThrow("not-applicable");
    }
  );

  it("leaves unsupported marked content for review", async () => {
    const snapshot = createMigrationSnapshot({
      gameId: "ck3",
      mod: {
        "migration-demo/complex.txt":
          "\uFEFF# px migration author example: example_value\ndemo_old = { example = yes }\n",
      },
    });
    const inspection = (await inspectMigration(createFolderExample(), snapshot, {})).inspection;
    expect(inspection.applicability).toBe("unknown");
    expect(inspection.findings[0].path).toBe("migration-demo/complex.txt");
  });

  it.each(["", "two words", "# comment", true])(
    "rejects invalid replacement answer %s with a useful finding",
    async (example_value) => {
      const snapshot = createMigrationSnapshot({ gameId: "ck3", mod: { "migration-demo/first.txt": first } });
      await expect(
        prepareMigration(createFolderExample(), snapshot, { example_value }, "fixture")
      ).rejects.toThrow(/invalid-example-value.*letters, digits, or underscores/);
    }
  );

  it("serializes the folder factory without module dependencies for each workspace game", async () => {
    const factory = new Function(
      `return (${createFolderExample.toString()})`
    )() as typeof createFolderExample;
    for (const gameId of ["ck3", "vic3", "eu5"]) {
      const recipe: MigrationRecipe = factory(gameId);
      expect(recipe.manifest).toMatchObject({
        gameId,
        fromVersion: "1.0",
        toVersion: "2.0",
        inputs: [{ root: "mod", path: "migration-demo" }],
      });
      const snapshot = createMigrationSnapshot({ gameId, mod: { "migration-demo/first.txt": first } });
      expect((await prepareMigration(recipe, snapshot, answers, "fixture")).files).toHaveLength(1);
    }
  });
});

describe("createMigrationSnapshot", () => {
  const invalidPaths: Record<string, string>[] = [
    { "../outside.txt": "x" },
    { "Common/a.txt": "x", "common/b.txt": "y" },
    { directory: "x", "directory/child.txt": "y" },
  ];
  it("encodes exact text, keeps binary bytes, and clones all supplied byte arrays and metadata", () => {
    const bytes = new Uint8Array([0, 255]);
    const metadata = { identity: "fixture" };
    const snapshot = createMigrationSnapshot({
      gameId: "ck3",
      mod: { "with-bom.txt": "\uFEFFx\r\n", "without-bom.txt": "x\n", "binary.bin": bytes },
      source: { "binary.bin": bytes },
      target: { "binary.bin": bytes },
      metadata,
    });
    bytes.fill(1);
    metadata.identity = "changed";
    expect(decode(snapshot.files[0].bytes)).toBe("\uFEFFx\r\n");
    expect(decode(snapshot.files[1].bytes)).toBe("x\n");
    for (const file of snapshot.files.filter((file) => file.path === "binary.bin"))
      expect(file.bytes).toEqual(new Uint8Array([0, 255]));
    expect(snapshot.metadata).toEqual({ identity: "fixture" });
    snapshot.files.find((file) => file.root === "source")!.bytes.fill(2);
    expect(snapshot.files.find((file) => file.root === "target")!.bytes).toEqual(new Uint8Array([0, 255]));
  });

  it.each(invalidPaths)("uses engine path and collision validation", (mod) => {
    expect(() => createMigrationSnapshot({ gameId: "ck3", mod })).toThrow("Migration:");
  });
});
