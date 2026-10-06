import advisoryExample from "../../../server/examples/migrations/example-advisory.json";
import { createAuthorExample } from "../../../server/examples/migrations/authorExample";
import { createFolderExample } from "../../../server/examples/migrations/folderExample";

/** Creates executable trusted author code, not a game-specific migration. */
export function migrationTemplate(gameId: string, scope: "folder" | "file" = "folder"): string {
  const instructions =
    scope === "folder"
      ? `// In a scratch mod, create migration-demo/first.txt and migration-demo/nested/second.txt.
// Give each file the two lines below. The recipe scans this folder and its subfolders.`
      : "// In a scratch mod, create migration-demo.txt with the two lines below.";
  return `// Recipe author example. This is synthetic test data, not a game migration.
// Loading this file runs trusted local JavaScript with the host's permissions.
${instructions}
// # px migration author example: example_value
// demo_old = previous_value
// Load this file in Mod Compatibility. Use 1.0 to 2.0, then choose Find route.
// Choose Use migration, answer the question, Review changes, then Apply migration.
// To write your own migration: set its ID, exact versions, inputs and evidence;
// adapt inspect() and prepare(), then test both affected and unaffected files.
// Inputs are root-relative file or folder paths, not globs. Return edits through
// prepare(); direct filesystem writes bypass the toolkit's preview and recovery.
module.exports = (${(scope === "folder" ? createFolderExample : createAuthorExample).toString()})(${JSON.stringify(gameId)});
`;
}

/** Creates plain data for a manual note. Loading it never evaluates author code. */
export function advisoryTemplate(gameId: string): string {
  return `${JSON.stringify({ manifest: { ...advisoryExample.manifest, gameId } }, null, 2)}\n`;
}
