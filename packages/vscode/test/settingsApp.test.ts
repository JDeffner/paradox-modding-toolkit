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
    ).map((r) => ({ ...r, value: r.schema.default, stamp: "undefined", explicit: false, source: "Default" })),
  };
  const post = (m: HostToApp) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: m }));
  post({ type: "state", state });
  const query = (value: string) => {
    const input = dom.window.document.getElementById("query") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input"));
  };
  const input = (key: string, value: string) => {
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
    const control = dom.window.document.getElementById(id) as HTMLSelectElement;
    control.value = value;
    control.dispatchEvent(new dom.window.Event("change"));
  };
  return { state, post, messages, query, input, click, select, document: dom.window.document };
}

it("searches across categories and gives controls labels", () => {
  const t = boot();
  const shownKeys = () =>
    [...t.document.querySelectorAll<HTMLElement>(".setting")].map((row) => row.dataset.key);
  const selectView = (name: string) =>
    [...t.document.querySelectorAll<HTMLButtonElement>("nav button")]
      .find((b) => b.textContent?.startsWith(name))!
      .click();
  expect(t.document.querySelector("h2")?.textContent).toBe("All settings");
  expect(shownKeys()).toEqual(t.state.rows.map((row) => row.key));
  t.input("locLanguage", "german");
  selectView("Editor");
  expect(shownKeys()).toEqual(t.state.rows.filter((row) => row.group === "Editor").map((row) => row.key));
  selectView("All settings");
  expect(shownKeys()).toEqual(t.state.rows.map((row) => row.key));
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
  expect(shownKeys()).toEqual(t.state.rows.map((row) => row.key));
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
  expect(message).toMatchObject({ type: "save", stamp: "undefined", value: "german" });
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
  expect(shownKeys()).toEqual(t.state.rows.map((r) => r.key));
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
