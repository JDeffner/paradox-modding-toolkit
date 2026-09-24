import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type * as VSCode from "vscode";
import { URI } from "vscode-uri";
import type { Entry, Kind } from "../src/compatch/core";
import type { PxConfig } from "../src/config";

type Row =
  { root: "A" | "B" | "base" } | { group: Kind } | { entry: Entry } | { page: Kind; direction: number };
type CommandArgument = Row | { entryId: string; sessionId?: string };
interface Provider {
  getChildren(row?: Row): Row[];
  getTreeItem(row: Row): VSCode.TreeItem;
}
const ui = vi.hoisted(() => ({
  commands: new Map<string, (row?: CommandArgument) => Promise<void>>(),
  provider: undefined as Provider | undefined,
  content: undefined as VSCode.TextDocumentContentProvider | undefined,
  pick: vi.fn(),
  folders: vi.fn(),
  input: vi.fn(),
  error: vi.fn(),
  diff: vi.fn(),
  shown: vi.fn(),
  treeChanged: vi.fn(),
  executed: vi.fn(),
  progress: vi.fn(),
  info: vi.fn(),
  status: { text: "", tooltip: "", name: "", command: "", show: vi.fn(), hide: vi.fn(), dispose() {} },
  tree: { message: "", title: "", description: "", reveal: vi.fn(), dispose() {} },
  tab: undefined as { input: unknown } | undefined,
  documents: new Map<string, { text: string; version: number }>(),
  documentHandles: new Map<string, { isClosed: boolean }>(),
  onDocumentRead: undefined as ((file: string) => void) | undefined,
  documentChanged: undefined as ((event: { document: { uri: URI } }) => void) | undefined,
  editors: [] as {
    document: { uri: URI; isDirty?: boolean; getText?: () => string };
    setDecorations: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    Range: class {},
    RelativePattern: class {},
    WorkspaceEdit: class {
      edits: { uri: URI; text: string }[] = [];
      replace(uri: URI, _range: unknown, text: string) {
        this.edits.push({ uri, text });
      }
    },
    EventEmitter: class {
      event = () => disposable;
      fire() {
        ui.treeChanged();
      }
      dispose() {}
    },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    StatusBarAlignment: { Left: 1 },
    TabInputTextDiff: class {
      constructor(
        public original: URI,
        public modified: URI
      ) {}
    },
    TreeItem: class {
      constructor(public label: string) {}
    },
    TreeItemCollapsibleState: { Collapsed: 1 },
    ProgressLocation: { Notification: 15 },
    commands: {
      registerCommand: (name: string, callback: (row?: CommandArgument) => Promise<void>) => {
        ui.commands.set(name, callback);
        return disposable;
      },
      executeCommand: async (command: string, ...args: unknown[]) => {
        const result = ui.executed(command, ...args);
        if (command === "vscode.diff") ui.diff(...args);
        return result;
      },
    },
    workspace: {
      get textDocuments() {
        return ui.editors.map((editor) => editor.document);
      },
      registerTextDocumentContentProvider: (
        _scheme: string,
        provider: VSCode.TextDocumentContentProvider
      ) => {
        ui.content = provider;
        return disposable;
      },
      onDidCloseTextDocument: () => disposable,
      onDidChangeTextDocument: (listener: (event: { document: { uri: URI } }) => void) => {
        ui.documentChanged = listener;
        return disposable;
      },
      createFileSystemWatcher: () => ({
        ...disposable,
        onDidChange: () => disposable,
        onDidCreate: () => disposable,
        onDidDelete: () => disposable,
      }),
      openTextDocument: async (uri: URI) => {
        if (uri.scheme !== "file") return { uri };
        if (!ui.documents.has(uri.fsPath))
          ui.documents.set(uri.fsPath, { text: await fs.readFile(uri.fsPath, "utf8"), version: 1 });
        const state = ui.documents.get(uri.fsPath)!;
        const open = ui.editors.find((editor) => editor.document.uri.toString() === uri.toString())?.document;
        const document = {
          uri,
          encoding: "utf8",
          get version() {
            return state.version;
          },
          isClosed: false,
          get isDirty() {
            return open?.isDirty ?? false;
          },
          getText: () => {
            ui.onDocumentRead?.(uri.fsPath);
            return open?.getText?.() ?? state.text;
          },
          positionAt: (offset: number) => offset,
          save: async () => {
            await fs.writeFile(uri.fsPath, state.text);
            return true;
          },
        };
        ui.documentHandles.set(uri.fsPath, document);
        return document;
      },
      applyEdit: async (edit: { edits: { uri: URI; text: string }[] }) => {
        for (const change of edit.edits) {
          const state = ui.documents.get(change.uri.fsPath)!;
          state.text = change.text;
          state.version++;
        }
        return true;
      },
    },
    languages: { setTextDocumentLanguage: async () => {} },
    window: {
      get visibleTextEditors() {
        return ui.editors;
      },
      get activeTextEditor() {
        return ui.editors[0];
      },
      createStatusBarItem: () => ui.status,
      tabGroups: {
        activeTabGroup: {
          get activeTab() {
            return ui.tab;
          },
        },
        onDidChangeTabs: () => disposable,
      },
      onDidChangeVisibleTextEditors: () => disposable,
      onDidChangeActiveTextEditor: () => disposable,
      createTreeView: (_id: string, options: { treeDataProvider: Provider }) => {
        ui.provider = options.treeDataProvider;
        return ui.tree;
      },
      createOutputChannel: () => ({ ...disposable, appendLine() {}, clear() {}, show() {} }),
      showOpenDialog: ui.folders,
      showQuickPick: ui.pick,
      showInputBox: ui.input,
      showErrorMessage: ui.error,
      showInformationMessage: ui.info,
      showWarningMessage: async () => undefined,
      showTextDocument: ui.shown,
      withProgress: async (
        _options: unknown,
        run: (progress: { report(): void }, token: { isCancellationRequested: boolean }) => Promise<unknown>
      ) => {
        ui.progress();
        return run({ report() {} }, { isCancellationRequested: false });
      },
    },
  };
});

import { registerCompatch } from "../src/compatch/view";

let root: string;
let context: VSCode.ExtensionContext;
let cfg: PxConfig;
beforeEach(async () => {
  cfg = { gameId: "ck3", gamePath: null, locLanguage: "english" } as PxConfig;
  vi.resetAllMocks();
  ui.commands.clear();
  ui.documents.clear();
  ui.documentHandles.clear();
  ui.onDocumentRead = undefined;
  ui.editors = [];
  ui.tab = undefined;
  ui.tree.message = "";
  root = await fs.mkdtemp(path.join(os.tmpdir(), "px-compatch-ui-"));
  for (const folder of ["a/events", "b/events/override", "result", "storage"])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.writeFile(
    path.join(root, "a/events/original.txt"),
    "namespace = demo\ndemo.1 = { hidden = yes }\n"
  );
  await fs.writeFile(
    path.join(root, "b/events/override/other.txt"),
    "namespace = demo\ndemo.1 = { hidden = no }\n"
  );
  context = {
    subscriptions: [],
    storageUri: URI.file(path.join(root, "storage")),
  } as unknown as VSCode.ExtensionContext;
  registerCompatch(context, () => cfg);
});
afterEach(async () => {
  for (const disposable of context.subscriptions) disposable.dispose();
  expect(path.dirname(root)).toBe(os.tmpdir());
  expect(path.basename(root)).toMatch(/^px-compatch-ui-/);
  await fs.rm(root, { recursive: true, force: true });
});

const run = (command: string, row?: Row | { entryId: string; sessionId?: string }) =>
  ui.commands.get(command)!(row);

it("shows Compatch before scanning a saved session", async () => {
  await fs.writeFile(
    path.join(root, "storage/compatch.json"),
    JSON.stringify({
      version: 1,
      gameId: "ck3",
      localizationLanguage: "english",
      roots: { A: path.join(root, "a"), B: path.join(root, "b"), base: null },
      output: path.join(root, "result"),
      protectedRoots: [],
      reviews: {},
      results: {},
    })
  );
  ui.progress.mockImplementation(() => {
    expect(ui.executed).toHaveBeenCalledWith("px.compatch.focus");
  });
  await run("px.openCompatch");
  expect(ui.progress).toHaveBeenCalledOnce();
  expect(ui.error).not.toHaveBeenCalled();
});

it.each(["px.openCompatch", "px.newCompatch", "px.updateModForGame"])(
  "%s shows Compatch even when initial setup is cancelled",
  async (command) => {
    ui.pick.mockImplementationOnce(() => {
      expect(ui.executed).toHaveBeenCalledWith("px.compatch.focus");
      return undefined;
    });
    await run(command);
    expect(ui.pick).toHaveBeenCalledOnce();
    expect(ui.progress).not.toHaveBeenCalled();
    expect(ui.error).not.toHaveBeenCalled();
  }
);

it.skipIf(!process.env.PX_COMPATCH_LARGE_MOD)(
  "opens a large real mod against two game versions",
  async () => {
    const mod = process.env.PX_COMPATCH_LARGE_MOD!;
    const oldGame = process.env.PX_COMPATCH_OLD_GAME!;
    const newGame = process.env.PX_COMPATCH_NEW_GAME!;
    expect(oldGame).toBeTruthy();
    expect(newGame).toBeTruthy();
    cfg.gamePath = oldGame;
    await fs.writeFile(
      path.join(root, "storage/compatch.json"),
      JSON.stringify({
        version: 1,
        mode: "game-update",
        gameId: "ck3",
        localizationLanguage: "english",
        roots: { A: mod, base: oldGame, B: newGame },
        output: mod,
        protectedRoots: [oldGame, newGame],
        reviews: {},
        results: {},
      })
    );
    const started = performance.now();
    await run("px.openCompatch");
    expect(ui.error).not.toHaveBeenCalled();
    const scanMs = performance.now() - started;
    const page = ui.provider!.getChildren({ group: "file" });
    const rows = page.filter((row): row is { entry: Entry } => "entry" in row);
    expect(rows.length).toBe(200);
    const items = rows.map((row) => ui.provider!.getTreeItem(row));
    const bytes = Buffer.byteLength(JSON.stringify(items.map((item) => item.command)));
    expect(bytes).toBeLessThan(100_000);
    const largest = rows.reduce((a, b) => (JSON.stringify(a).length > JSON.stringify(b).length ? a : b));
    const click = performance.now();
    const command = ui.provider!.getTreeItem(largest).command!;
    await run(command.command, JSON.parse(JSON.stringify(command.arguments![0])));
    expect(ui.error).not.toHaveBeenCalled();
    expect(ui.diff).toHaveBeenCalled();
    console.log(
      JSON.stringify({
        scanMs,
        pageCommandBytes: bytes,
        clickMs: performance.now() - click,
        selected: largest.entry.name,
      })
    );
  },
  900_000
);
function choose(label: string) {
  ui.pick.mockImplementationOnce(async (items: { label: string }[]) =>
    items.find((item) => item.label === label)
  );
}
function eventRow(): Row {
  return ui.provider!.getChildren({ group: "event" })[0];
}
async function setup() {
  ui.pick.mockResolvedValueOnce("Compare two sources into a separate result");
  for (const folder of ["a", "b", "result"])
    ui.folders.mockResolvedValueOnce([URI.file(path.join(root, folder))]);
  choose("Browse for another folder…");
  choose("Browse for another folder…");
  ui.pick.mockResolvedValueOnce("Compare without a base");
  choose("Browse for another folder…");
  await run("px.openCompatch");
  expect(ui.error).not.toHaveBeenCalled();
}

it("opens a large tree row using a small command argument and rejects a stale session", async () => {
  const text = "# large source file\n".repeat(100_000);
  await fs.writeFile(path.join(root, "a/large.txt"), text);
  await fs.writeFile(path.join(root, "b/large.txt"), `${text}# new version\n`);
  await setup();
  const row = ui
    .provider!.getChildren({ group: "file" })
    .find((row) => "entry" in row && row.entry.name === "large.txt")!;
  const command = ui.provider!.getTreeItem(row).command!;
  expect(Buffer.byteLength(JSON.stringify(command))).toBeLessThan(500);
  const argument = JSON.parse(JSON.stringify(command.arguments![0]));
  ui.treeChanged.mockClear();
  await run(command.command, argument);
  expect(ui.treeChanged).not.toHaveBeenCalled();
  expect(ui.error).not.toHaveBeenCalled();
  const [left, right] = ui.diff.mock.lastCall! as [VSCode.Uri, VSCode.Uri];
  expect(await ui.content!.provideTextDocumentContent(left, {} as VSCode.CancellationToken)).toBe(text);
  expect(await ui.content!.provideTextDocumentContent(right, {} as VSCode.CancellationToken)).toBe(
    `${text}# new version\n`
  );
  await fs.writeFile(path.join(root, "b/large.txt"), `${text}# changed on disk\n`);
  await run(command.command, argument);
  expect(ui.treeChanged).toHaveBeenCalled();
  expect(
    await ui.content!.provideTextDocumentContent(ui.diff.mock.lastCall![1], {} as VSCode.CancellationToken)
  ).toBe(`${text}# changed on disk\n`);
  ui.diff.mockClear();
  await run(command.command, { ...argument, sessionId: "another-session" });
  expect(ui.diff).not.toHaveBeenCalled();
  expect(ui.error.mock.lastCall![0]).toContain("This comparison changed");
});

it("drives cross-file diff, editable result, persisted review, source update and reload through registered commands", async () => {
  await setup();
  const row = eventRow();
  await run("px.compareCompatch", row);
  const [left, right] = ui.diff.mock.lastCall! as [VSCode.Uri, VSCode.Uri];
  expect(left.scheme).toBe("px-compatch");
  expect(right.scheme).toBe("px-compatch");
  expect(await ui.content!.provideTextDocumentContent(left, {} as VSCode.CancellationToken)).toContain(
    "hidden = yes"
  );
  expect(await ui.content!.provideTextDocumentContent(right, {} as VSCode.CancellationToken)).toContain(
    "hidden = no"
  );

  choose("Create result from full Source: a file");
  await run("px.compatchActions", row);
  const result = path.join(root, "result/events/original.txt");
  expect(await fs.readFile(result, "utf8")).toContain("demo.1");
  choose("Compare B → result");
  await run("px.compatchActions", row);
  expect((ui.diff.mock.lastCall![1] as VSCode.Uri).scheme).toBe("file");

  choose("Mark reviewed");
  await run("px.compatchActions", row);
  expect(ui.provider!.getTreeItem(row).description).toBe("reviewed");
  await fs.writeFile(result, "my manual result");
  await fs.writeFile(
    path.join(root, "b/events/override/other.txt"),
    "namespace = demo\ndemo.1 = { hidden = yes immediate = { add_gold = 1 } }\n"
  );
  await run("px.refreshCompatch");
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("sources changed");
  expect(await fs.readFile(result, "utf8")).toBe("my manual result");
  choose("Compare last reviewed B → current B");
  await run("px.compatchActions", eventRow());
  const old = ui.diff.mock.lastCall![0] as VSCode.Uri;
  expect(await ui.content!.provideTextDocumentContent(old, {} as VSCode.CancellationToken)).toContain(
    "hidden = no"
  );

  for (const disposable of context.subscriptions) disposable.dispose();
  context.subscriptions.length = 0;
  registerCompatch(context, () => cfg);
  await run("px.openCompatch");
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("sources changed");
  expect(ui.error).not.toHaveBeenCalled();
});

it("does not start or persist a partial session when folder selection is cancelled", async () => {
  ui.pick.mockResolvedValueOnce("Update a mod for a new game version");
  choose("Browse for another folder…");
  ui.folders.mockResolvedValueOnce(undefined);
  await run("px.openCompatch");
  expect(ui.provider!.getChildren()).toEqual([]);
  expect(await fs.readdir(path.join(root, "storage"))).toEqual([]);
  expect(ui.error).not.toHaveBeenCalled();
});

async function setupUpdate() {
  cfg.modPath = path.join(root, "a");
  await fs.mkdir(path.join(root, "base/events"), { recursive: true });
  await fs.mkdir(path.join(root, "a/.px-toolkit"));
  await fs.writeFile(
    path.join(root, "a/.px-toolkit/compatch.json"),
    JSON.stringify({ version: 1, vanilla: "../base", newGame: "../b" })
  );
  for (const [folder, gold] of [
    ["base", 1],
    ["a", 1],
    ["b", 2],
  ] as const)
    await fs.writeFile(
      path.join(root, folder, "events/original.txt"),
      `\uFEFFnamespace = demo\ndemo.1 = { hidden = yes immediate = { add_gold = ${gold} } }\n`
    );
  await fs.unlink(path.join(root, "b/events/override/other.txt"));
  execFileSync("git", ["init", "-q", path.join(root, "a")]);
  execFileSync("git", ["-C", path.join(root, "a"), "-c", "core.autocrlf=false", "add", "."]);
  await run("px.openCompatch");
  expect(ui.error).not.toHaveBeenCalled();
}

async function expectSnapshotDiff(leftText: string, rightText: string) {
  const [left, right, title] = ui.diff.mock.lastCall! as [VSCode.Uri, VSCode.Uri, string];
  expect(left.scheme).toBe("px-compatch");
  expect(right.scheme).toBe("px-compatch");
  expect(await ui.content!.provideTextDocumentContent(left, {} as VSCode.CancellationToken)).toContain(
    leftText
  );
  expect(await ui.content!.provideTextDocumentContent(right, {} as VSCode.CancellationToken)).toContain(
    rightText
  );
  return { left, right, title };
}

it.each(["px.compareCompatch", "px.compatchOpen", "px.compatchNext"])(
  "%s defaults to read-only old-game and new-game snapshots",
  async (command) => {
    await setupUpdate();
    const row = eventRow();
    await run(command, command === "px.compatchNext" ? undefined : row);
    const { title } = await expectSnapshotDiff("add_gold = 1", "add_gold = 2");
    expect(title).toContain("Old Game Version");
    expect(title).toContain("New Game Version");
  }
);

it.each([false, true])(
  "keeps %s replacement mod references read-only before and after intent changes",
  async (protectedReference) => {
    await setupUpdate();
    const row = ui.provider!.getChildren({ group: "file" })[0];
    await run("px.compatchModChanges", row);
    const opened = await expectSnapshotDiff("add_gold = 1", "add_gold = 1");

    if (protectedReference) {
      choose("Keep this file as an intentional replacement");
      await run("px.compatchReplacement", row);
      expect(opened.right.scheme).toBe("px-compatch");
      expect(
        await ui.content!.provideTextDocumentContent(opened.right, {} as VSCode.CancellationToken)
      ).toContain("add_gold = 1");
      ui.diff.mockClear();
      await run("px.compatchModChanges", row);
      await expectSnapshotDiff("add_gold = 1", "add_gold = 1");
    }

    ui.diff.mockClear();
    choose("New Game Version \u2194 Mod (reference)");
    await run("px.compatchActions", row);
    await expectSnapshotDiff("add_gold = 2", "add_gold = 1");
  }
);

it("uses unsaved mod text in reference snapshots without saving it", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  const mod = path.join(root, "a/events/original.txt");
  const saved = await fs.readFile(mod, "utf8");
  const unsaved = saved.replace("add_gold = 1", "add_gold = 99");
  const uri = URI.file(mod);
  ui.documents.set(uri.fsPath, { text: unsaved, version: 2 });
  ui.editors = [{ document: { uri, isDirty: true, getText: () => unsaved }, setDecorations: vi.fn() }];

  await run("px.compatchModChanges", row);

  const { title } = await expectSnapshotDiff("add_gold = 1", "add_gold = 99");
  expect(title.toLowerCase()).toContain("unsaved edits");
  expect(await fs.readFile(mod, "utf8")).toBe(saved);
});

