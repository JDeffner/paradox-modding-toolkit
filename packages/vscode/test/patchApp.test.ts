import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import * as path from "node:path";
import { patchHtml } from "../src/webviews/patches/html";
import type { PatchViewMessage, PatchViewState } from "../src/webviews/patches/messages";
import type { PatchEntry } from "@px-lsp/server/compatch/model";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/patches/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;

const entry: PatchEntry = {
  id: "definition:example",
  name: "example",
  kind: "definition",
  state: "needs-decision",
  explanation: "Two mods define this item.",
  fingerprint: "current-inputs",
  winner: "second-contribution",
  fieldsSupported: true,
  fieldKeys: ["first_field", "second_field"],
  issues: [],
  contributors: [
    {
      id: "first-contribution",
      sourceId: "first",
      sourceName: "First mod",
      path: "common/examples/first.txt",
      text: "example = { first_field = first }",
      context: "",
      active: true,
      fields: { first_field: "first_field = first" },
    },
    {
      id: "second-contribution",
      sourceId: "second",
      sourceName: "Second mod",
      path: "common/examples/second.txt",
      text: "example = { first_field = second second_field = yes }",
      context: "",
      active: true,
      fields: { first_field: "first_field = second", second_field: "second_field = yes" },
    },
  ],
};

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

function app(overrides: Partial<PatchViewState> = {}) {
  const messages: PatchViewMessage[] = [];
  const dom = new JSDOM(patchHtml({ scriptSrc: "app.js", nonce: "test-nonce", csp: "" }), {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.assign(window, {
        acquireVsCodeApi: () => ({ postMessage: (value: PatchViewMessage) => messages.push(value) }),
      });
    },
  });
  windows.push(dom);
  dom.window.eval(bundle);
  const state: PatchViewState = {
    name: "Example patch",
    output: "/test/patch",
    inputs: [
      { id: "first", name: "First mod", path: "/test/first" },
      { id: "second", name: "Second mod", path: "/test/second" },
    ],
    rows: [entry],
    selected: entry,
    filter: "attention",
    page: 0,
    total: 1,
    counts: { attention: 1, ready: 0, manual: 0, identical: 0 },
    files: [],
    conflicts: [],
    issues: [],
    busy: false,
    status: "Ready",
    needsRefresh: false,
    canPrepare: true,
    canApply: false,
    canRestore: false,
    recoveryBlocked: false,
    ...overrides,
  };
  const update = (value: PatchViewState) =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", { data: { type: "state", state: value } })
    );
  update(state);
  const doc = dom.window.document;
  const button = (action: string, extra = "") => {
    const found = doc.querySelector<HTMLButtonElement>(`[data-action="${action}"]${extra}`);
    if (!found) throw new Error(`Missing ${action} button`);
    return found;
  };
  const input = (id: string, value: string) => {
    const field = doc.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    field.value = value;
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  return { dom, doc, messages, state, update, button, input };
}

