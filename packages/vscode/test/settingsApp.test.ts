import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as path from "node:path";
import manifest from "../package.json";
import { settingsHtml } from "../src/webviews/settings/html";
import { settingsCatalog } from "../src/webviews/settings/model";
import type { AppToHost, HostToApp, SettingSchema, SettingsState } from "../src/webviews/settings/messages";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/settings/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;
let dom: JSDOM;
afterEach(() => dom?.window.close());
function boot() {
  const messages: AppToHost[] = [];
  dom = new JSDOM(
    settingsHtml({ scriptSrc: "app.js", nonce: "test", csp: "" }).replace(
      '<script nonce="test" src="app.js"></script>',
      ""
    ),
    {
      runScripts: "dangerously",
      beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = () => {};
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: (m: AppToHost) => messages.push(m),
            getState: () => undefined,
            setState() {},
          }),
        });
      },
    }
  );
  dom.window.eval(bundle);
  const state: SettingsState = {
    target: "workspace",
    targets: [
      { id: "user", label: "User" },
      { id: "workspace", label: "Workspace" },
    ],
    game: "Test game",
    summary: [],
    actions: [],
    rows: settingsCatalog(
      manifest.contributes.configuration as unknown as { properties: Record<string, SettingSchema> }[]
    ).map((r) => ({
      ...r,
      value: r.schema.default,
      target: "workspace" as const,
      targetLabel: "Workspace",
      targets: [
        { id: "user" as const, label: "User" },
        { id: "workspace" as const, label: "Workspace" },
      ],
      effectiveValue: r.schema.default,
      effectiveSource: "Default",
      resetLabel: "Use inherited value",
      stamp: "undefined",
      explicit: false,
      source: "Default",
    })),
  };
  const post = (m: HostToApp) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: structuredClone(m) }));
  post({ type: "state", state });
  const query = (value: string) => {
    const input = dom.window.document.getElementById("query") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input"));
  };
  const input = (key: string, value: string) => {
    if (dom.window.document.getElementById(`setting-${key}`)?.hidden)
      dom.window.document.getElementById(`summary-${key}`)!.click();
    const control = dom.window.document.getElementById(`setting-${key}`) as HTMLInputElement;
    control.value = value;
    control.dispatchEvent(new dom.window.Event("input"));
    return control;
  };
  const click = (key: string, text: string) =>
    [...dom.window.document.querySelectorAll<HTMLButtonElement>(`[data-key="${key}"] button`)]
      .find((b) => b.textContent === text)!
      .click();
  const select = (id: string, value: string) => {
    const control = dom.window.document.getElementById(id) as HTMLButtonElement;
    control.click();
    const labels: Record<string, string> = {
      all: "All settings",
      changed: id === "sort" ? "Changed first" : "Customized",
      drafts: "Unsaved drafts",
      default: "Default order",
      name: "Name",
      user: "User",
      workspace: "Workspace",
    };
    const option = [...dom.window.document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === (labels[value] ?? value)
    );
    expect(option, `Menu option ${value}`).toBeTruthy();
    option!.click();
  };
  return { state, post, messages, query, input, click, select, document: dom.window.document };
}

const groupedKeys = (state: SettingsState) =>
  ["Game & paths", "Mods", "Editor", "Validation", "Advanced"].flatMap((group) =>
    state.rows.filter((row) => row.group === group).map((row) => row.key)
  );

it("searches across categories and gives controls labels", () => {
  const t = boot();
  const shownKeys = () =>
    [...t.document.querySelectorAll<HTMLElement>(".setting")].map((row) => row.dataset.key);
  const selectView = (name: string) =>
    [...t.document.querySelectorAll<HTMLButtonElement>("nav button")]
      .find((b) => b.textContent?.startsWith(name))!
      .click();
  expect(t.document.querySelector("h2")?.textContent).toBe("All settings");
  expect(shownKeys()).toEqual(groupedKeys(t.state));
  t.input("locLanguage", "german");
  selectView("Editor");
  expect(shownKeys()).toEqual(t.state.rows.filter((row) => row.group === "Editor").map((row) => row.key));
  selectView("All settings");
  expect(shownKeys()).toEqual(groupedKeys(t.state));
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("german");
  t.query("quoteNames");
  expect(t.document.querySelectorAll(".setting")).toHaveLength(1);
  expect(t.document.querySelector("label[for='setting-characterHistory.quoteNames']")?.textContent).toBe(
    "Quote character names"
  );
  t.query("nothing matches this");
  expect(t.document.body.textContent).toContain("No settings found");
  t.query("ignorePatterns");
  expect(t.document.body.textContent).toContain("common/**/vendor/*.txt");
  t.query("");
  expect(shownKeys()).toEqual(groupedKeys(t.state));
});