it("opens the mod alone for editing only through the explicit action", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  ui.diff.mockClear();
  choose("Open mod file");

  await run("px.compatchActions", row);

  expect(ui.diff).not.toHaveBeenCalled();
  expect((ui.shown.mock.lastCall![0] as VSCode.Uri).fsPath).toBe(
    URI.file(path.join(root, "a/events/original.txt")).fsPath
  );
});

it("marks replacements through row actions, persists intent and blocks file and definition merges", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  const definition = eventRow();
  const mod = path.join(root, "a/events/original.txt");
  const before = await fs.readFile(mod, "utf8");
  choose("Set replacement intent");
  choose("Keep this file as an intentional replacement");
  await run("px.compatchActions", row);
  expect(ui.error).not.toHaveBeenCalled();
  expect(ui.provider!.getTreeItem(row).description).toBe("Intentional replacement");
  expect(ui.provider!.getTreeItem(row).contextValue).not.toContain(".merge");
  expect(ui.tree.message).toContain("0 pending");
  expect(ui.tree.message).toContain("1 intentional replacements");
  expect(ui.tree.message).toContain("Target validation has not run");
  await run("px.compatchApplyMerge", row);
  expect(ui.error.mock.lastCall![0]).toContain("Intentional replacement");
  await run("px.compatchPreviewMerge", definition);
  expect(ui.error.mock.lastCall![0]).toContain("Intentional replacement");
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  await run("px.compatchNext");
  expect(ui.tree.message).toContain("No unreviewed entries");
  choose("Pending");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(0);
  choose("Intentional replacements");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(1);
  const saved = JSON.parse(await fs.readFile(path.join(root, "storage/compatch.json"), "utf8"));
  expect(saved.sessions[0].reviews).toEqual({});
  expect(saved.sessions[0].validation).toBeUndefined();
  for (const disposable of context.subscriptions) disposable.dispose();
  registerCompatch(context, () => cfg);
  await run("px.openCompatch");
  expect(ui.provider!.getTreeItem(ui.provider!.getChildren({ group: "file" })[0]).description).toBe(
    "Intentional replacement"
  );
  choose("Remove replacement rule: events/original.txt");
  await run("px.compatchReplacement", row);
  choose("Pending");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(1);
});

