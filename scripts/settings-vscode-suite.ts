import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const version = (await (await fetch("http://127.0.0.1:9339/json/version")).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map<
    number,
    { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
  >();
  const contexts = new Map<string, number[]>();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(String(event.data));
    if (reply.method === "Runtime.executionContextCreated" && reply.params.context.auxData?.isDefault) {
      const list = contexts.get(reply.sessionId) ?? [];
      list.push(reply.params.context.id);
      contexts.set(reply.sessionId, list);
    }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.error) waiter.reject(new Error(JSON.stringify(reply.error)));
    else waiter.resolve(reply.result);
  });
  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  const sessions = new Map<string, string>();
  let workbench = "";
  let app: { session: string; context: number } | undefined;
  const evaluate = async (expression: string, session: string, context?: number) => {
    const reply = await send(
      "Runtime.evaluate",
      { expression, contextId: context, returnByValue: true, awaitPromise: true },
      session
    );
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return (reply.result as { value: unknown }).value;
  };
  for (let attempt = 0; attempt < 80 && !app; attempt++) {
    const { targetInfos } = (await send("Target.getTargets")) as {
      targetInfos: { targetId: string; type: string; url: string }[];
    };
    for (const target of targetInfos.filter((t) => ["page", "iframe"].includes(t.type))) {
      let session = sessions.get(target.targetId);
      if (!session) {
        const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        session = attached.sessionId as string;
        sessions.set(target.targetId, session);
        await send("Runtime.enable", {}, session);
      }
      if (target.url.includes("workbench")) workbench = session;
      for (const context of contexts.get(session) ?? []) {
        try {
          if (
            await evaluate(
              "Boolean(document.getElementById('scope') && document.getElementById('categories'))",
              session,
              context
            )
          ) {
            app = { session, context };
            break;
          }
        } catch {
          /* Contexts can be replaced while the webview starts. */
        }
      }
    }
    if (!app) await pause(250);
  }
  assert.ok(app, "settings app loaded in the packaged webview");
  const active = app;
  return {
    eval: (expression: string) => evaluate(expression, active.session, active.context),
    sendWorkbench: (method: string, params: Record<string, unknown>) => send(method, params, workbench),
    screenshot: async (file: string) => {
      await vscode.commands.executeCommand("notifications.clearAll");
      await pause(250);
      const shot = await send("Page.captureScreenshot", { format: "png" }, workbench);
      await fs.writeFile(file, Buffer.from(shot.data as string, "base64"));
    },
    close: () => socket.close(),
  };
}

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
  const scope = async (id: string) => {
    await ui.eval(
      `document.getElementById('scope').value=${JSON.stringify(id)};document.getElementById('scope').dispatchEvent(new Event('change'))`
    );
    await pause(250);
  };
  const choose = (id: string, option: string) =>
    ui.eval(
      `document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(option)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change'))`
    );
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
      const cards = [...document.querySelectorAll('.setting')].map(el => el.getBoundingClientRect());
      const content = document.getElementById('content').getBoundingClientRect();
      const categories = document.getElementById('categories').getBoundingClientRect();
      return {
        columns: new Set(cards.map(r => Math.round(r.left))).size,
        cardsFit: cards.every(r => r.left >= content.left && r.right <= content.right),
        topFilters: categories.bottom <= content.top + 1,
        noOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        contentHeight: content.height,
      };
    })()`) as Promise<{
      columns: number;
      cardsFit: boolean;
      topFilters: boolean;
      noOverflow: boolean;
      contentHeight: number;
    }>;
  try {
    await waitFor("document.querySelectorAll('.setting').length > 0", "settings state");
    const sections = vscode.extensions.getExtension("JDeffner.px-toolkit")!.packageJSON.contributes
      .configuration as { properties: Record<string, unknown> }[];
    const settingCount = sections.reduce((sum, section) => sum + Object.keys(section.properties).length, 0);
    assert.equal(await ui.eval("document.querySelector('h2').textContent"), "All settings");
    assert.equal(await ui.eval("document.querySelectorAll('.setting').length"), settingCount);
    const wide = await layout();
    assert.ok(wide.columns >= 2, "settings use multiple card columns in a wide editor");
    assert.ok(wide.cardsFit && wide.topFilters && wide.noOverflow, "cards fit below the top filters");
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
    assert.equal(await ui.eval("document.querySelectorAll('#scope option').length"), 4);
    assert.equal(
      await ui.eval(`new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false);
      image.src = getComputedStyle(document.getElementById('scope')).backgroundImage.slice(5, -2);
    })`),
      true,
      "the shared dropdown chevron loads under the panel CSP"
    );
    await ui.screenshot(path.join(scratch, "settings-dark.png"));
    await query("scopeInlayHints");
    await ui.eval("document.getElementById('setting-scopeInlayHints').focus()");
    await pressSpace();
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "toggle save");
    assert.equal(vscode.workspace.getConfiguration("px").inspect("scopeInlayHints")?.workspaceValue, true);
    await choose("filter", "changed");
    assert.equal(await ui.eval("document.querySelectorAll('.setting').length"), 1);
    await choose("filter", "all");
    await click("scopeInlayHints", "Reset");
    await waitFor(
      "!document.querySelector('[data-key=scopeInlayHints] .control-line button[title]')",
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
    await scope("user");
    await value("locLanguage", "german");
    await click("locLanguage", "Save");
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "user save");
    assert.equal(vscode.workspace.getConfiguration("px").inspect("locLanguage")?.globalValue, "german");
    assert.equal(vscode.workspace.getConfiguration("px").get("locLanguage"), "french");
    assert.match(String(await ui.eval("document.body.innerText")), /Overridden by workspace/);
    const folder = vscode.workspace.workspaceFolders![0];
    await scope(`folder:${folder.uri.toString()}`);
    await query("quoteNames");
    await ui.eval("document.getElementById('setting-characterHistory.quoteNames').click()");
    await waitFor("document.getElementById('notice').textContent.includes('saved')", "folder save");
    assert.equal(
      vscode.workspace.getConfiguration("px", folder.uri).inspect("characterHistory.quoteNames")
        ?.workspaceFolderValue,
      false
    );
    await query("gamePath");
    assert.equal(await ui.eval("document.getElementById('setting-gamePath').disabled"), true);
    await scope("workspace");
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
      await vscode.workspace
        .getConfiguration("px")
        .update("gameId", gameId, vscode.ConfigurationTarget.Workspace);
      await query("quoteNames");
      await waitFor(
        "document.getElementById('setting-characterHistory.quoteNames').disabled",
        `${gameId} profile gating`
      );
    }
    await query("tigerRunOn");
    assert.equal(await ui.eval("document.getElementById('setting-tigerRunOn').disabled"), true);
    await vscode.workspace
      .getConfiguration("px")
      .update("gameId", "ck3", vscode.ConfigurationTarget.Workspace);
    await query("");
    await ui.eval(
      "[...document.querySelectorAll('nav button')].find(b=>b.textContent.startsWith('Editor')).click()"
    );
    await ui.screenshot(path.join(scratch, "settings-editor.png"));
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
    assert.ok(compact.cardsFit && compact.noOverflow && compact.topFilters);
    assert.ok(compact.contentHeight >= 200, "top controls leave room for settings at small widths");
    await ui.screenshot(path.join(scratch, "settings-compact.png"));
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
          checks: [
            "packaged command and rendered settings",
            "card grid, top filters, sorting and retained drafts",
            "keyboard workspace toggle and reset",
            "user override precedence",
            "folder-scoped character preference",
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