it("retains drafts across external changes and sends their original stamp", () => {
  const t = boot();
  t.query("locLanguage");
  t.input("locLanguage", "german");
  const row = t.state.rows.find((r) => r.key === "locLanguage")!;
  row.value = "french";
  row.stamp = '"french"';
  row.explicit = true;
  t.post({ type: "state", state: t.state });
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("german");
  expect(t.document.body.textContent).toContain("Changed elsewhere");
  t.click("locLanguage", "Save");
  const message = t.messages.at(-1)!;
  expect(message).toMatchObject({
    type: "save",
    context: "workspace",
    target: "workspace",
    stamp: "undefined",
    value: "german",
  });
  if (message.type !== "save") throw new Error("No save");
  t.post({ type: "result", id: message.id, error: "Setting changed elsewhere" });
  expect(t.document.body.textContent).toContain("Setting changed elsewhere");
  t.click("locLanguage", "Discard draft");
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("french");
});

it("filters and sorts settings without losing drafts or their scope", () => {
  const t = boot();
  const shownKeys = () =>
    [...t.document.querySelectorAll<HTMLElement>(".setting")].map((row) => row.dataset.key);
  const changed = t.state.rows.filter((r) => ["locLanguage", "scopeInlayHints"].includes(r.key));
  for (const row of changed) row.explicit = true;
  t.post({ type: "state", state: t.state });
  t.input("locLanguage", "german");
  t.select("sort", "name");
  expect(shownKeys()).toEqual(
    [...t.state.rows].sort((a, b) => a.label.localeCompare(b.label)).map((r) => r.key)
  );
  t.select("filter", "changed");
  expect(shownKeys()).toEqual([...changed].sort((a, b) => a.label.localeCompare(b.label)).map((r) => r.key));
  t.select("filter", "drafts");
  expect(shownKeys()).toEqual(["locLanguage"]);
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("german");
  t.select("scope", "user");
  expect(t.messages.at(-1)).toEqual({ type: "target", target: "user" });
  t.post({ type: "state", state: { ...t.state, target: "user" } });
  expect(shownKeys()).toEqual([]);
  expect(t.document.body.textContent).toContain("No settings found");
  t.post({ type: "state", state: t.state });
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("german");
  t.select("filter", "all");
  t.select("sort", "changed");
  expect(shownKeys()).toEqual([
    ...changed.map((r) => r.key),
    ...t.state.rows.filter((r) => !r.explicit).map((r) => r.key),
  ]);
  t.select("sort", "default");
  expect(shownKeys()).toEqual(groupedKeys(t.state));
  t.select("filter", "drafts");
  t.click("locLanguage", "Discard draft");
  expect(shownKeys()).toEqual([]);
  expect(t.messages.some((m) => m.type === "save")).toBe(false);
});

it("reveals a setting hidden by filters without losing another setting's draft", () => {
  const t = boot();
  t.input("locLanguage", "german");
  t.select("filter", "drafts");
  t.post({ type: "reveal", key: "scopeInlayHints" });
  expect((t.document.getElementById("filter") as HTMLSelectElement).value).toBe("all");
  expect(t.document.getElementById("setting-scopeInlayHints")).not.toBeNull();
  t.query("");
  t.select("filter", "drafts");
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("german");
});

it("keeps focus on activated categories and refreshes without stealing it from controls", () => {
  const t = boot();
  t.input("locLanguage", "german");
  t.select("filter", "drafts");
  const category = [...t.document.querySelectorAll<HTMLButtonElement>("#categories button")].find((b) =>
    b.textContent?.startsWith("Mods")
  )!;
  category.focus();
  category.click();
  const replacement = t.document.getElementById(category.id)!;
  expect(replacement).not.toBe(category);
  expect(t.document.activeElement).toBe(replacement);
  t.post({ type: "state", state: t.state });
  expect(t.document.activeElement).toBe(t.document.getElementById(category.id));
  expect((t.document.getElementById("filter") as HTMLSelectElement).value).toBe("drafts");
  const query = t.document.getElementById("query")!;
  query.focus();
  t.query("locLanguage");
  t.post({ type: "state", state: t.state });
  expect(t.document.activeElement).toBe(query);
  const field = t.document.getElementById("setting-locLanguage") as HTMLInputElement;
  expect(field.value).toBe("german");
  field.focus();
  field.setSelectionRange(1, 3);
  t.post({ type: "state", state: t.state });
  const refreshed = t.document.getElementById("setting-locLanguage") as HTMLInputElement;
  expect(t.document.activeElement).toBe(refreshed);
  expect(refreshed.value).toBe("german");
  expect([refreshed.selectionStart, refreshed.selectionEnd]).toEqual([1, 3]);
});