it("retains folder intent across new files and unsaved edits without changing validation evidence", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  choose("Keep all mod files in events/ as intentional replacements");
  await run("px.compatchReplacement", row);
  await fs.writeFile(path.join(root, "a/events/new.txt"), "# empty override\n");
  await run("px.refreshCompatch");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(2);
  const uri = URI.file(path.join(root, "a/events/original.txt"));
  ui.editors = [{ document: { uri, isDirty: true }, setDecorations: vi.fn() }];
  ui.documentChanged!({ document: { uri } });
  expect(ui.provider!.getTreeItem(row).description).toBe("Intentional replacement (unsaved edits)");
  expect(ui.tree.message).toContain("0 pending");
  expect(ui.tree.message).toContain("Target validation has not run");
  choose("Remove replacement rule: events/");
  await run("px.compatchReplacement", row);
  expect(ui.provider!.getTreeItem(row).description).toBe("Unsaved source edits");
});

it("rejects an earlier editable merge result after replacement intent changes", async () => {
  const { mod, before, result } = await resolution();
  ui.documents.set(result.fsPath, { text: before, version: 2 });
  const row = ui.provider!.getChildren({ group: "file" })[0];
  choose("Keep this file as an intentional replacement");
  await run("px.compatchReplacement", row);
  await fs.rename(path.join(root, "a/.git"), path.join(root, "a/.git-saved"));
  await run("px.compatchApplyResolved");
  expect(ui.error.mock.lastCall![0]).toContain("Intentional replacement");
  expect(ui.info).not.toHaveBeenCalled();
  expect(await fs.readFile(mod, "utf8")).toBe(before);
});

