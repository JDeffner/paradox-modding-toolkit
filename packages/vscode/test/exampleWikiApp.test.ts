import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as path from "node:path";
import { exampleWikiHtml } from "../src/webviews/exampleWiki/html";
import type { AppToHost, HostToApp } from "../src/webviews/exampleWiki/messages";

const bundle = buildSync({
  entryPoints: [path.join(__dirname, "../src/webviews/exampleWiki/app/main.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
}).outputFiles[0].text;
let dom: JSDOM;
afterEach(() => dom?.window.close());

it("shows a handed-off query, clears the kind filter and keeps article deep links", () => {
  const sent: AppToHost[] = [];
  dom = new JSDOM(
    exampleWikiHtml({ scriptSrc: "app.js", nonce: "test", csp: "" }).replace(
      '<script nonce="test" src="app.js"></script>',
      ""
    ),
    {
      runScripts: "dangerously",
      beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = () => {};
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: (m: AppToHost) => sent.push(m),
            getState: () => undefined,
            setState() {},
          }),
        });
      },
    }
  );
  dom.window.eval(bundle);
  const post = (msg: HostToApp) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: msg }));
  post({
    type: "index",
    index: {
      sources: [],
      needsScriptDocs: false,
      entries: [
        { name: "capital", kind: "event_target", count: 1, shortDoc: "Capital scope" },
        { name: "is_alive", kind: "trigger", count: 1, shortDoc: "Alive" },
      ],
    },
  });
  const document = dom.window.document;
  document.querySelector<HTMLButtonElement>('[data-kind="trigger"]')!.click();
  post({ type: "search", query: "capital" });
  expect(document.querySelector<HTMLInputElement>("#query")!.value).toBe("capital");
  expect(document.querySelector('[data-kind="all"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector("#results")!.textContent).toContain("capital");
  expect(document.querySelector("#results")!.textContent).not.toContain("is_alive");
  post({ type: "reveal", name: "is_alive", kind: "trigger" });
  expect(document.querySelector<HTMLInputElement>("#query")!.value).toBe("");
  expect(sent.at(-1)).toEqual({ type: "select", name: "is_alive", kind: "trigger" });
  post({ type: "entry", name: "is_alive", kind: "trigger", detail: null });
  post({ type: "reveal", name: "capital", kind: "event_target" });
  expect(document.querySelector<HTMLButtonElement>("#back")!.disabled).toBe(false);
  post({ type: "loading" });
  expect(document.querySelector<HTMLButtonElement>("#back")!.disabled).toBe(false);
  expect(document.querySelector("#detailBody")!.textContent).toContain("capital");
  post({ type: "loading", reset: true });
  expect(document.querySelector<HTMLButtonElement>("#back")!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>("#forward")!.disabled).toBe(true);
  expect(document.querySelector<HTMLElement>("#detailBody")!.hidden).toBe(true);
  expect(document.querySelector("#detailBody")!.textContent).toBe("");
  const beforeHistory = sent.length;
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { altKey: true, key: "ArrowLeft" }));
  expect(sent).toHaveLength(beforeHistory);
  post({ type: "entry", name: "capital", kind: "event_target", detail: null });
  expect(document.querySelector("#detailBody")!.textContent).toBe("");
  post({
    type: "index",
    index: {
      sources: ["Victoria 3 catalog"],
      needsScriptDocs: false,
      entries: [{ name: "vic3_fixture", kind: "effect", count: 1, shortDoc: "New game" }],
    },
  });
  post({ type: "search", query: "vic3" });
  expect(document.querySelector("#results")!.textContent).toContain("vic3_fixture");
  expect(document.querySelector("#results")!.textContent).not.toContain("capital");
  expect(document.querySelector("#sourceLines")!.textContent).toBe("Victoria 3 catalog");
});