it("saves switches immediately and restores their draft after a write failure", () => {
  const t = boot();
  t.query("scopeInlayHints");
  (t.document.getElementById("setting-scopeInlayHints") as HTMLInputElement).click();
  const m = t.messages.at(-1)!;
  expect(m).toMatchObject({ type: "save", value: true, target: "workspace" });
  if (m.type !== "save") throw new Error("No save");
  t.post({ type: "result", id: m.id, error: "Settings file is read-only" });
  expect(t.document.body.textContent).toContain("Settings file is read-only");
  expect((t.document.getElementById("setting-scopeInlayHints") as HTMLInputElement).checked).toBe(true);
});

it("preserves a different field's focused draft and selection when a save reply arrives", () => {
  const t = boot();
  t.input("locLanguage", "german");
  t.click("locLanguage", "Save");
  const request = t.messages.at(-1)!;
  if (request.type !== "save") throw new Error("No save");
  const field = t.input("gamePath", "/games/draft");
  field.focus();
  field.setSelectionRange(2, 5);
  t.post({ type: "result", id: request.id });
  const replacement = t.document.getElementById("setting-gamePath") as HTMLInputElement;
  expect(t.document.activeElement).toBe(replacement);
  expect(replacement.value).toBe("/games/draft");
  expect([replacement.selectionStart, replacement.selectionEnd]).toEqual([2, 5]);
  t.click("gamePath", "Save");
  expect(t.messages.at(-1)).toMatchObject({ type: "save", value: "/games/draft", stamp: "undefined" });
});

it("browsing fills a draft, cancellation writes nothing, and invalid JSON stays editable", () => {
  const t = boot();
  t.query("gamePath");
  t.click("gamePath", "Browse…");
  const browse = t.messages.at(-1)!;
  if (browse.type !== "browse") throw new Error("No browse");
  expect(browse).toMatchObject({ context: "workspace", target: "workspace", key: "gamePath" });
  t.post({ type: "result", id: browse.id, value: "/games/test" });
  expect(t.messages.some((m) => m.type === "save")).toBe(false);
  expect((t.document.getElementById("setting-gamePath") as HTMLInputElement).value).toBe("/games/test");
  t.click("gamePath", "Browse…");
  const cancel = t.messages.at(-1)!;
  if (cancel.type !== "browse") throw new Error("No browse");
  t.post({ type: "result", id: cancel.id });
  expect((t.document.getElementById("setting-gamePath") as HTMLInputElement).value).toBe("/games/test");
  t.query("calendar");
  t.input("calendar", "{bad JSON");
  t.click("calendar", "Save");
  expect(t.document.body.textContent).toContain("Enter valid JSON");
  expect(t.messages.some((m) => m.type === "save")).toBe(false);
});

it("uses themed menus for longer selectors, with keyboard selection and Escape dismissal", async () => {
  const t = boot();
  expect(t.document.querySelector("select")).toBeNull();
  const scope = t.document.getElementById("scope") as HTMLButtonElement;
  scope.click();
  const list = t.document.querySelector('[role="listbox"]')!;
  expect(list.closest(".px-popover")).toBeTruthy();
  list.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  list.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(t.messages.at(-1)).toEqual({ type: "target", target: "user" });
  t.query("gameId");
  const control = t.document.getElementById("setting-gameId") as HTMLButtonElement;
  control.click();
  expect(t.document.querySelector('[role="listbox"]')).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(t.document.querySelector(".px-popover")).toBeNull();
  expect(t.document.activeElement).toBe(control);
});