it("leaves replacement intent unchanged when its picker is cancelled", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  const saved = await fs.readFile(path.join(root, "storage/compatch.json"), "utf8");
  await run("px.compatchReplacement", row);
  expect(await fs.readFile(path.join(root, "storage/compatch.json"), "utf8")).toBe(saved);
  expect(ui.provider!.getTreeItem(row).description).toBe("Game changes only");
});

it("protects saved previews when the mod root is a junction to its resolved editor path", async () => {
  await setupUpdate();
  const alias = path.join(root, "mod-alias");
  await fs.symlink(path.join(root, "a"), alias, "junction");
  const storePath = path.join(root, "storage/compatch.json");
  const store = JSON.parse(await fs.readFile(storePath, "utf8"));
  store.sessions[0].roots.A = alias;
  store.sessions[0].output = alias;
  await fs.writeFile(storePath, JSON.stringify(store));
  for (const disposable of context.subscriptions) disposable.dispose();
  registerCompatch(context, () => cfg);
  await run("px.openCompatch");
  const row = ui.provider!.getChildren({ group: "file" })[0];
  await run("px.compatchPreviewMerge", row);
  const [left, result] = ui.diff.mock.lastCall! as [VSCode.Uri, VSCode.Uri];
  const { TabInputTextDiff } = await import("vscode");
  ui.tab = { input: new TabInputTextDiff(left, result) };
  choose("Keep this file as an intentional replacement");
  await run("px.compatchReplacement", row);
  await run("px.compatchApplyResolved");
  expect(ui.error.mock.lastCall![0]).toContain("Intentional replacement");
  expect(ui.info).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(root, "a/events/original.txt"), "utf8")).toContain("add_gold = 1");
});

