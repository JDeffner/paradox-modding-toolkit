import { afterEach, describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import * as path from "node:path";
import { eventGraphHtml } from "../src/webviews/eventGraph/html";
import type { AppToHost, HostToApp } from "../src/webviews/eventGraph/messages";
import type { GraphState } from "../src/webviews/eventGraph/history";

const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()));
const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/eventGraph/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;

function boot() {
  const posted: AppToHost[] = [];
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => errors.push(error.message));
  const html = eventGraphHtml({ scriptSrc: "app.js", nonce: "test", csp: "" });
  const dom = new JSDOM(
    html.replace(/<script[^>]+src="app.js"><\/script>/, () => `<script>${bundle}</script>`),
    {
      runScripts: "dangerously",
      url: "http://localhost/",
      virtualConsole,
      beforeParse(win) {
        const globals = win as unknown as Record<string, unknown>;
        globals.acquireVsCodeApi = () => ({ postMessage: (message: AppToHost) => posted.push(message) });
        globals.ResizeObserver = class {
          observe() {}
          disconnect() {}
        };
        win.HTMLElement.prototype.scrollIntoView = () => undefined;
      },
    }
  );
  windows.push(dom);
  return {
    posted,
    window: dom.window,
    errors,
    document: dom.window.document,
    push: (data: HostToApp) => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data })),
  };
}

