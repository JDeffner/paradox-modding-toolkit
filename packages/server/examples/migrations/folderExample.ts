import {
  defineMigration,
  type MigrationContext,
  type MigrationFinding,
  type MigrationRecipe,
} from "@px-lsp/server/migrations";

/** Synthetic folder fixture. Keep the factory self-contained for the CJS author template. */
export function createFolderExample(gameId = "ck3"): MigrationRecipe {
  const directory = "migration-demo";
  const marker = "# px migration author example: example_value";
  const identifier = /^[A-Za-z0-9_]+$/;

  function locate(text: string) {
    const lines: { text: string; offset: number }[] = [];
    for (const line of text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
      if (line[0].length === 0) continue;
      lines.push({ text: line[0].replace(/[\r\n]+$/, ""), offset: line.index });
    }
    const marked = lines.flatMap((line, index) =>
      line.text.replace(/^\uFEFF/, "").trim() === marker ? [index] : []
    );
    if (marked.length === 0) return { kind: "unmarked" as const };
    if (marked.length !== 1) return { kind: "unsupported" as const };
    const line = lines[marked[0] + 1];
    if (!line) return { kind: "unsupported" as const };
    if (/^[ \t]*demo_new[ \t]*=[ \t]*[A-Za-z0-9_]+[ \t]*(?:#.*)?$/.test(line.text))
      return { kind: "converted" as const };
    const match = /^([ \t]*)demo_old([ \t]*=[ \t]*)([A-Za-z0-9_]+)([ \t]*(?:#.*)?)$/.exec(line.text);
    if (!match) return { kind: "unsupported" as const };
    const keyStart = line.offset + match[1].length;
    const valueStart = keyStart + "demo_old".length + match[2].length;
    return { kind: "old" as const, keyStart, valueStart, valueLength: match[3].length };
  }

  function scan(context: MigrationContext) {
    return context
      .list("mod", directory)
      .filter((path) => path.startsWith(`${directory}/`) && path.endsWith(".txt"))
      .map((path) => {
        const text = context.readText("mod", path);
        return { path, source: text === undefined ? { kind: "unreadable" as const } : locate(text) };
      });
  }

  function findings(files: ReturnType<typeof scan>): MigrationFinding[] {
    return files.flatMap(({ path, source }) => {
      if (source.kind !== "unreadable" && source.kind !== "unsupported") return [];
      return [
        {
          id: `${source.kind}-example:${path}`,
          severity: "warning" as const,
          path,
          message:
            source.kind === "unreadable"
              ? `Cannot read ${path} as UTF-8. Inspect its encoding before preparing a change.`
              : "Expected one example marker followed by a simple demo_old scalar. No automatic change is available.",
        },
      ];
    });
  }

  return {
    manifest: {
      id: "author.folder-example",
      revision: "1",
      sdkVersion: 1,
      gameId,
      fromVersion: "1.0",
      toVersion: "2.0",
      kind: "recipe",
      detection: "script",
      requirement: "required",
      guidance: "Use a scratch mod. Inspect migration-demo, answer, review every file diff, then apply.",
      limitations: [
        "Illustrative 1.0 and 2.0 builds are synthetic, not supported game versions.",
        "No game syntax conversion or target-game validation.",
      ],
      dependsOn: [],
      title: "Folder recipe author example",
      description: "Rename marked demo fields in a folder and use one replacement value for all files.",
      evidence: ["Synthetic migration-demo folder fixtures; no game migration claim."],
      inputs: [{ root: "mod", path: directory }],
    },
    inspect(context, answers) {
      const files = scan(context);
      const issues = findings(files);
      if (issues.length > 0) {
        return {
          applicability: "unknown",
          findings: issues,
          questions: [],
          coverage: ["Unreadable or unsupported marked files need author review before any file changes."],
        };
      }
      if (!files.some((file) => file.source.kind === "old"))
        return { applicability: "not-applicable", findings: [], questions: [], coverage: [] };
      const answer = answers.example_value;
      const invalid = answer !== undefined && (typeof answer !== "string" || !identifier.test(answer));
      return {
        applicability: "applicable",
        findings: invalid
          ? [
              {
                id: "invalid-example-value",
                severity: "error",
                message: "Use a non-empty value containing only letters, digits, or underscores.",
              },
            ]
          : [],
        questions: [
          {
            id: "example_value",
            label: "Replacement example value",
            description: "Letters, digits, and underscores only. Used for every marked demo field.",
            kind: "text",
            required: true,
          },
        ],
        coverage: [
          "Only marked scalars in .txt files under migration-demo are inspected, including nested folders.",
        ],
      };
    },
    prepare(context, answers) {
      const files = scan(context);
      const issues = findings(files);
      if (issues.length > 0)
        return {
          groups: [],
          unresolved: issues.map((issue) => ({ ...issue, severity: "error" })),
          checks: [],
        };
      const old = files.filter((file) => file.source.kind === "old");
      if (old.length === 0) return { groups: [], unresolved: [], checks: [] };
      const value = answers.example_value;
      if (typeof value !== "string" || !identifier.test(value)) {
        return {
          groups: [],
          unresolved: [
            {
              id: "invalid-example-value",
              severity: "error",
              message: "Use a non-empty value containing only letters, digits, or underscores.",
            },
          ],
          checks: [],
        };
      }
      return {
        groups: [
          {
            id: "example-field",
            title: "Rename all marked example fields and set their value",
            dependsOn: [],
            changes: old.flatMap(({ path, source }) =>
              source.kind === "old"
                ? [
                    {
                      kind: "text" as const,
                      path,
                      edits: [
                        {
                          start: source.keyStart,
                          end: source.keyStart + "demo_old".length,
                          text: "demo_new",
                        },
                        {
                          start: source.valueStart,
                          end: source.valueStart + source.valueLength,
                          text: value,
                        },
                      ],
                    },
                  ]
                : []
            ),
          },
        ],
        unresolved: [],
        checks: [
          {
            id: "example-input",
            label: "All marked example sources and answer",
            stage: "before-apply",
            necessity: "required",
            status: "passed",
          },
        ],
      };
    },
  };
}

export default defineMigration(createFolderExample("ck3"));
