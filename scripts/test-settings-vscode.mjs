import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-settings-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "settings-"));
for (const folder of ["Mod", "Second", "Vanilla/common", "logs", "user/User", "extensions"])
  await mkdir(join(scratch, folder), { recursive: true });
for (const folder of ["Mod", "Second"])
  await writeFile(join(scratch, folder, "descriptor.mod"), `\uFEFFname="Settings ${folder}"\n`);
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
    "window.title": "PXTK Settings Test",
    "window.commandCenter": false,
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
const workspace = join(scratch, "settings.code-workspace");
await writeFile(
  workspace,
  JSON.stringify(
    {
      folders: [{ path: "Mod" }, { path: "Second" }],
      settings: {
        "px.gameId": "ck3",
        "px.gamePath": join(scratch, "Vanilla"),
        "px.modPath": join(scratch, "Mod"),
        "px.logsPath": join(scratch, "logs"),
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
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/settings-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Settings editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_SETTINGS_TEST_SCRATCH: scratch },
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
