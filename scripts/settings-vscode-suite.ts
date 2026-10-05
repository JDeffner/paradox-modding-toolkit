import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

import { connect } from "./webview-cdp";

async function checks() {
  const scratch = process.env.PX_SETTINGS_TEST_SCRATCH!;
  assert.ok(scratch);
  await vscode.extensions.getExtension("JDeffner.px-toolkit")!.activate();
  await vscode.commands.executeCommand("px.openSettings");
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  const ui = await connect();
  const waitFor = async (expression: string, label: string) => {
    for (let i = 0; i < 80; i++) {
      if (await ui.eval(expression)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${label}. Page: ${await ui.eval("document.body.innerText")}`);
  };
  const query = (key: string) =>
    ui.eval(
      `document.getElementById('query').value=${JSON.stringify(key)};document.getElementById('query').dispatchEvent(new Event('input'))`
    );
  const value = (key: string, text: string) =>
    ui.eval(
      `document.getElementById(${JSON.stringify(`setting-${key}`)}).value=${JSON.stringify(text)};document.getElementById(${JSON.stringify(`setting-${key}`)}).dispatchEvent(new Event('input'))`
    );
  const click = (key: string, text: string) =>
    ui.eval(
      `[...document.querySelectorAll(${JSON.stringify(`[data-key="${key}"] button`)})].find(b=>b.textContent===${JSON.stringify(text)}).click()`
    );
  const choose = async (id: string, option: string, label?: string) => {
    const labels: Record<string, string> = {
      name: "Name",
      default: "Default order",
      drafts: "Unsaved drafts",
      all: "All settings",
      changed: "Customized",
    };
    const face = label ?? labels[option] ?? option;
    if (await ui.eval(`document.getElementById(${JSON.stringify(id)}).getAttribute('role')==='radio'`)) {
      await ui.eval(
        `[...document.getElementById(${JSON.stringify(id)}).closest('[role=radiogroup]').querySelectorAll('[role=radio]')].find(node=>node.querySelector('.choice-label').textContent===${JSON.stringify(face)}).click()`
      );
    } else {
      await ui.eval(`document.getElementById(${JSON.stringify(id)}).click()`);
      const item = `[...document.querySelectorAll('.px-menu [role=option]')].find(node=>node.querySelector('.px-grow')?.textContent===${JSON.stringify(face)})`;
      await waitFor(`Boolean(${item})`, `${face} menu option`);
      await ui.eval(`(${item}).click()`);
    }
    await waitFor(
      `document.getElementById(${JSON.stringify(id)}).value===${JSON.stringify(option)}`,
      `${face} selected`
    );
  };
  const destination = async (key: string, id: string, label: string) => {
    await ui.eval(
      `(() => {const button=document.getElementById(${JSON.stringify(`expand-${key}`)});if(button.getAttribute('aria-expanded')!=='true')button.click()})()`
    );
    await choose(`destination-${key}`, id, label);
  };
  const pressSpace = async () => {
    for (const type of ["keyDown", "keyUp"])
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type,
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
  };
  const layout = () =>
    ui.eval(`(() => {
      const rows = [...document.querySelectorAll('.setting')];
      const cards = rows.map(el => el.getBoundingClientRect());
      const parts = rows.map(row=>({copy:row.querySelector('.setting-copy').getBoundingClientRect(),editor:row.querySelector('.setting-editor').getBoundingClientRect()}));
      const content = document.getElementById('content').getBoundingClientRect();
      const categories = document.getElementById('categories').getBoundingClientRect();
      return {
        columns: new Set(cards.map(r => Math.round(r.left))).size,
        sideBySide: parts.every(({copy,editor})=>editor.left>=copy.right-1),
        stacked: parts.every(({copy,editor})=>editor.top>=copy.bottom-1),
        cardsFit: cards.every(r => r.left >= content.left && r.right <= content.right),
        topFilters: categories.bottom <= content.top + 1,
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        contentHeight: content.height,
        medianRowHeight: cards.map(r => r.height).sort((a,b) => a-b)[Math.floor(cards.length / 2)],
      };
    })()`) as Promise<{
      columns: number;
      sideBySide: boolean;
      stacked: boolean;
      cardsFit: boolean;
      topFilters: boolean;
      noOverflow: boolean;
      contentHeight: number;
      medianRowHeight: number;
    }>;
  try {
    await waitFor("document.querySelectorAll('.setting').length > 0", "settings state");
    const sections = vscode.extensions.getExtension("JDeffner.px-toolkit")!.packageJSON.contributes
      .configuration as { properties: Record<string, unknown> }[];
    // machinePaths is the backing registry, edited through the individual path rows.
    const settingCount = sections.reduce(
      (sum, section) =>
        sum + Object.keys(section.properties).filter((key) => key !== "px.machinePaths").length,
      0
    );
    assert.equal(await ui.eval("document.querySelector('h2').textContent"), "All settings");
    assert.equal(await ui.eval("document.querySelectorAll('.setting').length"), settingCount);
    const wide = await layout();
    assert.equal(wide.columns, 1, "settings stay in one catalogue column");
    assert.ok(wide.sideBySide, "wide setting rows show labels and controls side by side");
    assert.equal(await ui.eval("document.querySelectorAll('.group-heading').length"), 5);
    assert.equal(await ui.eval("document.querySelectorAll('.setting.is-expanded').length"), 0);
    assert.equal(await ui.eval("document.getElementById('show-details').checked"), false);
    assert.ok(wide.cardsFit && wide.topFilters && wide.noOverflow, "rows fit below the top filters");
    await choose("sort", "name");
    const labels = (await ui.eval(
      "[...document.querySelectorAll('.setting-head label')].map(el=>el.textContent)"
    )) as string[];
    assert.deepEqual(
      labels,
      [...labels].sort((a, b) => a.localeCompare(b))
    );
    await choose("sort", "default");
    await value("locLanguage", "german");
    await choose("filter", "drafts");
    assert.equal(await ui.eval("document.querySelectorAll('.setting').length"), 1);
    assert.equal(await ui.eval("document.querySelector('.setting').dataset.key"), "locLanguage");
    await choose("filter", "all");
    assert.equal(await ui.eval("document.getElementById('setting-locLanguage').value"), "german");
    await click("locLanguage", "Discard draft");
    await ui.eval(
      "[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('Editor')).focus()"
    );
    await pressSpace();
    assert.ok(await ui.eval("document.activeElement?.textContent.startsWith('Editor')"));
    assert.ok(Number(await ui.eval("document.querySelectorAll('.setting').length")) < settingCount);
    await ui.eval(
      "[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('All settings')).click()"
    );
    assert.equal(await ui.eval("document.querySelectorAll('.setting').length"), settingCount);
    assert.equal(await ui.eval("document.querySelectorAll('select').length"), 0);
    await ui.eval("document.getElementById('scope').click()");
    assert.equal(await ui.eval("document.querySelectorAll('.px-menu [role=option]').length"), 2);
    assert.deepEqual(
      await ui.eval(
        "[...document.querySelectorAll('.px-menu [role=option] .px-grow')].map(node=>node.textContent)"
      ),
      ["Settings Mod", "Settings Second"]
    );
    assert.equal(
      await ui.eval("Boolean(document.querySelector('#scope svg'))"),
      true,
      "shared dropdown chevron is inline under the CSP"
    );
    await ui.screenshot(path.join(scratch, "settings-dropdown-dark.png"));
    await ui.eval("document.getElementById('scope').click()");
    await ui.screenshot(path.join(scratch, "settings-dark.png"));
    await query("parentMods");
    await ui.eval("document.getElementById('summary-parentMods').click()");
    assert.equal(await ui.eval("document.activeElement.id"), "setting-parentMods");
    assert.equal(await ui.eval("document.getElementById('setting-parentMods').hidden"), false);
    await query("diagnostics.ignorePatterns");
    await ui.eval("document.getElementById('expand-diagnostics.ignorePatterns').focus()");
    await pressSpace();
    assert.equal(
      await ui.eval("document.getElementById('details-diagnostics.ignorePatterns').hidden"),
      false
    );
    // Hover the help affordance using its rendered hit-test position.
    await ui.eval(`(() => {
      const help=document.querySelector('.extra-help summary');
      const r=help.getBoundingClientRect();
      help.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
    })()`);
    await waitFor("!document.querySelector('.px-tip').hidden", "help appears on hover");
    assert.match(
      String(await ui.eval("document.querySelector('.px-tip').textContent")),
      /common\/\*\*\/vendor/
    );
    await ui.screenshot(path.join(scratch, "settings-help.png"));
    await ui.eval("document.querySelector('.extra-help summary').click()");
    assert.equal(await ui.eval("document.querySelector('.extra-help').open"), true);
    await ui.eval("document.getElementById('show-details').click()");
    await query("");
    assert.equal(await ui.eval("document.querySelectorAll('.setting.is-expanded').length"), settingCount);
    await ui.screenshot(path.join(scratch, "settings-expanded.png"));
    await ui.eval("document.getElementById('show-details').click()");
    assert.equal(await ui.eval("document.querySelectorAll('.setting.is-expanded').length"), 0);
    await query("scopeInlayHints");
    await ui.eval("document.getElementById('setting-scopeInlayHints').focus()");
    await pressSpace();
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "toggle save");
    assert.equal(vscode.workspace.getConfiguration("px").inspect("scopeInlayHints")?.workspaceValue, true);
    await choose("filter", "changed");
    assert.equal(await ui.eval("document.querySelectorAll('.setting').length"), 1);
    await choose("filter", "all");
    await click("scopeInlayHints", "Remove workspace override");
    await waitFor(
      "![...document.querySelectorAll('[data-key=scopeInlayHints] .control-line button')].some(button=>button.textContent==='Remove workspace override')",
      "reset override"
    );
    assert.equal(
      vscode.workspace.getConfiguration("px").inspect("scopeInlayHints")?.workspaceValue,
      undefined
    );
    await query("locLanguage");
    await value("locLanguage", "german");
    await vscode.workspace
      .getConfiguration("px")
      .update("locLanguage", "french", vscode.ConfigurationTarget.Workspace);
    await waitFor("document.body.innerText.includes('Changed elsewhere')", "external change retained draft");
    await click("locLanguage", "Save");
    await waitFor(
      "document.querySelector('.field-error')?.textContent.includes('changed elsewhere')",
      "stale write rejected"
    );
    assert.equal(vscode.workspace.getConfiguration("px").get("locLanguage"), "french");
    await click("locLanguage", "Discard draft");
    await destination("locLanguage", "user", "Personal defaults");
    await value("locLanguage", "german");
    await click("locLanguage", "Save");
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "user save");
    assert.equal(vscode.workspace.getConfiguration("px").inspect("locLanguage")?.globalValue, "german");
    assert.equal(vscode.workspace.getConfiguration("px").get("locLanguage"), "french");
    assert.match(String(await ui.eval("document.querySelector('.setting-source').textContent")), /workspace/);
    assert.match(String(await ui.eval("document.querySelector('.active-value').textContent")), /french/);
    const folder = vscode.workspace.workspaceFolders![0];
    const context = `project:${folder.uri.toString()}`;
    await query("quoteNames");
    await destination("characterHistory.quoteNames", context, "This mod · Shared");
    await ui.eval("document.getElementById('setting-characterHistory.quoteNames').click()");
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "folder save");
    const shared = JSON.parse(
      await fs.readFile(path.join(folder.uri.fsPath, ".px-toolkit/project.json"), "utf8")
    );
    assert.equal(shared.authoring.characterHistory.quoteNames, false);
    assert.equal(
      vscode.workspace.getConfiguration("px", folder.uri).inspect("characterHistory.quoteNames")
        ?.workspaceFolderValue,
      undefined
    );
    await query("gamePath");
    assert.equal(await ui.eval("document.getElementById('setting-gamePath').disabled"), false);
    await destination("gamePath", "machine:workspace", "This workspace · Private");
    await query("texturePreview.background");
    await value("texturePreview.background", "invalid-color");
    await click("texturePreview.background", "Save");
    await waitFor(
      "document.querySelector('.field-error')?.textContent.includes('six-digit')",
      "invalid value rejected"
    );
    assert.equal(vscode.workspace.getConfiguration("px").get("texturePreview.background"), "checkerboard");
    await ui.screenshot(path.join(scratch, "settings-error.png"));
    await click("texturePreview.background", "Discard draft");
    // A settings edit must not drop unrelated unsaved text in the workspace file.
    const workspace = await vscode.workspace.openTextDocument(vscode.workspace.workspaceFile!);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(workspace.uri, new vscode.Position(1, 0), "  // keep this unsaved note\n");
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await query("locLanguage");
    await destination("locLanguage", "workspace", "This workspace");
    await value("locLanguage", "spanish");
    await click("locLanguage", "Save");
    await waitFor(
      "document.querySelector('.field-error') || document.getElementById('notice').textContent.includes('saved')",
      "dirty settings handled"
    );
    assert.match(workspace.getText(), /keep this unsaved note/);
    await workspace.save();
    if (vscode.workspace.getConfiguration("px").get("locLanguage") !== "spanish") {
      await click("locLanguage", "Save");
      await waitFor(
        "document.getElementById('notice').textContent.includes('saved')",
        "retry after saving workspace"
      );
    }
    assert.match(await fs.readFile(vscode.workspace.workspaceFile!.fsPath, "utf8"), /keep this unsaved note/);
    for (const gameId of ["vic3", "eu5"]) {
      await query("gameId");
      await destination("gameId", context, "This mod · Shared");
      await choose("setting-gameId", gameId, gameId === "vic3" ? "Vic3" : "Eu5");
      await waitFor(
        "document.getElementById('notice').textContent.includes('saved')",
        `${gameId} game saved`
      );
      await query("quoteNames");
      await waitFor(
        "document.getElementById('setting-characterHistory.quoteNames').disabled",
        `${gameId} profile gating`
      );
    }
    await query("tigerRunOn");
    assert.equal(await ui.eval("document.getElementById('setting-tigerRunOn').disabled"), true);
    await query("gameId");
    await choose("setting-gameId", "ck3", "Ck3");
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "CK3 game saved");
    await query("");
    await ui.eval(
      "[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('Editor')).click()"
    );
    await ui.screenshot(path.join(scratch, "settings-editor.png"));
    await query("completion.mode");
    await ui.eval("document.getElementById('expand-completion.mode').click()");
    await ui.eval("document.getElementById('setting-completion.mode').focus()");
    for (const type of ["keyDown", "keyUp"])
      await ui.sendWorkbench("Input.dispatchKeyEvent", {
        type,
        key: "ArrowRight",
        code: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "choice save");
    assert.equal(vscode.workspace.getConfiguration("px").get("completion.mode"), "examples");
    await ui.screenshot(path.join(scratch, "settings-choices.png"));
    await ui.eval("document.getElementById('expand-completion.mode').click()");
    await query("");

    await vscode.workspace
      .getConfiguration("workbench")
      .update("colorTheme", "Default Light Modern", vscode.ConfigurationTarget.Global);
    await pause(600);
    await ui.screenshot(path.join(scratch, "settings-light.png"));
    await ui.sendWorkbench("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(300);
    await ui.screenshot(path.join(scratch, "settings-narrow.png"));
    const narrow = await layout();
    assert.equal(narrow.columns, 1, "settings use one column in a narrow editor");
    assert.ok(narrow.cardsFit && narrow.noOverflow && narrow.topFilters);
    await ui.sendWorkbench("Emulation.setDeviceMetricsOverride", {
      width: 440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(300);
    const compact = await layout();
    assert.equal(compact.columns, 1);
    assert.ok(compact.stacked, "small setting rows stack labels above controls");
    assert.ok(compact.cardsFit && compact.noOverflow && compact.topFilters);
    assert.ok(compact.contentHeight >= 200, "top controls leave room for settings at small widths");
    await ui.screenshot(path.join(scratch, "settings-compact.png"));
    await ui.eval("document.getElementById('show-details').click()");
    const narrowExpanded = await layout();
    assert.ok(narrowExpanded.cardsFit && narrowExpanded.noOverflow && narrowExpanded.topFilters);
    await ui.screenshot(path.join(scratch, "settings-narrow-expanded.png"));
    await choose("filter", "drafts");
    await ui.eval("document.getElementById('native').click()");
    await pause(500);
    assert.equal(
      vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview,
      false
    );
    await vscode.commands.executeCommand("px.openSettings", "scopeInlayHints");
    await waitFor("document.getElementById('query').value === 'scopeInlayHints'", "settings deep link");
    assert.ok(await ui.eval("document.getElementById('setting-scopeInlayHints') !== null"));
    await fs.writeFile(
      path.join(scratch, "results.json"),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          compactMedianRowHeight: wide.medianRowHeight,
          checks: [
            "packaged command and rendered settings",
            "compact catalogue rows, top filters, sorting and retained drafts",
            "individual expansion, list editor, hover help and show all details",
            "explained choices with keyboard save",
            "keyboard workspace toggle and reset",
            "user override precedence",
            "shared mod character preference and available private paths",
            "stale draft rejected",
            "invalid value rejected",
            "unsaved unrelated settings preserved",
            "all three game profiles",
            "dark, light, narrow and compact layouts",
          ],
        },
        null,
        2
      )
    );
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
        timeout = setTimeout(() => reject(new Error("Settings editor smoke exceeded 120 seconds")), 120_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
