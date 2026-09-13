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
    errors,
    document: dom.window.document,
    push: (data: HostToApp) => dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data })),
  };
}

describe("Event Graph boot", () => {
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
