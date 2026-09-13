// Exercise real diff tabs, virtual documents and in-place writes in an isolated editor.
import { runTests } from "@vscode/test-electron";
import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [example, executable] = process.argv.slice(2);
if (!example || !executable)
  throw new Error("Usage: node scripts/test-compatch-vscode.mjs <generated example> <Code executable>");
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "px-compatch-editor-"));
for (const name of ["Mod", "Vanilla", "New Game Version"])
  await cp(join(example, name), join(scratch, name), { recursive: true });
// Explicit mock game folder prevents installation discovery. This suite needs no installed game.
await mkdir(join(scratch, "user/User"), { recursive: true });
await writeFile(
  join(scratch, "user/User/settings.json"),
  JSON.stringify({
    "security.workspace.trust.enabled": false,
    "extensions.autoUpdate": false,
    "update.mode": "none",
    "px.gameId": "ck3",
    "px.gamePath": join(scratch, "Vanilla"),
    "px.modPath": join(scratch, "Mod"),
    "px.tigerRunOn": "manual",
    "px.indexAssets": false,
  })
);
const suite = join(scratch, "suite.cjs");
await writeFile(
  suite,
  `
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
exports.run = async () => {
  const root = path.dirname(vscode.workspace.workspaceFolders[0].uri.fsPath);
  const mod = path.join(root, "Mod");
  await vscode.extensions.getExtension("JDeffner.px-toolkit").activate();
  await vscode.commands.executeCommand("px.openCompatch");
  async function row(name) {
    const sites = {};
    for (const [side, folder] of Object.entries({A:"Mod", base:"Vanilla", B:"New Game Version"}))
      sites[side] = [{path:name, line:1, text:await fs.readFile(path.join(root,folder,name),"utf8")}];
    return {entry:{id:JSON.stringify(["file",name]), kind:"file", name, sites}};
  }
  const event = await row("events/legacy_events/dynasty_legacy_events.txt");
  await vscode.commands.executeCommand("px.compareCompatch",event);
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(tab.input instanceof vscode.TabInputTextDiff, "real diff tab opened");
  assert.equal(tab.input.original.scheme,"px-compatch");
  assert.equal(tab.input.modified.toString(),vscode.Uri.file(path.join(mod,event.entry.name)).toString());
  const source = await vscode.workspace.openTextDocument(tab.input.original);
  assert.ok(source.getText().includes("namespace = dynasty_legacy"),"complete source file");
  assert.ok(source.getText().includes("id_override_priority"),"new version snapshot has content");
  await vscode.commands.executeCommand("px.compatchGameChanges",event);
  const gameTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const old = await vscode.workspace.openTextDocument(gameTab.input.original);
  assert.ok(!old.getText().includes("id_override_priority"));
  const before = await fs.readFile(path.join(mod,event.entry.name),"utf8");
  await vscode.commands.executeCommand("px.compatchApplyMerge",event);
  assert.equal(await fs.readFile(path.join(mod,event.entry.name),"utf8"),before,"conflict never writes");
  const conflictTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok((await vscode.workspace.openTextDocument(conflictTab.input.original)).getText().includes("<<<<<<< Mod"));
  const clean = await row("common/on_action/traits_on_actions.txt");
  await vscode.commands.executeCommand("px.compatchPreviewMerge",clean);
  assert.equal(await fs.readFile(path.join(mod,clean.entry.name),"utf8"),clean.entry.sites.A[0].text,"preview never writes");
  await vscode.commands.executeCommand("px.compatchApplyMerge",clean);
  const bytes = await fs.readFile(path.join(mod,clean.entry.name));
  assert.deepEqual([...bytes.subarray(0,3)],[239,187,191],"BOM preserved exactly once");
  assert.notEqual(bytes.toString("utf8")[1],"\\uFEFF");
  assert.ok(bytes.toString("utf8").includes("on_trait_gained"),"applied to original mod");
  assert.equal(await fs.readFile(path.join(root,"Vanilla",clean.entry.name),"utf8"),clean.entry.sites.base[0].text);
  assert.equal(await fs.readFile(path.join(root,"New Game Version",clean.entry.name),"utf8"),clean.entry.sites.B[0].text);
  console.log("Compatch editor smoke passed: real diffs, complete snapshots, conflict preservation, preview and clean save with BOM.");
};
`
);
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: join(root, "packages/vscode"),
  extensionTestsPath: suite,
  launchArgs: [
    join(scratch, "Mod"),
    "--user-data-dir",
    join(scratch, "user"),
    "--extensions-dir",
    join(scratch, "extensions"),
    "--disable-gpu",
    "--no-sandbox",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
