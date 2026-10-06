import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LanguageClient } from "vscode-languageclient/node";
import type { DefinitionEditParams } from "@px-lsp/protocol/protocol";
import type { PxConfig } from "../src/config";

interface MockUri {
  scheme: string;
  fsPath: string;
  toString(): string;
}
interface MockDocument {
  uri: MockUri;
  text: string;
  version: number;
  isClosed: boolean;
  encoding: string;
  getText(): string;
  positionAt(offset: number): number;
  readonly lineCount: number;
  save(): Promise<boolean>;
}
interface MockChange {
  uri: MockUri;
  range: { start: number; end: number };
  text: string;
}
const host = vi.hoisted(() => ({
  docs: new Map<string, MockDocument>(),
  encoding: "utf8",
  rejectSave: false,
  rejectEdit: false,
  pick: vi.fn(),
  input: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  show: vi.fn(),
}));
vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string): MockUri => ({ scheme: "file", fsPath, toString: () => `file:${fsPath}` }) },
  Range: class {
    constructor(
      public start: number,
      public end: number
    ) {}
  },
  Position: class {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  WorkspaceEdit: class {
    changes: MockChange[] = [];
    replace(uri: MockUri, range: MockChange["range"], text: string) {
      this.changes.push({ uri, range, text });
    }
  },
  ViewColumn: { Beside: 2 },
  window: {
    showQuickPick: host.pick,
    showInputBox: host.input,
    showInformationMessage: host.info,
    showWarningMessage: host.warning,
    showErrorMessage: host.error,
    showTextDocument: host.show,
  },
  workspace: {
    get textDocuments() {
      return [...host.docs.values()];
    },
    openTextDocument: async (uri: MockUri | string) => {
      const file = typeof uri === "string" ? uri : uri.fsPath;
      if (host.docs.has(file)) return host.docs.get(file)!;
      const disk = fs.readFileSync(file, "utf8");
      const doc: MockDocument = {
        uri: { scheme: "file", fsPath: file, toString: () => `file:${file}` },
        text: disk.replace(/^\uFEFF/, ""),
        version: 1,
        isClosed: false,
        encoding: disk.startsWith("\uFEFF") ? "utf8bom" : host.encoding,
        getText() {
          return this.text;
        },
        positionAt(offset: number) {
          return offset;
        },
        get lineCount() {
          return this.text.split(/\r?\n/).length;
        },
        async save() {
          if (host.rejectSave) return false;
          fs.writeFileSync(file, (this.encoding === "utf8bom" ? "\uFEFF" : "") + this.text);
          return true;
        },
      };
      host.docs.set(file, doc);
      return doc;
    },
    applyEdit: async (edit: { changes: MockChange[] }) => {
      if (host.rejectEdit) return false;
      for (const change of [...edit.changes].sort((a, b) => b.range.start - a.range.start)) {
        const doc = host.docs.get(change.uri.fsPath)!;
        doc.text = doc.text.slice(0, change.range.start) + change.text + doc.text.slice(change.range.end);
        doc.version++;
      }
      return true;
    },
  },
}));

import { writeLocValues, applyDefinitionEdits, openSaveTarget } from "../src/creators/save";
import { prepareLocalizationWrite } from "../src/locCommands";
import { DynastyTreePanel } from "../src/webviews/dynastyTree/panel";
import { WriteJournal, type JournalState } from "../src/webviews/dynastyTree/journal";
import { newContentCommand } from "../src/scaffold/command";
import { createTranslationCommand } from "../src/translation";
import { generateCalendarLocCommand } from "../src/calendarInsert";
import { translateNextCommand } from "../src/translationLoop";
import { ck3Meta } from "../../server/src/games/ck3/meta";

