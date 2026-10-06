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
import { ExampleWikiPanel, type ExampleWikiActions } from "../src/webviews/exampleWiki/panel";

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
