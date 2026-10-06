import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-localization-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "localization-"));
for (const folder of [
  "Mod",
  "Second/events",
  "Second/localization/german",
  "Second/.px-toolkit",
  "Vanilla/common/traits",
  "Vanilla/common/folder_only/child",
  "logs",
  "user/User",
  "extensions",
])
  await mkdir(join(scratch, folder), { recursive: true });
for (const folder of ["Mod", "Second"]) {
  await writeFile(join(scratch, folder, "descriptor.mod"), `\uFEFFname="Localization ${folder}"\n`);
}
await writeFile(join(scratch, "Vanilla/common/traits/import_traits.txt"), "\uFEFFfixture_trait = {}\n");
await writeFile(join(scratch, "Vanilla/common/traits/dirty_traits.txt"), "\uFEFFfixture_dirty = {}\n");
await writeFile(join(scratch, "Vanilla/common/folder_only/child/keep.txt"), "\uFEFFfixture_keep = {}\n");
await writeFile(
  join(scratch, "Second/events/localization_script.txt"),
  "\uFEFFnamespace = fixture\nfixture.1 = {\n title = fixture_new\n desc = fixture_stale\n}\n"
);
await writeFile(
  join(scratch, "Second/localization/german/project_l_german.yml"),
  '\uFEFFl_german:\n fixture_existing:7 "Keep this entry"\n'
);
await writeFile(
  join(scratch, "Second/.px-toolkit/localization.json"),
  JSON.stringify(
    {
      language: "german",
      newKeyFile: "localization/german/project_l_{language}.yml",
      entryVersion: "none",
    },
    null,
    2
  )
);
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
    "window.title": "PXTK Localization Test",
    "window.commandCenter": false,
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
const workspace = join(scratch, "localization.code-workspace");
await mkdir(join(scratch, "user/User/profiles/pxtk-localization"), { recursive: true });
await mkdir(join(scratch, "user/User/globalStorage"), { recursive: true });
await writeFile(
  join(scratch, "user/User/profiles/pxtk-localization/settings.json"),
  await readFile(join(scratch, "user/User/settings.json"))
);
await writeFile(
  join(scratch, "user/User/globalStorage/storage.json"),
  JSON.stringify({ userDataProfiles: [{ location: "pxtk-localization", name: "PXTK Development" }] })
);
await writeFile(
  workspace,
  JSON.stringify(
    {
      folders: [{ path: "Mod" }, { path: "Second" }, { path: "Vanilla" }],
      settings: {
        "px.gameId": "ck3",
        "px.gamePath": join(scratch, "Vanilla"),
        "px.modPath": join(scratch, "Mod"),
        "px.logsPath": join(scratch, "logs"),
        "px.indexAssets": false,
        "px.tigerRunOn": "manual",
        "explorer.compactFolders": false,
        "explorer.autoReveal": true,
        "git.enabled": false,
        "git.openRepositoryInParentFolders": "never",
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
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/localization-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Localization editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_LOCALIZATION_TEST_SCRATCH: scratch },
  launchArgs: [
    workspace,
    "--profile",
    "PXTK Development",
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--remote-debugging-port=9339",
    "--disable-extension",
    "vscode.git",
    "--disable-extension",
    "vscode.git-base",
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
