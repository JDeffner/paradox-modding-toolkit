import { afterEach, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import type { ExampleWikiIndex } from "@px-lsp/protocol/protocol";
import type { AppToHost, HostToApp } from "../src/webviews/exampleWiki/messages";

const host = vi.hoisted(() => ({
  posted: [] as HostToApp[],
  receive: (_message: AppToHost) => {},
  close: () => {},
  panels: 0,
}));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  return {
    ViewColumn: { Active: 1 },
    window: {
      createWebviewPanel: () => {
        host.panels++;
        return {
          title: "",
          reveal() {},
          dispose() {},
          onDidDispose: (fn: () => void) => {
            host.close = fn;
            return disposable;
          },
          webview: {
            cspSource: "https://webview.test",
            postMessage: (message: HostToApp) => {
              host.posted.push(message);
              return Promise.resolve(true);
            },
            onDidReceiveMessage: (fn: typeof host.receive) => {
              host.receive = fn;
              return disposable;
            },
          },
        };
      },
    },
  };
});
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "exampleWiki.js",
  watchBundle: () => ({ dispose() {} }),
}));
import {
  ExampleWikiPanel,
  parseExampleWikiTarget,
  type ExampleWikiActions,
} from "../src/webviews/exampleWiki/panel";

const index = (name: string): ExampleWikiIndex => ({
  entries: [{ name, kind: "effect", shortDoc: name, count: 0 }],
  sources: [name],
  needsScriptDocs: false,
});
const actions = (gameId: string, fetchIndex: ExampleWikiActions["fetchIndex"]): ExampleWikiActions => ({
  gameId,
  gameName: gameId,
  shortName: gameId,
  contextKey: gameId,
  fetchIndex,
  fetchEntry: async () => null,
});
afterEach(() => {
  host.close();
  host.posted = [];
  host.panels = 0;
});

