import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { connect } from "./webview-cdp";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run() {
  const scratch = process.env.PX_WORKSHOP_TEST_SCRATCH!;
  assert.ok(scratch);
  const mod = path.join(scratch, "Mod");
  const listing = path.join(mod, ".px-toolkit/workshop");
  const descriptor = await fs.readFile(path.join(mod, "descriptor.mod"));
  const description = await fs.readFile(path.join(listing, "description.bbcode"));
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await vscode.commands.executeCommand("px.openWorkshopManager", vscode.Uri.file(mod));
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  const ui = await connect(
    "Boolean(document.getElementById('createLegacy') && document.getElementById('mod'))"
  );
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 100; i++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${expression}. ${await ui.eval("document.body.innerText")}`);
  };
  const click = (id: string) => ui.eval(`document.getElementById(${JSON.stringify(id)}).click()`);
  const pick = (text: string) =>
    ui.eval(
      `[...document.querySelectorAll('[role=option]')].find(el => el.textContent.startsWith(${JSON.stringify(text)})).click()`
    );
  const inputVersion = (version: string) =>
    ui.eval(
      `document.getElementById('legacy-game-version').value=${JSON.stringify(version)}; document.querySelector('.legacy-form').requestSubmit()`
    );
  const checks: string[] = [];
  try {
    await waitFor("document.getElementById('title').value === 'Workshop fixture'");
    assert.equal(await ui.eval("document.getElementById('mod').nextElementSibling.id"), "openPage");
    assert.equal(await ui.eval("document.getElementById('versionControls').nextElementSibling.id"), "upload");
    assert.equal(await ui.eval("document.querySelectorAll('select').length"), 0);
    assert.equal(await ui.eval("document.getElementById('listing').hidden"), true);
    await ui.screenshot(path.join(scratch, "workshop-live-dark.png"));
    await click("createLegacy");
    await waitFor("document.activeElement.id === 'legacy-game-version'");
    await ui.eval(
      "Promise.all(document.querySelector('.legacy-form').getAnimations().map(animation => animation.finished))"
    );
    assert.equal(await ui.eval("Boolean(document.querySelector('#main .legacy-form'))"), true);
    assert.equal(await ui.eval("document.querySelector('[aria-modal=true]') === null"), true);
    assert.equal(await ui.eval("document.getElementById('app').inert"), false);
    await ui.eval("document.getElementById('upload').focus()");
    assert.equal(
      await ui.eval("document.activeElement.id"),
      "upload",
      "toolbar remains reachable while the form is open"
    );
    await ui.eval("document.getElementById('legacy-game-version').focus()");
    await ui.screenshot(path.join(scratch, "workshop-create-dialog.png"));
    await inputVersion("../../invalid");
    assert.match(
      String(await ui.eval("document.getElementById('legacy-version-error').textContent")),
      /Enter a game version/
    );
    await assert.rejects(fs.stat(path.join(listing, "legacy_version")), { code: "ENOENT" });
    await click("legacy-cancel");
    assert.equal(await ui.eval("document.querySelector('.legacy-form') === null"), true);
    await click("createLegacy");
    await inputVersion("1.19");
    await waitFor("document.getElementById('listing').textContent.includes('Legacy 1.19.*')");
    const first = path.join(listing, "legacy_version/1.19/item.json");
    const item = JSON.parse(await fs.readFile(first, "utf8"));
    assert.equal(item.legacy.content, "new");
    assert.equal(item.legacy.supportedVersion, "1.19.*");
    assert.equal(item.publishedfileid, undefined);
    assert.equal(await ui.eval("document.getElementById('createLegacy').hidden"), true);
    assert.equal(await ui.eval("document.getElementById('legacyHelp').hidden"), false);
    checks.push("local creation, invalid input, cancellation, version selection and preserved live files");

    for (let attempt = 0; attempt < 20; attempt++) {
      await ui.eval(
        "(() => { const r = document.getElementById('legacyHelp').getBoundingClientRect(); document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()"
      );
      await pause(500);
      if (await ui.eval("document.querySelector('[role=tooltip]').hidden === false")) break;
    }
    assert.equal(await ui.eval("document.querySelector('[role=tooltip]').hidden"), false);
    assert.match(
      String(await ui.eval("document.querySelector('[role=tooltip]').textContent")),
      /current mod files/
    );
    await click("upload");
    await waitFor("Boolean(document.querySelector('.px-confirmation'))");
    assert.match(
      String(await ui.eval("document.querySelector('.px-dialog-title').textContent")),
      /legacy 1.19/
    );
    assert.match(
      String(await ui.eval("document.querySelector('.px-dialog-actions button:last-child').textContent")),
      /legacy version/
    );
    await ui.screenshot(path.join(scratch, "workshop-legacy-confirm.png"));
    await ui.eval("document.querySelector('.px-dialog-actions button:first-child').click()");
    assert.equal(JSON.parse(await fs.readFile(first, "utf8")).legacy.content, "new");
    checks.push(
      "rendered tooltip, legacy upload labels, first-upload restrictions and cancellation before Steam"
    );

    for (const [name, theme] of [
      ["dark", "Default Dark Modern"],
      ["light", "Default Light Modern"],
      ["contrast", "Default High Contrast"],
      ["solarized", "Solarized Dark"],
    ]) {
      await vscode.workspace
        .getConfiguration("workbench")
        .update("colorTheme", theme, vscode.ConfigurationTarget.Global);
      await pause(500);
      assert.match(
        String(await ui.eval("document.getElementById('uploadLabel').textContent")),
        /legacy 1.19/
      );
      const legacyBackground = await ui.eval(
        "getComputedStyle(document.getElementById('app')).backgroundColor"
      );
      await ui.screenshot(path.join(scratch, `workshop-legacy-${name}.png`));
      await click("listing");
      await ui.screenshot(path.join(scratch, `workshop-menu-${name}.png`));
      await pick("Live version");
      await waitFor("!document.getElementById('app').hasAttribute('data-legacy')");
      assert.notEqual(
        await ui.eval("getComputedStyle(document.getElementById('app')).backgroundColor"),
        legacyBackground
      );
      assert.equal(await ui.eval("document.getElementById('uploadLabel').textContent"), "Upload");
      await click("listing");
      await pick("Legacy 1.19.*");
      await waitFor("document.getElementById('app').hasAttribute('data-legacy')");
    }
    checks.push(
      "visible live/legacy distinction and shared menus in dark, light, high contrast and Solarized themes"
    );

    await click("listing");
    await pick("Create new legacy version");
    await inputVersion("1.19");
    assert.match(
      String(await ui.eval("document.getElementById('legacy-version-error').textContent")),
      /already exists/
    );
    await inputVersion("1.18.2");
    await waitFor("document.getElementById('listing').textContent.includes('Legacy 1.18.2')");
    assert.equal(
      JSON.parse(await fs.readFile(path.join(listing, "legacy_version/1.18.2/item.json"), "utf8")).legacy
        .supportedVersion,
      "1.18.2"
    );
    assert.deepEqual(await fs.readFile(path.join(mod, "descriptor.mod")), descriptor);
    assert.deepEqual(await fs.readFile(path.join(listing, "description.bbcode")), description);
    checks.push(
      "multiple local versions and duplicate rejection without changing the live descriptor or description"
    );

    const waitWorkbench = async (expression: string) => {
      for (let i = 0; i < 100; i++) {
        if (await ui.evalWorkbench(expression)) return;
        await pause(100);
      }
      throw new Error(
        `Workbench timed out: ${expression}. ${await ui.evalWorkbench("document.body.innerText")}`
      );
    };
    const pickZip = async (filename: string | null) => {
      const pickerInput = '.quick-input-widget:not([style*="display: none"]) .quick-input-box input';
      await click("legacy-choose-zip");
      await waitWorkbench(`Boolean(document.querySelector(${JSON.stringify(pickerInput)}))`);
      await waitWorkbench(
        `document.querySelector(${JSON.stringify(pickerInput)}).value.includes(${JSON.stringify(scratch)}) && document.querySelector('.quick-input-widget').innerText.includes('.px-toolkit')`
      );
      if (filename) {
        await ui.sendWorkbench("Page.bringToFront", {});
        await ui.evalWorkbench(
          `(() => { const input=document.querySelector(${JSON.stringify(pickerInput)}); input.focus(); input.select(); })()`
        );
        await ui.sendWorkbench("Input.insertText", { text: path.join(scratch, filename) });
        await waitWorkbench(
          `document.querySelector(${JSON.stringify(pickerInput)}).value.endsWith(${JSON.stringify(filename)})`
        );
        await waitWorkbench(
          `document.querySelector('.quick-input-widget').innerText.includes(${JSON.stringify(filename)})`
        );
        await ui.screenshot(path.join(scratch, `picker-${filename}.png`));
      }
      const key = filename ? "Enter" : "Escape";
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: key,
        windowsVirtualKeyCode: filename ? 13 : 27,
      });
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: key,
        windowsVirtualKeyCode: filename ? 13 : 27,
      });
      try {
        await waitFor("!document.getElementById('legacy-choose-zip').disabled");
      } catch (error) {
        console.log("ZIP picker after key", await ui.evalWorkbench("document.body.innerText"));
        throw error;
      }
    };
    await click("listing");
    await pick("Create new legacy version");
    await click("legacy-source-zip");
    assert.equal(await ui.eval("document.querySelector('.legacy-form button[type=submit]').disabled"), true);
    await pickZip(null);
    assert.equal(await ui.eval("document.getElementById('legacy-zip-name').textContent"), "No ZIP selected");
    await pickZip("invalid-release.zip");
    await inputVersion("1.17");
    await waitWorkbench("document.body.innerText.includes('exactly one descriptor.mod')");
    await assert.rejects(fs.stat(path.join(listing, "legacy_version/1.17")), { code: "ENOENT" });
    await vscode.commands.executeCommand("notifications.clearAll");
    await waitFor("!document.getElementById('listing').disabled");
    await click("listing");
    await pick("Create new legacy version");
    await click("legacy-source-zip");
    await pickZip("old-release.zip");
    assert.equal(await ui.eval("document.getElementById('legacy-zip-name').textContent"), "old-release.zip");
    await ui.screenshot(path.join(scratch, "workshop-zip-dialog.png"));
    await inputVersion("1.17");
    await waitFor("document.getElementById('listing').textContent.includes('Legacy 1.17.*')");
    const archived = path.join(listing, "legacy_version/1.17");
    const archivedItem = JSON.parse(await fs.readFile(path.join(archived, "item.json"), "utf8"));
    assert.equal(archivedItem.legacy.archive, "old-release.zip");
    assert.equal(archivedItem.legacy.version, "1.0");
    assert.equal(archivedItem.publishedfileid, undefined);
    assert.equal(
      await fs.readFile(path.join(archived, "content/events/archived.txt"), "utf8"),
      "\uFEFFArchived files"
    );
    assert.match(
      String(await ui.eval("document.getElementById('contentHint').textContent")),
      /saved files from old-release.zip/
    );
    assert.match(String(await ui.eval("document.getElementById('modRoot').textContent")), /1.17.*content/);
    await click("upload");
    await waitFor("Boolean(document.querySelector('.px-confirmation'))");
    assert.match(
      String(await ui.eval("document.querySelector('.px-confirmation').textContent")),
      /saved files from old-release.zip/
    );
    await ui.screenshot(path.join(scratch, "workshop-zip-confirm.png"));
    await ui.eval("document.querySelector('.px-dialog-actions button:first-child').click()");
    assert.deepEqual(await fs.readFile(path.join(mod, "descriptor.mod")), descriptor);
    assert.deepEqual(await fs.readFile(path.join(listing, "description.bbcode")), description);
    checks.push(
      "ZIP file picker cancellation, invalid archive rejection, wrapped mod import, saved source labels and confirmation without submitting to Steam"
    );

    await vscode.commands.executeCommand("px.openSettings", "experimentalFeatures");
    const settings = await connect();
    try {
      assert.equal(vscode.workspace.getConfiguration("px").get("experimentalFeatures"), false);
      await settings.eval("document.getElementById('setting-experimentalFeatures').click()");
      for (let i = 0; i < 100 && !vscode.workspace.getConfiguration("px").get("experimentalFeatures"); i++)
        await pause(100);
      assert.equal(vscode.workspace.getConfiguration("px").get("experimentalFeatures"), true);
      await settings.screenshot(path.join(scratch, "experimental-features-enabled.png"));
      await vscode.commands.executeCommand("px.openCompatch");
      await vscode.commands.executeCommand("px.openSettings", "experimentalFeatures");
      await settings.eval("document.getElementById('setting-experimentalFeatures').click()");
      for (let i = 0; i < 100 && vscode.workspace.getConfiguration("px").get("experimentalFeatures"); i++)
        await pause(100);
      assert.equal(vscode.workspace.getConfiguration("px").get("experimentalFeatures"), false);
      await vscode.commands.executeCommand("px.openCompatch");
      await pause(300);
      assert.match(
        String(await settings.evalWorkbench("document.body.innerText")),
        /Enable Experimental features/
      );
      checks.push(
        "Experimental features toggled from Settings, Compatch opened when enabled and rejected when disabled"
      );
    } finally {
      settings.close();
    }
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify({ passed: true, vscode: vscode.version, steamSubmission: false, checks }, null, 2)
    );
  } finally {
    ui.close();
  }
}
