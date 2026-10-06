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
  const checks: string[] = [];
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
      "document.querySelector('.node[data-id=\"graph_save.1\"]').dispatchEvent(new KeyboardEvent('keydown', {key:' ',bubbles:true}))"
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
    await waitFor("document.querySelectorAll('.node').length === 3");
    assert.equal(await ui.eval("document.querySelectorAll('.edge-path').length"), 1);
    assert.match(
      String(await ui.eval("document.querySelector('.edge-hit title').textContent")),
      /graph_save\.2.*graph_save\.3[\s\S]*30/
    );
    await ui.screenshot(path.join(scratch, "event-graph-edges.png"));
    await ui.eval(
      "document.querySelector('.node[data-id=\"graph_save.3\"]').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))"
    );
    const chainFile = path.join(scratch, "Mod/events/graph_chain.txt");
    const isChainEditor = (editor: vscode.TextEditor) =>
      editor.document.uri.fsPath.toLowerCase() === chainFile.toLowerCase();
    for (let i = 0; i < 100 && !vscode.window.visibleTextEditors.some(isChainEditor); i++) await pause(100);
    const sourceEditor = vscode.window.visibleTextEditors.find(isChainEditor);
    assert.ok(sourceEditor, "node navigation opens a visible source editor alongside the graph");
    assert.equal(sourceEditor.selection.active.line, 3);
    const assertSourceLine = async (line: number, action: string) => {
      for (let i = 0; i < 100; i++) {
        if (
          vscode.window.visibleTextEditors.some(
            (editor) => isChainEditor(editor) && editor.selection.active.line === line
          )
        )
          return;
        await pause(100);
      }
      assert.fail(`${action} opens the exact zero-based source line ${line}`);
    };
    await ui.eval(
      "document.querySelector('.node[data-id=\"graph_save.2\"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}))"
    );
    await assertSourceLine(2, "node Enter");
    await ui.eval(
      "document.querySelector('.node[data-id=\"graph_save.2\"]').dispatchEvent(new KeyboardEvent('keydown', {key:' ',bubbles:true}))"
    );
    await waitFor("document.querySelector('#inspector h2')?.textContent === 'graph_save.2'");
    sourceEditor.selection = new vscode.Selection(0, 0, 0, 0);
    await ui.eval("document.querySelector('#inspector [data-tip=\"Open the source\"]').click()");
    await assertSourceLine(2, "inspector Open source");
    await ui.eval("document.getElementById('toolSimulate').click()");
    await waitFor("document.querySelector('#simBody h3')?.textContent === 'graph_save.2'");
    sourceEditor.selection = new vscode.Selection(0, 0, 0, 0);
    await ui.eval("document.querySelector('#simBody .badges button').click()");
    await assertSourceLine(2, "simulator Open source");
    await ui.screenshot(path.join(scratch, "event-graph-navigation.png"));
    await ui.eval("document.getElementById('simClose').click()");
    assert.equal(
      await ui.eval(
        "JSON.parse(document.querySelector('.node[data-id=\"graph_save.2\"]').getAttribute('data-vscode-context')).pxSourceLine"
      ),
      2
    );
    checks.push(
      "linked events and delay edge; node double-click, Enter, inspector and simulator use exact source lines"
    );
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
    checks.push("field edits and Ctrl+S preserve comparison, spacing, sibling condition, comment and BOM");
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
    checks.push("two queued options save in author order and preserve existing event source");
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
    checks.push("stale dirty source rejects Save and retains pending edit");
    await ui.eval("document.getElementById('undo').click()");
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await vscode.commands.executeCommand("px.showEventGraph", doc.uri);
    const blockedLocalization = path.join(scratch, "Mod/localization");
    await fs.mkdir(blockedLocalization, { recursive: true });
    const savedLocalization = path.join(scratch, "english-before-failure");
    await fs.rename(path.join(blockedLocalization, "english"), savedLocalization);
    await fs.writeFile(path.join(blockedLocalization, "english"), "blocking destination fixture\n");
    await ui.eval("document.getElementById('newEvent').click()");
    await waitFor("Boolean(document.querySelector('.newEventForm'))");
    await ui.eval(
      "(() => { const inputs=[...document.querySelectorAll('.newEventForm input')]; inputs[0].value='graph_retry.1';inputs.find(input=>input.placeholder===\"The window's heading\").value='Retry heading';inputs.find(input=>input.placeholder==='What is happening').value='Retry body';[...document.querySelectorAll('.newEventForm button')].find(button=>button.textContent.trim()==='Create on Save').click(); })()"
    );
    await waitFor("document.querySelector('#changes .count').textContent==='1'");
    const retryFile = path.join(scratch, "Mod/events/graph_retry_events.txt");
    await assert.rejects(fs.readFile(retryFile), { code: "ENOENT" });
    await ui.eval("document.getElementById('save').click()");
    await waitFor(
      "!document.getElementById('save').disabled && document.body.innerText.includes('localization')"
    );
    const partialScript = await fs.readFile(retryFile, "utf8");
    assert.equal(partialScript.match(/graph_retry\.1 =/g)?.length, 1);
    assert.match(partialScript, /^\uFEFFnamespace = graph_retry\r?\n/);
    assert.equal(await ui.eval("document.querySelector('#changes .count').textContent"), "1");
    await ui.screenshot(path.join(scratch, "event-graph-create-failure.png"));
    checks.push(
      "New event queues a scaffold; localization write failure reports failure and retains pending create"
    );
    await fs.unlink(path.join(blockedLocalization, "english"));
    await fs.rename(savedLocalization, path.join(blockedLocalization, "english"));
    await ui.eval("document.getElementById('save').click()");
    await waitFor(
      "document.getElementById('save').disabled && document.querySelector('#changes .count').textContent==='0'"
    );
    assert.equal(
      await fs.readFile(retryFile, "utf8"),
      partialScript,
      "retry does not append a duplicate event"
    );
    const locFiles = await fs.readdir(blockedLocalization, { recursive: true });
    const locTexts = await Promise.all(
      locFiles
        .filter((name) => name.endsWith(".yml"))
        .map((name) => fs.readFile(path.join(blockedLocalization, name), "utf8"))
    );
    assert.ok(
      locTexts.some(
        (text) =>
          /^\uFEFFl_english:\r?\n/.test(text) &&
          text.includes('graph_retry.1.t: "Retry heading"') &&
          text.includes('graph_retry.1.desc: "Retry body"')
      )
    );
    assert.equal(await fs.readFile(file, "utf8"), saved, "event creation preserves the original source file");
    await ui.screenshot(path.join(scratch, "event-graph-create-retry.png"));
    checks.push(
      "Save retry finishes localization without duplicate script and preserves unrelated event source"
    );
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify({ passed: true, vscode: vscode.version, checks }, null, 2)
    );
    console.log(
      "Packaged Event Graph checks passed: rendered field editing, repeated values, Ctrl+S with active field, connected filter state, exact file preservation, stale dirty-source rejection and pending retention."
    );
  } catch (error) {
    const evidence = await Promise.allSettled([ui.screenshot(path.join(scratch, "failure.png"))]);
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        {
          checks,
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
          visibleEditors: vscode.window.visibleTextEditors.map((editor) => ({
            file: editor.document.uri.fsPath,
            line: editor.selection.active.line,
          })),
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
