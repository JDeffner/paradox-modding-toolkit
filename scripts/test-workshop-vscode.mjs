import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-workshop-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "workshop-"));
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
    "window.title": "PXTK Workshop Test",
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
        "files.simpleDialog.enable": true,
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
await mkdir(join(scratch, "Mod/.px-toolkit/workshop"), { recursive: true });
await writeFile(
  join(scratch, "Mod/.px-toolkit/workshop/description.bbcode"),
  "[h1]Workshop fixture[/h1]\nKeep the live description.\n"
);
await writeFile(
  join(scratch, "Mod/descriptor.mod"),
  '\uFEFFname="Workshop fixture"\nversion="2.0"\nsupported_version="1.20.*"\n'
);
const previews = join(scratch, "Mod/.px-toolkit/workshop/previews");
await mkdir(previews, { recursive: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv+kAAAAASUVORK5CYII=",
  "base64"
);
for (const name of ["a.png", "b.png"]) await writeFile(join(previews, name), png);
await writeFile(join(previews, "order.txt"), "b.png\na.png\nb.png\na.png\n");
const legacyZip = new AdmZip();
legacyZip.addFile(
  "old-release/mod/descriptor.mod",
  Buffer.from(
    '\uFEFFname="Archived fixture"\nversion="1.0"\nsupported_version="1.17.*"\nremote_file_id="999"\n'
  )
);
legacyZip.addFile("old-release/mod/events/archived.txt", Buffer.from("\uFEFFArchived files"));
legacyZip.writeZip(join(scratch, "old-release.zip"));
const invalidZip = new AdmZip();
invalidZip.addFile("README.txt", Buffer.from("No mod descriptor"));
invalidZip.writeZip(join(scratch, "invalid-release.zip"));
await mkdir(join(scratch, "Target/common"), { recursive: true });
await writeFile(
  join(scratch, "Mod/.px-toolkit/compatch.json"),
  JSON.stringify({ version: 1, vanilla: "../Vanilla", newGame: "../Target", output: "../Result" })
);
await mkdir(join(scratch, "Result"), { recursive: true });
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/workshop-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Workshop editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_WORKSHOP_TEST_SCRATCH: scratch },
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
