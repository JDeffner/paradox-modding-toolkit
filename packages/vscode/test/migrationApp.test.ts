import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import * as path from "node:path";
import { migrationHtml } from "../src/webviews/compatch/html";
import type { MigrationViewState } from "../src/webviews/compatch/messages";
import type { MigrationManifest } from "@px-lsp/protocol/migration";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/compatch/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;

const recipe: MigrationManifest = {
  id: "test.recipe",
  revision: "1",
  sdkVersion: 1,
  gameId: "ck3",
  fromVersion: "1.0",
  toVersion: "2.0",
  kind: "recipe",
  detection: "script",
  requirement: "required",
  title: "Update example value",
  description: "Synthetic example",
  guidance: "Choose the value your mod needs.",
  limitations: [],
  dependsOn: [],
  evidence: [],
  inputs: [{ root: "mod", path: "example.txt" }],
};

function app(overrides: Partial<MigrationViewState> = {}) {
  const messages: unknown[] = [];
  const dom = new JSDOM(migrationHtml({ scriptSrc: "app.js", nonce: "test-nonce", csp: "" }), {
    runScripts: "dangerously",
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
      Object.assign(window, {
        acquireVsCodeApi: () => ({ postMessage: (value: unknown) => messages.push(value) }),
      });
    },
  });
  dom.window.eval(bundle);
  const state: MigrationViewState = {
    roots: { mod: "/test/mod" },
    catalog: [recipe],
    selected: recipe,
    fromVersion: "1.0",
    toVersion: "2.0",
    versions: ["1.0", "2.0"],
    routes: [],
    entries: { [recipe.id]: { trusted: true } },
    references: [],
    issues: [],
    local: false,
    answers: {},
    missing: [],
    busy: false,
    canCancel: false,
    status: "Ready",
    canRestore: false,
    ...overrides,
  };
  const update = (value: MigrationViewState) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", { data: { type: "state", state: value } })
    );
  update(state);
  return { dom, messages, state, update, doc: dom.window.document };
}