it("reports persistence failures without claiming replacement protection was saved", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  await fs.mkdir(path.join(root, "storage/compatch.json.tmp"));
  choose("Keep this file as an intentional replacement");
  await run("px.compatchReplacement", row);
  expect(ui.error).toHaveBeenCalled();
  expect(ui.provider!.getTreeItem(row).description).toBe("Game changes only");
  const saved = JSON.parse(await fs.readFile(path.join(root, "storage/compatch.json"), "utf8"));
  expect(saved.sessions[0].intentionalReplacements).toBeUndefined();
});

it("validates the whole mod with replacement rules active and preserves the resulting findings", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  choose("Keep this file as an intentional replacement");
  await run("px.compatchReplacement", row);
  ui.executed.mockImplementation((command: string) =>
    command === "px.validateCompatchTarget"
      ? {
          checkedAt: "test",
          gamePath: path.join(root, "b"),
          errors: 1,
          warnings: 2,
          other: 0,
        }
      : undefined
  );
  await run("px.compatchValidate");
  expect(ui.executed).toHaveBeenCalledWith("px.validateCompatchTarget", {
    gameId: "ck3",
    modPath: path.join(root, "a"),
    gamePath: path.join(root, "b"),
  });
  expect(ui.tree.message).toContain("Target validation: 1 errors, 2 warnings, 0 other findings");
  expect(ui.provider!.getTreeItem(row).description).toBe("Intentional replacement");
  choose("Remove replacement rule: events/original.txt");
  await run("px.compatchReplacement", row);
  expect(ui.tree.message).toContain("Target validation: 1 errors, 2 warnings, 0 other findings");
  ui.documentChanged!({ document: { uri: URI.file(path.join(root, "a/events/original.txt")) } });
  expect(ui.tree.message).toContain("Target validation (outdated)");
});

it("protects localization keys inside intentional file replacements", async () => {
  await setupUpdate();
  const relative = "localization/english/bookmarks_l_english.yml";
  for (const [folder, value] of [
    ["a", "Mod"],
    ["base", "Old"],
    ["b", "New"],
  ]) {
    await fs.mkdir(path.dirname(path.join(root, folder, relative)), { recursive: true });
    await fs.writeFile(path.join(root, folder, relative), `\uFEFFl_english:\n bookmark_name:0 "${value}"\n`);
  }
  await run("px.refreshCompatch");
  const row = ui
    .provider!.getChildren({ group: "file" })
    .find((row) => "entry" in row && row.entry.name === relative)!;
  const key = ui.provider!.getChildren({ group: "localization" })[0];
  const before = await fs.readFile(path.join(root, "a", relative));
  choose("Keep this file as an intentional replacement");
  await run("px.compatchReplacement", row);
  await run("px.compatchApplyKey", key);
  expect(ui.error.mock.lastCall![0]).toContain("Intentional replacement");
  expect(ui.provider!.getTreeItem(key).contextValue).not.toContain(".key");
  expect(await fs.readFile(path.join(root, "a", relative))).toEqual(before);
});

it("opens a project preset without folder dialogs and compares the old and new game snapshots", async () => {
  await setupUpdate();
  expect(ui.pick).not.toHaveBeenCalled();
  expect(ui.folders).not.toHaveBeenCalled();
  expect(
    ui
      .provider!.getChildren()
      .slice(0, 3)
      .map((row) => ui.provider!.getTreeItem(row).label)
  ).toEqual(["Mod", "Old Game Version", "New Game Version"]);
  await run("px.compareCompatch", eventRow());
  const [left, right, title] = ui.diff.mock.lastCall!;
  expect(left.scheme).toBe("px-compatch");
  expect(right.scheme).toBe("px-compatch");
  expect(title).toContain("Old Game Version");
  expect(title).toContain("New Game Version");
  expect(ui.content!.provideTextDocumentContent(left, {} as VSCode.CancellationToken)).toContain(
    "add_gold = 1"
  );
  expect(ui.content!.provideTextDocumentContent(right, {} as VSCode.CancellationToken)).toContain(
    "add_gold = 2"
  );
  choose("events/original.txt");
  await run("px.compatchFiles", { root: "A" });
  expect(ui.shown.mock.lastCall![0].fsPath).toBe(URI.file(path.join(root, "a/events/original.txt")).fsPath);
});

it("previews without writes, applies a clean update to the original mod, and leaves both game sources unchanged", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  const mod = path.join(root, "a/events/original.txt");
  const old = await fs.readFile(mod, "utf8");
  await run("px.compatchPreviewMerge", row);
  expect(await fs.readFile(mod, "utf8")).toBe(old);
  await run("px.compatchApplyMerge", row);
  expect(await fs.readFile(mod, "utf8")).toContain("add_gold = 2");
  expect((await fs.readFile(mod))[0]).toBe(0xef);
  expect(await fs.readFile(path.join(root, "base/events/original.txt"), "utf8")).toBe(old);
  expect(ui.provider!.getTreeItem(ui.provider!.getChildren({ group: "file" })[0]).description).toBe(
    "reviewed"
  );
  expect(ui.error).not.toHaveBeenCalled();
});

