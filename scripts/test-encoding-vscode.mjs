import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-encoding-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "px-encoding-editor-"));
const mod = join(scratch, "Mod");
const game = join(scratch, "Vanilla");
const dependency = join(scratch, "Dependency");
for (const folder of [
  mod,
  join(game, "common"),
  dependency,
  join(scratch, "user/User"),
  join(scratch, "extensions"),
  join(scratch, "logs"),
]) {
  await mkdir(folder, { recursive: true });
}
await writeFile(join(mod, ".px-encoding-fixture"), "isolated encoding smoke\n");
await writeFile(join(mod, "descriptor.mod"), 'name="Encoding smoke"\n');
await writeFile(join(dependency, "descriptor.mod"), 'name="Read-only dependency"\n');
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
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
    "px.parentMods": [dependency],
    "px.logsPath": join(scratch, "logs"),
    "px.tigerRunOn": "manual",
    "px.indexAssets": false,
  })
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/encoding-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Isolated encoding editor test: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(root, "packages/vscode"),
  extensionTestsPath: suite,
  launchArgs: [
    mod,
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--disable-gpu",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