let base: string;
let mod: string;
let game: string;
let cfg: PxConfig;
beforeEach(() => {
  vi.resetAllMocks();
  host.docs.clear();
  host.encoding = "utf8";
  host.rejectEdit = false;
  host.rejectSave = false;
  fs.mkdirSync(".local/testing", { recursive: true });
  base = fs.mkdtempSync(path.resolve(".local/testing/writer-safety-"));
  mod = path.join(base, "mod");
  game = path.join(base, "game");
  fs.mkdirSync(mod);
  fs.mkdirSync(game);
  cfg = {
    gameId: "ck3",
    modPath: mod,
    gamePath: game,
    locLanguage: "english",
    workspaceMods: [mod],
    parentPaths: [],
  } as unknown as PxConfig;
});
afterEach(() => {
  host.docs.clear();
  fs.rmSync(base, { recursive: true, force: true });
});
function seed(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function expectOneBom(file: string) {
  expect(fs.readFileSync(file, "utf8").startsWith("\uFEFF")).toBe(true);
  expect(fs.readFileSync(file, "utf8").startsWith("\uFEFF\uFEFF")).toBe(false);
}

it.each(["vanilla", "parent"] as const)(
  "routes creator %s-only overrides to replace in a fresh mod",
  async (source) => {
    const root = source === "vanilla" ? game : path.join(base, "parent");
    if (source === "parent") cfg.parentPaths = [root];
    const file = path.join(root, "localization/english/traits_l_english.yml");
    const original = '\uFEFFl_english:\n brave:0 "Brave"\n';
    seed(file, original);
    const files = await writeLocValues(
      cfg,
      async () => [{ file, line: 1, source: source === "vanilla" ? "vanilla" : "mod", value: "Brave" }],
      [{ key: "brave", value: "Changed" }],
      { modPath: mod, file: "my_traits.txt" }
    );
    expect(files[0].split(path.sep)).toContain("replace");
    expect(fs.readFileSync(files[0], "utf8")).toContain('brave: "Changed"');
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expectOneBom(files[0]);
  }
);

it.each(["utf8", "utf8bom"])(
  "saves existing scripts with one BOM using %s and preserves unsaved neighbors",
  async (encoding) => {
    const file = path.join(mod, "common/traits/traits.txt");
    seed(file, "old = {}\n");
    const vscode = await import("vscode");
    await vscode.workspace.openTextDocument(file);
    const doc = host.docs.get(file)!;
    doc.encoding = encoding;
    doc.text += "neighbor = {} # unsaved\n";
    expect(await applyDefinitionEdits(file, doc.text, [{ start: 0, end: 3, newText: "new" }], { cfg })).toBe(
      "saved"
    );
    expect(fs.readFileSync(file, "utf8")).toBe("\uFEFFnew = {}\nneighbor = {} # unsaved\n");
    expectOneBom(file);
  }
);

it.each(["encoding", "edit", "save", "stale"])(
  "reports %s script save failures and preserves disk content",
  async (failure) => {
    const file = path.join(mod, "common/traits/traits.txt");
    const original = "old = {}\n";
    seed(file, original);
    await (await import("vscode")).workspace.openTextDocument(file);
    const doc = host.docs.get(file)!;
    if (failure === "encoding") doc.encoding = "windows1252";
    if (failure === "edit") host.rejectEdit = true;
    if (failure === "save") host.rejectSave = true;
    if (failure === "stale") doc.text += "unsaved = {}\n";
    expect(await applyDefinitionEdits(file, original, [{ start: 0, end: 3, newText: "new" }], { cfg })).toBe(
      failure === "stale" ? "stale" : "failed"
    );
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(failure === "stale" ? host.warning : host.error).toHaveBeenCalled();
  }
);

it("refuses a scaffold's events junction into vanilla before creating a file", async () => {
  const outside = path.join(game, "events");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(mod, "events"), "junction");
  const template = ck3Meta.scaffolds!.find((item) => item.id === "event")!;
  host.pick.mockResolvedValue({ template });
  host.input.mockResolvedValueOnce("audit").mockResolvedValueOnce("audit.1");
  await newContentCommand(cfg, vi.fn());
  expect(fs.readdirSync(outside)).toEqual([]);
  expect(host.error).toHaveBeenCalledWith(expect.stringContaining("selected mod"));
  expect(host.info).not.toHaveBeenCalled();
});

it("refuses creator target creation and saving through a traits junction into vanilla", async () => {
  const outside = path.join(game, "common/traits");
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(mod, "common"));
  fs.symlinkSync(outside, path.join(mod, "common/traits"), "junction");
  await expect(
    openSaveTarget(cfg, "common/traits", { modPath: mod, modLabel: "Mod", file: "my_traits.txt" })
  ).rejects.toThrow("selected mod");
  expect(fs.readdirSync(outside)).toEqual([]);
  const file = path.join(mod, "common/traits/my_traits.txt");
  seed(file, "old = {}\n");
  expect(
    await applyDefinitionEdits(file, "old = {}\n", [{ start: 0, end: 3, newText: "new" }], { cfg })
  ).toBe("failed");
  expect(fs.readFileSync(file, "utf8")).toBe("old = {}\n");
});

