import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-migrations-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "migrations-"));
for (const folder of ["Mod", "Vanilla/common", "Vanilla/launcher", "logs", "user/User", "extensions"])
  await mkdir(join(scratch, folder), { recursive: true });
await writeFile(join(scratch, "Mod/descriptor.mod"), '\uFEFFname="Migration Tests"\n');
const original =
  "\uFEFF# keep this comment\r\n# px migration author example: example_value\r\ndemo_old = previous_value # preserve inline comment\r\n";
await writeFile(join(scratch, "Mod/migration-demo.txt"), original);
await writeFile(join(scratch, "original.txt"), original);
await writeFile(join(scratch, "Vanilla/reference.txt"), "revision = old\n");
// Launcher metadata maps the synthetic 2.0 reference. These are not real CK3 builds.
await writeFile(join(scratch, "Vanilla/launcher/launcher-settings.json"), '{"rawVersion":"2.0"}\n');
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "files.autoSave": "off",
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none",
    "window.title": "PXTK Migration Test",
    "window.commandCenter": false,
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
const workspace = join(scratch, "migrations.code-workspace");
await mkdir(join(scratch, "user/User/profiles/pxtk-migrations"), { recursive: true });
await mkdir(join(scratch, "user/User/globalStorage"), { recursive: true });
await writeFile(
  join(scratch, "user/User/profiles/pxtk-migrations/settings.json"),
  await readFile(join(scratch, "user/User/settings.json"))
);
await writeFile(
  join(scratch, "user/User/globalStorage/storage.json"),
  JSON.stringify({ userDataProfiles: [{ location: "pxtk-migrations", name: "PXTK Development" }] })
);
await writeFile(
  workspace,
  JSON.stringify(
    {
      folders: [{ path: "Mod" }],
      settings: {
        "px.gameId": "ck3",
        "px.gamePath": join(scratch, "Vanilla"),
        "px.modPath": join(scratch, "Mod"),
        "px.logsPath": join(scratch, "logs"),
        "px.experimentalFeatures": true,
        "px.indexAssets": false,
        "px.tigerRunOn": "manual",
      },
    },
    null,
    2
  )
);
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(scratch, "package")
);
const templateModule = join(scratch, "template.cjs");
await build({
  entryPoints: [join(root, "packages/vscode/src/compatch/migrationTemplate.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: templateModule,
});
const { migrationTemplate } = createRequire(import.meta.url)(templateModule);
await writeFile(
  join(scratch, "recipe.cjs"),
  migrationTemplate("ck3", "file") +
    '\nmodule.exports.manifest.inputs.push({root:"target",path:"reference.txt"});\n'
);
const manualManifest = {
  id: "author.route-note",
  revision: "1",
  sdkVersion: 1,
  gameId: "ck3",
  fromVersion: "1.0",
  toVersion: "2.0",
  kind: "advisory",
  detection: "none",
  requirement: "required",
  title: "Synthetic route manual note",
  description: "Required manual review between two synthetic author recipes.",
  guidance: "Review the preserved comment, then record the review. No game compatibility claim.",
  limitations: ["Synthetic builds only. This note performs no game validation."],
  dependsOn: ["author.example"],
  evidence: ["Scratch migration-demo.txt; no game migration claim."],
  inputs: [],
};
await writeFile(join(scratch, "route-note.json"), JSON.stringify({ manifest: manualManifest }, null, 2));
const note = (id, dependsOn = []) => ({
  manifest: {
    ...manualManifest,
    id,
    fromVersion: "4.0",
    toVersion: "5.0",
    title: `Synthetic library note ${id}`,
    dependsOn,
  },
});
for (const folder of [
  "contributions/nested",
  "contributions/.git",
  "contributions/node_modules",
  "contributions/.px-toolkit",
  "Mod/migration-demo/nested",
])
  await mkdir(join(scratch, folder), { recursive: true });
await writeFile(join(scratch, "contributions/first.json"), JSON.stringify(note("author.folder-first")));
await writeFile(
  join(scratch, "contributions/nested/second.json"),
  JSON.stringify(note("author.folder-second", ["author.folder-first"]))
);
await writeFile(join(scratch, "contributions/config.json"), '{"not":"a contribution"}\n');
const helper = `require("node:fs").writeFileSync(${JSON.stringify(join(scratch, "unexpected-helper-execution"))}, "executed"); throw new Error("Unselected helper executed.");\n`;
await writeFile(join(scratch, "contributions/helper.js"), helper);
for (const folder of [".git", "node_modules", ".px-toolkit"])
  await writeFile(join(scratch, "contributions", folder, "skipped.js"), helper);
await writeFile(join(scratch, "batch-valid.json"), JSON.stringify(note("author.failed-batch")));
await writeFile(join(scratch, "batch-invalid.json"), '{"not":"a contribution"}\n');
await writeFile(join(scratch, "batch-duplicate.json"), JSON.stringify(note("author.failed-batch")));
await writeFile(join(scratch, "folder-recipe.cjs"), migrationTemplate("ck3"));
await writeFile(join(scratch, "Mod/migration-demo/first.txt"), original);
await writeFile(join(scratch, "Mod/migration-demo/nested/second.txt"), original);
await writeFile(
  join(scratch, "Mod/migration-demo/unrelated.txt"),
  "\uFEFF# unrelated fixture\r\nkeep = yes\r\n"
);
const secondManifest = {
  ...manualManifest,
  id: "author.route-second",
  fromVersion: "2.0",
  toVersion: "3.0",
  kind: "recipe",
  detection: "script",
  title: "Synthetic route second recipe",
  description: "Consumes only the first synthetic recipe's exact output.",
  guidance: "Review the second transformation after the required note is resolved.",
  dependsOn: ["author.route-note"],
  inputs: [
    { root: "mod", path: "migration-demo.txt" },
    { root: "source", path: "reference.txt" },
  ],
};
await writeFile(
  join(scratch, "route-recipes.cjs"),
  `
// Synthetic editor fixture only. No real CK3 versions or syntax conversion.
module.exports = [{
  manifest: ${JSON.stringify(secondManifest)},
  inspect(context) {
    const text = context.readText("mod", "migration-demo.txt") ?? "";
    const applicable = text.includes("demo_new = new_value");
    return {
      applicability: applicable ? "applicable" : "unknown",
      findings: [{ id: "route-input", severity: applicable ? "info" : "error", message: applicable ? "First recipe output found: demo_new = new_value." : "Expected first recipe output." }],
      questions: [], coverage: ["Only the synthetic marked scalar is checked; no game validation."]
    };
  },
  prepare(context) {
    const text = context.readText("mod", "migration-demo.txt") ?? "";
    const before = "demo_new = new_value";
    const start = text.indexOf(before);
    if (start < 0) throw new Error("Expected first recipe output.");
    return { groups: [{ id: "second", title: "Second synthetic edit", dependsOn: [], changes: [{ kind: "text", path: "migration-demo.txt", edits: [{ start, end: start + before.length, text: "demo_final = route_value" }] }] }], unresolved: [], checks: [] };
  }
}];
`
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/migrations-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Migration editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_MIGRATION_TEST_SCRATCH: scratch },
  launchArgs: [
    workspace,
    "--profile",
    "PXTK Development",
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--remote-debugging-port=9339",
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
