import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const previewType = "px.bbcodePreview";

async function waitFor<T>(read: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function activeTab(uri: vscode.Uri, representation: "text" | "preview"): vscode.Tab | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab) return;
  const input = tab.input;
  if (
    representation === "text"
      ? input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()
      : input instanceof vscode.TabInputCustom &&
        input.viewType === previewType &&
        input.uri.toString() === uri.toString()
  ) {
    return tab;
  }
}

async function checkBBCodeEditors(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "isolated test workspace opened");
  const mod = folder.uri.fsPath;
  assert.equal(await fs.readFile(path.join(mod, ".px-ux-fixture"), "utf8"), "isolated UX smoke\n");
  const extension = vscode.extensions.getExtension("JDeffner.px-toolkit");
  assert.ok(extension, "extension discovered");
  const contribution = extension.packageJSON.contributes.customEditors.find(
    (item: { viewType: string }) => item.viewType === previewType
  );
  assert.ok(contribution, "BBCode Preview advertised to the native editor picker");
  assert.equal(contribution.displayName, "BBCode Preview");
  assert.equal(contribution.priority, "option", "source remains the default until the user chooses");
  assert.ok(
    contribution.selector.some((item: { filenamePattern: string }) => item.filenamePattern === "*.bbcode")
  );
  await extension.activate();
  const review = extension.packageJSON.contributes.viewsContainers.panel.find(
    (item: { title: string }) => item.title === "Paradox Review"
  );
  assert.ok(review && /^[a-zA-Z0-9_-]+$/.test(review.id), "native panel container has a valid identifier");
  const commands = await vscode.commands.getCommands(true);
  assert.ok(
    commands.includes(`workbench.view.extension.${review.id}`),
    "review panel is registered by VS Code"
  );
  await vscode.commands.executeCommand("px.compatch.focus");

  const uri = vscode.Uri.joinPath(folder.uri, "description.bbcode");
  const unrelated = vscode.Uri.joinPath(folder.uri, "unrelated.txt");
  const original = await fs.readFile(uri.fsPath, "utf8");
  const dirtyText = "[h1]Unsaved preview title[/h1]\n[b]Unsaved source changes[/b]\n";
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.commands.executeCommand("vscode.open", uri, { preview: false });
  await waitFor(() => activeTab(uri, "text"), "default BBCode text editor");
  assert.equal(document.languageId, "bbcode");
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    dirtyText
  );
  assert.ok(await vscode.workspace.applyEdit(edit));

  const assertDirtySource = async (): Promise<void> => {
    const current = await vscode.workspace.openTextDocument(uri);
    assert.equal(current.getText(), dirtyText, "unsaved source text survives editor switching");
    assert.equal(current.languageId, "bbcode", "preview does not change the source language");
    assert.ok(current.isDirty, "preview does not save the source implicitly");
    assert.equal(await fs.readFile(uri.fsPath, "utf8"), original, "preview never writes to disk");
  };

  try {
    await vscode.window.showTextDocument(unrelated, { preview: false });
    await waitFor(() => activeTab(unrelated, "text"), "unrelated active editor");
    await vscode.commands.executeCommand("px.openBBCodePreview", uri);
    const preview = await waitFor(() => activeTab(uri, "preview"), "explicit target's custom preview");
    assert.ok(preview.isDirty, "custom preview shares the dirty document");
    await assertDirtySource();

    await vscode.commands.executeCommand("px.openBBCodeSource");
    await waitFor(() => activeTab(uri, "text"), "preview return to source");
    await assertDirtySource();

    const sourceColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
    await vscode.commands.executeCommand("px.openBBCodePreviewSide");
    const beside = await waitFor(
      () =>
        vscode.window.tabGroups.all.find(
          (group) =>
            group.viewColumn !== sourceColumn &&
            group.tabs.some(
              (tab) =>
                tab.input instanceof vscode.TabInputCustom &&
                tab.input.viewType === previewType &&
                tab.input.uri.toString() === uri.toString()
            )
        ),
      "file-backed preview in another editor group"
    );
    assert.equal(
      vscode.window.tabGroups.activeTabGroup.viewColumn,
      sourceColumn,
      "side preview preserves source focus"
    );
    assert.ok(activeTab(uri, "text"));
    await assertDirtySource();

    // Focus the existing side preview through the same stable API as the picker.
    await vscode.commands.executeCommand("vscode.openWith", uri, previewType, {
      viewColumn: beside.viewColumn,
      preserveFocus: false,
      preview: false,
    });
    await waitFor(() => activeTab(uri, "preview"), "focused side preview");
    await vscode.commands.executeCommand("px.openBBCodeSource");
    await waitFor(() => activeTab(uri, "text"), "side preview return to source");
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, beside.viewColumn);
    await assertDirtySource();

    await fs.writeFile(
      path.join(path.dirname(mod), "editor-results.json"),
      JSON.stringify(
        {
          passed: true,
          checks: [
            "native editor contribution is optional",
            "BBCode opens as text by default",
            "explicit URI overrides unrelated active editor",
            "custom preview tab retains file identity",
            "dirty text and BBCode language survive source and preview switching",
            "side preview preserves source focus",
            "return to source uses the preview group",
            "preview does not write to disk",
          ],
        },
        null,
        2
      ) + "\n"
    );
    console.log(
      "UX editor smoke passed: BBCode source, native custom preview, dirty edits, file targets and side preview."
    );
  } finally {
    // This document belongs to the disposable fixture. Clear dirty state before the test host exits.
    const current = await vscode.workspace.openTextDocument(uri);
    const restore = new vscode.WorkspaceEdit();
    restore.replace(
      uri,
      new vscode.Range(current.positionAt(0), current.positionAt(current.getText().length)),
      original
    );
    await vscode.workspace.applyEdit(restore);
    await current.save();
  }
}

export async function run(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checkBBCodeEditors(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("UX editor smoke exceeded 60 seconds")), 60_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