it("allows a linked mod root whose descendants stay inside that mod", async () => {
  const alias = path.join(base, "linked-mod");
  fs.symlinkSync(mod, alias, "junction");
  cfg = { ...cfg, modPath: alias, workspaceMods: [alias] };
  const target = await openSaveTarget(cfg, "common/traits", {
    modPath: alias,
    modLabel: "Mod",
    file: "my_traits.txt",
  });
  expect(target).not.toBeNull();
  expect(fs.readFileSync(path.join(mod, "common/traits/my_traits.txt"), "utf8")).toBe("\uFEFF");
});

it.each(["saveDynasty", "saveHouse"])(
  "%s routes the name to the actual script owner instead of the character target",
  async (type) => {
    const other = path.join(base, "other");
    fs.mkdirSync(other);
    const scriptFile = path.join(
      other,
      "common",
      type === "saveDynasty" ? "dynasties" : "dynasty_houses",
      "other.txt"
    );
    seed(scriptFile, "1 = {}\n");
    const prepareLoc = vi.fn(async () => undefined);
    const panel = Object.assign(Object.create(DynastyTreePanel.prototype), {
      options: {
        cfg: { ...cfg, workspaceMods: [mod, other] },
        modRoot: mod,
        meta: ck3Meta,
        mods: [{ path: mod }, { path: other }],
      },
      actions: {
        prepareLoc,
        editDefinition: async ({ text }: DefinitionEditParams) => ({
          ops: [],
          edits: [{ start: 0, end: text.length, newText: "1 = { name = dynn_audit }\n" }],
        }),
      },
      targetChoice: () => ({ modPath: mod }),
      refuseQuote: () => false,
      post: vi.fn(),
      remember: vi.fn(),
      reloadSoon: vi.fn(),
    }) as { onMessage(message: unknown): Promise<void> };
    await panel.onMessage({ type, form: { id: "1", nameKey: "dynn_audit" }, name: "New", file: scriptFile });
    expect(fs.readFileSync(scriptFile, "utf8")).toContain("name = dynn_audit");
    expect(prepareLoc).toHaveBeenCalledWith("dynn_audit", other);
  }
);

it("undo and redo keep one BOM for a newly created dynasty localization file", async () => {
  host.encoding = "utf8bom";
  const panel = Object.assign(Object.create(DynastyTreePanel.prototype), {
    options: { cfg, mods: [{ path: mod }], modRoot: mod },
    actions: { prepareLoc: (key: string) => prepareLocalizationWrite(cfg, async () => [], key) },
    post: vi.fn(),
    postJournal: vi.fn(),
  }) as {
    writeName(key: string, value: string, modPath: string): Promise<void>;
    docText(file: string): Promise<string | null>;
    journalState(file: string): Promise<JournalState | null>;
    replaceDocument(file: string, text: string, expected?: JournalState): Promise<boolean>;
    journal: WriteJournal;
  };
  panel.journal = new WriteJournal({
    read: (file) => panel.journalState(file),
    write: (file, text, expected) => panel.replaceDocument(file, text, expected),
    refuse: vi.fn(),
  });
  await panel.writeName("dynn_audit", "New", mod);
  const file = [...host.docs.keys()].find((file) => file.endsWith(".yml"))!;
  expectOneBom(file);
  expect(await panel.journal.undo()).toBe(true);
  expect(fs.readFileSync(file, "utf8")).toBe("\uFEFFl_english:\n");
  expect(await panel.journal.redo()).toBe(true);
  expect(fs.readFileSync(file, "utf8")).toContain('dynn_audit: "New"');
  expectOneBom(file);
});