it("refreshes an already-open reference and discards old catalog and detail replies", async () => {
  let finishOld!: (value: ExampleWikiIndex) => void;
  ExampleWikiPanel.show(
    {} as never,
    actions(
      "ck3",
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
  );
  host.receive({ type: "refresh" });
  const newer = actions("vic3", async () => index("vic3-only"));
  let finishDetail!: (value: null) => void;
  newer.fetchEntry = () =>
    new Promise((resolve) => {
      finishDetail = resolve;
    });
  ExampleWikiPanel.show({} as never, newer);
  await vi.waitFor(() => expect(host.posted).toContainEqual({ type: "index", index: index("vic3-only") }));
  finishOld(index("ck3-only"));
  await Promise.resolve();
  expect(host.posted.filter((message) => message.type === "index")).toHaveLength(1);
  host.receive({ type: "select", name: "same-name", kind: "effect" });
  ExampleWikiPanel.show(
    {} as never,
    actions("eu5", async () => index("eu5-only"))
  );
  await vi.waitFor(() => expect(host.posted).toContainEqual({ type: "index", index: index("eu5-only") }));
  finishDetail(null);
  await Promise.resolve();
  expect(host.posted.some((message) => message.type === "entry")).toBe(false);
  expect(host.panels).toBe(1);
  expect(host.posted).toContainEqual({ type: "loading", reset: true, gameName: "eu5" });
  const sameGame = actions("eu5", async () => index("new-path-only"));
  sameGame.contextKey = "eu5-new-path";
  ExampleWikiPanel.show({} as never, sameGame);
  await vi.waitFor(() =>
    expect(host.posted).toContainEqual({ type: "index", index: index("new-path-only") })
  );
});

it("keeps a deep link until the app is ready after a game change", async () => {
  ExampleWikiPanel.show(
    {} as never,
    actions("ck3", async () => index("ck3-only"))
  );
  ExampleWikiPanel.show(
    {} as never,
    actions("vic3", async () => index("vic3-only")),
    { name: "vic3-only", kind: "effect" }
  );
  expect(host.posted).toEqual([]);
  host.receive({ type: "refresh" });
  await vi.waitFor(() =>
    expect(host.posted.at(-1)).toEqual({ type: "reveal", name: "vic3-only", kind: "effect" })
  );
});

it("validates query command arguments while preserving article callers", () => {
  expect(parseExampleWikiTarget({ query: " capital " })).toEqual({ query: "capital" });
  for (const arg of [{ query: " " }, { query: 12 }, { query: "x\n" }, { query: "x".repeat(2001) }, null]) {
    expect(parseExampleWikiTarget(arg)).toBeUndefined();
  }
  expect(parseExampleWikiTarget({ name: "is_alive", kind: "trigger" })).toEqual({
    name: "is_alive",
    kind: "trigger",
  });
});

it("sends a new search after the index and searches an already open catalog", async () => {
  const selected = actions("ck3", vi.fn().mockResolvedValue(index("fixture")));
  ExampleWikiPanel.show({} as never, selected, { query: "capital" });
  expect(host.posted).toEqual([]);
  host.receive({ type: "refresh" });
  await vi.waitFor(() => expect(host.posted.at(-1)).toEqual({ type: "search", query: "capital" }));
  expect(host.posted.map((m) => m.type)).toEqual(["loading", "index", "search"]);
  ExampleWikiPanel.show({} as never, selected, { query: "culture" });
  expect(selected.fetchIndex).toHaveBeenCalledTimes(1);
  expect(host.posted.at(-1)).toEqual({ type: "search", query: "culture" });
  ExampleWikiPanel.show({} as never, selected, { name: "is_alive", kind: "trigger" });
  expect(host.posted.at(-1)).toEqual({ type: "reveal", name: "is_alive", kind: "trigger" });
});

it("keeps the latest reused search through loading failures and retry", async () => {
  const selected = actions(
    "ck3",
    vi.fn().mockRejectedValueOnce(new Error("Index unavailable")).mockResolvedValue(index("fixture"))
  );
  ExampleWikiPanel.show({} as never, selected, { query: "old" });
  ExampleWikiPanel.show({} as never, selected, { query: "latest" });
  host.receive({ type: "refresh" });
  await vi.waitFor(() => expect(host.posted.at(-1)).toEqual({ type: "error", message: "Index unavailable" }));
  expect(host.posted.some((m) => m.type === "search")).toBe(false);
  host.receive({ type: "refresh" });
  await vi.waitFor(() => expect(host.posted.at(-1)).toEqual({ type: "search", query: "latest" }));
});

it("holds the latest search until a changed reference context finishes loading", async () => {
  const initial = actions("ck3", vi.fn().mockResolvedValue(index("initial")));
  ExampleWikiPanel.show({} as never, initial);
  host.receive({ type: "refresh" });
  await vi.waitFor(() => expect(host.posted.at(-1)?.type).toBe("index"));
  let finish!: (value: ExampleWikiIndex) => void;
  const next = actions(
    "ck3",
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
  );
  next.contextKey = "ck3-new-reference-path";
  ExampleWikiPanel.show({} as never, next, { query: "first" });
  ExampleWikiPanel.show({} as never, next, { query: "latest" });
  expect(host.posted.at(-1)).toEqual({ type: "loading", reset: true, gameName: "ck3" });
  expect(next.fetchIndex).toHaveBeenCalledTimes(1);
  finish(index("new-reference"));
  await vi.waitFor(() =>
    expect(host.posted.slice(-2)).toEqual([
      { type: "index", index: index("new-reference") },
      { type: "search", query: "latest" },
    ])
  );
  host.receive({ type: "refresh" });
  expect(next.fetchIndex).toHaveBeenLastCalledWith(true);
  finish(index("refreshed-reference"));
  await vi.waitFor(() =>
    expect(host.posted.at(-1)).toEqual({ type: "index", index: index("refreshed-reference") })
  );
});