it("shows short choices with explanations and saves keyboard selection", () => {
  const t = boot();
  t.query("completion.mode");
  t.document.getElementById("expand-completion.mode")!.click();
  const choices = t.document.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  expect(choices).toHaveLength(3);
  expect(choices[0].getAttribute("aria-checked")).toBe("true");
  expect(choices[1].textContent).toContain("Insert documented example blocks");
  choices[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  const request = t.messages.at(-1)!;
  expect(request).toMatchObject({
    type: "save",
    key: "completion.mode",
    value: "examples",
    stamp: "undefined",
  });
  expect(t.document.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Examples");
  if (request.type !== "save") throw new Error("Expected save");
  t.post({ type: "result", id: request.id, error: "Read-only settings" });
  expect(t.document.querySelector('[role="alert"]')?.textContent).toBe("Read-only settings");
  t.click("completion.mode", "Save");
  expect(t.messages.at(-1)).toMatchObject({ type: "save", value: "examples" });
});

it("starts compact, expands individual rows and all settings without saving or losing drafts", () => {
  const t = boot();
  const toggle = t.document.getElementById("show-details") as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  expect(t.document.querySelectorAll('.row-expander[aria-expanded="true"]')).toHaveLength(0);
  expect([...t.document.querySelectorAll<HTMLElement>(".setting-details")].every((node) => node.hidden)).toBe(
    true
  );
  t.input("locLanguage", "german");
  t.query("locLanguage");
  const expand = t.document.getElementById("expand-locLanguage")!;
  expand.focus();
  expand.click();
  expect(t.document.activeElement?.id).toBe(expand.id);
  expect(t.document.getElementById("details-locLanguage")?.hidden).toBe(false);
  expect(toggle.indeterminate).toBe(true);
  t.query("");
  expect(t.document.querySelectorAll('.row-expander[aria-expanded="true"]')).toHaveLength(1);
  // The switch applies to settings outside the current search, too.
  t.query("locLanguage");
  toggle.click();
  t.query("");
  expect(t.document.querySelectorAll('.row-expander[aria-expanded="true"]')).toHaveLength(
    t.state.rows.length
  );
  expect(toggle.checked).toBe(true);
  toggle.click();
  expect(t.document.querySelectorAll('.row-expander[aria-expanded="true"]')).toHaveLength(0);
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("german");
  expect(t.document.querySelector('[data-key="locLanguage"]')?.classList.contains("has-draft")).toBe(true);
  expect(t.messages.filter((message) => message.type === "save")).toHaveLength(0);
});

it("expands a compact list summary for editing and preserves its draft through collapse", () => {
  const t = boot();
  const key = "parentMods";
  const summary = t.document.getElementById(`summary-${key}`)!;
  expect(summary.textContent).toBe("0 entries");
  summary.click();
  expect(t.document.activeElement?.id).toBe(`setting-${key}`);
  expect(t.document.getElementById(`setting-${key}`)?.hidden).toBe(false);
  t.input(key, "/mods/first\n/mods/second");
  t.document.getElementById(`expand-${key}`)!.click();
  expect(t.document.getElementById(`summary-${key}`)?.textContent).toBe("2 entries");
  t.click(key, "Save");
  expect(t.messages.at(-1)).toMatchObject({
    type: "save",
    key,
    value: ["/mods/first", "/mods/second"],
    stamp: "undefined",
  });
  const request = t.messages.at(-1)!;
  if (request.type !== "save") throw new Error("Expected save");
  t.post({ type: "result", id: request.id, error: "Settings file is read-only" });
  expect(t.document.querySelector(".field-error")?.closest("[hidden]")).toBeNull();
  t.document.getElementById(`summary-${key}`)!.click();
  expect((t.document.getElementById(`setting-${key}`) as HTMLTextAreaElement).value).toBe(
    "/mods/first\n/mods/second"
  );
});

it("offers brief help without expanding the row and exposes full help in Details", async () => {
  const t = boot();
  t.query("diagnostics.ignorePatterns");
  const help = t.document.querySelector<HTMLButtonElement>(".setting-help")!;
  expect(help.getAttribute("aria-label")).toBe("Help for Ignored file patterns");
  expect(help.dataset.tip).toBeTruthy();
  expect(t.document.getElementById("details-diagnostics.ignorePatterns")?.hidden).toBe(true);
  help.click();
  expect(t.document.getElementById("details-diagnostics.ignorePatterns")?.hidden).toBe(true);
  expect(t.document.querySelector(".extra-help")).not.toBeNull();
  t.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  help.focus();
  expect(t.document.activeElement).toBe(help);
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(t.document.querySelector<HTMLElement>(".px-tip")?.hidden).toBe(false);
  expect(t.document.querySelector(".px-tip")?.textContent).toBe(help.dataset.tip);
  t.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(t.document.querySelector<HTMLElement>(".px-tip")?.hidden).toBe(true);
  const disclosure = t.document.getElementById("expand-diagnostics.ignorePatterns")!;
  expect(disclosure.getAttribute("aria-label")).toBe("Show details for Ignored file patterns");
  disclosure.click();
  expect(t.document.getElementById("details-diagnostics.ignorePatterns")?.hidden).toBe(false);
  expect(t.document.querySelector(".extra-help summary")?.getAttribute("data-tip")).toContain(
    "common/**/vendor/*.txt"
  );
  help.click();
  expect(t.document.getElementById("details-diagnostics.ignorePatterns")?.hidden).toBe(false);
  expect(t.messages.some((m) => m.type === "save")).toBe(false);
});

it("offers extra help on keyboard focus and click without repeating the brief", async () => {
  const t = boot();
  t.query("diagnostics.ignorePatterns");
  t.document.getElementById("expand-diagnostics.ignorePatterns")!.click();
  const summary = t.document.querySelector<HTMLElement>(".extra-help summary")!;
  expect(summary.querySelector("svg")).not.toBeNull();
  expect(summary.dataset.tip).toContain("common/**/vendor/*.txt");
  t.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  summary.focus();
  expect(t.document.activeElement).toBe(summary);
  expect(summary.matches(":focus-visible")).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(t.document.querySelector<HTMLElement>(".px-tip")?.hidden).toBe(false);
  expect(t.document.querySelector(".px-tip")?.textContent).toContain("common/**/vendor/*.txt");
  summary.click();
  expect(t.document.querySelector<HTMLDetailsElement>(".extra-help")?.open).toBe(true);
  expect(t.document.querySelector(".extra-help p")?.textContent).not.toBe(
    t.document.querySelector(".description")?.textContent
  );
});

it("keeps one catalogue in a mod context with separate destinations and effective sources", () => {
  const t = boot();
  const context = "project:file:///mods/first" as const;
  t.state.target = context;
  t.state.targets = [{ id: context, label: "First mod" }];
  const path = t.state.rows.find((row) => row.key === "gamePath")!;
  path.target = "machine:workspace";
  path.targetLabel = "Personal paths: this workspace";
  path.targets = [
    { id: "machine:workspace", label: path.targetLabel },
    { id: "user", label: "User" },
  ];
  path.value = "/games/destination";
  path.effectiveValue = "/games/active";
  path.effectiveSource = "Personal paths: this mod";
  path.explicit = true;
  path.resetLabel = "Use personal default";
  const rule = t.state.rows.find((row) => row.key === "characterHistory.quoteNames")!;
  rule.target = context;
  rule.targetLabel = "Shared rules: First mod";
  t.post({ type: "state", state: t.state });
  expect([...t.document.querySelectorAll<HTMLElement>(".setting")].map((row) => row.dataset.key)).toEqual(
    groupedKeys(t.state)
  );
  expect(t.document.body.textContent).toContain("Settings for");
  expect(t.document.querySelector('[data-key="gamePath"]')?.textContent).toContain(path.targetLabel);
  expect(t.document.querySelector('[data-key="gamePath"] .setting-source')?.textContent).toContain(
    path.effectiveSource.toLowerCase()
  );
  expect(t.document.querySelector('[data-key="gamePath"] .setting-source')?.closest("[hidden]")).toBeNull();
  const active = t.document.querySelector('[data-key="gamePath"] .active-value');
  expect(active?.textContent).toContain("/games/active");
  expect(active?.closest("[hidden]")).toBeNull();
  t.document.getElementById("expand-gamePath")!.click();
  expect(t.document.querySelector('[data-key="gamePath"]')?.textContent).toContain("/games/active");
  expect(t.document.querySelector('[data-key="gamePath"]')?.textContent).toContain(path.resetLabel);
  t.input("gamePath", "/games/draft");
  t.select("destination-gamePath", "user");
  expect(t.messages.at(-1)).toEqual({ type: "destination", context, key: "gamePath", target: "user" });
  t.query("quoteNames");
  expect(t.document.querySelectorAll(".setting")).toHaveLength(1);
  t.query("gamePath");
  t.click("gamePath", "Save");
  expect(t.messages.at(-1)).toMatchObject({
    type: "save",
    context,
    target: "machine:workspace",
    value: "/games/draft",
  });
});

it("preserves destination drafts and newer edits when an old save reply arrives", () => {
  const t = boot();
  t.input("locLanguage", "german");
  t.click("locLanguage", "Save");
  const request = t.messages.at(-1)!;
  if (request.type !== "save") throw new Error("Expected save");
  const row = t.state.rows.find((item) => item.key === "locLanguage")!;
  row.target = "user";
  row.targetLabel = "User";
  t.post({ type: "state", state: t.state });
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe(row.value);
  t.input("locLanguage", "french");
  t.post({ type: "result", id: request.id });
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("french");
  t.click("locLanguage", "Save");
  expect(t.messages.at(-1)).toMatchObject({
    type: "save",
    context: "workspace",
    target: "user",
    value: "french",
  });
  row.target = "workspace";
  row.targetLabel = "Workspace";
  t.post({ type: "state", state: t.state });
  t.input("locLanguage", "spanish");
  t.click("locLanguage", "Save");
  const older = t.messages.at(-1)!;
  if (older.type !== "save") throw new Error("Expected save");
  t.input("locLanguage", "italian");
  t.post({ type: "result", id: older.id });
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("italian");
});

it("saves drafts for every destination in the active context and keeps other contexts private", () => {
  const t = boot();
  const row = t.state.rows.find((item) => item.key === "locLanguage")!;
  t.input("locLanguage", "german");
  row.target = "user";
  row.targetLabel = "User";
  t.post({ type: "state", state: t.state });
  t.input("locLanguage", "french");
  t.post({ type: "state", state: { ...t.state, target: "user" } });
  t.input("locLanguage", "spanish");
  t.post({ type: "state", state: t.state });
  expect(t.document.getElementById("draft-count")?.textContent).toBe("2 unsaved settings");
  t.document.getElementById("save-drafts")!.click();
  const batches = t.messages.filter((message) => message.type === "saveBatch");
  expect(batches).toHaveLength(1);
  expect(batches[0].changes).toMatchObject([
    { context: "workspace", target: "workspace", key: "locLanguage", stamp: "undefined", value: "german" },
    { context: "workspace", target: "user", key: "locLanguage", stamp: "undefined", value: "french" },
  ]);
  expect(new Set(batches[0].changes.map((change) => change.id)).size).toBe(2);
  expect(t.messages.some((message) => message.type === "save")).toBe(false);
  t.post({ type: "state", state: { ...t.state, target: "user" } });
  expect((t.document.getElementById("setting-locLanguage") as HTMLInputElement).value).toBe("spanish");
});

it("formats help safely and saves only editable drafts in the current scope", () => {
  const t = boot();
  expect(t.document.querySelector('[data-key="diagnostics.ignorePatterns"] code')?.textContent).toBeTruthy();
  t.input("locLanguage", "german");
  t.input("gamePath", "/games/example");
  expect(t.document.getElementById("draft-count")?.textContent).toBe("2 unsaved settings");
  const row = t.state.rows.find((r) => r.key === "gamePath")!;
  row.disabled = "Not editable here";
  t.post({ type: "state", state: t.state });
  t.document.getElementById("save-drafts")!.click();
  expect(t.messages.filter((m) => m.type === "saveBatch")).toMatchObject([
    { changes: [{ context: "workspace", target: "workspace", key: "locLanguage", value: "german" }] },
  ]);
  expect(t.messages.some((message) => message.type === "save")).toBe(false);
});

it("saves two private paths in one batch and handles each result independently", () => {
  const t = boot();
  for (const row of t.state.rows.filter((row) => ["gamePath", "logsPath"].includes(row.key))) {
    row.target = "machine:workspace";
    row.targetLabel = "This workspace · Private";
    row.targets = [{ id: "machine:workspace", label: row.targetLabel }];
    row.stamp = '"registry snapshot"';
  }
  t.post({ type: "state", state: t.state });
  t.input("gamePath", "/games/batch");
  t.input("logsPath", "/logs/batch");
  t.document.getElementById("save-drafts")!.click();
  const request = t.messages.at(-1)!;
  expect(request.type).toBe("saveBatch");
  if (request.type !== "saveBatch") throw new Error("Expected batch save");
  expect(request.changes).toMatchObject([
    { key: "gamePath", target: "machine:workspace", stamp: '"registry snapshot"', value: "/games/batch" },
    { key: "logsPath", target: "machine:workspace", stamp: '"registry snapshot"', value: "/logs/batch" },
  ]);
  t.post({ type: "result", id: request.changes[0].id });
  expect(t.document.getElementById("draft-count")?.textContent).toBe("1 unsaved setting");
  t.post({ type: "result", id: request.changes[1].id });
  expect(t.document.getElementById("draft-count")?.textContent).toBe("");
  expect(t.document.querySelector(".field-error")).toBeNull();
});