it.each(["failed", "saved", "unchanged"])(
  "a partial dynasty undo checks %s disk state before retrying",
  async (edited) => {
    const script = path.join(mod, "history/script.txt");
    const loc = path.join(mod, "localization/english/names_l_english.yml");
    seed(script, "\uFEFFafter");
    seed(loc, "\uFEFFloc after");
    const post = vi.fn();
    const panel = Object.assign(Object.create(DynastyTreePanel.prototype), {
      options: { cfg, mods: [{ path: mod }] },
      post,
    }) as {
      journalState(file: string): Promise<JournalState | null>;
      replaceDocument(file: string, text: string, expected?: JournalState): Promise<boolean>;
    };
    const refuse = vi.fn();
    let reject = true;
    const journal = new WriteJournal({
      read: (file) => panel.journalState(file),
      write: async (file, text, expected) => {
        host.rejectSave = reject && file === script;
        return panel.replaceDocument(file, text, expected);
      },
      refuse,
    });
    journal.record({ file: script, before: "before", after: "after", disk: fs.readFileSync(script) });
    journal.record({ file: loc, before: "loc before", after: "loc after", disk: fs.readFileSync(loc) }, true);
    expect(await journal.undo()).toBe(false);
    expect(host.docs.get(script)!.text).toBe("before");
    expect(fs.readFileSync(script, "utf8")).toBe("\uFEFFafter");
    expect(fs.readFileSync(loc, "utf8")).toBe("\uFEFFloc before");
    reject = false;
    if (edited === "unchanged") {
      expect(await journal.undo()).toBe(true);
      expect(fs.readFileSync(script, "utf8")).toBe("\uFEFFbefore");
      expect(journal.depth).toEqual({ undo: 0, redo: 1 });
      expect(await journal.redo()).toBe(true);
      expect(fs.readFileSync(script, "utf8")).toBe("\uFEFFafter");
      expect(fs.readFileSync(loc, "utf8")).toBe("\uFEFFloc after");
      return;
    }
    const target = edited === "failed" ? script : loc;
    const external = "\uFEFFexternal user work";
    fs.writeFileSync(target, external);
    host.rejectSave = false;
    expect(await journal.undo()).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe(external);
    expect(journal.depth).toEqual({ undo: 1, redo: 0 });
    expect(refuse).toHaveBeenLastCalledWith(expect.stringContaining("has changed since the panel wrote it"));
  }
);

it.each([
  'l_french:\n existing:0 "Keep"\n',
  "l_german:\nl_french:\n",
  "# Generated from names.jinja\nl_german:\n",
])("Add Language refuses an invalid or generated target: %j", async (body) => {
  seed(path.join(mod, "localization/english/source_l_english.yml"), '\uFEFFl_english:\n new_key:0 "New"\n');
  const target = path.join(mod, "localization/german/source_l_german.yml");
  seed(target, "\uFEFF" + body);
  host.pick.mockResolvedValueOnce("english").mockResolvedValueOnce("other...");
  host.input.mockResolvedValueOnce("german");
  await createTranslationCommand(cfg, vi.fn());
  expect(fs.readFileSync(target, "utf8")).toBe("\uFEFF" + body);
  expect(host.error).toHaveBeenCalled();
  expect(host.info).not.toHaveBeenCalled();
});

it.each(["localization.json", "calendar.json"])(
  "calendar generation rejects %s created during Regenerate",
  async (config) => {
    cfg.calendar = { epoch: 4000, after: "AD", before: "BC" };
    const target = path.join(mod, "localization/english/px_calendar_l_english.yml");
    const original = '\uFEFFl_english:\n PX_CAL_ERA:0 "Old"\n';
    seed(target, original);
    host.warning.mockImplementation(async () => {
      seed(
        path.join(mod, ".px-toolkit", config),
        config === "localization.json" ? '{"language":"german"}' : '{"epoch":5000,"after":"New"}'
      );
      return "Regenerate";
    });
    await generateCalendarLocCommand(cfg);
    expect(fs.readFileSync(target, "utf8")).toBe(original);
    expect(host.error).toHaveBeenCalledWith(expect.stringContaining("changed during"));
    expect(host.info).not.toHaveBeenCalled();
  }
);

it.each(["buffer", "disk"])(
  "Translate Missing Keys rejects a destination %s edit during its prompt",
  async (change) => {
    const file = path.join(mod, "localization/german/source_l_german.yml");
    seed(file, '\uFEFFl_german:\n new_key:0 ""\n');
    host.input.mockImplementation(async () => {
      if (change === "disk") seed(file, '\uFEFFl_german:\n new_key:0 "External translation"\n');
      else {
        const mock = host.docs.get(file)!;
        mock.text = mock.text.replace('""', '"Manual translation"');
        mock.version++;
      }
      return "Prompt translation";
    });
    const lc = {
      sendRequest: async () => [
        {
          language: "german",
          untranslated: [{ key: "new_key", file, line: 1, value: "Original" }],
          missing: [],
        },
      ],
    } as unknown as LanguageClient;
    const changed = vi.fn();
    await translateNextCommand(lc, cfg, changed);
    expect(fs.readFileSync(file, "utf8")).not.toContain("Prompt translation");
    if (change === "buffer") expect(host.docs.get(file)!.text).toContain("Manual translation");
    else expect(fs.readFileSync(file, "utf8")).toContain("External translation");
    expect(changed).not.toHaveBeenCalled();
    expect(host.error).toHaveBeenCalledWith(expect.stringContaining("changed during"));
  }
);
