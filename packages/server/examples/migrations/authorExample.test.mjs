import assert from "node:assert/strict";
import test from "node:test";
import { createMigrationSnapshot, assertMigrationIdempotent } from "@px-lsp/server/migrations/testing";
import { inspectMigration } from "@px-lsp/server/migrations/engine";
import { createFolderExample } from "../../dist/examples/migrations/folderExample.cjs";

test("a folder recipe preserves exact fixture text and reference roots", async () => {
  const recipe = createFolderExample("ck3");
  const snapshot = createMigrationSnapshot({
    gameId: "ck3",
    mod: {
      "migration-demo/first.txt":
        "\uFEFF# px migration author example: example_value\r\n  demo_old = first # keep this comment\r\nother = unchanged\r\n",
      "migration-demo/nested/second.txt":
        "\uFEFF# keep this line\n# px migration author example: example_value\n\tdemo_old\t= second\t# keep tabs\n",
      "migration-demo/unmarked.txt": "\uFEFFdemo_old = unrelated\n",
      "migration-demo-other/sibling.txt": "\uFEFFdemo_old = sibling\n",
    },
    source: { "migration-demo/first.txt": "source reference" },
    target: { "migration-demo/nested/second.txt": "target reference" },
  });
  const original = structuredClone(snapshot);
  const result = await assertMigrationIdempotent({
    recipe,
    snapshot,
    answers: { example_value: "chosen_value" },
  });
  assert.deepEqual(result.plan.selectedGroups, ["example-field"]);
  assert.deepEqual(
    result.plan.files.map((file) => file.path),
    ["migration-demo/first.txt", "migration-demo/nested/second.txt"]
  );
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  assert.equal(
    decoder.decode(result.plan.files[0].after),
    "\uFEFF# px migration author example: example_value\r\n  demo_new = chosen_value # keep this comment\r\nother = unchanged\r\n"
  );
  assert.equal(
    decoder.decode(result.plan.files[1].after),
    "\uFEFF# keep this line\n# px migration author example: example_value\n\tdemo_new\t= chosen_value\t# keep tabs\n"
  );
  for (const file of original.files) {
    if (file.root === "mod" && result.plan.files.some((change) => change.path === file.path)) continue;
    assert.deepEqual(
      result.snapshot.files.find((entry) => entry.root === file.root && entry.path === file.path),
      file
    );
  }
  assert.deepEqual(snapshot, original);
  assert.equal(
    (await inspectMigration(recipe, result.snapshot, {})).inspection.applicability,
    "not-applicable"
  );
});
