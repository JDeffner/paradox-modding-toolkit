import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run() {
  const scratch = process.env.PX_EVENT_GRAPH_TEST_SCRATCH!;
  assert.ok(scratch);
  const file = path.join(scratch, "Mod/events/graph_save.txt");
  const before = await fs.readFile(file, "utf8");
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand("px.showEventGraph", doc.uri);
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  const ui = await connect(
    "Boolean(document.getElementById('inspector') && document.getElementById('save'))"
  );
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 100; i++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${expression}. ${await ui.eval("document.body.innerText")}`);
  };
  const select = () =>
    ui.eval(
      "document.querySelector('.node').dispatchEvent(new KeyboardEvent('keydown', {key:' ',bubbles:true}))"
    );
  const editGold = async (value: string, commit = true) => {
    await ui.eval(
      "[...document.querySelectorAll('#inspector .trow')].find(row => row.querySelector('.tk')?.textContent === 'gold').querySelector('.tval').click()"
    );
    await waitFor("Boolean(document.querySelector('#inspector .editWrap input'))");
    if (commit)
      await ui.eval(
        `(() => { const field = document.querySelector('#inspector .editWrap input'); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('change')); })()`
      );
    else {
      await ui.eval("document.querySelector('#inspector .editWrap input').select()");
      await ui.sendWorkbench("Input.insertText", { text: value });
    }
  };
  try {
    await waitFor("document.querySelectorAll('.node').length === 1");
    assert.equal(
      await ui.eval("document.getElementById('toolConnected').getAttribute('aria-pressed')"),
      "false"
    );
    await select();
    await waitFor(
      "Boolean([...document.querySelectorAll('#inspector .trow')].find(row => row.querySelector('.tk')?.textContent === 'gold'))"
    );
    await editGold("20");
    await editGold("25", false);
    assert.equal(await fs.readFile(file, "utf8"), before, "form edits stay pending before Save");
    for (const type of ["keyDown", "keyUp"])
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type,
        key: "s",
        code: "KeyS",
        windowsVirtualKeyCode: 83,
        modifiers: 2,
      });
    await waitFor(
      "document.getElementById('save').disabled && document.querySelector('#inspector .pendingMark') === null && document.body.innerText.includes('Saved 2 changes')"
    );
    let saved = await fs.readFile(file, "utf8");
    assert.equal(
      saved,
      before.replace("gold >= 10", "gold >= 25"),
      "packaged graph Save preserves comparison, spacing, adjacent condition, comment and BOM"
    );
    await waitFor(
      "Boolean([...document.querySelectorAll('#inspector .trow')].find(row => row.querySelector('.tk')?.textContent === 'gold' && row.querySelector('.tval')?.textContent === '25'))"
    );
    await ui.screenshot(path.join(scratch, "event-graph-saved.png"));
    for (let count = 1; count <= 2; count++) {
      await ui.eval(
        "[...document.querySelectorAll('#inspector button')].find(button => button.textContent.trim() === 'Add option').click()"
      );
      await waitFor(`document.querySelector('#changes .count').textContent === '${count}'`);
    }
    assert.equal(await fs.readFile(file, "utf8"), saved, "queued options do not write before Save");
    await ui.eval("document.getElementById('save').click()");
    await waitFor(
      "document.getElementById('save').disabled && document.querySelector('#inspector .pendingMark') === null"
    );
    const withOptions = await fs.readFile(file, "utf8");
    assert.deepEqual(
      withOptions.match(/name = graph_save\.1\.[ab]/g),
      ["name = graph_save.1.a", "name = graph_save.1.b"],
      "two queued options save in author order"
    );
    assert.equal(
      withOptions,
      saved.replace(
        /}\n$/,
        "\toption = {\n\t\tname = graph_save.1.a\n\t}\n\toption = {\n\t\tname = graph_save.1.b\n\t}\n}\n"
      ),
      "option creation preserves all existing event bytes"
    );
    saved = withOptions;
    await ui.screenshot(path.join(scratch, "event-graph-options-saved.png"));
    await editGold("30");
    const userChange = new vscode.WorkspaceEdit();
    userChange.insert(doc.uri, new vscode.Position(doc.lineCount - 1, 0), "# unsaved source work\n");
    assert.equal(await vscode.workspace.applyEdit(userChange), true);
    const dirty = doc.getText();
    assert.equal(doc.isDirty, true);
    await ui.eval("document.getElementById('save').click()");
    await waitFor(
      "!document.getElementById('save').disabled && document.body.innerText.includes('source changed')"
    );
    assert.equal(doc.getText(), dirty, "stale graph form cannot overwrite current unsaved source");
    assert.equal(await fs.readFile(file, "utf8"), saved, "rejected graph save leaves disk unchanged");
    assert.equal(
      await ui.eval("document.querySelector('#changes .count').textContent"),
      "1",
      "rejected edit remains pending"
    );
    await ui.screenshot(path.join(scratch, "event-graph-stale-save.png"));
    await ui.eval("document.getElementById('undo').click()");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    console.log(
      "Packaged Event Graph checks passed: rendered field editing, repeated values, Ctrl+S with active field, connected filter state, exact file preservation, stale dirty-source rejection and pending retention."
    );
  } finally {
    ui.close();
  }
}
