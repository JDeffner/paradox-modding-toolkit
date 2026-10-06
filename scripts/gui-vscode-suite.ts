import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run() {
  const scratch = process.env.PX_GUI_TEST_SCRATCH!;
  assert.ok(scratch);
  const file = path.join(scratch, "Mod/gui/editor.gui");
  const before = await fs.readFile(file);
  const checks: string[] = [];
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("px.openGuiEditor");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  let ui = await connect("Boolean(document.getElementById('canvas') && document.getElementById('tree'))");
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 150; i++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${expression}. ${await ui.eval("document.body.innerText")}`);
  };
  const select = async () => {
    await waitFor(
      "Boolean([...document.querySelectorAll('#tree .row')].find(row=>row.textContent.includes('#editor_icon')))"
    );
    await ui.eval(
      "[...document.querySelectorAll('#tree .row')].find(row=>row.textContent.includes('#editor_icon')).click()"
    );
    await waitFor("Boolean(document.querySelector('#inspector input[data-row=position]'))");
  };
  const closePanel = async () => {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (item) => item.input instanceof vscode.TabInputWebview && item.input.viewType.includes("px.guiEditor")
      );
    assert.ok(tab, "GUI editor tab exists before closing");
    assert.equal(await vscode.window.tabGroups.close(tab), true);
  };
  try {
    await select();
    assert.equal(
      await ui.eval("document.querySelector('#tree [aria-selected=true] .rowName').textContent"),
      "#editor_icon"
    );
    await ui.screenshot(path.join(scratch, "gui-selected.png"));
    checks.push("rendered tree selection and property inspector");
    await ui.eval(
      "(() => { const input=document.querySelector('#inspector input[data-row=position]');input.value='';input.dispatchEvent(new Event('change')); })()"
    );
    await waitFor("document.body.textContent.includes('position needs a value')");
    assert.equal(doc.isDirty, false);
    assert.deepEqual(await fs.readFile(file), before);
    assert.equal(
      await ui.eval("document.querySelector('#inspector input[data-row=position]').value"),
      "{ 30 20 }"
    );
    checks.push("empty property refusal preserves source and restores the field value");
    await ui.eval(
      "(() => { const input=document.querySelector('#inspector input[data-row=position]');input.value='{ 50 30 }';input.dispatchEvent(new Event('change')); })()"
    );
    await waitFor(
      "!document.getElementById('save').disabled && document.querySelector('#changes .count').textContent==='1'"
    );
    assert.equal(doc.isDirty, true);
    assert.deepEqual(
      await fs.readFile(file),
      before,
      "property edit stays in the current buffer before Save"
    );
    assert.equal(
      doc.getText(),
      before
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .replace("{ 30 20 }", "{ 50 30 }")
    );
    checks.push("property edit preserves surrounding source and waits for Save");
    await ui.eval("document.getElementById('save').click()");
    await waitFor("document.getElementById('save').disabled");
    assert.equal(doc.isDirty, false);
    const saved = await fs.readFile(file);
    assert.deepEqual(saved, Buffer.from(before.toString("utf8").replace("{ 30 20 }", "{ 50 30 }")));
    await ui.screenshot(path.join(scratch, "gui-saved.png"));
    checks.push("rendered Save writes exact source with one BOM");
    await ui.eval("document.getElementById('undo').click()");
    await waitFor("!document.getElementById('save').disabled && document.getElementById('undo').disabled");
    assert.equal(doc.getText(), before.toString("utf8").replace(/^\uFEFF/, ""));
    await ui.eval("document.getElementById('save').click()");
    await waitFor("document.getElementById('save').disabled");
    assert.deepEqual(await fs.readFile(file), before);
    checks.push("panel Undo and Save restore exact original bytes");
    await ui.eval("document.getElementById('redo').click()");
    await waitFor("!document.getElementById('save').disabled");
    await ui.eval("document.getElementById('save').click()");
    await waitFor("document.getElementById('save').disabled");
    assert.deepEqual(await fs.readFile(file), saved);
    checks.push("panel Redo restores the saved edit");
    await closePanel();
    ui.close();
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("px.openGuiEditor");
    ui = await connect("Boolean(document.getElementById('canvas') && document.getElementById('tree'))");
    await select();
    assert.equal(
      await ui.eval("document.querySelector('#inspector input[data-row=position]').value"),
      "{ 50 30 }"
    );
    assert.equal(await ui.eval("document.getElementById('undo').disabled"), true);
    assert.equal(await ui.eval("document.getElementById('save').disabled"), true);
    await ui.screenshot(path.join(scratch, "gui-reopened.png"));
    checks.push("reopened panel reads saved property and has no inherited undo history");
    await closePanel();
    const binding = await vscode.workspace.openTextDocument(path.join(scratch, "Mod/gui/multiline.gui"));
    const editor = await vscode.window.showTextDocument(binding);
    editor.selection = new vscode.Selection(1, 14, 1, 14);
    for (let i = 0; i < 100; i++) {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        binding.uri,
        editor.selection.active
      );
      if (hovers?.length) break;
      await pause(100);
    }
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    await vscode.commands.executeCommand("editor.action.showHover");
    for (let i = 0; i < 100; i++) {
      if (
        await ui.evalWorkbench(
          "Boolean([...document.querySelectorAll('.monaco-hover')].find(element=>element.textContent.includes('Character.GetName')))"
        )
      )
        break;
      await pause(100);
    }
    assert.equal(
      await ui.evalWorkbench(
        "Boolean([...document.querySelectorAll('.monaco-hover')].find(element=>element.textContent.includes('Character.GetName')))"
      ),
      true
    );
    await ui.screenshot(path.join(scratch, "multiline-hover.png"));
    await vscode.commands.executeCommand("editor.action.hideHover");
    const completionEdit = new vscode.WorkspaceEdit();
    completionEdit.replace(binding.uri, new vscode.Range(1, 11, 1, 18), "GetN");
    assert.equal(await vscode.workspace.applyEdit(completionEdit), true);
    editor.selection = new vscode.Selection(1, 15, 1, 15);
    await vscode.commands.executeCommand("editor.action.triggerSuggest");
    for (let i = 0; i < 100; i++) {
      if (
        await ui.evalWorkbench(
          "Boolean(document.querySelector('.suggest-widget.visible')?.textContent.includes('GetName'))"
        )
      )
        break;
      await pause(100);
    }
    assert.equal(
      await ui.evalWorkbench(
        "Boolean(document.querySelector('.suggest-widget.visible')?.textContent.includes('GetName'))"
      ),
      true
    );
    await ui.screenshot(path.join(scratch, "multiline-completion.png"));
    await ui.evalWorkbench(
      "[...document.querySelectorAll('.suggest-widget .monaco-list-row')].find(row=>row.querySelector('.label-name')?.textContent==='GetName').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))"
    );
    await vscode.commands.executeCommand("acceptSelectedSuggestion");
    assert.equal(binding.lineAt(1).text, " Character.GetName,");
    editor.selection = new vscode.Selection(2, 1, 2, 1);
    await vscode.commands.executeCommand("editor.action.triggerParameterHints");
    for (let i = 0; i < 100; i++) {
      if (
        await ui.evalWorkbench(
          "Boolean(document.querySelector('.parameter-hints-widget.visible')?.textContent.includes('ObjectsEqual'))"
        )
      )
        break;
      await pause(100);
    }
    assert.equal(
      await ui.evalWorkbench(
        "Boolean(document.querySelector('.parameter-hints-widget.visible')?.textContent.includes('ObjectsEqual'))"
      ),
      true
    );
    await ui.screenshot(path.join(scratch, "multiline-signature.png"));
    checks.push("multiline GUI binding shows hover, completion with exact replacement and signature help");
    await vscode.commands.executeCommand("closeParameterHints");
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify({ passed: true, vscode: vscode.version, checks }, null, 2)
    );
    console.log(`Packaged GUI editor checks passed: ${checks.length} groups.`);
  } catch (error) {
    const evidence = await Promise.allSettled([ui.screenshot(path.join(scratch, "failure.png"))]);
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        {
          checks,
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
          evidence: evidence.map((item) => (item.status === "fulfilled" ? "saved" : String(item.reason))),
        },
        null,
        2
      )
    );
    throw error;
  } finally {
    ui.close();
  }
}
