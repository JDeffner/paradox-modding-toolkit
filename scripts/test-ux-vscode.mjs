import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-ux-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "px-ux-editor-"));
const mod = join(scratch, "Mod");
const game = join(scratch, "Vanilla");
await mkdir(mod);
await mkdir(join(game, "common"), { recursive: true });
await mkdir(join(scratch, "user/User"), { recursive: true });
await mkdir(join(scratch, "extensions"));
await writeFile(join(mod, ".px-ux-fixture"), "isolated UX smoke\n");
await writeFile(join(mod, "descriptor.mod"), 'name="UX smoke"\n');
await writeFile(join(mod, "description.bbcode"), "[h1]Saved listing[/h1]\n");
await writeFile(join(mod, "unrelated.txt"), "Unrelated editor target\n");
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "files.autoSave": "off",
    "px.gameId": "ck3",
    "px.gamePath": game,
    "px.modPath": mod,
    "px.tigerRunOn": "manual",
    "px.indexAssets": false,
  })
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/ux-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Isolated UX editor test: ${scratch}`);
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
