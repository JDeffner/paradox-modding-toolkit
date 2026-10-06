import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function checks() {
  const scratch = process.env.PX_MIGRATION_TEST_SCRATCH!;
  assert.ok(scratch);
  const modFile = path.join(scratch, "Mod/migration-demo.txt");
  const original = await fs.readFile(path.join(scratch, "original.txt"));
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await vscode.commands.executeCommand("px.openMigrations");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  const marker =
    "Boolean(document.getElementById('versions') && document.querySelector('h1')?.textContent === 'Mod Compatibility')";
  let ui = await connect(marker);
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. Page: ${await ui.eval("document.body.innerText")}`);
  };
  const idle = () => waitFor("document.getElementById('app').getAttribute('aria-busy') === 'false'", "idle");
  const act = async (selector: string, trigger: string, label: string) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `${label} available`);
    return ui.eval(`new Promise((resolve, reject) => {
      const app=document.getElementById('app');let busy=false;
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error(${JSON.stringify(`Action did not finish: ${label}`)}));},15000);
      const observer=new MutationObserver(()=>{
        if(app.getAttribute('aria-busy')==='true')busy=true;
        else if(busy){clearTimeout(timer);observer.disconnect();resolve(true);}
      });
      observer.observe(app,{attributes:true,attributeFilter:['aria-busy']});
      ${trigger};
    })`);
  };
  const click = (action: string) =>
    act(
      `[data-action="${action}"]:not(:disabled)`,
      `document.querySelector('[data-action="${action}"]').click()`,
      action
    );
  const select = (id: string) =>
    act(`[data-entry="${id}"]:not(:disabled)`, `document.querySelector('[data-entry="${id}"]').click()`, id);
  const versions = (from: string, to: string) =>
    act(
      "#versions button[type=submit]:not(:disabled)",
      `document.getElementById('from-version').value=${JSON.stringify(from)};document.getElementById('to-version').value=${JSON.stringify(to)};document.getElementById('versions').requestSubmit()`,
      `${from} to ${to}`
    );
  const trustCode = async (filenames: string | string[]) => {
    const files = (Array.isArray(filenames) ? filenames : [filenames]).map((filename) =>
      vscode.Uri.file(path.join(scratch, filename))
    );
    const loading = vscode.commands.executeCommand(
      "px.loadMigrationRecipe",
      Array.isArray(filenames) ? vscode.Uri.file(path.join(scratch, "batch-invalid.json")) : files[0],
      Array.isArray(filenames) ? files : undefined
    );
    let trusted = false;
    for (let i = 0; i < 100; i++) {
      trusted = Boolean(
        await ui.evalWorkbench(
          `(() => {const button=[...document.querySelectorAll('.notification-toast button, .notification-toast .monaco-button')].find(b=>b.textContent==='Trust and load');if(!button)return false;button.click();return true;})()`
        )
      );
      if (trusted) break;
      await pause(100);
    }
    assert.ok(trusted, "local code requires explicit trust through the real command");
    await loading;
    await idle();
    assert.equal(
      await ui.evalWorkbench(
        "[...document.querySelectorAll('.notification-toast button, .notification-toast .monaco-button')].some(b=>b.textContent==='Trust and load')"
      ),
      false,
      "one trust approval completes the entire executable batch"
    );
  };
  const waitForWorkbench = async (expression: string, label: string) => {
    for (let i = 0; i < 100; i++) {
      if (await ui.evalWorkbench(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const waitForPicker = () =>
    waitForWorkbench(
      "(() => {const picker=document.querySelector('.quick-input-widget');return Boolean(picker?.checkVisibility() && picker.innerText.includes('Choose contribution files') && picker.querySelectorAll('.quick-input-list .monaco-list-row').length);})()",
      "native contribution file picker"
    );
  const waitForPickerClosed = () =>
    waitForWorkbench(
      "!document.querySelector('.quick-input-widget')?.checkVisibility()",
      "native contribution file picker closed"
    );
  const clickWorkbench = async (expression: string, label: string) => {
    await waitForWorkbench(`Boolean(${expression})`, `${label} available`);
    await ui.evalWorkbench(`(${expression}).scrollIntoView({block:'nearest'})`);
    await ui.evalWorkbench(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    );
    const position = (await ui.evalWorkbench(`(() => {
      const element=${expression};const rect=element.getBoundingClientRect();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height};
    })()`)) as { x: number; y: number; width: number; height: number };
    assert.ok(position.width > 0 && position.height > 0, `${label} is rendered`);
    assert.equal(
      await ui.evalWorkbench(`(() => {
        const element=${expression};const hit=document.elementFromPoint(${position.x},${position.y});
        return element===hit || element.contains(hit);
      })()`),
      true,
      `${label} receives the mouse click`
    );
    await ui.sendWorkbench("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: position.x,
      y: position.y,
      button: "none",
      buttons: 0,
    });
    for (const type of ["mousePressed", "mouseReleased"])
      await ui.sendWorkbench("Input.dispatchMouseEvent", {
        type,
        x: position.x,
        y: position.y,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
      });
  };
  const noHelperExecution = async () => {
    await assert.rejects(fs.access(path.join(scratch, "unexpected-helper-execution")), { code: "ENOENT" });
  };
  const restore = async () => {
    await click("restore");
    assert.equal(
      await ui.eval("Boolean(document.querySelector('.error'))"),
      false,
      "recovery has no conflicts"
    );
  };
  const prepare = async () => {
    await click("prepare");
    await waitFor(
      "Boolean(document.querySelector('[data-action=apply]:not(:disabled)'))",
      "prepared preview"
    );
  };
  try {
    await idle();
    assert.match(String(await ui.eval("document.querySelector('.route-nav').textContent")), /faith/i);
    assert.equal(await ui.eval("document.querySelector('[data-action=load]').textContent"), "Load files…");
    assert.equal(
      await ui.eval("document.querySelector('[data-action=load-folder]').textContent"),
      "Load folder…"
    );
    await trustCode("recipe.cjs");
    await versions("1.0", "2.0");
    await select("author.example");
    await waitFor(
      "document.body.innerText.includes('Trusted local code') && document.getElementById('app').getAttribute('aria-busy') === 'false'",
      "loaded local recipe"
    );
    await click("scan");
    await waitFor(
      "Boolean(document.getElementById('q-example_value')) && document.getElementById('app').getAttribute('aria-busy') === 'false'",
      "required choice"
    );
    assert.equal(await ui.eval("document.querySelector('[data-action=prepare]').disabled"), true);
    await ui.eval(
      "(()=>{const field=document.getElementById('q-example_value');field.value='new_value';field.dispatchEvent(new Event('change',{bubbles:true}));})()"
    );
    await waitFor(
      "Boolean(document.querySelector('[data-action=prepare]:not(:disabled)'))",
      "answer accepted"
    );
    await prepare();
    const routeBeforeFailedBatch = await ui.eval("document.querySelector('.route-nav').textContent");
    for (const invalid of ["batch-invalid.json", "batch-duplicate.json"]) {
      await vscode.commands.executeCommand("px.loadMigrationRecipe", undefined, [
        vscode.Uri.file(path.join(scratch, "batch-valid.json")),
        vscode.Uri.file(path.join(scratch, invalid)),
      ]);
      await idle();
      assert.match(
        String(await ui.eval("document.querySelector('.error')?.textContent")),
        /Nothing was added/
      );
      assert.equal(
        await ui.eval("document.querySelector('.route-nav').textContent"),
        routeBeforeFailedBatch,
        "failed batch preserves the prior route"
      );
      assert.equal(
        await ui.eval("Boolean(document.querySelector('[data-action=apply]:not(:disabled)'))"),
        true,
        "failed batch preserves the exact prepared preview"
      );
      assert.equal(
        await ui.eval("Boolean(document.querySelector('[data-entry=\"author.failed-batch\"]'))"),
        false
      );
    }
    await ui.screenshot(path.join(scratch, "migration-failed-batch-preview.png"));
    await ui.screenshot(path.join(scratch, "migration-preview.png"));
    await ui.eval("document.querySelector('[data-action=apply]').scrollIntoView({block:'center'})");
    await ui.screenshot(path.join(scratch, "migration-preview-changes.png"));
    assert.equal(await ui.eval("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await ui.eval("document.querySelector('[data-diff]').click()");
    for (
      let i = 0;
      i < 50 && !(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff);
      i++
    )
      await pause(100);
    const diff = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(diff instanceof vscode.TabInputTextDiff, "Review diff opens native diff editor");
    assert.match(
      (await vscode.workspace.openTextDocument(diff.original)).getText(),
      /demo_old = previous_value/
    );
    assert.match((await vscode.workspace.openTextDocument(diff.modified)).getText(), /demo_new = new_value/);
    await vscode.commands.executeCommand("px.openMigrations");
    await idle();
    await ui.eval(`(() => {
      window.migrationWriteCancelStates = [];
      window.migrationWriteObserver = new MutationObserver(() => {
        if (document.querySelector('.status')?.textContent.includes('Applying the reviewed changes'))
          window.migrationWriteCancelStates.push(Boolean(document.querySelector('[data-action=cancel]')));
      });
      window.migrationWriteObserver.observe(document.getElementById('app'), {childList:true, subtree:true});
    })()`);
    await click("apply");
    await waitFor(
      "document.querySelector('.status').textContent.includes('Applied.') && document.getElementById('app').getAttribute('aria-busy') === 'false'",
      "apply exact preview"
    );
    const writeCancelStates = (await ui.eval(`(() => {
      window.migrationWriteObserver.disconnect();
      return window.migrationWriteCancelStates;
    })()`)) as boolean[];
    assert.ok(writeCancelStates.length > 0, "packaged UI rendered the write phase");
    assert.ok(
      writeCancelStates.every((visible) => !visible),
      "Cancel is hidden while writing"
    );
    const migrated = original.toString("utf8").replace("demo_old = previous_value", "demo_new = new_value");
    assert.deepEqual(await fs.readFile(modFile), Buffer.from(migrated));
    await restore();
    assert.deepEqual(await fs.readFile(modFile), original);
    assert.equal(
      await ui.eval("Boolean(document.querySelector('[data-action=restore]'))"),
      false,
      "consumed recovery is removed"
    );
    assert.match(
      (await vscode.workspace.openTextDocument(diff.modified)).getText(),
      /demo_new = new_value/,
      "native diff retains the exact immutable preview after restore"
    );

    // A target outside the workspace is still checked at Apply. Failed preflight must not fabricate recovery.
    await click("scan");
    await idle();
    await prepare();
    await fs.writeFile(path.join(scratch, "Vanilla/reference.txt"), "revision = changed\n");
    await click("apply");
    await waitFor(
      "Boolean(document.querySelector('.error')) && document.getElementById('app').getAttribute('aria-busy') === 'false'",
      "stale target rejected"
    );
    assert.deepEqual(await fs.readFile(modFile), original);
    assert.equal(await ui.eval("Boolean(document.querySelector('[data-action=restore]'))"), false);

    await click("scan");
    await prepare();
    const recipeFile = path.join(scratch, "recipe.cjs");
    const recipeCode = await fs.readFile(recipeFile);
    await fs.appendFile(recipeFile, "\n// changed after preview\n");
    await click("apply");
    await waitFor(
      "document.querySelector('.error')?.textContent.includes('Recipe code changed')",
      "changed code rejected"
    );
    assert.deepEqual(await fs.readFile(modFile), original);
    await fs.writeFile(recipeFile, recipeCode);

    // A connected route retains all entries, gates later work, and consumes actual earlier output.
    await trustCode(["route-recipes.cjs", "route-note.json"]);
    assert.match(
      String(await ui.eval("document.querySelector('.status').textContent")),
      /Loaded 2 entries from 2 files/
    );
    await ui.screenshot(path.join(scratch, "migration-bulk-load.png"));
    await select("author.route-note");
    assert.equal(
      await ui.evalWorkbench(
        "[...document.querySelectorAll('.notification-toast button, .notification-toast .monaco-button')].some(b=>b.textContent==='Trust and load')"
      ),
      false,
      "JSON notes never request code trust"
    );
    assert.match(
      String(await ui.eval("document.querySelector('.detail').textContent")),
      /Local note.*Data only/
    );
    assert.equal(
      await ui.eval("Boolean(document.querySelector('[data-action=scan]'))"),
      false,
      "data-only note has no executable inspection"
    );
    await versions("1.0", "99.0");
    assert.match(
      String(await ui.eval("document.querySelector('.feedback').textContent")),
      /version gap/i,
      "uncovered build reports a route gap"
    );
    assert.equal(
      await ui.eval("Boolean(document.querySelector('[data-action=prepare]:not(:disabled)'))"),
      false
    );
    await versions("1.0", "3.0");
    assert.deepEqual(
      await ui.eval(
        "[...document.querySelectorAll('.route-group')].map(g=>[...g.querySelectorAll('[data-entry]')].map(b=>b.dataset.entry))"
      ),
      [["author.example", "author.route-note"], ["author.route-second"]],
      "both entries in the first transition remain in the route"
    );
    await select("author.route-second");
    assert.equal(
      await ui.eval("document.querySelector('[data-action=scan]').disabled"),
      true,
      "later recipe waits for earlier required work"
    );
    await select("author.route-note");
    assert.equal(
      await ui.eval("document.getElementById('manual-note').disabled"),
      true,
      "required note waits for first recipe"
    );
    const recordManual = async () => {
      await select("author.route-note");
      await ui.eval(
        "(()=>{const field=document.getElementById('manual-note');field.value='Reviewed preserved synthetic comment. No game validation was run.';field.dispatchEvent(new Event('input',{bubbles:true}));})()"
      );
      await click("manual");
      assert.match(
        String(
          await ui.eval("document.querySelector('.completion')?.textContent ?? document.body.innerText")
        ),
        /toolkit has not verified this manual work/
      );
    };
    const firstHop = async () => {
      await select("author.example");
      await click("scan");
      await prepare();
      await click("apply");
      assert.deepEqual(await fs.readFile(modFile), Buffer.from(migrated));
    };
    await firstHop();
    await select("author.route-second");
    assert.equal(
      await ui.eval("document.querySelector('[data-action=scan]').disabled"),
      true,
      "manual resolution is required after the first apply"
    );
    await recordManual();
    await click("next");
    assert.equal(
      await ui.eval(
        "document.querySelector('[data-entry=\"author.route-second\"]').getAttribute('aria-current')"
      ),
      "true",
      "Continue reaches the eligible second hop"
    );
    await click("scan");
    assert.match(
      String(await ui.eval("document.querySelector('.detail').textContent")),
      /First recipe output found: demo_new = new_value/
    );
    await prepare();
    await fs.writeFile(path.join(scratch, "Vanilla/reference.txt"), "revision = changed after first hop\n");
    await click("apply");
    assert.ok(
      await ui.eval("Boolean(document.querySelector('.error'))"),
      "stale reference blocks the second hop"
    );
    assert.deepEqual(await fs.readFile(modFile), Buffer.from(migrated));
    assert.ok(
      await ui.eval("Boolean(document.querySelector('[data-action=restore]'))"),
      "failed second hop retains first-hop recovery"
    );
    await restore();
    assert.deepEqual(await fs.readFile(modFile), original);
    assert.equal(await ui.eval("Boolean(document.querySelector('[data-action=restore]'))"), false);
    await firstHop();
    await recordManual();
    await click("next");
    await click("scan");
    await prepare();
    await click("apply");
    const finalOutput = migrated.replace("demo_new = new_value", "demo_final = route_value");
    assert.deepEqual(await fs.readFile(modFile), Buffer.from(finalOutput));
    assert.match(String(await ui.eval("document.querySelector('.route-nav').textContent")), /3 of 3 handled/);
    assert.match(
      String(await ui.eval("document.querySelector('.footer').textContent")),
      /do not establish full compatibility/
    );
    await ui.screenshot(path.join(scratch, "migration-route-complete.png"));
    await restore();
    assert.deepEqual(
      await fs.readFile(modFile),
      Buffer.from(migrated),
      "latest recovery restores first-hop output"
    );
    assert.ok(
      await ui.eval("Boolean(document.querySelector('[data-action=restore]'))"),
      "earlier recovery remains on stack"
    );
    await restore();
    assert.deepEqual(await fs.readFile(modFile), original, "earlier recovery restores original bytes");
    assert.equal(
      await ui.eval("Boolean(document.querySelector('[data-action=restore]'))"),
      false,
      "fully restored stack has no recovery action"
    );
    await versions("1.0", "2.0");
    await select("author.example");

    // Unsaved content is part of the reviewed input and is restored as an unsaved buffer.
    const document = await vscode.workspace.openTextDocument(modFile);
    assert.equal(document.encoding, "utf8bom");
    await vscode.window.showTextDocument(document);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(0, 0), "# unsaved author note\r\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    const dirtyBefore = document.getText();
    assert.ok(document.isDirty);
    await vscode.commands.executeCommand("px.openMigrations");
    await click("scan");
    await idle();
    await prepare();
    await click("apply");
    await waitFor(
      "document.querySelector('.status').textContent.includes('Applied.') && document.getElementById('app').getAttribute('aria-busy') === 'false'",
      "dirty-buffer apply"
    );
    assert.match(document.getText(), /# unsaved author note/);
    assert.match(document.getText(), /demo_new = new_value/);
    assert.equal(document.isDirty, false);
    await restore();
    assert.deepEqual(await fs.readFile(modFile), original);
    assert.equal(document.getText(), dirtyBefore);
    assert.equal(document.isDirty, true);

    await click("scan");
    await idle();
    await prepare();
    const newer = new vscode.WorkspaceEdit();
    newer.insert(document.uri, new vscode.Position(0, 0), "# newer edit\r\n");
    assert.ok(await vscode.workspace.applyEdit(newer));
    await waitFor("!document.querySelector('[data-action=apply]')", "new editor changes invalidate preview");
    assert.match(document.getText(), /# newer edit/);
    await ui.screenshot(path.join(scratch, "migration-stale.png"));

    // Closing/reopening as UTF-8 without BOM must block before editing an open document.
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await fs.writeFile(modFile, original.subarray(3));
    const noBom = await vscode.workspace.openTextDocument(vscode.Uri.file(modFile), { encoding: "utf8" });
    await vscode.window.showTextDocument(noBom);
    assert.equal(noBom.encoding, "utf8");
    await vscode.commands.executeCommand("px.openMigrations");
    await click("scan");
    await idle();
    await prepare();
    const textBefore = noBom.getText();
    await click("apply");
    await waitFor(
      "document.querySelector('.error')?.textContent.includes('UTF-8 with BOM')",
      "encoding preflight"
    );
    assert.equal(
      await ui.eval("document.body.innerText.includes('Checking files before applying changes')"),
      false,
      "failed actions clear the unfinished progress message"
    );
    assert.equal(noBom.getText(), textBefore);
    assert.equal(noBom.isDirty, false);
    assert.deepEqual(await fs.readFile(modFile), original.subarray(3));
    await ui.sendWorkbench("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(250);
    assert.equal(await ui.eval("document.documentElement.scrollWidth <= window.innerWidth"), true);
    await ui.screenshot(path.join(scratch, "migration-encoding-narrow.png"));
    await ui.sendWorkbench("Emulation.clearDeviceMetricsOverride", {});
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    ui.close();
    await vscode.commands.executeCommand("px.openMigrations");
    ui = await connect(marker);
    await idle();
    assert.equal(
      await ui.eval("document.body.innerText.includes('Trusted local code')"),
      false,
      "reopening does not execute saved local code"
    );
    await trustCode("recipe.cjs");
    await waitFor(
      "document.body.innerText.includes('Trusted local code') && document.getElementById('app').getAttribute('aria-busy') === 'false'",
      "reloaded local recipe"
    );
    await click("scan");
    assert.equal(
      await ui.eval("document.getElementById('q-example_value').value"),
      "new_value",
      "saved answer survives panel reopening"
    );

    // Discovery shows real native candidate controls before evaluating any selected file.
    const folderUri = vscode.Uri.file(path.join(scratch, "contributions"));
    const openFolder = () => vscode.commands.executeCommand("px.loadMigrationFolder", folderUri);
    const beforeFolderRoute = await ui.eval("document.querySelector('.route-nav').textContent");
    const beforeFolderStatus = await ui.eval("document.querySelector('.status').textContent");
    const cancelledFolder = openFolder();
    await waitForPicker();
    const pickerCandidates = (await ui.evalWorkbench(
      "[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(row=>({label:row.querySelector('.label-name')?.textContent,description:row.querySelector('.label-description')?.textContent,checked:row.querySelector('[role=checkbox]')?.getAttribute('aria-checked')}))"
    )) as { label: string; description: string; checked: string }[];
    assert.deepEqual(pickerCandidates.map((item) => item.label).sort(), [
      "config.json",
      "first.json",
      "helper.js",
      "nested/second.json",
    ]);
    for (const item of pickerCandidates) {
      assert.equal(item.checked, "true", "all discovered candidates start selected");
      assert.equal(item.description, item.label.endsWith(".json") ? "JSON note" : "Executable JavaScript");
    }
    await ui.screenshot(path.join(scratch, "migration-folder-candidates.png"));
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await cancelledFolder;
    await idle();
    await waitForPickerClosed();
    assert.equal(await ui.eval("document.querySelector('.route-nav').textContent"), beforeFolderRoute);
    assert.equal(await ui.eval("document.querySelector('.status').textContent"), beforeFolderStatus);
    await noHelperExecution();

    const emptyFolder = openFolder();
    await waitForPicker();
    await clickWorkbench(
      "document.querySelector('.quick-input-widget .quick-input-header [role=checkbox]')",
      "native select-all checkbox"
    );
    await waitForWorkbench(
      "[...document.querySelectorAll('.quick-input-list .monaco-list-row [role=checkbox]')].every(checkbox=>checkbox.getAttribute('aria-checked')==='false')",
      "all candidate checkboxes cleared"
    );
    assert.equal(
      await ui.evalWorkbench(
        "[...document.querySelectorAll('.quick-input-list .monaco-list-row [role=checkbox]')].every(checkbox=>checkbox.getAttribute('aria-checked')==='false')"
      ),
      true,
      "native select-all checkbox clears the candidate selection"
    );
    await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
    await emptyFolder;
    await idle();
    await waitForPickerClosed();
    assert.equal(await ui.eval("document.querySelector('.route-nav').textContent"), beforeFolderRoute);
    assert.equal(await ui.eval("document.querySelector('.status').textContent"), beforeFolderStatus);
    await noHelperExecution();

    const loadingFolder = vscode.commands.executeCommand(
      "px.loadMigrationFolder",
      vscode.Uri.file(path.join(scratch, "batch-invalid.json")),
      [folderUri]
    );
    await waitForPicker();
    for (const filename of ["config.json", "helper.js"]) {
      const checkbox = `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].find(row=>row.querySelector('.label-name')?.textContent===${JSON.stringify(filename)})?.querySelector('[role=checkbox]')`;
      await clickWorkbench(checkbox, `${filename} candidate checkbox`);
      await waitForWorkbench(
        `(${checkbox})?.getAttribute('aria-checked')==='false'`,
        `${filename} deselected`
      );
      assert.equal(
        await ui.evalWorkbench(`(${checkbox}).getAttribute('aria-checked')`),
        "false",
        `deselect ${filename} through its native picker checkbox`
      );
    }
    await ui.screenshot(path.join(scratch, "migration-folder-selected.png"));
    await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
    await loadingFolder;
    await idle();
    await noHelperExecution();
    assert.match(
      String(await ui.eval("document.querySelector('.status').textContent")),
      /Loaded 2 entries from 2 files/
    );
    assert.equal(
      await ui.evalWorkbench(
        "[...document.querySelectorAll('.notification-toast button, .notification-toast .monaco-button')].some(b=>b.textContent==='Trust and load')"
      ),
      false,
      "JSON-only folder selection has no executable trust prompt"
    );
    await versions("4.0", "5.0");
    assert.deepEqual(
      await ui.eval(
        "[...document.querySelectorAll('.route-group [data-entry]')].map(button=>button.dataset.entry)"
      ),
      ["author.folder-first", "author.folder-second"],
      "nested cross-file dependencies load together and failed batches add no entries"
    );
    await ui.screenshot(path.join(scratch, "migration-folder-loaded.png"));

    // The default author template previews and edits every marked file under its declared prefix.
    const folderFiles = ["migration-demo/first.txt", "migration-demo/nested/second.txt"];
    const unrelated = path.join(scratch, "Mod/migration-demo/unrelated.txt");
    const unrelatedBefore = await fs.readFile(unrelated);
    const rootFileBefore = await fs.readFile(modFile);
    await trustCode("folder-recipe.cjs");
    await versions("1.0", "2.0");
    await select("author.folder-example");
    await click("scan");
    await ui.eval(
      "(()=>{const field=document.getElementById('q-example_value');field.value='folder_value';field.dispatchEvent(new Event('change',{bubbles:true}));})()"
    );
    await waitFor(
      "Boolean(document.querySelector('[data-action=prepare]:not(:disabled)'))",
      "folder answer accepted"
    );
    await prepare();
    const folderPreview = String(await ui.eval("document.querySelector('.detail').textContent"));
    for (const filename of folderFiles)
      assert.ok(folderPreview.includes(filename), `preview lists ${filename}`);
    await ui.screenshot(path.join(scratch, "migration-folder-preview.png"));
    await click("apply");
    const folderOutput = Buffer.from(
      original.toString("utf8").replace("demo_old = previous_value", "demo_new = folder_value")
    );
    for (const filename of folderFiles)
      assert.deepEqual(await fs.readFile(path.join(scratch, "Mod", filename)), folderOutput);
    assert.deepEqual(await fs.readFile(unrelated), unrelatedBefore);
    assert.deepEqual(await fs.readFile(modFile), rootFileBefore);
    await restore();
    for (const filename of folderFiles)
      assert.deepEqual(await fs.readFile(path.join(scratch, "Mod", filename)), original);
    assert.deepEqual(await fs.readFile(unrelated), unrelatedBefore);
    assert.deepEqual(await fs.readFile(modFile), rootFileBefore);
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          checks: [
            "packaged command, built-in catalog and local code trust prompt",
            "required answer and saved choice after reopening",
            "native immutable diff",
            "exact apply and byte-for-byte restore",
            "target freshness and retained recovery",
            "data-only JSON note loads without code trust",
            "explicit build selection, complete transition membership and uncovered route gap",
            "required earlier and manual steps block later recipes",
            "two-hop route consumes previous output without claiming game validation",
            "reverse recovery restores each hop and consumes the stack",
            "changed recipe code rejected before apply",
            "unsaved edits included and restored dirty",
            "editor changes invalidate preview",
            "encoding mismatch blocked before editing",
            "wide and narrow rendered layout",
            "multi-file executable batch uses one trust approval and resolves cross-file dependencies",
            "invalid and duplicate batches preserve prior route and exact applicable preview",
            "native folder picker exposes preselected nested candidates and skips excluded folders",
            "cancelled and empty folder selections do not change the route or execute helpers",
            "unselected invalid JSON and helper JavaScript are never loaded or executed",
            "JSON-only folder batch loads nested dependencies without code trust",
            "default folder author template previews two paths, applies, and restores exact bytes",
            "folder recipe preserves unrelated files and the file outside its declared prefix",
          ],
        },
        null,
        2
      )
    );
  } catch (error) {
    await fs.writeFile(path.join(scratch, "failure.json"), JSON.stringify({ error: String(error) }, null, 2));
    const evidence = await Promise.allSettled([
      ui.screenshot(path.join(scratch, "migration-failure.png")),
      ui
        .evalWorkbench("document.body.innerText")
        .then((text) => fs.writeFile(path.join(scratch, "migration-workbench-failure.txt"), String(text))),
      ui
        .eval("document.body.innerText")
        .then((text) => fs.writeFile(path.join(scratch, "migration-failure.txt"), String(text))),
    ]);
    await fs.writeFile(
      path.join(scratch, "failure.json"),
      JSON.stringify(
        {
          error: String(error),
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

export async function run() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      checks(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Migration editor smoke exceeded 240 seconds")), 240_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
