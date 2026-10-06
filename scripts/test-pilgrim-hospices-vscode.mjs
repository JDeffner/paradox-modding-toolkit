import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [fixture, executable, target] = process.argv.slice(2);
if (!fixture || !executable || !target)
  throw new Error("Pass fixture, Code executable, and a NEW test output folder");
await mkdir(target);
for (const folder of ["Practice", "Vanilla 1.18", "Vanilla 1.19", "Reference 1.19"])
  await cp(join(fixture, folder), join(target, folder), { recursive: true });
await mkdir(join(target, "Result"));
await writeFile(
  join(target, "Practice/.px-toolkit/compatch.json"),
  JSON.stringify({ version: 1, vanilla: "../Vanilla 1.18", newGame: "../Vanilla 1.19", output: "../Result" })
);
await mkdir(join(target, "user/User"), { recursive: true });
await writeFile(
  join(target, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "files.autoSave": "off",
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
  })
);
await writeFile(
  join(target, "Practice/.vscode/settings.json"),
  JSON.stringify({
    "px.gameId": "ck3",
    "px.gamePath": join(target, "Vanilla 1.19"),
    "px.modPath": join(target, "Practice"),
    "px.tigerRunOn": "manual",
    "px.indexAssets": false,
    "px.experimentalFeatures": true,
  })
);
const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(target, "package")
);
const suite = join(target, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/pilgrim-hospices-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Pilgrim Hospices separate-result editor checks: ${target}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: join(target, "package/extension"),
  extensionTestsPath: suite,
  launchArgs: [
    join(target, "Practice"),
    "--profile",
    "PXTK Development",
    "--user-data-dir",
    join(target, "user"),
    "--extensions-dir",
    join(target, "extensions"),
    "--remote-debugging-port=9339",
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