it("keeps unsaved conflicting mod edits and shows a proposal instead of writing conflict markers", async () => {
  await setupUpdate();
  const mod = path.join(root, "a/events/original.txt");
  const before = await fs.readFile(mod, "utf8");
  ui.documents.set(URI.file(mod).fsPath, {
    text: before.replace("add_gold = 1", "add_gold = 99"),
    version: 2,
  });
  await run("px.compatchApplyMerge", ui.provider!.getChildren({ group: "file" })[0]);
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  expect(ui.documents.get(URI.file(mod).fsPath)!.text).toContain("add_gold = 99");
  expect(ui.diff.mock.lastCall![2]).toContain("Conflicts");
  expect(ui.error).not.toHaveBeenCalled();
});

it("refuses a merge when the game source changed since scanning", async () => {
  await setupUpdate();
  const mod = path.join(root, "a/events/original.txt");
  const before = await fs.readFile(mod, "utf8");
  await fs.appendFile(path.join(root, "b/events/original.txt"), "# newer patch\n");
  await run("px.compatchApplyMerge", ui.provider!.getChildren({ group: "file" })[0]);
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  expect(ui.error.mock.lastCall![0]).toContain("Source files changed");
});

it("records reviewed manual work and reopens it when sources change", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  choose("Mark reviewed");
  await run("px.compatchActions", row);
  expect(ui.provider!.getTreeItem(row).description).toBe("reviewed");
  await fs.appendFile(path.join(root, "b/events/original.txt"), "# newer patch\n");
  await run("px.refreshCompatch");
  expect(ui.provider!.getTreeItem(ui.provider!.getChildren({ group: "file" })[0]).description).toBe(
    "sources changed"
  );
});

it("keeps source roles in native status chrome and exposes actions without changing file text", async () => {
  await setupUpdate();
  const mod = path.join(root, "a/events/original.txt");
  const before = await fs.readFile(mod, "utf8");
  ui.editors = ["a", "base", "b"].map((folder) => ({
    document: { uri: URI.file(path.join(root, folder, "events/original.txt")) },
    setDecorations: vi.fn(),
  }));
  await run("px.refreshCompatch");
  expect(ui.status.text).toBe("$(git-compare) Mod (editable)");
  const { TabInputTextDiff } = await import("vscode");
  ui.tab = { input: new TabInputTextDiff(ui.editors[2].document.uri, ui.editors[0].document.uri) };
  await run("px.refreshCompatch");
  expect(ui.status.text).toContain("New Game Version (left)");
  expect(ui.status.text).toContain("Mod (right, editable)");
  choose("Skip for now");
  await run("px.compatchEditorActions");
  const row = ui.provider!.getChildren({ group: "file" })[0];
  expect(ui.provider!.getTreeItem(row).description).toBe("skipped");
  choose("Reopen review");
  await run("px.compatchEditorActions");
  expect(ui.provider!.getTreeItem(row).description).toBe("Game changes only");
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  ui.editors[0].document.isDirty = true;
  choose("Mark reviewed");
  await run("px.compatchEditorActions");
  expect(ui.error.mock.lastCall![0]).toContain("Save your mod edits");
});

it("pages large lists and resets the page when a filter narrows the results", async () => {
  await fs.writeFile(
    path.join(root, "a/events/many.txt"),
    "namespace = many\n" + Array.from({ length: 250 }, (_, i) => `many.${i} = { hidden = yes }`).join("\n")
  );
  await setup();
  const first = ui.provider!.getChildren({ group: "event" });
  expect(first.filter((row) => "entry" in row)).toHaveLength(200);
  const next = first.find((row) => "page" in row)!;
  await run("px.compatchPage", next);
  expect(ui.provider!.getChildren({ group: "event" }).filter((row) => "entry" in row)).toHaveLength(51);
  ui.input.mockResolvedValueOnce("demo.1");
  await run("px.filterCompatch");
  const filtered = ui.provider!.getChildren({ group: "event" });
  expect(filtered).toHaveLength(1);
  expect("entry" in filtered[0] && filtered[0].entry.name).toBe("demo.1");
  expect(ui.error).not.toHaveBeenCalled();
});

it("creates routed localization results and preserves an existing edited result", async () => {
  cfg.gamePath = path.join(root, "game");
  for (const directory of ["game/localization/english", "a/localization/replace"])
    await fs.mkdir(path.join(root, directory), { recursive: true });
  await fs.writeFile(
    path.join(root, "game/localization/english/base_l_english.yml"),
    'l_english:\n existing:0 "Vanilla"\n'
  );
  await fs.writeFile(
    path.join(root, "a/localization/replace/mod_l_english.yml"),
    'l_english:\n existing:0 "Modified"\n new_key:0 "New"\n'
  );
  await setup();
  const rows = ui.provider!.getChildren({ group: "localization" });
  for (const row of rows) {
    choose("Apply this key from Source: a");
    await run("px.compatchActions", row);
  }
  const replacement = path.join(
    root,
    "result/localization/replace/english/zzz_ck3_modding_edits_l_english.yml"
  );
  const ordinary = path.join(root, "result/localization/english/result_l_english.yml");
  expect(await fs.readFile(replacement, "utf8")).toContain('existing:0 "Modified"');
  expect(await fs.readFile(ordinary, "utf8")).toContain('new_key:0 "New"');
  await fs.writeFile(replacement, "manual localization");
  choose("Apply this key from Source: a");
  await run("px.compatchActions", rows[0]);
  expect(await fs.readFile(replacement, "utf8")).toBe("manual localization");
  expect(ui.error.mock.lastCall![0]).toContain("header or parse errors");
});

