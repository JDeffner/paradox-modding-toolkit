import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-patches-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const parent = join(root, ".local/testing");
await mkdir(parent, { recursive: true });
const scratch = await mkdtemp(join(parent, "patches-"));
const output = join(scratch, "Output");
const sources = Object.fromEntries(["a", "b", "c"].map((id) => [id, join(scratch, `Source-${id}`)]));
const scriptPath = "common/decisions/px_editor_fixture.txt";
const locPath = "localization/english/px_editor_fixture_l_english.yml";
const originalSources = {};
for (const directory of [output, ...Object.values(sources)]) {
  await mkdir(join(directory, "common/decisions"), { recursive: true });
  await mkdir(join(directory, "localization/english"), { recursive: true });
}
for (const [id, folder] of Object.entries(sources)) {
  const index = ["a", "b", "c"].indexOf(id) + 1;
  const name = `Synthetic source ${id.toUpperCase()}`;
  const script = `\uFEFF# Synthetic editor fixture. No game compatibility claim.
px_fields = {
 desc = DESC_${id.toUpperCase()}
 major = ${id === "c" ? "yes" : "no"}
 is_shown = { always = yes }
 effect = { add_gold = ${index} }
}
px_source = {
 desc = SOURCE_${id.toUpperCase()}
 major = no
 is_shown = { always = yes }
 effect = { add_gold = ${index * 10} }
}
px_winner = {
 desc = WINNER_${id.toUpperCase()}
 major = no
 is_shown = { always = yes }
 effect = { add_gold = ${index * 100} }
}
# This unchanged sibling must survive complete file replacement.
px_sibling = {
 desc = KEEP_SIBLING
 major = no
 is_shown = { always = yes }
 effect = { add_gold = 99 }
}
`;
  const localization = `\uFEFFl_english:\n PATCH_LABEL:0 "Contribution ${id.toUpperCase()}"\n SOURCE_LOC_SIBLING:0 "Same source sibling"\n`;
  const descriptor = `\uFEFFname = "${name}"\nversion = "1.0"\nsupported_version = "1.*"\n`;
  for (const [relative, text] of [
    [scriptPath, script],
    [locPath, localization],
    ["descriptor.mod", descriptor],
  ]) {
    await writeFile(join(folder, relative), text);
    originalSources[`${id}:${relative}`] = Buffer.from(text, "utf8").toString("base64");
  }
}
await mkdir(join(sources.a, "gfx"));
const binary = Buffer.from([0x44, 0x44, 0x53, 0x20, 0xff]);
await writeFile(join(sources.a, "gfx/fixture.dds"), binary);
originalSources["a:gfx/fixture.dds"] = binary.toString("base64");
await mkdir(join(output, ".px-toolkit"), { recursive: true });
await mkdir(join(output, "localization/replace"), { recursive: true });
const outputLocalization = "localization/replace/owned_l_english.yml";
await writeFile(
  join(output, outputLocalization),
  '\uFEFFl_english:\n PATCH_LABEL:0 "Existing patch value"\n OUTPUT_LOC_SIBLING:0 "Keep output sibling"\n'
);
await writeFile(
  join(output, "descriptor.mod"),
  '\uFEFFname = "Synthetic compatibility patch"\nversion = "1.0"\nsupported_version = "1.*"\ndependencies = { "External author dependency" }\n'
);
const patchId = "packaged-patches-fixture";
await writeFile(
  join(output, ".px-toolkit/compatibility.json"),
  JSON.stringify(
    {
      version: 1,
      id: patchId,
      gameId: "ck3",
      name: "Synthetic compatibility patch",
      inputs: ["a", "b", "c"].map((id) => ({ id, name: `Synthetic source ${id.toUpperCase()}` })),
      decisions: {},
      generated: {},
      testExtensionField: { preserved: true },
    },
    null,
    2
  ) + "\n"
);
await writeFile(
  join(scratch, "fixture.json"),
  JSON.stringify(
    { patchId, output, sources, scriptPath, locPath, outputLocalization, originalSources },
    null,
    2
  )
);
for (const folder of [
  "Vanilla/common",
  "Vanilla/launcher",
  "logs",
  "user/User/profiles/pxtk-patches",
  "user/User/globalStorage",
  "extensions",
])
  await mkdir(join(scratch, folder), { recursive: true });
await writeFile(join(scratch, "Vanilla/launcher/launcher-settings.json"), '{"rawVersion":"1.0"}\n');
const settings = JSON.stringify(
  {
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "update.mode": "none",
    "files.autoSave": "off",
    "files.simpleDialog.enable": true,
    "chat.disableAIFeatures": true,
    "workbench.startupEditor": "none",
    "window.title": "PXTK Compatibility Patch Test",
    "window.commandCenter": false,
    "workbench.colorTheme": "Default Dark Modern",
    "git.openRepositoryInParentFolders": "never",
    "px.notifications.startup": false,
    "px.machinePaths": { version: 1, patches: { [patchId]: { output, sources } } },
  },
  null,
  2
);
await writeFile(join(scratch, "user/User/settings.json"), settings);
await writeFile(join(scratch, "user/User/profiles/pxtk-patches/settings.json"), settings);
await writeFile(
  join(scratch, "user/User/globalStorage/storage.json"),
  JSON.stringify({ userDataProfiles: [{ location: "pxtk-patches", name: "PXTK Development" }] })
);
const workspace = join(scratch, "patches.code-workspace");
await writeFile(
  workspace,
  JSON.stringify(
    {
      folders: ["Output", "Source-a", "Source-b", "Source-c"].map((folder) => ({ path: folder })),
      settings: {
        "px.gameId": "ck3",
        "px.gamePath": join(scratch, "Vanilla"),
        "px.modPath": output,
        "px.logsPath": join(scratch, "logs"),
        "px.experimentalFeatures": false,
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
  entryPoints: [join(root, "scripts/patches-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Packaged compatibility patch checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_PATCHES_TEST_SCRATCH: scratch },
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