describe("Event Graph boot", () => {
  it("commits the first active field before Ctrl+S reaches a disabled Save button", () => {
    const app = boot();
    app.push({ type: "init", state: { focus: {}, positions: {}, pending: [] } });
    app.push({
      type: "graph",
      params: { connectedOnly: false },
      graph: {
        nodes: [{ id: "test.1", kind: "event", source: "mod", file: "/mods/one.txt", line: 1 }],
        edges: [],
        truncated: false,
      },
    });
    app.document
      .querySelector(".node")!
      .dispatchEvent(new app.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    app.push({
      type: "detail",
      id: "test.1",
      detail: {
        id: "test.1",
        file: "/mods/one.txt",
        sourceHash: "fixture",
        line: 1,
        endLine: 4,
        bodyLine: 2,
        fields: [{ key: "gold", value: "10", line: 2 }],
        sections: [],
        options: [],
        refs: [],
      },
    });
    (app.document.querySelector("#inspector .tval") as HTMLElement).click();
    const input = app.document.querySelector<HTMLInputElement>("#inspector .editWrap input")!;
    input.value = "20";
    // JSDOM does not emit the browser's change-on-blur event.
    input.addEventListener("blur", () => input.dispatchEvent(new app.window.Event("change")));
    input.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect([...app.posted].reverse().find((message) => message.type === "save")).toMatchObject({
      type: "save",
      edits: [{ kind: "setField", value: "20", sourceHash: "fixture" }],
    });
    expect(app.errors).toEqual([]);
  });
  it("includes source identity and a return to the original scalar value in the rendered Save batch", () => {
    const app = boot();
    app.push({ type: "init", state: { focus: {}, positions: {}, pending: [] } });
    app.push({
      type: "graph",
      params: { connectedOnly: false },
      graph: {
        nodes: [{ id: "test.1", kind: "event", source: "mod", file: "/mods/one.txt", line: 1 }],
        edges: [],
        truncated: false,
      },
    });
    app.document
      .querySelector(".node")!
      .dispatchEvent(new app.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    app.push({
      type: "detail",
      id: "test.1",
      detail: {
        id: "test.1",
        file: "/mods/one.txt",
        sourceHash: "fixture",
        line: 1,
        endLine: 4,
        bodyLine: 2,
        fields: [{ key: "gold", value: "10", line: 2 }],
        sections: [],
        options: [],
        refs: [],
      },
    });
    const edit = (value: string) => {
      (app.document.querySelector("#inspector .tval") as HTMLElement).click();
      const input = app.document.querySelector<HTMLInputElement>("#inspector .editWrap input")!;
      input.value = value;
      input.dispatchEvent(new app.window.Event("change"));
    };
    edit("20");
    edit("10");
    app.document.getElementById("save")!.click();
    const save = [...app.posted].reverse().find((message) => message.type === "save");
    expect(save).toMatchObject({
      type: "save",
      edits: [
        { kind: "setField", value: "20", sourceHash: "fixture" },
        { kind: "setField", value: "10", sourceHash: "fixture" },
      ],
    });
    app.push({ type: "saved", applied: [0, 1] });
    expect([...app.posted].reverse().find((message) => message.type === "fetch")).toMatchObject({
      type: "fetch",
      params: { connectedOnly: false },
    });
    expect(app.document.getElementById("toolConnected")!.getAttribute("aria-pressed")).toBe("false");
    expect(app.errors).toEqual([]);
  });
  it("retains failed edits and allows Save to retry without changing the batch", () => {
    const app = boot();
    const state: GraphState = {
      focus: {},
      positions: {},
      pending: [
        {
          kind: "setField",
          id: "test.1",
          file: "/mods/one.txt",
          key: "gold",
          value: "25",
          line: 2,
          insertLine: 2,
          indent: 1,
          sourceHash: "fixture",
        },
      ],
    };
    app.push({ type: "init", state });
    app.document.getElementById("save")!.click();
    expect((app.document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
    expect((app.document.getElementById("inspector") as HTMLElement).inert).toBe(true);
    app.push({ type: "saved", applied: [], error: "save rejected" });
    expect((app.document.getElementById("save") as HTMLButtonElement).disabled).toBe(false);
    expect((app.document.getElementById("inspector") as HTMLElement).inert).toBe(false);
    app.document.getElementById("save")!.click();
    expect(app.posted.filter((message) => message.type === "save")).toEqual([
      { type: "save", edits: state.pending },
      { type: "save", edits: state.pending },
    ]);
    app.push({ type: "saved", applied: [0] });
    expect((app.document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
    expect(app.errors).toEqual([]);
  });
  it("requests host state before sending any session and restores unsaved edits after reload", () => {
    const state: GraphState = {
      focus: { namespace: "test" },
      positions: { "test.1": { x: 100, y: 200 } },
      pending: [{ kind: "editLoc", id: "test.1", key: "test.1.t", value: "Unsaved title" }],
    };
    const first = boot();
    expect(first.errors).toEqual([]);
    expect(first.posted).toContainEqual({ type: "ready" });
    expect(first.posted.filter((message) => message.type === "state")).toEqual([]);
    first.push({ type: "init", state });
    const mirror = first.posted.find((message) => message.type === "state");
    expect(mirror).toMatchObject({ type: "state", state, dirty: 1 });
    const reloaded = boot();
    reloaded.push({ type: "init", state: mirror!.type === "state" ? mirror!.state : state });
    expect(reloaded.errors).toEqual([]);
    expect((reloaded.document.getElementById("save") as HTMLButtonElement).disabled).toBe(false);
    expect((reloaded.document.getElementById("undo") as HTMLButtonElement).disabled).toBe(true);
    reloaded.document.getElementById("save")!.click();
    expect(reloaded.posted).toContainEqual({ type: "save", edits: state.pending });
    expect(reloaded.posted.filter((message) => message.type === "fetch")).toEqual([]);
  });

  it("opens a clean graph with no undo step", () => {
    const app = boot();
    app.push({ type: "init", state: { focus: {}, positions: {}, pending: [] } });
    expect(app.errors).toEqual([]);
    expect((app.document.getElementById("undo") as HTMLButtonElement).disabled).toBe(true);
    expect((app.document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Event Graph node actions", () => {
  function graph() {
    const app = boot();
    app.push({ type: "init", state: { focus: {}, positions: {}, pending: [] } });
    app.push({
      type: "graph",
      params: { modRoot: "/mods/selected" },
      graph: {
        nodes: [
          { id: "test.1", kind: "event", source: "mod", file: "/mods/selected/one.txt", line: 4 },
          { id: "test.2", kind: "event", source: "mod", file: "/mods/selected/two.txt", line: 8 },
        ],
        edges: [{ from: "test.1", to: "test.2", via: "trigger_event" }],
        truncated: false,
      },
    });
    return app;
  }

  it("right-click preserves graph focus and exposes the clicked source, not the selection", () => {
    const app = graph();
    const nodes = app.document.querySelectorAll<SVGGElement>(".node");
    nodes[0].dispatchEvent(new app.window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
    const event = new app.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    nodes[1].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(JSON.parse(nodes[1].getAttribute("data-vscode-context")!)).toMatchObject({
      webviewSection: "px.graphNode",
      pxSourceFile: "/mods/selected/two.txt",
      pxSourceLine: 7,
      pxDefinitionId: "test.2",
      pxDefinitionKind: "event",
    });
    expect(app.posted.filter((message) => message.type === "fetch")).toEqual([]);
    expect(nodes[0].getAttribute("aria-pressed")).toBe("true");
    expect(app.errors).toEqual([]);
  });

  it("navigates with arrows and opens the focused source and native menu by keyboard", () => {
    const app = graph();
    const nodes = app.document.querySelectorAll<SVGGElement>(".node");
    nodes[0].focus();
    nodes[0].dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(app.document.activeElement).toBe(nodes[1]);
    expect(nodes[0].getAttribute("tabindex")).toBe("-1");
    expect(nodes[1].getAttribute("tabindex")).toBe("0");
    let menuTarget: EventTarget | null = null;
    app.document.addEventListener("contextmenu", (event) => {
      menuTarget = event.target;
    });
    nodes[1].dispatchEvent(
      new app.window.KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true })
    );
    expect(menuTarget).toBe(nodes[1]);
    nodes[1].dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(app.posted).toContainEqual({ type: "open", file: "/mods/selected/two.txt", line: 8 });
    expect(app.posted).toContainEqual({ type: "select", id: "test.2", file: "/mods/selected/two.txt" });
    expect(app.errors).toEqual([]);
  });

  it("routes native actions to their exact node and rejects a stale source", () => {
    const app = graph();
    app.push({ type: "nodeAction", action: "simulate", id: "test.2", file: "/mods/other/two.txt" });
    expect(app.posted.some((message) => message.type === "simulate")).toBe(false);
    app.push({ type: "nodeAction", action: "simulate", id: "test.2", file: "/mods/selected/two.txt" });
    expect(app.posted).toContainEqual({ type: "simulate", id: "test.2", file: "/mods/selected/two.txt" });
    app.push({ type: "nodeAction", action: "focus", id: "test.1", file: "/mods/selected/one.txt" });
    expect(app.posted).toContainEqual({
      type: "fetch",
      params: expect.objectContaining({ root: "test.1", modRoot: "/mods/selected" }),
    });
    expect(app.errors).toEqual([]);
  });
});