it("uses direct review commands, keeps completed history, and reopens the selected file and its definitions", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  await run("px.compatchSkip", row);
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("skipped");
  await run("px.compatchReopen", row);
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("Game changes only");
  await run("px.compatchApplyMerge", row);
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("reviewed");
  await run("px.compatchReopen", ui.provider!.getChildren({ group: "file" })[0]);
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(1);
  expect(ui.error).not.toHaveBeenCalled();
});

it("reuses unchanged comparison tabs and visibly invalidates source edits", async () => {
  await setupUpdate();
  const row = eventRow();
  await run("px.compareCompatch", row);
  const first = ui.diff.mock.lastCall![0].toString();
  await run("px.compareCompatch", row);
  expect(ui.diff.mock.lastCall![0].toString()).toBe(first);
  const source = path.join(root, "b/events/original.txt");
  await fs.appendFile(source, "# change after scan\n");
  ui.documentChanged!({ document: { uri: URI.file(source) } });
  expect(ui.provider!.getTreeItem(row).description).toBe("Sources Changed");
  await run("px.compatchMarkReviewed", row);
  expect(ui.error.mock.lastCall![0]).toContain("Source files changed");
  await run("px.compatchMarkReviewed", eventRow());
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("reviewed");
});

it("does not write to an untracked mod when no HEAD or staged baseline exists", async () => {
  await setupUpdate();
  execFileSync("git", ["-C", path.join(root, "a"), "rm", "--cached", "events/original.txt"]);
  const mod = path.join(root, "a/events/original.txt");
  const before = await fs.readFile(mod, "utf8");
  await run("px.compatchApplyMerge", ui.provider!.getChildren({ group: "file" })[0]);
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  expect(ui.info.mock.lastCall![0]).toContain("saved Git baseline");
});

async function resolution() {
  await setupUpdate();
  const mod = path.join(root, "a/events/original.txt");
  const before = await fs.readFile(mod, "utf8");
  await fs.writeFile(mod, before.replace("add_gold = 1", "add_gold = 99"));
  await run("px.refreshCompatch");
  await run("px.compatchPreviewMerge", ui.provider!.getChildren({ group: "file" })[0]);
  const [left, result] = ui.diff.mock.lastCall! as [VSCode.Uri, VSCode.Uri];
  const { TabInputTextDiff } = await import("vscode");
  ui.tab = { input: new TabInputTextDiff(left, result) };
  return { mod, before: await fs.readFile(mod, "utf8"), result };
}

it("applies an explicitly resolved temporary result and refuses unresolved markers", async () => {
  const { mod, before, result } = await resolution();
  expect(result.scheme).toBe("file");
  expect(result.fsPath).not.toBe(URI.file(mod).fsPath);
  expect(await fs.readFile(result.fsPath, "utf8")).toContain("<<<<<<<");
  await run("px.compatchApplyResolved");
  expect(ui.error.mock.lastCall![0]).toContain("Resolve every conflict marker");
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  ui.documents.set(result.fsPath, { text: before.replace("add_gold = 99", "add_gold = 100"), version: 2 });
  await run("px.compatchApplyResolved");
  expect(await fs.readFile(mod, "utf8")).toContain("add_gold = 100");
  expect((await fs.readFile(mod))[0]).toBe(0xef);
  expect(ui.provider!.getTreeItem(ui.provider!.getChildren({ group: "file" })[0]).description).toBe(
    "reviewed"
  );
});

it("rejects a resolved result if any game input changed after its preview", async () => {
  const { mod, before, result } = await resolution();
  ui.documents.set(result.fsPath, { text: before, version: 2 });
  await fs.appendFile(path.join(root, "base/events/original.txt"), "# changed base\n");
  await run("px.compatchApplyResolved");
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  expect(ui.error.mock.lastCall![0]).toContain("Source files changed");
});

it("rejects a resolved result when the mod editor changed and preserves those edits", async () => {
  const { mod, before, result } = await resolution();
  ui.documents.set(result.fsPath, { text: before, version: 2 });
  const modState = ui.documents.get(URI.file(mod).fsPath)!;
  modState.text += "# unsaved edit\n";
  modState.version++;
  await run("px.compatchApplyResolved");
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  expect(modState.text).toContain("# unsaved edit");
  expect(ui.error.mock.lastCall![0]).toContain("unsaved or changed edits");
});

it("resumes independent update and comparison sessions with their own filters and reviews", async () => {
  await setupUpdate();
  await run("px.compatchSkip", eventRow());
  ui.input.mockResolvedValueOnce("demo.1");
  await run("px.filterCompatch");
  ui.pick.mockResolvedValueOnce("Compare without a base");
  choose("Browse for another folder…");
  ui.folders.mockResolvedValueOnce([URI.file(path.join(root, "result"))]);
  ui.input.mockResolvedValueOnce("Second comparison");
  await ui.commands.get("px.newCompatch")!({
    sourceA: path.join(root, "a"),
    sourceB: path.join(root, "b"),
  } as never);
  expect(ui.error).not.toHaveBeenCalled();
  const saved = JSON.parse(await fs.readFile(path.join(root, "storage/compatch.json"), "utf8"));
  expect(saved.sessions).toHaveLength(2);
  expect(saved.sessions[0].navigation.filter).toBe("demo.1");
  await run("px.compatchMarkReviewed", eventRow());
  for (const disposable of context.subscriptions) disposable.dispose();
  context.subscriptions.length = 0;
  registerCompatch(context, () => cfg);
  await run("px.openCompatch");
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("reviewed");
  ui.pick.mockImplementationOnce(async (items: { session: { mode?: string } }[]) =>
    items.find((item) => item.session.mode === "game-update")
  );
  await run("px.compatchSessions");
  expect(ui.provider!.getChildren({ group: "event" })).toHaveLength(1);
  expect(ui.provider!.getTreeItem(eventRow()).description).toBe("skipped");
});

