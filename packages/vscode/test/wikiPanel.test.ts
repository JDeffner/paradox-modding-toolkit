import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import type { AppToHost, HostToApp } from "../src/webviews/wiki/messages";

interface Watcher {
  pattern: { base: string; pattern: string };
  dispose: ReturnType<typeof vi.fn>;
  change: () => void;
  create: () => void;
  delete: () => void;
}
const host = vi.hoisted(() => ({
  posted: [] as HostToApp[],
  watchers: [] as Watcher[],
  receive: (_message: AppToHost) => {},
  close: () => {},
  reveal: () => {},
}));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  return {
    ViewColumn: { Active: 1 },
    RelativePattern: class {
      constructor(
        public base: string,
        public pattern: string
      ) {}
    },
    workspace: {
      createFileSystemWatcher: (pattern: Watcher["pattern"]) => {
        const watcher: Watcher = { pattern, dispose: vi.fn(), change() {}, create() {}, delete() {} };
        host.watchers.push(watcher);
        return {
          dispose: watcher.dispose,
          onDidChange: (fn: () => void) => {
            watcher.change = fn;
            return disposable;
          },
          onDidCreate: (fn: () => void) => {
            watcher.create = fn;
            return disposable;
          },
          onDidDelete: (fn: () => void) => {
            watcher.delete = fn;
            return disposable;
          },
        };
      },
    },
    window: {
      createWebviewPanel: () => ({
        visible: true,
        reveal() {},
        dispose() {},
        onDidChangeViewState: (fn: () => void) => {
          host.reveal = fn;
          return disposable;
        },
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
      }),
    },
  };
});
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "wiki.js",
  watchBundle: () => ({ dispose() {} }),
}));
import { WikiPanel, type WikiDeps } from "../src/webviews/wiki/panel";

let scratch: string;
let gamePath: string;
const filename = () => path.join(gamePath, ck3Meta.launchOptionsFile!);
const write = (flag: string) => fs.writeFileSync(filename(), `# Fixture option\n${flag}\n`);
const deps = (): WikiDeps => ({ modReport: async () => "# Report", gamePath: () => gamePath });
const show = () =>
  WikiPanel.show({ asAbsolutePath: (p: string) => path.join(scratch, p) } as never, ck3Meta, deps());
function latest() {
  const message = host.posted.at(-1)!;
  if (message.type !== "content" && message.type !== "launchOptions") throw new Error("Expected articles");
  return message.articles.find((a) => a.id === "launch-options" && a.game === "ck3")!.markdown;
}
beforeEach(() => {
  host.posted = [];
  host.watchers = [];
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  scratch = fs.mkdtempSync(path.join(base, "wiki-tests-"));
  gamePath = path.join(scratch, "game");
  fs.mkdirSync(path.dirname(filename()), { recursive: true });
  write("-fixture_old");
});
afterEach(() => {
  host.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

it("loads all games on ready and replaces changed, deleted and recreated source content", () => {
  show();
  expect(host.posted).toHaveLength(0);
  host.receive({ type: "ready" });
  const initial = host.posted[0];
  expect(initial).toMatchObject({
    type: "content",
    hub: expect.arrayContaining([
      { label: "Launch Options", icon: "play", tip: expect.any(String), target: { page: "launch-options" } },
    ]),
  });
  if (initial.type !== "content") throw new Error("Expected content");
  expect(initial.articles.filter((a) => a.id === "launch-options").map((a) => a.game)).toEqual([
    "ck3",
    "vic3",
    "eu5",
  ]);
  expect(latest()).toContain("-fixture_old");
  const watcher = host.watchers.find((w) => path.join(w.pattern.base, w.pattern.pattern) === filename())!;
  write("-fixture_new");
  watcher.change();
  expect(latest()).toContain("-fixture_new");
  expect(latest()).not.toContain("-fixture_old");
  fs.unlinkSync(filename());
  watcher.delete();
  expect(latest()).toContain("missing");
  expect(latest()).not.toContain("-fixture_new");
  write("-fixture_recreated");
  watcher.create();
  expect(latest()).toContain("-fixture_recreated");
  host.close();
  expect(host.watchers.every((w) => w.dispose.mock.calls.length === 1)).toBe(true);
});

it("rereads on page refresh and reveal, and replaces watchers when resolved paths change", () => {
  show();
  host.receive({ type: "ready" });
  write("-fixture_page");
  host.receive({ type: "refreshLaunchOptions" });
  expect(latest()).toContain("-fixture_page");
  write("-fixture_reveal");
  host.reveal();
  expect(latest()).toContain("-fixture_reveal");
  const previous = [...host.watchers];
  gamePath = path.join(scratch, "other-game");
  fs.mkdirSync(path.dirname(filename()), { recursive: true });
  write("-fixture_new_path");
  WikiPanel.refresh();
  expect(latest()).toContain("-fixture_new_path");
  expect(previous.every((w) => w.dispose.mock.calls.length === 1)).toBe(true);
  expect(host.watchers.at(-1)!.pattern.base).toBe(path.dirname(filename()));
  const alternative = path.join(scratch, "replacement-deps");
  fs.mkdirSync(path.dirname(path.join(alternative, ck3Meta.launchOptionsFile!)), { recursive: true });
  fs.writeFileSync(path.join(alternative, ck3Meta.launchOptionsFile!), "-fixture_new_deps");
  WikiPanel.show({} as never, ck3Meta, { ...deps(), gamePath: () => alternative });
  expect(latest()).toContain("-fixture_new_deps");
});
