/**
 * The event graph's query box, booted in jsdom from the REAL panel markup and
 * the REAL inlined script (the template literal `buildHtml` returns), with the
 * host stubbed by a message recorder.
 *
 * What it pins is the part a reader cannot check by eye: which params a pick
 * produces. An on_action or decision id has no dot, and the box's fallback
 * heuristic reads a dotless word as a NAMESPACE — so completing one has to
 * answer with `root`, or the graph comes back empty on the id the user just
 * chose from the list.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { JSDOM } from "jsdom";

const PANEL = path.join(__dirname, "..", "src", "webviews", "eventGraph", "panel.ts");
const OPEN = "return /* html */ `";

/** The shipped page, with the host-side interpolations filled in. */
function panelHtml(): string {
  const source = fs.readFileSync(PANEL, "utf8");
  const start = source.indexOf(OPEN);
  const rest = source.slice(start + OPEN.length);
  const html = rest
    .slice(0, rest.indexOf("`;"))
    .replace(/\$\{csp\}/g, "")
    .replace(/\$\{nonce\}/g, "test")
    // The layout function is irrelevant here: the graph under test has no nodes.
    .replace(/\$\{layoutSource\}/g, "function () { return new Map(); }");
  expect(html).not.toContain("${");
  return html;
}

const SUGGESTIONS = {
  ids: ["px_test.1", "px_test.2", "px_on_action_thing"],
  namespaces: ["px_test"],
};

interface Booted {
  window: Window & typeof globalThis;
  query: HTMLInputElement;
  posted: Array<Record<string, unknown>>;
  type(text: string): void;
  key(key: string): void;
  items(): string[];
}

function boot(): Booted {
  const posted: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(panelHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: Record<string, unknown>) => posted.push(msg),
        getState: () => undefined,
        setState: () => undefined,
      });
    },
  });
  const window = dom.window as unknown as Window & typeof globalThis;
  const document = window.document;
  // The catalog reaches the box the only way it ever does: with a graph.
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        type: "graph",
        graph: { nodes: [], edges: [], truncated: false, suggestions: SUGGESTIONS },
        params: {},
      },
    })
  );
  const query = document.getElementById("query") as HTMLInputElement;
  return {
    window,
    query,
    posted,
    type(text: string) {
      query.value = text;
      query.dispatchEvent(new window.Event("input"));
    },
    key(key: string) {
      query.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
    },
    items() {
      return [...document.querySelectorAll("#suggest li")].map((li) => li.firstChild?.textContent ?? "");
    },
  };
}

describe("event graph query completion", () => {
  it("offers the mod's namespaces before its ids, matched on substring", () => {
    const app = boot();
    app.type("px_");
    expect(app.items()).toEqual(["px_test", "px_test.1", "px_test.2", "px_on_action_thing"]);
    app.type("test.2");
    expect(app.items()).toEqual(["px_test.2"]);
  });

  it("picks with the keyboard: down then Enter queries the highlighted entry", () => {
    const app = boot();
    app.type("px_test.");
    app.key("ArrowDown");
    app.key("ArrowDown");
    app.key("Enter");
    expect(app.query.value).toBe("px_test.2");
    expect(app.posted.at(-1)).toMatchObject({ type: "fetch", params: { root: "px_test.2" } });
  });

  it("queries a picked namespace as a namespace and a picked id as a root", () => {
    const app = boot();
    app.type("px_test");
    app.key("ArrowDown");
    app.key("Enter");
    expect(app.posted.at(-1)).toMatchObject({ type: "fetch", params: { namespace: "px_test" } });

    // The dotless on_action: the fallback heuristic would ask for a namespace.
    app.type("on_action");
    app.key("ArrowDown");
    app.key("Enter");
    expect(app.posted.at(-1)).toMatchObject({ type: "fetch", params: { root: "px_on_action_thing" } });
  });

  it("a typed known id is a root even without picking it from the list", () => {
    const app = boot();
    app.type("px_on_action_thing");
    app.key("Escape");
    app.key("Enter");
    expect(app.posted.at(-1)).toMatchObject({ type: "fetch", params: { root: "px_on_action_thing" } });
  });

  it("Escape closes the list and leaves the text alone", () => {
    const app = boot();
    app.type("px_");
    expect(app.items().length).toBeGreaterThan(0);
    app.key("Escape");
    expect(app.items()).toEqual([]);
    expect(app.query.value).toBe("px_");
  });
});
