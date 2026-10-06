import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [executable] = process.argv.slice(2);
if (!executable) throw new Error("Usage: node scripts/test-highlighting-vscode.mjs <Code executable>");
const root = resolve(import.meta.dirname, "..");
const base = join(root, ".local/testing");
await mkdir(base, { recursive: true });
const scratch = await mkdtemp(join(base, "highlighting-"));
for (const folder of [
  "Mod/common/scripted_effects",
  "Mod/common/traits",
  "Mod/gui",
  "Mod/localization/english",
  "Vanilla/common",
  "logs",
  "user/User",
  "extensions",
])
  await mkdir(join(scratch, folder), { recursive: true });
await writeFile(join(scratch, "Mod/descriptor.mod"), '\uFEFFname="Highlighting fixture"\n');
await writeFile(join(scratch, "Mod/common/traits/fixture.txt"), "\uFEFFhighlight_trait = {}\n");
await writeFile(
  join(scratch, "Mod/common/scripted_effects/fixture.txt"),
  `\uFEFFhighlight_effect = {
    save_scope_as = highlight_actor
    set_variable = { name = highlight_counter value = 2 }
    if = {
        limit = { is_alive = yes }
        scope:highlight_actor = {
            add_gold = var:highlight_counter
            add_trait = highlight_trait
        }
    }
    set_county_culture = scope:replacement_county.culture
    # scope:comment stays a comment
    custom_tooltip = "scope:quoted"
}
`
);
await writeFile(
  join(scratch, "Mod/gui/fixture.gui"),
  'types fixture {\n    type highlight_widget = widget {\n        text = "[Character.GetName]"\n    }\n}\n'
);
await writeFile(
  join(scratch, "Mod/localization/english/fixture_l_english.yml"),
  '\uFEFFl_english:\n highlight_label:0 "[Character.GetName] walks here"\n # [Character.GetName] stays a comment\n'
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
    "window.title": "PXTK Highlighting Test",
    "workbench.colorTheme": "Default Dark Modern",
    "editor.fontSize": 17,
    "editor.wordWrap": "off",
    "editor.minimap.enabled": false,
    "editor.semanticHighlighting.enabled": true,
    "git.enabled": false,
    "px.notifications.startup": false,
  })
);
const workspace = join(scratch, "highlighting.code-workspace");
await writeFile(
  workspace,
  JSON.stringify({
    folders: [{ path: "Mod" }],
    settings: {
      "px.gameId": "ck3",
      "px.gamePath": join(scratch, "Vanilla"),
      "px.modPath": join(scratch, "Mod"),
      "px.logsPath": join(scratch, "logs"),
      "px.indexAssets": false,
      "px.tigerRunOn": "manual",
    },
  })
);
const { version } = JSON.parse(await readFile(join(root, "packages/vscode/package.json"), "utf8"));
new AdmZip(join(root, `packages/vscode/px-toolkit-test-${version}.vsix`)).extractAllTo(
  join(scratch, "package")
);
const suite = join(scratch, "suite.cjs");
await build({
  entryPoints: [join(root, "scripts/highlighting-vscode-suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: suite,
});
console.log(`Highlighting editor checks: ${scratch}`);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: resolve(executable),
  extensionDevelopmentPath: join(scratch, "package/extension"),
  extensionTestsPath: suite,
  extensionTestsEnv: { PX_HIGHLIGHTING_TEST_SCRATCH: scratch },
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
