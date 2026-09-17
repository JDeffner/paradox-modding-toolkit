import { runTests } from "@vscode/test-electron";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [fixture, executable, target] = process.argv.slice(2);
if (!fixture || !executable || !target)
  throw new Error("Pass fixture, Code executable, and a NEW test output folder");
await mkdir(target);
for (const folder of ["Practice", "Vanilla 1.18", "Vanilla 1.19", "Reference 1.19"])
  await cp(join(fixture, folder), join(target, folder), { recursive: true });
await writeFile(
  join(target, "Practice/.vscode/settings.json"),
  JSON.stringify({
    "px.gameId": "ck3",
    "px.gamePath": join(target, "Vanilla 1.19"),
    "px.modPath": join(target, "Practice"),
    "px.tigerRunOn": "manual",
    "px.indexAssets": false,
  })
);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: resolve("packages/vscode"),
  extensionTestsPath: resolve("dist/pilgrim-hospices-vscode-suite.cjs"),
  launchArgs: [
    join(target, "Practice"),
    "--user-data-dir",
    join(target, "user"),
    "--extensions-dir",
    join(target, "extensions"),
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