describe("maintained compatibility patch UI", () => {
  it("starts with Create and Open and sends the literal patch name", () => {
    const { doc, messages, button, input, state, update } = app({ output: undefined });
    expect(messages).toEqual([{ type: "ready" }]);
    input("new-name", "Two mods together");
    button("create").click();
    expect(messages.at(-1)).toEqual({ type: "create", name: "Two mods together" });
    button("open").click();
    expect(messages.at(-1)).toEqual({ type: "open" });
    update({ ...state, busy: true });
    expect((doc.getElementById("new-name") as HTMLInputElement).value).toBe("Two mods together");
    expect(button("create").disabled).toBe(true);
    expect(button("open").disabled).toBe(true);
  });

  it("renders untrusted source, file, key and contributor strings as text", () => {
    const attack = '<img src=x onerror="window.attacked=true">';
    const selected: PatchEntry = {
      ...entry,
      id: attack,
      name: attack,
      fieldKeys: [attack],
      contributors: [
        {
          ...entry.contributors[0],
          id: attack,
          sourceName: attack,
          path: attack,
          text: attack,
          fields: { [attack]: attack },
        },
      ],
      winner: attack,
    };
    const { doc, messages, button } = app({
      name: attack,
      output: attack,
      inputs: [{ id: attack, name: attack, path: attack }],
      rows: [selected],
      selected,
      files: [{ path: attack, action: "update" }],
      issues: [attack],
      error: attack,
    });
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.body.textContent).toContain(attack);
    expect(doc.querySelector<HTMLSelectElement>("[data-field]")?.dataset.field).toBe(attack);
    button("source").click();
    expect(messages.at(-1)).toEqual({ type: "source", id: attack, contributorId: attack });
    button("diff").click();
    expect(messages.at(-1)).toEqual({ type: "diff", path: attack });
  });

  it("lets the user order, remove and reconnect sources and request adding mods", () => {
    const { doc, button, messages } = app();
    expect([...doc.querySelectorAll(".source-main strong")].map((item) => item.textContent)).toEqual([
      "First mod",
      "Second mod",
    ]);
    expect(button("up", '[data-id="first"]').disabled).toBe(true);
    expect(button("down", '[data-id="second"]').disabled).toBe(true);
    for (const [action, id, expected] of [
      ["down", "first", { type: "move", id: "first", direction: 1 }],
      ["up", "second", { type: "move", id: "second", direction: -1 }],
      ["remove", "first", { type: "remove", id: "first" }],
      ["bind", "second", { type: "bind", id: "second" }],
    ] as const) {
      button(action, `[data-id="${id}"]`).click();
      expect(messages.at(-1)).toEqual(expected);
    }
    expect(button("add").textContent).toBe("Add mods");
    button("add").click();
    expect(messages.at(-1)).toEqual({ type: "add" });
  });

  it("selects conflicts and sends filters and bounded page navigation", () => {
    const { doc, dom, messages, button, state, update } = app({ total: 85 });
    doc.querySelector<HTMLButtonElement>("[data-entry]")!.click();
    expect(messages.at(-1)).toEqual({ type: "select", id: entry.id });
    const filter = doc.getElementById("entry-filter") as HTMLSelectElement;
    filter.value = "ready";
    filter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(messages.at(-1)).toEqual({ type: "filter", value: "ready" });
    expect(button("previous").disabled).toBe(true);
    button("next").click();
    expect(messages.at(-1)).toEqual({ type: "page", value: 1 });
    update({ ...state, page: 2 });
    expect(button("next").disabled).toBe(true);
    button("previous").click();
    expect(messages.at(-1)).toEqual({ type: "page", value: 1 });
  });

  it("sends winner, source, manual and deferred choices with the decision note", () => {
    const { button, messages, input } = app();
    const note = "Keep the custom behavior.";
    input("decision-note", note);
    button("winner").click();
    expect(messages.at(-1)).toEqual({ type: "resolve", id: entry.id, resolution: { mode: "winner", note } });
    button("use-source", '[data-contributor="first-contribution"]').click();
    expect(messages.at(-1)).toEqual({
      type: "resolve",
      id: entry.id,
      resolution: { mode: "source", contributorId: "first-contribution", note },
    });
    input("manual-text", "example = { custom = yes }");
    button("manual").click();
    expect(messages.at(-1)).toEqual({
      type: "resolve",
      id: entry.id,
      resolution: { mode: "manual", text: "example = { custom = yes }", note },
    });
    button("defer").click();
    expect(messages.at(-1)).toEqual({ type: "resolve", id: entry.id, resolution: { mode: "defer", note } });
  });

  it("combines complete direct fields and explicitly omits a field", () => {
    const { doc, dom, messages, button, input } = app();
    const first = doc.querySelector<HTMLSelectElement>('[data-field="first_field"]')!;
    first.value = "first-contribution";
    first.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    const second = doc.querySelector<HTMLSelectElement>('[data-field="second_field"]')!;
    second.value = "";
    second.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    input("decision-note", "Use the first field only.");
    button("fields").click();
    expect(messages.at(-1)).toEqual({
      type: "resolve",
      id: entry.id,
      resolution: {
        mode: "fields",
        fields: { first_field: "first-contribution", second_field: null },
        note: "Use the first field only.",
      },
    });
  });

  it("preserves unsaved field choices, notes and manual text across host updates", () => {
    const { doc, dom, input, state, update } = app();
    const field = doc.querySelector<HTMLSelectElement>('[data-field="first_field"]')!;
    field.value = "first-contribution";
    field.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    input("decision-note", "Unsent note");
    input("manual-text", "example = { unsent = yes }");
    update({ ...state, status: "Scanning", busy: true });
    update({ ...state, status: "Ready again" });
    expect((doc.getElementById("decision-note") as HTMLTextAreaElement).value).toBe("Unsent note");
    expect((doc.getElementById("manual-text") as HTMLTextAreaElement).value).toBe(
      "example = { unsent = yes }"
    );
    expect(doc.querySelector<HTMLSelectElement>('[data-field="first_field"]')!.value).toBe(
      "first-contribution"
    );
  });

  it("shows changed choices for review and labels unsupported overlaps honestly", () => {
    const changed: PatchEntry = {
      ...entry,
      state: "changed",
      decision: {
        fingerprint: "old-inputs",
        resolution: { mode: "source", contributorId: "first-contribution", note: "Earlier choice" },
      },
    };
    const { doc, button, state, update } = app({ selected: changed, rows: [changed] });
    expect(doc.body.textContent).toContain("Inputs changed");
    expect(doc.body.textContent).toContain("Review it before saving again");
    expect(button("use-source", '[data-contributor="first-contribution"]').textContent).toBe(
      "Save this choice again"
    );
    expect((doc.getElementById("decision-note") as HTMLTextAreaElement).value).toBe("Earlier choice");
    const unsupported: PatchEntry = {
      ...entry,
      state: "unsupported",
      winner: undefined,
      fieldsSupported: false,
      kind: "file",
    };
    update({ ...state, rows: [unsupported], selected: unsupported });
    expect(doc.body.textContent).toContain("Manual review");
    expect(button("use-source").disabled).toBe(true);
    expect(button("winner").disabled).toBe(true);
    expect(doc.querySelector('[data-action="fields"]')).toBeNull();
    expect(doc.querySelector('[data-action="manual"]')).toBeNull();
    expect(button("defer").disabled).toBe(false);
  });

  it("blocks stale decisions and disables editing while busy but allows cancellation", () => {
    const { button, doc, messages, state, update } = app({ needsRefresh: true, canPrepare: false });
    for (const action of ["winner", "use-source", "fields", "manual", "defer", "prepare"])
      expect(button(action).disabled).toBe(true);
    expect(button("scan").textContent).toBe("Refresh conflicts");
    update({ ...state, busy: true, canCancel: true });
    for (const action of [
      "add",
      "remove",
      "bind",
      "scan",
      "winner",
      "use-source",
      "fields",
      "manual",
      "source",
    ])
      expect(button(action).disabled).toBe(true);
    expect(doc.getElementById("app")?.getAttribute("aria-busy")).toBe("true");
    button("cancel").click();
    expect(messages.at(-1)).toEqual({ type: "cancel" });
    update({ ...state, busy: true, canCancel: false });
    expect(doc.querySelector('[data-action="cancel"]')).toBeNull();
  });

  it("compares output conflicts and sends current/generated choices, including removal", () => {
    const filename = "common/examples/patch.txt";
    const { button, messages, state, update } = app({
      conflicts: [
        { path: filename, reason: "Independent output edits", current: "current", generated: "generated" },
      ],
    });
    button("diff").click();
    expect(messages.at(-1)).toEqual({ type: "diff", path: filename });
    button("keep-output").click();
    expect(messages.at(-1)).toEqual({ type: "output-choice", path: filename, choice: "current" });
    button("generated-output").click();
    expect(messages.at(-1)).toEqual({ type: "output-choice", path: filename, choice: "generated" });
    update({ ...state, conflicts: [{ path: filename, reason: "No longer generated", current: "current" }] });
    expect(button("generated-output").textContent).toBe("Remove this file");
  });

  it("enables Apply only for an approved current plan and blocks project edits during recovery", () => {
    const { button, messages, doc, state, update } = app({
      files: [{ path: "common/examples/patch.txt", action: "update" }],
    });
    expect(button("apply").disabled).toBe(true);
    update({ ...state, canApply: true });
    button("apply").click();
    expect(messages.at(-1)).toEqual({ type: "apply" });
    update({ ...state, needsRefresh: true, canPrepare: false, canApply: false });
    expect(button("apply").disabled).toBe(true);
    update({ ...state, recoveryBlocked: true, canPrepare: false, canApply: false, canRestore: true });
    expect(doc.body.textContent).toContain("Restore it before changing this project");
    for (const action of ["add", "remove", "bind", "scan", "prepare", "winner", "fields", "apply"])
      expect(button(action).disabled).toBe(true);
    button("restore").click();
    expect(messages.at(-1)).toEqual({ type: "restore" });
  });
});
