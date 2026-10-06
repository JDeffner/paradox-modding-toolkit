import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { initialWikiState } from "../src/webviews/wiki/navigation";
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
  execute: vi.fn(),
  error: vi.fn(),
  openExternal: vi.fn(),
  state: undefined as unknown,
  update: vi.fn(),
}));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  return {
    ViewColumn: { Active: 1 },
    Uri: { parse: (value: string) => URI.parse(value) },
    env: { openExternal: host.openExternal },
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
      showErrorMessage: host.error,
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
    commands: { executeCommand: host.execute },
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
const context = () => ({
  asAbsolutePath: (p: string) => path.join(scratch, p),
  workspaceState: { get: () => host.state, update: host.update },
});
const show = () => WikiPanel.show(context() as never, ck3Meta, deps());
function latest() {
  const message = host.posted.at(-1)!;
  if (message.type !== "content" && message.type !== "launchOptions") throw new Error("Expected articles");
  return message.articles.find((a) => a.id === "launch-options" && a.game === "ck3")!.markdown;
}
beforeEach(() => {
  host.posted = [];
  host.watchers = [];
  host.execute.mockReset();
  host.error.mockReset();
  host.state = undefined;
  host.update.mockReset().mockResolvedValue(undefined);
  host.openExternal.mockReset().mockResolvedValue(true);
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
      {
        label: "Launch Options",
        group: "Script reference",
        selectedGame: true,
        icon: "play",
        tip: expect.any(String),
        target: { page: "launch-options" },
      },
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

it("passes a selected game to Examples and rejects unknown game or command messages", async () => {
  show();
  host.receive({ type: "run", command: "px.showExamplesWiki", game: "vic3" });
  await vi.waitFor(() =>
    expect(host.execute).toHaveBeenCalledWith("px.showExamplesWiki", { gameId: "vic3" })
  );
  host.receive({ type: "run", command: "px.showExamplesWiki", game: "missing-game" });
  host.receive({ type: "run", command: "unrelated.command", game: "ck3" });
  expect(host.execute).toHaveBeenCalledTimes(1);
  expect(host.error).toHaveBeenCalledWith(expect.stringContaining("not supported"));
  host.receive({ type: "run", command: "px.showExamplesWiki" });
  expect(host.execute).toHaveBeenLastCalledWith("px.showExamplesWiki");
  host.receive({ type: "ready" });
  WikiPanel.refresh(vic3Meta);
  expect(host.posted).toContainEqual({
    type: "hub",
    game: "vic3",
    hub: expect.arrayContaining([expect.objectContaining({ label: "Vic3 Mod Report (workspace)" })]),
  });
});

it("attaches bundled revisions to owned articles without dating live sources or unsupported placeholders", () => {
  const date = "2026-01-02T03:04:05+00:00";
  const entries: [string, string, boolean][] = [
    ["image-guidelines", "packages/vscode/media/image-guidelines.md", true],
    ["steam-error-codes", "packages/vscode/media/steam-workshop-error-codes.md", false],
    ["steam-bbcode", "packages/vscode/media/steam-bbcode.md", false],
    ["credits", "packages/vscode/src/webviews/credits/credits.ts", false],
    ["modding-tools", "packages/vscode/src/webviews/wiki/moddingTools.ts", false],
    ["modding-guides", "packages/vscode/src/webviews/wiki/moddingGuides.ts", false],
    ["PX1001", "docs/diagnostics/PX1001.md", true],
  ];
  for (const [_, source] of entries) {
    if (!source.endsWith(".md")) continue;
    const packaged = source.startsWith("docs/")
      ? source.replace("docs/", "dist/")
      : source.replace("packages/vscode/", "");
    const file = path.join(scratch, packaged);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# Fixture article\n");
  }
  fs.writeFileSync(
    path.join(scratch, "dist/wiki-revisions.json"),
    JSON.stringify(
      Object.fromEntries(
        entries.map(([_, source, uncommitted]) => [source, { lastEdited: date, uncommitted }])
      )
    )
  );
  show();
  host.receive({ type: "ready" });
  const message = host.posted[0];
  if (message.type !== "content") throw new Error("Expected content");
  for (const [id, _, uncommitted] of entries) {
    const article = message.articles.find((a) => a.id === id && (!a.game || a.game === "ck3"));
    expect(article?.revision, id).toEqual({ lastEdited: date, uncommitted });
  }
  expect(message.articles.filter((a) => a.id === "launch-options").every((a) => !a.revision)).toBe(true);
  expect(
    message.articles.filter((a) => a.id === "image-guidelines" && a.game !== "ck3").every((a) => !a.revision)
  ).toBe(true);
});

it("loads owned articles with unavailable dates when metadata is missing or invalid", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    show();
    host.receive({ type: "ready" });
    let message = host.posted.at(-1)!;
    if (message.type !== "content") throw new Error("Expected content");
    expect(message.articles.find((a) => a.id === "credits")?.revision).toEqual({ uncommitted: false });
    expect(warning).not.toHaveBeenCalled();
    fs.mkdirSync(path.join(scratch, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(scratch, "dist/wiki-revisions.json"),
      JSON.stringify({
        "packages/vscode/src/webviews/credits/credits.ts": { lastEdited: "invalid", uncommitted: false },
      })
    );
    host.receive({ type: "ready" });
    message = host.posted.at(-1)!;
    if (message.type !== "content") throw new Error("Expected content");
    expect(message.articles.find((a) => a.id === "credits")?.revision).toEqual({ uncommitted: false });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("invalid revision"));
  } finally {
    warning.mockRestore();
  }
});

it("restores validated workspace history and saves state with honest storage failures", async () => {
  const state = initialWikiState("ck3");
  state.current.page = "credits";
  host.state = state;
  show();
  host.receive({ type: "ready" });
  expect(host.posted[0]).toMatchObject({ type: "content", state });
  host.receive({ type: "saveState", state });
  await vi.waitFor(() => expect(host.update).toHaveBeenCalledWith("px.wiki.readingState", state));
  host.receive({ type: "saveState", state: { version: 9 } as never });
  expect(host.update).toHaveBeenCalledTimes(1);
  host.update.mockRejectedValueOnce(new Error("Storage unavailable"));
  host.receive({ type: "saveState", state });
  await vi.waitFor(() =>
    expect(host.error).toHaveBeenCalledWith(expect.stringContaining("Storage unavailable"))
  );
});

it("retains explicit links before ready and updates the workspace game on reuse and refresh", () => {
  show();
  WikiPanel.show(context() as never, vic3Meta, deps(), "credits");
  host.receive({ type: "ready" });
  expect(host.posted[0]).toMatchObject({ type: "content", game: "vic3", select: "credits" });
  WikiPanel.refresh(ck3Meta);
  expect(host.posted).toContainEqual(expect.objectContaining({ type: "hub", game: "ck3" }));
  WikiPanel.show(context() as never, vic3Meta, deps());
  expect(host.posted).toContainEqual(expect.objectContaining({ type: "hub", game: "vic3" }));
});

it("opens the fixed contribution form and passes searches to the existing command", async () => {
  show();
  host.receive({ type: "contribute", game: "ck3", article: "credits" });
  await vi.waitFor(() => expect(host.openExternal).toHaveBeenCalledTimes(1));
  const url = new URL(host.openExternal.mock.calls[0][0].toString(true));
  expect(url.origin + url.pathname).toBe("https://github.com/JDeffner/paradox-modding-toolkit/issues/new");
  expect(url.searchParams.get("template")).toBe("wiki_content.yml");
  expect(url.searchParams.get("context")).toContain("Credits (credits)");
  host.receive({ type: "contribute", game: "ck3", article: "https://untrusted.test" });
  expect(host.openExternal).toHaveBeenCalledTimes(1);
  host.openExternal.mockResolvedValueOnce(false);
  host.receive({ type: "contribute", game: "vic3" });
  await vi.waitFor(() =>
    expect(host.error).toHaveBeenCalledWith(expect.stringContaining("browser did not open"))
  );
  host.openExternal.mockRejectedValueOnce(new Error("Unavailable"));
  host.receive({ type: "contribute", game: "eu5" });
  await vi.waitFor(() => expect(host.error).toHaveBeenCalledWith(expect.stringContaining("Unavailable")));
  host.receive({ type: "searchExamples", query: "capital", game: "vic3" });
  expect(host.execute).toHaveBeenCalledWith("px.showExamplesWiki", { query: "capital", gameId: "vic3" });
  host.receive({ type: "searchExamples", query: "capital", game: "unknown" });
  host.receive({ type: "searchExamples", query: "x\n", game: "vic3" });
  expect(host.execute).toHaveBeenCalledTimes(1);
});

it("discards a report that finishes after the workspace game changes", async () => {
  let resolve!: (value: string) => void;
  const report = new Promise<string>((done) => {
    resolve = done;
  });
  WikiPanel.show(context() as never, ck3Meta, { ...deps(), modReport: () => report });
  host.receive({ type: "ready" });
  host.receive({ type: "modReport" });
  WikiPanel.refresh(vic3Meta);
  resolve("# Old workspace report");
  await Promise.resolve();
  expect(host.posted).toContainEqual(expect.objectContaining({ type: "hub", game: "vic3" }));
  expect(host.posted.some((message) => message.type === "modReport")).toBe(false);
});

it("keeps the newer report when earlier builds finish last, including failure messages", async () => {
  let finishOld!: (value: string) => void;
  let finishNew!: (value: string) => void;
  let failLatest!: (reason: Error) => void;
  const old = new Promise<string>((resolve) => {
    finishOld = resolve;
  });
  const next = new Promise<string>((resolve) => {
    finishNew = resolve;
  });
  const latest = new Promise<string>((_resolve, reject) => {
    failLatest = reject;
  });
  const build = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(next).mockReturnValueOnce(latest);
  WikiPanel.show(context() as never, ck3Meta, { ...deps(), modReport: build });
  host.receive({ type: "ready" });
  host.receive({ type: "modReport" });
  WikiPanel.refresh(vic3Meta);
  host.receive({ type: "modReport" });
  finishNew("# New workspace report");
  await Promise.resolve();
  expect(host.posted.at(-1)).toEqual({ type: "modReport", markdown: "# New workspace report" });
  finishOld("# Old workspace report");
  await Promise.resolve();
  expect(host.posted.at(-1)).toEqual({ type: "modReport", markdown: "# New workspace report" });
  host.receive({ type: "modReport" });
  failLatest(new Error("Report unavailable"));
  await Promise.resolve();
  expect(host.posted.at(-1)).toEqual({
    type: "modReport",
    markdown: "# Mod Report\n\nThe report could not be built: Report unavailable",
  });
});
