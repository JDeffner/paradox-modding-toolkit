import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-editor-improvements.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "editor-improvements-"));
const mod = join(scratch, "Mod");
const game = join(scratch, "Vanilla");
for (const dir of [
  mod,
  join(mod, ".vscode"),
  join(game, "common"),
  join(scratch, "Dependency"),
  join(scratch, "user/User"),
  join(scratch, "extensions"),
  join(scratch, "logs"),
])
  await mkdir(dir, { recursive: true });
await writeFile(join(mod, "descriptor.mod"), 'name="Editor Improvements Test"\n');
await writeFile(join(scratch, "Dependency/descriptor.mod"), 'name="Dependency"\n');
await writeFile(join(mod, ".px-ux-fixture"), "isolated UX smoke\n");
await writeFile(join(mod, ".px-encoding-fixture"), "isolated encoding smoke\n");
await writeFile(join(mod, "description.bbcode"), "[h1]Saved listing[/h1]\n");
await writeFile(join(mod, "unrelated.txt"), "Unrelated editor target\n");
const compatchFile = "common/script_values/px_compatch_fixture.txt";
const compatchBase = join(scratch, "Old Game");
for (const [folder, value] of [
  [compatchBase, 1],
  [mod, 2],
  [game, 3],
]) {
  await mkdir(join(folder, "common/script_values"), { recursive: true });
  await writeFile(join(folder, compatchFile), `\uFEFFpx_compatch_fixture_value = ${value}\n`);
}
await mkdir(join(mod, ".px-toolkit"), { recursive: true });
await writeFile(
  join(mod, ".px-toolkit/compatch.json"),
  JSON.stringify({ version: 1, vanilla: compatchBase, newGame: game })
);
const settings = JSON.stringify({
  "security.workspace.trust.enabled": false,
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "update.mode": "none",
  "files.autoSave": "off",
  "files.encoding": "utf8",
  "files.autoGuessEncoding": false,
  "px.gameId": "ck3",
  "px.gamePath": game,
  "px.modPath": mod,
  "px.parentMods": [join(scratch, "Dependency")],
  "px.logsPath": join(scratch, "logs"),
  "px.tigerRunOn": "manual",
  "px.indexAssets": false,
  "window.title": "PXTK Packaged Improvements Test",
  "window.dialogStyle": "custom",
  "chat.disableAIFeatures": true,
  "git.openRepositoryInParentFolders": "never",
  "workbench.startupEditor": "none",
});
await writeFile(join(scratch, "user/User/settings.json"), settings);
await writeFile(
  join(mod, ".vscode/settings.json"),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(JSON.parse(settings)).filter(
        ([key]) =>
          !key.startsWith("extensions.") && !key.startsWith("update.") && !key.startsWith("security.")
      )
    )
  )
);
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(scratch, "package")
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/editor-improvements-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Packaged editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_EDITOR_TEST_SCRATCH: scratch },
  launchArgs: [
    mod,
    "--profile",
    "PXTK Development",
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--remote-debugging-port=9338",
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
