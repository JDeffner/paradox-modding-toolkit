import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-storage-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "storage-"));
for (const folder of [
  "Mod/.ck3modding/nested",
  "Second/.vscode",
  "Second/.ck3modding",
  "Vanilla/common",
  "logs",
  "second-logs",
  "logs-next",
  "logs-external",
  "logs-draft",
  "user/User",
  "user/User/profiles/pxtk-storage",
  "user/User/globalStorage",
  "extensions",
])
  await mkdir(join(scratch, folder), { recursive: true });
for (const folder of ["Mod", "Second"])
  await writeFile(join(scratch, folder, "descriptor.mod"), `\uFEFFname="Storage ${folder}"\n`);
await writeFile(join(scratch, "Vanilla/reference.txt"), "Read-only storage test reference.\n");
await writeFile(
  join(scratch, "Mod/.ck3modding/project.json"),
  JSON.stringify({ version: 1, authoring: { future: "keep" }, unrelated: { keep: true } }, null, 2) + "\n"
);
await writeFile(
  join(scratch, "Mod/.ck3modding/calendar.json"),
  '{"epoch":1000,"after":"AF","before":"BF"}\n'
);
await writeFile(
  join(scratch, "Mod/.ck3modding/nested/keep.txt"),
  "Legacy nested artifact, preserve these bytes.\r\n"
);
await writeFile(join(scratch, "Second/.ck3modding/localization.json"), '{"language":"german"}\n');
await writeFile(
  join(scratch, "Second/.vscode/settings.json"),
  `{
  // Keep this folder editor note.
  "files.trimTrailingWhitespace": false,
  "storage.fixture": "keep",
  "px.characterHistory.quoteNames": true,
  "px.logsPath": ${JSON.stringify(join(scratch, "second-logs"))}
}\n`
);
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify(
    {
      "security.workspace.trust.enabled": false,
      "extensions.autoUpdate": false,
      "extensions.autoCheckUpdates": false,
      "update.mode": "none",
      "files.autoSave": "off",
      "chat.disableAIFeatures": true,
      "workbench.startupEditor": "none",
      "window.title": "PXTK Storage Test",
      "window.commandCenter": false,
      "workbench.colorTheme": "Default Dark Modern",
      "git.openRepositoryInParentFolders": "never",
      "px.notifications.startup": false,
      "px.machinePaths": {
        version: 1,
        future: "keep",
        defaults: { vic3: { gamePath: "another installation" } },
      },
    },
    null,
    2
  )
);
// Named profiles have their own User settings, even in a fresh isolated user-data directory.
await writeFile(
  join(scratch, "user/User/profiles/pxtk-storage/settings.json"),
  await readFile(join(scratch, "user/User/settings.json"))
);
await writeFile(
  join(scratch, "user/User/globalStorage/storage.json"),
  JSON.stringify({
    userDataProfiles: [{ location: "pxtk-storage", name: "PXTK Development" }],
  })
);
const workspace = join(scratch, "storage.code-workspace");
await writeFile(
  workspace,
  `{
  // Keep this workspace editor note.
  "folders": [{"path":"Mod"},{"path":"Second"}],
  "settings": ${JSON.stringify(
    {
      "px.gameId": "ck3",
      "px.gamePath": join(scratch, "Vanilla"),
      "px.modPath": join(scratch, "Mod"),
      "px.logsPath": join(scratch, "logs"),
      "px.characterHistory.quoteNames": false,
      "px.characterHistory.quoteCultures": false,
      "px.diagnostics.ignore": ["fixture-diagnostic"],
      "px.indexAssets": false,
      "px.tigerRunOn": "manual",
      "editor.tabSize": 3,
      "storage.fixture": "keep",
    },
    null,
    2
  )}
}\n`
);
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(scratch, "package")
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/storage-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Storage editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_STORAGE_TEST_SCRATCH: scratch },
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
