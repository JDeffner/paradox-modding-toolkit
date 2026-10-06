import { defineMigration, type MigrationContext, type MigrationRecipe } from "@px-lsp/server/migrations";

/** Synthetic author fixture. This factory is also embedded in the dependency-free CJS template. */
export function createAuthorExample(gameId: string): MigrationRecipe {
  const path = "migration-demo.txt";
  const marker = "# px migration author example: example_value";
  const identifier = /^[A-Za-z0-9_]+$/;

  function locate(context: MigrationContext) {
    if (!context.list("mod", path).includes(path)) return { kind: "absent" as const };
    const text = context.readText("mod", path);
    if (text === undefined) return { kind: "unreadable" as const };
    const lines: { text: string; offset: number }[] = [];
    for (const line of text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
      if (line[0].length === 0) continue;
      lines.push({ text: line[0].replace(/[\r\n]+$/, ""), offset: line.index });
    }
    const marked = lines.flatMap((line, index) =>
      line.text.replace(/^\uFEFF/, "").trim() === marker ? [index] : []
    );
    if (marked.length !== 1) return { kind: "unsupported" as const };
    const line = lines[marked[0] + 1];
    if (!line) return { kind: "unsupported" as const };
    if (/^[ \t]*demo_new[ \t]*=[ \t]*[A-Za-z0-9_]+[ \t]*(?:#.*)?$/.test(line.text)) {
      return { kind: "converted" as const };
    }
    const match = /^([ \t]*)demo_old([ \t]*=[ \t]*)([A-Za-z0-9_]+)([ \t]*(?:#.*)?)$/.exec(line.text);
    if (!match) return { kind: "unsupported" as const };
    const keyStart = line.offset + match[1].length;
    const valueStart = keyStart + "demo_old".length + match[2].length;
    return { kind: "old" as const, keyStart, valueStart, valueLength: match[3].length };
  }

  return {
    manifest: {
      id: "author.example",
      revision: "1",
      sdkVersion: 1,
      gameId,
      fromVersion: "1.0",
      toVersion: "2.0",
      kind: "recipe",
      detection: "script",
      requirement: "required",
      guidance:
        "Use only in a scratch mod with the synthetic marked scalar. Inspect, answer, review the diff, then apply.",
      limitations: [
        "Illustrative 1.0 and 2.0 builds are synthetic, not supported game versions.",
        "No game syntax conversion or target-game validation.",
      ],
      dependsOn: [],
      title: "Recipe author example",
      description: "Synthetic fixture only. Rename a marked demo field and ask for its replacement value.",
      evidence: ["Synthetic migration-demo.txt fixture; no game migration claim."],
      inputs: [{ root: "mod", path }],
    },
    inspect(context, answers) {
      const source = locate(context);
      if (source.kind === "absent" || source.kind === "converted") {
        return { applicability: "not-applicable", findings: [], questions: [], coverage: [] };
      }
      if (source.kind === "unsupported" || source.kind === "unreadable") {
        return {
          applicability: "unknown",
          findings: [
            {
              id: source.kind === "unreadable" ? "unreadable-example" : "unsupported-example",
              severity: "warning",
              path,
              message:
                source.kind === "unreadable"
                  ? `Cannot read ${path} as UTF-8. Inspect its encoding before preparing a change.`
                  : "Expected one example marker followed by a simple demo_old scalar. No automatic change is available.",
            },
          ],
          questions: [],
          coverage: ["Unmarked, duplicate, or complex example fields need author review."],
        };
      }
      const answer = answers.example_value;
      const invalid = answer !== undefined && (typeof answer !== "string" || !identifier.test(answer));
      return {
        applicability: "applicable",
        findings: invalid
          ? [
              {
                id: "invalid-example-value",
                severity: "error",
                path,
                message: "Use a non-empty value containing only letters, digits, or underscores.",
              },
            ]
          : [],
        questions: [
          {
            id: "example_value",
            label: "Replacement example value",
            description: "Letters, digits, and underscores only. This changes synthetic author data.",
            kind: "text",
            required: true,
          },
        ],
        coverage: ["Only the marked scalar in migration-demo.txt is inspected."],
      };
    },
    prepare(context, answers) {
      const source = locate(context);
      const value = answers.example_value;
      if (source.kind === "absent" || source.kind === "converted") {
        return { groups: [], unresolved: [], checks: [] };
      }
      if (source.kind !== "old" || typeof value !== "string" || !identifier.test(value)) {
        return {
          groups: [],
          unresolved: [
            {
              id: "example-needs-review",
              severity: "error",
              path,
              message:
                "The source must match the author fixture and the answer must be a simple identifier. No automatic change is available.",
            },
          ],
          checks: [
            {
              id: "example-input",
              label: "Example source and answer",
              stage: "before-apply",
              necessity: "required",
              status: "failed",
            },
          ],
        };
      }
      return {
        groups: [
          {
            id: "example-field",
            title: "Rename the example field and set its value",
            dependsOn: [],
            changes: [
              {
                kind: "text",
                path,
                edits: [
                  { start: source.keyStart, end: source.keyStart + "demo_old".length, text: "demo_new" },
                  { start: source.valueStart, end: source.valueStart + source.valueLength, text: value },
                ],
              },
            ],
          },
        ],
        unresolved: [],
        checks: [
          {
            id: "example-input",
            label: "Example source and answer",
            stage: "before-apply",
            necessity: "required",
            status: "passed",
          },
        ],
      };
    },
  };
}

// Set this to the gameId used by the scratch workspace before compiling the example.
export default defineMigration(createAuthorExample("ck3"));