it("adds a second localization key to the same sibling file without changing the first edited value", async () => {
  cfg.gamePath = path.join(root, "game");
  await fs.mkdir(path.join(root, "game/localization"), { recursive: true });
  await fs.mkdir(path.join(root, "a/localization/english"), { recursive: true });
  await fs.writeFile(
    path.join(root, "a/localization/english/mod_l_english.yml"),
    'l_english:\n demo_first:0 "First"\n demo_second:0 "Second"\n'
  );
  await setup();
  const rows = ui.provider!.getChildren({ group: "localization" });
  choose("Apply this key from Source: a");
  await run("px.compatchActions", rows[0]);
  const destination = path.join(root, "result/localization/english/result_l_english.yml");
  const first = (await fs.readFile(destination, "utf8")).replace('"First"', '"Manually edited"');
  await fs.writeFile(destination, first);
  ui.documents.delete(URI.file(destination).fsPath);
  choose("Apply this key from Source: a");
  await run("px.compatchActions", rows[1]);
  const text = await fs.readFile(destination, "utf8");
  expect(text).toContain('demo_first:0 "Manually edited"');
  expect(text).toContain('demo_second:0 "Second"');
  expect(text.startsWith("\uFEFFl_english:")).toBe(true);
  expect(ui.error).not.toHaveBeenCalled();
});

it("moves a watched reviewed row back to Pending before a rescan", async () => {
  await setupUpdate();
  const row = ui.provider!.getChildren({ group: "file" })[0];
  await run("px.compatchMarkReviewed", row);
  const source = path.join(root, "b/events/original.txt");
  await fs.appendFile(source, "# external change\n");
  ui.documentChanged!({ document: { uri: URI.file(source) } });
  choose("Reviewed");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(0);
  choose("Pending");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(1);
  expect(ui.provider!.getTreeItem(row).description).toBe("Sources Changed");
});

it("marks a saved validation result outdated when resuming its session", async () => {
  await setupUpdate();
  const file = path.join(root, "storage/compatch.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  saved.sessions[0].validation = {
    at: "2026-01-01",
    gamePath: path.join(root, "b"),
    summary: "0 errors",
    stale: false,
  };
  await fs.writeFile(file, JSON.stringify(saved));
  for (const disposable of context.subscriptions) disposable.dispose();
  context.subscriptions.length = 0;
  registerCompatch(context, () => cfg);
  await run("px.openCompatch");
  const resumed = JSON.parse(await fs.readFile(file, "utf8"));
  expect(resumed.sessions[0].validation.stale).toBe(true);
});

it("keeps unsaved reviewed files pending after a full rescan of unchanged saved sources", async () => {
  await setupUpdate();
  await run("px.compatchMarkReviewed", ui.provider!.getChildren({ group: "file" })[0]);
  const source = URI.file(path.join(root, "a/events/original.txt"));
  const before = await fs.readFile(source.fsPath, "utf8");
  ui.editors = [{ document: { uri: source, isDirty: true }, setDecorations: vi.fn() }];
  ui.documentChanged!({ document: { uri: source } });
  await run("px.refreshCompatch");
  const row = ui.provider!.getChildren({ group: "file" })[0];
  expect(ui.provider!.getTreeItem(row).description).toBe("Unsaved source edits");
  choose("Reviewed");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(0);
  choose("Pending");
  await run("px.compatchQueue");
  expect(ui.provider!.getChildren({ group: "file" })).toHaveLength(1);
  expect(await fs.readFile(source.fsPath, "utf8")).toBe(before);
  expect(ui.editors[0].document.isDirty).toBe(true);
  expect(ui.error).not.toHaveBeenCalled();
});

it("refuses key publication while a source has unsaved localization edits", async () => {
  cfg.gamePath = path.join(root, "game");
  await fs.mkdir(path.join(root, "game/localization"), { recursive: true });
  await fs.mkdir(path.join(root, "a/localization/english"), { recursive: true });
  const source = path.join(root, "a/localization/english/mod_l_english.yml");
  await fs.writeFile(source, 'l_english:\n demo_key:0 "Saved"\n');
  await setup();
  ui.editors = [{ document: { uri: URI.file(source), isDirty: true }, setDecorations: vi.fn() }];
  const row = ui.provider!.getChildren({ group: "localization" })[0];
  choose("Apply this key from Source: a");
  await run("px.compatchActions", row);
  expect(ui.error.mock.lastCall![0]).toContain("Save the localization source edits");
  expect(await fs.readdir(path.join(root, "result"))).toEqual([]);
});

it("rejects a temporary result edited while asynchronous recovery and source checks run", async () => {
  const { mod, before, result } = await resolution();
  const state = { text: before.replace("add_gold = 99", "add_gold = 100"), version: 2 };
  ui.documents.set(result.fsPath, state);
  ui.onDocumentRead = (file) => {
    if (file !== result.fsPath) return;
    ui.onDocumentRead = undefined;
    queueMicrotask(() => {
      state.text += "# newer unsaved result\n";
      state.version++;
    });
  };
  await run("px.compatchApplyResolved");
  expect(await fs.readFile(mod, "utf8")).toBe(before);
  expect(state.text).toContain("# newer unsaved result");
  expect(ui.error.mock.lastCall![0]).toContain("temporary result changed");
});

it("reopens an unchanged mod document closed when the temporary result replaced its preview tab", async () => {
  const { mod, before, result } = await resolution();
  ui.documents.set(result.fsPath, { text: before.replace("add_gold = 99", "add_gold = 100"), version: 2 });
  ui.documentHandles.get(URI.file(mod).fsPath)!.isClosed = true;
  await run("px.compatchApplyResolved");
  expect(await fs.readFile(mod, "utf8")).toContain("add_gold = 100");
  expect(ui.error).not.toHaveBeenCalled();
});

it("still rejects changed mod bytes when a resolution must reopen its closed document", async () => {
  const { mod, before, result } = await resolution();
  ui.documents.set(result.fsPath, { text: before, version: 2 });
  ui.documentHandles.get(URI.file(mod).fsPath)!.isClosed = true;
  const changed = before + "# external edit after closing the original preview\n";
  await fs.writeFile(mod, changed);
  ui.documents.delete(URI.file(mod).fsPath);
  await run("px.compatchApplyResolved");
  expect(await fs.readFile(mod, "utf8")).toBe(changed);
  expect(ui.error.mock.lastCall![0]).toContain("mod has unsaved or changed edits");
});
