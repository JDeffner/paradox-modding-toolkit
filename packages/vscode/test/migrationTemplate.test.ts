import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { inspectMigration, prepareMigration } from "../../server/src/migrations/engine";
import type { MigrationRecipe, MigrationSnapshot } from "../../server/src/migrations/sdk";
import { assertMigrationIdempotent } from "../../server/src/migrations/testing";
import { advisoryTemplate, migrationTemplate } from "../src/compatch/migrationTemplate";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const marker = "# px migration author example: example_value";

function recipe(gameId = "ck3"): MigrationRecipe {
  const module = { exports: {} };
  // This evaluates our own synthetic fixture. It does not isolate untrusted code.
  runInNewContext(migrationTemplate(gameId, "file"), { module });
  return module.exports as MigrationRecipe;
}

function snapshot(text?: string, gameId = "ck3"): MigrationSnapshot {
  return {
    gameId,
    metadata: {},
    files: [
      ...(text === undefined
        ? []
        : [{ root: "mod" as const, path: "migration-demo.txt", bytes: encoder.encode(text) }]),
      { root: "mod", path: "unrelated.txt", bytes: encoder.encode("keep = yes") },
      { root: "source", path: "migration-demo.txt", bytes: encoder.encode(`${marker}\ndemo_old = source`) },
      { root: "target", path: "migration-demo.txt", bytes: encoder.encode(`${marker}\ndemo_old = target`) },
    ],
  };
}

describe("migration author template", () => {
  it("starts with a dependency-free folder recipe that handles nested files", async () => {
    const module = { exports: {} };
    runInNewContext(migrationTemplate("ck3"), { module });
    const example = module.exports as MigrationRecipe;
    expect(example.manifest.inputs).toEqual([{ root: "mod", path: "migration-demo" }]);
    const before = `\uFEFF${marker}\r\ndemo_old = previous_value # preserved\r\n`;
    const input = snapshot();
    input.files.push(
      ...["migration-demo/first.txt", "migration-demo/nested/second.txt"].map((path) => ({
        root: "mod" as const,
        path,
        bytes: encoder.encode(before),
      }))
    );
    const result = await assertMigrationIdempotent({
      recipe: example,
      snapshot: input,
      answers: { example_value: "chosen" },
    });
    expect(result.plan.files.map((file) => file.path)).toEqual([
      "migration-demo/first.txt",
      "migration-demo/nested/second.txt",
    ]);
    for (const file of result.plan.files)
      expect(decoder.decode(file.after)).toBe(
        before.replace("demo_old = previous_value", "demo_new = chosen")
      );
  });
  it("creates a data-only advisory with exact synthetic versions and no functions", () => {
    const gameId = 'example"\\\nvalue';
    const note = JSON.parse(advisoryTemplate(gameId));
    expect(Object.keys(note)).toEqual(["manifest"]);
    expect(note.manifest).toMatchObject({
      gameId,
      fromVersion: "1.0",
      toVersion: "2.0",
      kind: "advisory",
      detection: "none",
      requirement: "required",
      inputs: [],
    });
    expect(note.manifest.evidence).toContain(
      "Synthetic migration-demo.txt fixture; no game migration claim."
    );
    expect(note.manifest.limitations.join(" ")).toContain("not supported game versions");
  });
  it("creates dependency-free CJS with an escaped game id", () => {
    const gameId = 'example"\\\nvalue';
    expect(recipe(gameId).manifest).toMatchObject({
      id: "author.example",
      revision: "1",
      gameId,
      fromVersion: "1.0",
      toVersion: "2.0",
      kind: "recipe",
      detection: "script",
      requirement: "required",
      dependsOn: [],
      inputs: [{ root: "mod", path: "migration-demo.txt" }],
    });
    expect(migrationTemplate(gameId)).not.toContain("require(");
  });

  it("asks for the value, edits exact offsets, preserves other content and roots, and becomes inapplicable", async () => {
    const before = `\uFEFFunrelated = keep\r\n${marker}\r\n  demo_old = previous_value # keep comment\r\nother = retained\r\n`;
    const input = snapshot(before);
    const example = recipe();
    const inspection = await inspectMigration(example, input, {});
    expect(inspection.inspection.applicability).toBe("applicable");
    expect(inspection.missingAnswers).toEqual(["example_value"]);
    expect(inspection.inspection.questions).toMatchObject([
      { id: "example_value", kind: "text", required: true },
    ]);
    const result = await assertMigrationIdempotent({
      recipe: example,
      snapshot: input,
      answers: { example_value: "chosen_2" },
    });
    expect(result.plan.files.map((file) => file.path)).toEqual(["migration-demo.txt"]);
    expect(decoder.decode(result.plan.files[0].after)).toBe(
      before.replace("demo_old = previous_value", "demo_new = chosen_2")
    );
    for (const original of input.files.filter(
      (file) => file.path !== "migration-demo.txt" || file.root !== "mod"
    )) {
      expect(
        result.snapshot.files.find((file) => file.root === original.root && file.path === original.path)
      ).toEqual(original);
    }
    expect(decoder.decode(input.files[0].bytes)).toBe(before);
    expect((await inspectMigration(example, result.snapshot, {})).inspection).toMatchObject({
      applicability: "not-applicable",
      questions: [],
    });
  });

  it("rejects missing or invalid answers without producing a plan", async () => {
    const input = snapshot(`${marker}\ndemo_old = previous_value\n`);
    await expect(prepareMigration(recipe(), input, {}, "fixture")).rejects.toThrow("missing answers");
    const result = await inspectMigration(recipe(), input, { example_value: "invalid value" });
    expect(result.inspection.findings).toMatchObject([{ severity: "error", id: "invalid-example-value" }]);
    await expect(
      prepareMigration(recipe(), input, { example_value: "invalid value" }, "fixture")
    ).rejects.toThrow("unresolved errors");
  });

  it.each([
    "demo_old = unmarked\n",
    `${marker}\ndemo_old = { complex = yes }\n`,
    `${marker}\ndemo_old = first\n${marker}\ndemo_old = second\n`,
  ])("reports unsupported content instead of editing it: %s", async (text) => {
    const result = await inspectMigration(recipe(), snapshot(text), {});
    expect(result.inspection).toMatchObject({
      applicability: "unknown",
      questions: [],
      findings: [{ severity: "warning" }],
    });
    await expect(prepareMigration(recipe(), snapshot(text), {}, "fixture")).rejects.toThrow(
      "applicability is unknown"
    );
  });

  it.each([undefined, `${marker}\ndemo_new = chosen\n`])(
    "has no question when absent or already converted",
    async (text) => {
      const result = await inspectMigration(recipe(), snapshot(text), {});
      expect(result.inspection).toMatchObject({ applicability: "not-applicable", questions: [] });
    }
  );
});
