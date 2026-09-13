import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type * as VSCode from "vscode";
import { URI } from "vscode-uri";
import type { Entry, Kind } from "../src/compatch/core";
import type { PxConfig } from "../src/config";

type Row =
  { root: "A" | "B" | "base" } | { group: Kind } | { entry: Entry } | { page: Kind; direction: number };
interface Provider {
  getChildren(row?: Row): Row[];
  getTreeItem(row: Row): VSCode.TreeItem;
}
const ui = vi.hoisted(() => ({
  commands: new Map<string, (row?: Row) => Promise<void>>(),
  provider: undefined as Provider | undefined,
  content: undefined as VSCode.TextDocumentContentProvider | undefined,
  pick: vi.fn(),
  folders: vi.fn(),
  input: vi.fn(),
  error: vi.fn(),
  diff: vi.fn(),
  shown: vi.fn(),
  info: vi.fn(),
  documents: new Map<string, { text: string; version: number }>(),
}));

vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    Range: class {},
    WorkspaceEdit: class {
      edits: { uri: URI; text: string }[] = [];
      replace(uri: URI, _range: unknown, text: string) {
        this.edits.push({ uri, text });
      }
    },
    EventEmitter: class {
      event = () => disposable;
      fire() {}
      dispose() {}
    },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    TreeItem: class {
      constructor(public label: string) {}
    },
    TreeItemCollapsibleState: { Collapsed: 1 },
    ProgressLocation: { Notification: 15 },
    commands: {
      registerCommand: (name: string, callback: (row?: Row) => Promise<void>) => {
        ui.commands.set(name, callback);
        return disposable;
      },
      executeCommand: async (command: string, ...args: unknown[]) => {
        if (command === "vscode.diff") ui.diff(...args);
      },
    },
    workspace: {
      textDocuments: [],
      registerTextDocumentContentProvider: (
        _scheme: string,
        provider: VSCode.TextDocumentContentProvider
      ) => {
        ui.content = provider;
        return disposable;
      },
      onDidCloseTextDocument: () => disposable,
      openTextDocument: async (uri: URI) => {
        if (uri.scheme !== "file") return { uri };
        if (!ui.documents.has(uri.fsPath))
          ui.documents.set(uri.fsPath, { text: await fs.readFile(uri.fsPath, "utf8"), version: 1 });
        const state = ui.documents.get(uri.fsPath)!;
        return {
          uri,
          encoding: "utf8",
          get version() {
            return state.version;
          },
          isClosed: false,
          getText: () => state.text,
          positionAt: (offset: number) => offset,
          save: async () => {
            await fs.writeFile(uri.fsPath, state.text);
            return true;
          },
        };
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
      createTreeView: (_id: string, options: { treeDataProvider: Provider }) => {
        ui.provider = options.treeDataProvider;
        return disposable;
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
      ) => run({ report() {} }, { isCancellationRequested: false }),
    },
  };
});

import { registerCompatch } from "../src/compatch/view";

let root: string;
let context: VSCode.ExtensionContext;
let cfg: PxConfig;
beforeEach(async () => {
  cfg = { gameId: "ck3", gamePath: null, locLanguage: "english" } as PxConfig;
  vi.clearAllMocks();
  ui.commands.clear();
  ui.documents.clear();
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

const run = (command: string, row?: Row) => ui.commands.get(command)!(row);
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

  choose("Create result from full A file");
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
  await run("px.openCompatch");
  expect(ui.error).not.toHaveBeenCalled();
}

it("opens a project preset without folder dialogs and compares complete new-game files with the editable original mod", async () => {
  await setupUpdate();
  expect(ui.pick).not.toHaveBeenCalled();
  expect(ui.folders).not.toHaveBeenCalled();
  expect(
    ui
      .provider!.getChildren()
      .slice(0, 3)
      .map((row) => ui.provider!.getTreeItem(row).label)
  ).toEqual(["Mod", "Vanilla", "New Game Version"]);
  await run("px.compareCompatch", eventRow());
  const [left, right, title] = ui.diff.mock.lastCall!;
  expect(right.fsPath).toBe(URI.file(path.join(root, "a/events/original.txt")).fsPath);
  expect(title).toContain("New Game Version");
  expect(ui.content!.provideTextDocumentContent(left, {} as VSCode.CancellationToken)).toContain(
    "add_gold = 2"
  );
  choose("events/original.txt");
  await run("px.compatchFiles", { root: "A" });
  expect(ui.shown.mock.lastCall![0].fsPath).toBe(right.fsPath);
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
  expect(ui.provider!.getChildren({ group: "file" })).toEqual([]);
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
    choose("Create localization result from A");
    await run("px.compatchActions", row);
  }
  const replacement = path.join(root, "result/localization/replace/px_compatch_l_english.yml");
  const ordinary = path.join(root, "result/localization/english/result_l_english.yml");
  expect(await fs.readFile(replacement, "utf8")).toContain('existing:0 "Modified"');
  expect(await fs.readFile(ordinary, "utf8")).toContain('new_key:0 "New"');
  await fs.writeFile(replacement, "manual localization");
  choose("Create localization result from A");
  await run("px.compatchActions", rows[0]);
  expect(await fs.readFile(replacement, "utf8")).toBe("manual localization");
  expect(ui.error).not.toHaveBeenCalled();
});