describe("migration task workspace", () => {
  it("offers file and folder loading beside entry creation", () => {
    const { doc, messages, state, update, dom } = app();
    for (const [action, label] of [
      ["load", "Load files…"],
      ["load-folder", "Load folder…"],
      ["template", "Create an entry…"],
    ]) {
      const button = doc.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;
      expect(button.textContent).toBe(label);
      button.click();
      expect(messages.at(-1)).toEqual({ type: action });
    }
    update({ ...state, busy: true });
    expect((doc.querySelector('[data-action="load-folder"]') as HTMLButtonElement).disabled).toBe(true);
    dom.window.close();
  });
  it("exposes source selection and honest empty coverage", () => {
    const { doc, messages, dom } = app({ catalog: [], selected: undefined });
    expect(messages).toEqual([{ type: "ready" }]);
    expect(doc.body.textContent).toContain("No built-in entries are available");
    (doc.querySelector('[data-root="mod"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "root", root: "mod" });
    dom.window.close();
  });
  it("renders required dependent questions and sends literal choices", () => {
    const { doc, messages, dom } = app({
      inspection: {
        applicability: "applicable",
        coverage: ["Known references only"],
        findings: [],
        questions: [
          {
            id: "parent",
            label: "Parent faith",
            kind: "choice",
            required: true,
            options: [{ label: "River", value: "river" }],
          },
        ],
      },
      missing: ["parent"],
    });
    expect((doc.querySelector('[data-action="prepare"]') as HTMLButtonElement).disabled).toBe(true);
    const select = doc.querySelector('[data-question="parent"]') as HTMLButtonElement;
    expect(select.classList.contains("px-dropdown")).toBe(true);
    select.click();
    const option = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "River"
    )!;
    option.click();
    expect(messages.at(-1)).toEqual({ type: "answer", id: "parent", value: "river" });
    expect(doc.querySelector(".px-popover")).toBeNull();
    expect(doc.activeElement).toBe(select);
    expect(doc.body.textContent).toContain("does not establish compatibility");
    dom.window.close();
  });
  it("escapes untrusted recipe text and values", () => {
    const attack = '<img src=x onerror="window.attacked=true">';
    const { doc, dom } = app({
      status: attack,
      error: attack,
      inspection: {
        applicability: "unknown",
        coverage: [attack],
        questions: [{ id: attack, label: attack, kind: "text", required: true }],
        findings: [{ id: "x", severity: "error", message: attack, path: attack }],
      },
    });
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.body.textContent).toContain(attack);
    dom.window.close();
  });
  it("removes Apply when the prepared plan becomes stale", () => {
    const { doc, state, update, dom } = app({
      preview: { files: [{ path: "example.txt", before: 10, after: 12, text: true }], checks: [] },
    });
    expect(doc.querySelector('[data-action="apply"]')).not.toBeNull();
    update({ ...state, preview: undefined, status: "Source files changed. Inspect again before applying." });
    expect(doc.querySelector('[data-action="apply"]')).toBeNull();
    expect(doc.body.textContent).toContain("Source files changed");
    dom.window.close();
  });
  it("supports cancellation and disables writes while busy", () => {
    const { doc, messages, dom, state, update } = app({
      busy: true,
      canCancel: true,
      preview: { files: [{ path: "x.txt", before: 1, after: 2, text: true }], checks: [] },
    });
    expect((doc.querySelector('[data-action="apply"]') as HTMLButtonElement).disabled).toBe(true);
    (doc.querySelector('[data-action="cancel"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "cancel" });
    update({ ...state, canCancel: false });
    expect(doc.querySelector('[data-action="cancel"]')).toBeNull();
    expect((doc.querySelector('[data-action="apply"]') as HTMLButtonElement).disabled).toBe(true);
    dom.window.close();
  });
  it("submits exact versions together and explains missing coverage", () => {
    const { doc, messages, dom } = app({
      issues: ["No route from 1.0 to 3.0. Missing transition coverage."],
    });
    (doc.getElementById("from-version") as HTMLInputElement).value = "1.0";
    (doc.getElementById("to-version") as HTMLInputElement).value = "3.0";
    doc
      .getElementById("versions")!
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    expect(messages.at(-1)).toEqual({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    expect(doc.body.textContent).toContain("Missing transition coverage");
    expect(doc.querySelector('[data-action="scan"]')?.textContent).toBe("Use migration");
    dom.window.close();
  });
  it("shows ordered route entries and permits reading blocked guidance", () => {
    const later = {
      ...recipe,
      id: "test.later",
      fromVersion: "2.0",
      toVersion: "3.0",
      title: "Later change",
    };
    const route = {
      id: "chain",
      fromVersion: "1.0",
      toVersion: "3.0",
      transitions: [
        { fromVersion: "1.0", toVersion: "2.0", entryIds: [recipe.id] },
        { fromVersion: "2.0", toVersion: "3.0", entryIds: [later.id] },
      ],
      entryIds: [recipe.id, later.id],
    };
    const { doc, messages, dom } = app({
      catalog: [recipe, later],
      route,
      routes: [route],
      selected: later,
      entries: {
        [recipe.id]: { trusted: true },
        [later.id]: { trusted: true, blocked: "Handle Update example value first." },
      },
      nextEntryId: recipe.id,
    });
    expect([...doc.querySelectorAll(".transition")].map((el) => el.textContent)).toEqual([
      "1.0 → 2.0",
      "2.0 → 3.0",
    ]);
    expect((doc.querySelector('[data-action="scan"]') as HTMLButtonElement).disabled).toBe(true);
    expect(doc.body.textContent).toContain("Handle Update example value first.");
    (doc.querySelector('[data-entry="test.later"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "recipe", id: later.id });
    (doc.querySelector('[data-action="next"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "next" });
    dom.window.close();
  });
  it("requires a manual resolution note and never offers automation for static guidance", () => {
    const note: MigrationManifest = {
      ...recipe,
      id: "test.note",
      kind: "advisory",
      detection: "none",
      guidance: "Inspect custom definitions manually.",
    };
    const { doc, messages, dom, state, update } = app({
      selected: note,
      catalog: [note],
      entries: { [note.id]: { trusted: true } },
    });
    expect(doc.querySelector('[data-action="scan"]')).toBeNull();
    expect(doc.querySelector('[data-action="prepare"]')).toBeNull();
    const button = doc.querySelector('[data-action="manual"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = doc.getElementById("manual-note") as HTMLTextAreaElement;
    input.value = "Updated the custom definitions.";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    expect(button.disabled).toBe(false);
    button.click();
    expect(messages.at(-1)).toEqual({
      type: "complete",
      state: "manual",
      note: "Updated the custom definitions.",
    });
    update({ ...state, busy: true });
    expect((doc.getElementById("manual-note") as HTMLTextAreaElement).value).toBe(input.value);
    expect((doc.querySelector('[data-action="manual"]') as HTMLButtonElement).disabled).toBe(true);
    update({
      ...state,
      entries: {
        [note.id]: {
          trusted: true,
          completion: { revision: "1", state: "manual", note: "Updated definitions." },
        },
      },
    });
    expect(doc.body.textContent).toContain("The toolkit has not verified this manual work.");
    expect(doc.querySelector('[data-action="manual"]')).toBeNull();
    dom.window.close();
  });
  it("distinguishes reading informational notes from resolving required work", () => {
    const note: MigrationManifest = {
      ...recipe,
      kind: "advisory",
      detection: "none",
      requirement: "informational",
    };
    const { doc, messages, dom } = app({ selected: note });
    (doc.querySelector('[data-action="read"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "complete", state: "read" });
    expect(doc.querySelector("textarea")).toBeNull();
    dom.window.close();
  });
  it("requires explicit route choice when more than one path exists", () => {
    const first = {
      id: "direct",
      fromVersion: "1.0",
      toVersion: "2.0",
      transitions: [{ fromVersion: "1.0", toVersion: "2.0", entryIds: [recipe.id] }],
      entryIds: [recipe.id],
    };
    const { doc, messages, dom } = app({ routes: [first, { ...first, id: "alternative" }] });
    expect(doc.body.textContent).toContain("Choose a route");
    expect(doc.querySelectorAll("[data-route]")).toHaveLength(2);
    (doc.querySelector('[data-route="alternative"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "route", id: "alternative" });
    dom.window.close();
  });
  it("keeps saved local code disabled until reloaded", () => {
    const { doc, messages, dom } = app({ local: true, entries: { [recipe.id]: { trusted: false } } });
    expect((doc.querySelector('[data-action="scan"]') as HTMLButtonElement).disabled).toBe(true);
    (doc.querySelector('[data-action="reload"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "reload" });
    expect(doc.getElementById("app")!.textContent).not.toContain("Trusted local code");
    dom.window.close();
  });
  it("offers manual resolution when a recipe cannot determine its automatic edits", () => {
    const { doc, messages, dom } = app({
      inspection: {
        applicability: "unknown",
        findings: [],
        questions: [],
        coverage: ["Custom cases need manual review."],
      },
    });
    expect((doc.querySelector('[data-action="prepare"]') as HTMLButtonElement).disabled).toBe(true);
    expect(doc.getElementById("app")!.textContent).toContain("Resolve this step manually");
    const input = doc.getElementById("manual-note") as HTMLTextAreaElement;
    input.value = "Updated the unsupported custom case and tested it.";
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    (doc.querySelector('[data-action="manual"]') as HTMLButtonElement).click();
    expect(messages.at(-1)).toEqual({ type: "complete", state: "manual", note: input.value });
    dom.window.close();
  });
  it("shows unresolved preparation work before enabling Apply", () => {
    const { doc, dom } = app({
      preview: {
        blocked: "Resolve remaining work before applying.",
        files: [{ path: "example.txt", before: 1, after: 2, text: true }],
        checks: [],
      },
    });
    expect((doc.querySelector('[data-action="apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(doc.getElementById("app")!.textContent).toContain("Resolve remaining work before applying.");
    dom.window.close();
  });
  it("refreshes saved JSON guidance without calling it executable code", () => {
    const note: MigrationManifest = { ...recipe, kind: "advisory", detection: "none" };
    const { doc, dom } = app({
      selected: note,
      local: true,
      localFormat: "data",
      entries: { [note.id]: { trusted: false } },
    });
    expect(doc.querySelector('[data-action="reload"]')!.textContent).toBe("Refresh note");
    expect(doc.getElementById("app")!.textContent).not.toContain("trust local code");
    dom.window.close();
  });
});
