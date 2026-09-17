import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";
import { addFile, emptyInventory } from "../packages/vscode/src/compatch/core";
import { needsGameUpdate } from "../packages/vscode/src/compatch/gameUpdate";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";

export async function run() {
  const mod = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const root = path.dirname(mod);
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit")!;
  assert.deepEqual(
    extension.packageJSON.contributes.views.px
      .filter((v: { visibility: string }) => v.visibility === "visible")
      .map((v: { id: string }) => v.id),
    ["px.tools"],
    "Only Project defaults to expanded"
  );
  await extension.activate();
  await vscode.commands.executeCommand("px.openCompatch");
  const gameRelative = "events/health_events.txt",
    modRelative = "events/gentler_wounds/health_0001.txt";
  const oldFile = path.join(root, "Vanilla", gameRelative),
    newFile = path.join(root, "New Game Version", gameRelative);
  const oldText = await fs.readFile(oldFile, "utf8"),
    newText = await fs.readFile(newFile, "utf8");
  const modFile = path.join(mod, modRelative),
    before = await fs.readFile(modFile, "utf8");
  const row = async () => {
    const inventory = emptyInventory();
    addFile(inventory, "base", gameRelative, await fs.readFile(oldFile, "utf8"), ck3Meta.compatch);
    addFile(inventory, "B", gameRelative, await fs.readFile(newFile, "utf8"), ck3Meta.compatch);
    addFile(inventory, "A", modRelative, await fs.readFile(modFile, "utf8"), ck3Meta.compatch);
    const tasks = [...inventory.entries.values()].filter(needsGameUpdate);
    assert.deepEqual(
      tasks.map((entry) => entry.name),
      ["health.0001"]
    );
    return { entry: tasks[0] };
  };
  const selected = await row();
  await vscode.commands.executeCommand("px.compareCompatch", selected);
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab!;
  assert.ok(tab.input instanceof vscode.TabInputTextDiff);
  const input = tab.input;
  assert.ok(tab.label.startsWith("New Game Version"), "roles lead the tab title");
  assert.equal(tab.input.modified.toString(), vscode.Uri.file(modFile).toString());
  const original = await vscode.workspace.openTextDocument(tab.input.original);
  assert.ok(original.getText().includes("health.0001"));
  assert.ok(
    !original.getText().includes("health.0002"),
    "unrelated vanilla events are not shown as removed mod content"
  );
  const editor = vscode.window.visibleTextEditors.find(
    (item) => item.document.uri.toString() === input.modified.toString()
  )!;
  const lastLine = editor.document.lineCount - 1;
  editor.revealRange(new vscode.Range(lastLine, 0, lastLine, 0), vscode.TextEditorRevealType.AtTop);
  assert.equal(
    vscode.window.tabGroups.activeTabGroup.activeTab!.label,
    tab.label,
    "source title survives scrolling"
  );
  await vscode.commands.executeCommand("px.compatchPreviewMerge", selected);
  assert.equal(await fs.readFile(modFile, "utf8"), before);
  await vscode.commands.executeCommand("px.compatchApplyMerge", selected);
  const after = await fs.readFile(modFile, "utf8");
  assert.equal(after, before.replace("max = 25", "max = 30"), "only the upstream event change is applied");
  assert.ok(after.includes("id_override_priority = 10") && after.includes("chance = 10"));
  assert.ok(!after.includes("health.0002"));
  assert.equal(await fs.readFile(oldFile, "utf8"), oldText);
  assert.equal(await fs.readFile(newFile, "utf8"), newText);
  assert.deepEqual(
    execFileSync("git", ["-C", mod, "diff", "--name-only"], { encoding: "utf8", windowsHide: true })
      .trim()
      .split(/\r?\n/),
    [modRelative]
  );
  await vscode.commands.executeCommand("px.compatchSourceControl");
  // Only the scratch new-game source is changed to exercise a future overlapping update.
  await fs.writeFile(newFile, newText.replace("chance = 40", "chance = 20"));
  await vscode.commands.executeCommand("px.refreshCompatch");
  await vscode.commands.executeCommand("px.compatchApplyMerge", await row());
  assert.equal(
    await fs.readFile(modFile, "utf8"),
    after,
    "conflicting event updates never overwrite the mod"
  );
  console.log(
    "Single-event editor test passed: cross-file ID match, scoped diff, scrolling, preview, in-place event merge, one-file Git diff and conflict preservation. Only Project defaults expanded."
  );
}
