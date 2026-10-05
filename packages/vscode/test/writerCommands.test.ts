import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PxConfig } from "../src/config";
import type { TraitSave } from "../src/webviews/traitCreator/messages";

interface Document {
  uri: { fsPath: string; scheme: string };
  text: string;
  version: number;
  encoding: string | undefined;
  getText(): string;
  positionAt(offset: number): number;
  readonly lineCount: number;
  save(): Promise<boolean>;
}
const editor = vi.hoisted(() => ({
  documents: new Map<string, Document>(),
  rejectEdit: false,
  saveMode: "ok" as "ok" | "reject" | "throw",
  onOpen: (_file: string) => {},
  applyEdit: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showTextDocument: vi.fn(),
}));

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath, toString: () => `file:${fsPath}` }) },
  Position: class {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  Range: class {
    constructor(
      public start: number,
      public end: number
    ) {}
  },
  WorkspaceEdit: class {
    changes: { uri: { fsPath: string }; range: { start: number; end: number }; text: string }[] = [];
    replace(uri: { fsPath: string }, range: { start: number; end: number }, text: string) {
      this.changes.push({ uri, range, text });
    }
  },
  ViewColumn: { Beside: 2 },
  window: editor,
  workspace: {
    get textDocuments() {
      return [...editor.documents.values()];
    },
    openTextDocument: async (uri: { fsPath: string } | string) => {
      const file = typeof uri === "string" ? uri : uri.fsPath;
      let doc = editor.documents.get(file);
      if (!doc) {
        const disk = fs.readFileSync(file, "utf8");
        const encoding = disk.startsWith("\uFEFF") ? "utf8bom" : "utf8";
        doc = {
          uri: { fsPath: file, scheme: "file" },
          text: disk.replace(/^\uFEFF/, ""),
          encoding,
          version: 1,
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
            if (editor.saveMode === "throw") throw new Error("Disk is read-only");
            if (editor.saveMode === "reject") return false;
            fs.writeFileSync(file, (encoding === "utf8bom" ? "\uFEFF" : "") + this.text, "utf8");
            return true;
          },
        };
        editor.documents.set(file, doc);
      }
      editor.onOpen(file);
      return doc;
    },
    applyEdit: editor.applyEdit,
  },
}));

import * as vscode from "vscode";
import { readDocument, writeDocument } from "../src/documentWrite";
import { applyDefinitionEdits, writeLocValues } from "../src/creators/save";
import { writeFlagFile } from "../src/webviews/flagBuilder/save";
import { FlagBuilderPanel } from "../src/webviews/flagBuilder/panel";
import { CoaDesignerPanel } from "../src/webviews/coaDesigner/panel";
import { newContentCommand } from "../src/scaffold/command";
import { createTranslationCommand } from "../src/translation";
import { createTranslationModCommand } from "../src/translationMod";
import { generateCalendarLocCommand } from "../src/calendarInsert";
import { ck3Meta } from "../../server/src/games/ck3/meta";
import { renderScaffold } from "../../server/src/games/renderScaffold";
import { TraitCreatorPanel } from "../src/webviews/traitCreator/panel";
import { DynastyTreePanel } from "../src/webviews/dynastyTree/panel";
import { WriteJournal } from "../src/webviews/dynastyTree/journal";

let root: string;
let cfg: PxConfig;
const BOM = "\uFEFF";
beforeEach(() => {
  vi.resetAllMocks();
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/writers-"));
  cfg = { gameId: "ck3", modPath: root, locLanguage: "english", workspaceMods: [] } as unknown as PxConfig;
  editor.rejectEdit = false;
  editor.saveMode = "ok";
  editor.onOpen = () => {};
  editor.applyEdit.mockImplementation(
    async (edit: {
      changes: { uri: { fsPath: string }; range: { start: number; end: number }; text: string }[];
    }) => {
      if (editor.rejectEdit) return false;
      for (const change of [...edit.changes].sort((a, b) => b.range.start - a.range.start)) {
        const doc = editor.documents.get(change.uri.fsPath)!;
        doc.text = doc.text.slice(0, change.range.start) + change.text + doc.text.slice(change.range.end);
        doc.version++;
      }
      return true;
    }
  );
});
afterEach(() => {
  editor.documents.clear();
  fs.rmSync(root, { recursive: true, force: true });
});
function seed(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BOM + body, "utf8");
}
async function dirty(file: string, text: string) {
  await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  editor.documents.get(file)!.text = text;
  editor.documents.get(file)!.version++;
}
function savedText(file: string) {
  const disk = fs.readFileSync(file, "utf8");
  expect(disk.startsWith(BOM)).toBe(true);
  expect(disk.startsWith(BOM + BOM)).toBe(false);
  expect(disk.slice(1)).toBe(editor.documents.get(file)!.text.replace(/^\uFEFF/, ""));
  return disk.slice(1);
}

describe("flag and coat of arms save boundary", () => {
  const script = "wanted = { color1 = red }";
  function flagPath() {
    return path.join(root, "common/coat_of_arms/coat_of_arms/flags.txt");
  }
  function save() {
    return writeFlagFile({ modPath: root, file: "flags.txt", name: "wanted", script });
  }
  it.each(["new", "clean", "dirty"])("saves a %s file and preserves neighboring blocks", async (state) => {
    const file = flagPath();
    if (state !== "new") seed(file, "neighbor = {}\nwanted = {}\n");
    if (state === "dirty") await dirty(file, "neighbor = { # unsaved\n}\nwanted = {}\n");
    expect(await save()).toBe("flags.txt");
    const text = savedText(file);
    expect(text).toContain(script);
    if (state !== "new") expect(text).toContain("neighbor = {");
    if (state === "dirty") expect(text).toContain("# unsaved");
    expect(editor.applyEdit).toHaveBeenCalledTimes(1);
  });
  it("rejects a disk change while opening instead of overwriting it", async () => {
    seed(flagPath(), "wanted = {}\n");
    editor.onOpen = (file) => fs.writeFileSync(file, "external change");
    await expect(save()).rejects.toThrow("changed during");
    expect(fs.readFileSync(flagPath(), "utf8")).toBe("external change");
    expect(editor.applyEdit).not.toHaveBeenCalled();
  });
  it("reports read errors instead of treating an unreadable path as a new file", async () => {
    fs.mkdirSync(flagPath(), { recursive: true });
    await expect(save()).rejects.toThrow();
    expect(editor.applyEdit).not.toHaveBeenCalled();
  });
  it.each(["edit", "reject", "throw"])("reports %s failure and does not reveal success", async (failure) => {
    const file = flagPath();
    seed(file, "wanted = {}\n");
    editor.rejectEdit = failure === "edit";
    if (failure !== "edit") editor.saveMode = failure as "reject" | "throw";
    await expect(save()).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(BOM + "wanted = {}\n");
    expect(editor.showTextDocument).not.toHaveBeenCalled();
    if (failure !== "edit") expect(editor.documents.get(file)!.text).toContain(script);
  });
});

describe.each(["flag", "coa"])("%s panel failure reporting", (kind) => {
  it.each(["edit", "reject", "throw"])("reports %s failure instead of posting success", async (failure) => {
    const file = path.join(root, "common/coat_of_arms/coat_of_arms/flags.txt");
    seed(file, "wanted = {}\n");
    const post = vi.fn();
    const options = { mods: [{ path: root }], meta: {} };
    editor.rejectEdit = failure === "edit";
    if (failure === "reject" || failure === "throw") editor.saveMode = failure;
    editor.showQuickPick.mockResolvedValueOnce({ label: "flags.txt" });
    const script = "wanted = { color1 = red }";
    if (kind === "flag") {
      const panel = Object.assign(Object.create(FlagBuilderPanel.prototype), { options, post }) as {
        save(name: string, script: string, modPath: string): Promise<void>;
      };
      await panel.save("wanted", script, root);
    } else {
      const panel = Object.assign(Object.create(CoaDesignerPanel.prototype), {
        options,
        post,
        targetChoice: () => ({ modPath: root, file: "flags.txt" }),
      }) as { onMessage(message: unknown): Promise<void> };
      await panel.onMessage({ type: "save", name: "wanted", script, modPath: root });
    }
    expect(post).toHaveBeenCalledExactlyOnceWith({
      type: "toast",
      message: expect.stringContaining("Could not save wanted:"),
    });
    expect(fs.readFileSync(file, "utf8")).toBe(BOM + "wanted = {}\n");
    if (failure !== "edit") expect(editor.documents.get(file)!.text).toContain(script);
  });
});

describe("New Content command", () => {
  const template = ck3Meta.scaffolds!.find((item) => item.id === "event")!;
  function output() {
    return renderScaffold(template, { prefix: "audit", name: "audit.1", locLanguage: "english" });
  }
  async function run() {
    editor.showQuickPick.mockResolvedValue({ template });
    editor.showInputBox.mockResolvedValueOnce("audit").mockResolvedValueOnce("audit.1");
    const changed = vi.fn();
    await newContentCommand(cfg, changed);
    return changed;
  }
  it.each(["new", "clean", "dirty", "deleted with dirty buffer"])(
    "creates or appends to %s documents with the required header",
    async (state) => {
      const file = path.join(root, output().files[0].relPath);
      if (state !== "new") seed(file, "# existing\naudit.9 = {}\n");
      if (state === "dirty" || state === "deleted with dirty buffer") {
        await dirty(file, "# unsaved\naudit.9 = {}\n");
        if (state === "deleted with dirty buffer") fs.unlinkSync(file);
      }
      await run();
      expect(editor.showErrorMessage).not.toHaveBeenCalled();
      const text = savedText(file);
      expect(text.startsWith("namespace = audit")).toBe(true);
      expect(text).toContain("audit.1 = {");
      if (state !== "new") expect(text).toContain("audit.9 = {}");
      if (state === "dirty" || state === "deleted with dirty buffer") expect(text).toContain("# unsaved");
      expect(savedText(path.join(root, output().files[1].relPath))).toContain("l_english:");
    }
  );
  it.each(["edit", "save", "stale", "read"])(
    "stops before localization and success feedback on %s failure",
    async (failure) => {
      const file = path.join(root, output().files[0].relPath);
      if (failure === "read") fs.mkdirSync(file, { recursive: true });
      else seed(file, "namespace = audit\naudit.9 = {}\n");
      if (failure === "edit") editor.rejectEdit = true;
      if (failure === "save") editor.saveMode = "reject";
      if (failure === "stale") editor.onOpen = (opened) => fs.writeFileSync(opened, "external change");
      const changed = await run();
      expect(editor.showErrorMessage).toHaveBeenCalledTimes(1);
      expect(editor.showInformationMessage).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(root, output().files[1].relPath))).toBe(false);
    }
  );
});

describe("Add Language command", () => {
  it("creates the first language with a valid header and one BOM", async () => {
    editor.showQuickPick.mockResolvedValueOnce("french");
    await createTranslationCommand(cfg, vi.fn());
    expect(savedText(path.join(root, "localization/french/mod_l_french.yml"))).toBe("l_french:\n");
    expect(editor.showTextDocument).toHaveBeenCalledTimes(1);
  });
  function files() {
    return {
      source: path.join(root, "localization/english/audit_l_english.yml"),
      target: path.join(root, "localization/french/audit_l_french.yml"),
    };
  }
  async function run() {
    editor.showQuickPick.mockImplementation(async (_items, options: { title: string }) =>
      options.title === "Translate from" ? "english" : "other..."
    );
    editor.showInputBox.mockResolvedValue("french");
    await createTranslationCommand(cfg, vi.fn());
  }
  it.each(["new", "clean", "dirty", "deleted with dirty buffer"])(
    "merges the current source into a %s destination",
    async (state) => {
      const { source, target } = files();
      seed(source, 'l_english:\n old:0 "Old"\n new_key:0 "New"\n');
      if (state !== "new") seed(target, 'l_french:\n old:0 "Traduit"\n');
      if (state === "dirty" || state === "deleted with dirty buffer") {
        await dirty(source, 'l_english:\n old:0 "Old"\n new_key:0 "Unsaved source"\n');
        await dirty(target, 'l_french:\r\n old:0 "Unsaved translation" # keep\r\n');
        if (state === "deleted with dirty buffer") fs.unlinkSync(target);
      }
      const sourceDisk = fs.readFileSync(source, "utf8");
      await run();
      const result = savedText(target);
      expect(result).toContain('new_key:0 "" # english:');
      expect(fs.readFileSync(source, "utf8")).toBe(sourceDisk);
      if (state === "dirty" || state === "deleted with dirty buffer") {
        expect(result).toContain('old:0 "Unsaved translation" # keep\r\n');
        expect(result).toContain("Unsaved source");
      }
      expect(editor.showErrorMessage).not.toHaveBeenCalled();
    }
  );
  it.each(["source", "target"])("rejects a stale %s", async (which) => {
    const { source, target } = files();
    seed(source, 'l_english:\n key:0 "Source"\n');
    seed(target, "l_french:\n");
    editor.onOpen = (file) => {
      if (file === target) {
        const changed = which === "source" ? source : target;
        editor.documents.get(changed)!.text += "# concurrent unsaved edit\n";
        editor.documents.get(changed)!.version++;
        if (which === "target") fs.writeFileSync(target, "external change");
      }
    };
    await run();
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(editor.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
  });
  it.each(["read", "edit", "save"])("reports %s failure without a success summary", async (failure) => {
    const { source, target } = files();
    seed(source, 'l_english:\n key:0 "Source"\n');
    if (failure === "read") fs.mkdirSync(target, { recursive: true });
    if (failure === "edit") editor.rejectEdit = true;
    if (failure === "save") editor.saveMode = "reject";
    await run();
    expect(editor.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
  });
});

describe("adaptive specialized writers", () => {
  function defaults(value: unknown) {
    const file = path.join(root, ".px-toolkit/localization.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }

  it("creator saves new keys into the author default and keeps owned keys in their dirty document", async () => {
    defaults({
      language: "german",
      newKeyFile: "localization/replace/german/author_l_german.yml",
      entryVersion: "none",
    });
    const existing = path.join(root, "localization/german/traits_l_german.yml");
    seed(existing, 'l_german:\n old_trait:0 "Old"\n neighbor:7 "Keep"\n');
    await dirty(existing, 'l_german:\n old_trait:0 "Unsaved"\n neighbor:7 "Unsaved neighbor" # keep\n');
    const files = await writeLocValues(
      cfg,
      async () => [],
      [
        { key: "old_trait", value: "Changed" },
        { key: "fresh_trait", value: "Fresh" },
      ],
      { modPath: root, file: "traits.txt" }
    );
    expect(files[0]).toBe(existing);
    expect(savedText(existing)).toContain('neighbor:7 "Unsaved neighbor" # keep');
    expect(savedText(existing)).toContain('old_trait:0 "Changed"');
    const newFile = path.join(root, "localization/replace/german/author_l_german.yml");
    expect(files[1]).toBe(newFile);
    expect(savedText(newFile)).toContain('fresh_trait: "Fresh"');
    expect(fs.existsSync(path.join(root, "localization/english/traits_l_english.yml"))).toBe(false);
  });

  it("New Content routes localization through the portable author default", async () => {
    defaults({ language: "german", newKeyFile: "localization/german/my_events_l_german.yml" });
    const template = ck3Meta.scaffolds!.find((item) => item.id === "event")!;
    editor.showQuickPick.mockResolvedValue({ template });
    editor.showInputBox.mockResolvedValueOnce("audit").mockResolvedValueOnce("audit.1");
    await newContentCommand(cfg, vi.fn());
    expect(editor.showErrorMessage).not.toHaveBeenCalled();
    expect(savedText(path.join(root, "localization/german/my_events_l_german.yml"))).toContain("audit_1_t:");
    expect(fs.existsSync(path.join(root, "localization/english/audit_events_l_english.yml"))).toBe(false);
  });

  it("Add Language discovers staged localization and mirrors its source layout", async () => {
    cfg = { ...cfg, gameId: "eu5" };
    defaults({ language: "german" });
    const source = path.join(root, "main_menu/localization/replace/german/menu_l_german.yml");
    seed(source, 'l_german:\n menu_title: "Titel"\n');
    editor.showQuickPick.mockResolvedValue("french");
    await createTranslationCommand(cfg, vi.fn());
    expect(savedText(path.join(root, "main_menu/localization/replace/french/menu_l_french.yml"))).toContain(
      "# german: Titel"
    );
    expect(fs.readFileSync(source, "utf8")).toContain('menu_title: "Titel"');
  });

  it("creates a first language under a profile stage for a new staged mod", async () => {
    cfg = { ...cfg, gameId: "eu5" };
    editor.showQuickPick.mockResolvedValue("german");
    await createTranslationCommand(cfg, vi.fn());
    expect(savedText(path.join(root, "in_game/localization/german/mod_l_german.yml"))).toBe("l_german:\n");
    expect(fs.existsSync(path.join(root, "localization"))).toBe(false);
  });
});

describe("calendar localization command", () => {
  function targets() {
    return [
      path.join(root, "localization/english/px_calendar_l_english.yml"),
      path.join(root, "localization/replace/english/px_calendar_dates_l_english.yml"),
    ];
  }
  function calendarFile() {
    return path.join(root, ".px-toolkit/calendar.json");
  }
  beforeEach(() => {
    cfg = { ...cfg, calendar: { epoch: 4000, after: "AD", before: "BC" } };
    editor.showWarningMessage.mockResolvedValue("Regenerate");
  });
  it("uses the dirty declaration and preserves unrelated dirty localization and existing versions", async () => {
    seed(calendarFile(), JSON.stringify(cfg.calendar));
    await dirty(calendarFile(), JSON.stringify({ epoch: 3000, after: "CE", before: "BCE" }));
    const [math] = targets();
    seed(math, 'l_english:\n PX_CAL_ERA:7 "Old" # retain\n unrelated:0 "Old neighbor"\n');
    await dirty(math, 'l_english:\n PX_CAL_ERA:7 "Edited" # retain\n unrelated:0 "Unsaved neighbor"\n');
    await generateCalendarLocCommand(cfg);
    const text = savedText(math);
    expect(text).toContain('unrelated:0 "Unsaved neighbor"');
    expect(text).toContain("PX_CAL_ERA:7");
    expect(text).toContain("'CE', 'BCE'");
    expect(text).toContain("# retain");
    expect(fs.readFileSync(calendarFile(), "utf8")).toContain("4000");
    expect(editor.showErrorMessage).not.toHaveBeenCalled();
  });
  it("uses the author language and version setting for generated calendar files", async () => {
    const file = path.join(root, ".px-toolkit/localization.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ language: "german", entryVersion: "none" }));
    await generateCalendarLocCommand(cfg);
    expect(savedText(path.join(root, "localization/german/px_calendar_l_german.yml"))).toContain(
      'PX_CAL_ERA: "'
    );
    expect(fs.existsSync(targets()[0])).toBe(false);
  });
  it("does not create a missing sibling file when regeneration is cancelled", async () => {
    const [math, dates] = targets();
    seed(math, 'l_english:\n PX_CAL_ERA:0 "Old"\n');
    await dirty(math, 'l_english:\n PX_CAL_ERA:0 "Unsaved"\n unrelated:0 "Keep"\n');
    const before = fs.readFileSync(math, "utf8");
    editor.showWarningMessage.mockResolvedValue(undefined);
    await generateCalendarLocCommand(cfg);
    expect(fs.existsSync(dates)).toBe(false);
    expect(fs.readFileSync(math, "utf8")).toBe(before);
    expect(editor.documents.get(math)!.text).toContain('unrelated:0 "Keep"');
    expect(editor.applyEdit).not.toHaveBeenCalled();
  });
  it("checks all existing calendar documents before writing a missing sibling", async () => {
    const [math, dates] = targets();
    seed(dates, "not a localization header\n");
    await generateCalendarLocCommand(cfg);
    expect(fs.existsSync(math)).toBe(false);
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(editor.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("header"));
  });
  it.each(["target", "source", "defaults"])(
    "rejects a stale %s after the regenerate prompt",
    async (which) => {
      seed(calendarFile(), JSON.stringify(cfg.calendar));
      const defaults = path.join(root, ".px-toolkit/localization.json");
      seed(defaults, JSON.stringify({ language: "english" }));
      const [math, dates] = targets();
      seed(math, 'l_english:\n PX_CAL_ERA:0 "Old"\n');
      seed(dates, "l_english:\n");
      const before = targets().map((file) => fs.readFileSync(file, "utf8"));
      editor.showWarningMessage.mockImplementation(async () => {
        const doc = editor.documents.get(
          which === "source" ? calendarFile() : which === "defaults" ? defaults : math
        )!;
        doc.text += "\n";
        doc.version++;
        return "Regenerate";
      });
      await generateCalendarLocCommand(cfg);
      expect(editor.applyEdit).not.toHaveBeenCalled();
      expect(editor.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed during"));
      expect(targets().map((file) => fs.readFileSync(file, "utf8"))).toEqual(before);
      expect(editor.showInformationMessage).not.toHaveBeenCalled();
    }
  );
  it("refuses a calendar destination inside vanilla", async () => {
    cfg = { ...cfg, gamePath: path.join(root, "localization") };
    const [math] = targets();
    seed(math, 'l_english:\n PX_CAL_ERA:0 "Vanilla"\n');
    await generateCalendarLocCommand(cfg);
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(editor.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("read-only"));
    expect(fs.readFileSync(math, "utf8")).toContain('"Vanilla"');
  });
  it.each(["edit", "save"])("reports %s failure without success feedback", async (failure) => {
    if (failure === "edit") editor.rejectEdit = true;
    else editor.saveMode = "reject";
    await generateCalendarLocCommand(cfg);
    expect(editor.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
    expect(editor.showTextDocument).not.toHaveBeenCalled();
  });
});

describe("standalone translation mod command", () => {
  let destination: string;
  let source: string;
  beforeEach(() => {
    destination = path.join(root, "generated");
    source = path.join(root, "localization/english/source_l_english.yml");
    cfg = { ...cfg, parentPaths: [] };
    seed(source, 'l_english:\n source_key:0 "Saved source"\n');
    editor.showQuickPick.mockImplementation(async (_items, options: { title: string }) =>
      options.title === "Translate which mod?" ? { root, label: "Source" } : "german"
    );
    editor.showInputBox.mockImplementation(async () => destination);
  });
  it("translates the dirty source without saving it", async () => {
    await dirty(source, 'l_english:\n source_key:0 "Unsaved source"\n');
    const original = fs.readFileSync(source, "utf8");
    await createTranslationModCommand(cfg, vi.fn());
    expect(savedText(path.join(destination, "localization/german/replace/source_l_german.yml"))).toContain(
      "# english: Unsaved source"
    );
    expect(fs.readFileSync(source, "utf8")).toBe(original);
    expect(editor.showErrorMessage).not.toHaveBeenCalled();
  });
  it("retains unique source entries when plain and replace filenames match", async () => {
    seed(
      path.join(root, "localization/replace/english/source_l_english.yml"),
      'l_english:\n replace_key:0 "Replace entry"\n'
    );
    await createTranslationModCommand(cfg, vi.fn());
    const translated = savedText(path.join(destination, "localization/german/replace/source_l_german.yml"));
    expect(translated).toContain("# english: Saved source");
    expect(translated).toContain("# english: Replace entry");
    expect(editor.showErrorMessage).not.toHaveBeenCalled();
  });
  it("reports conflicting collapsed source values before creating the destination", async () => {
    seed(
      path.join(root, "localization/replace/english/source_l_english.yml"),
      'l_english:\n source_key:0 "Different source"\n'
    );
    await createTranslationModCommand(cfg, vi.fn());
    expect(fs.existsSync(destination)).toBe(false);
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(editor.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Conflicting source localization for source_key")
    );
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
  });
  it("rejects a source changed while opening a destination", async () => {
    editor.onOpen = (file) => {
      if (file.startsWith(destination)) {
        const doc = editor.documents.get(source)!;
        doc.text += "# concurrent\n";
        doc.version++;
      }
    };
    await createTranslationModCommand(cfg, vi.fn());
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(editor.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed during"));
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
  });
  it("rejects a destination that became nonempty after selection", async () => {
    editor.showInputBox.mockImplementation(async () => {
      seed(path.join(destination, "keep.txt"), "User work");
      return destination;
    });
    await createTranslationModCommand(cfg, vi.fn());
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(destination, "keep.txt"), "utf8")).toBe(BOM + "User work");
    expect(editor.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("no longer empty"));
  });
  it("refuses a new translation mod inside vanilla before writing any generated file", async () => {
    cfg = { ...cfg, gamePath: path.join(root, "game") };
    fs.mkdirSync(cfg.gamePath!, { recursive: true });
    destination = path.join(cfg.gamePath!, "translation");
    await createTranslationModCommand(cfg, vi.fn());
    expect(editor.applyEdit).not.toHaveBeenCalled();
    expect(fs.existsSync(destination)).toBe(false);
    expect(editor.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("read-only"));
  });
  it.each(["edit", "save"])("reports %s failure without a success summary", async (failure) => {
    if (failure === "edit") editor.rejectEdit = true;
    else editor.saveMode = "reject";
    await createTranslationModCommand(cfg, vi.fn());
    expect(editor.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
  });
});

describe("document snapshots", () => {
  it("preserves a surviving dirty buffer when an older host cannot report its encoding", async () => {
    const file = path.join(root, "deleted.txt");
    seed(file, "old = {}\n");
    await dirty(file, "unsaved = {}\n");
    editor.documents.get(file)!.encoding = undefined;
    fs.unlinkSync(file);
    await expect(readDocument(file, true)).rejects.toThrow("encoding can be checked");
    expect(editor.documents.get(file)!.text).toBe("unsaved = {}\n");
    expect(editor.applyEdit).not.toHaveBeenCalled();
  });
  it.each(["text", "version", "disk"])("rejects a changed %s before applying", async (kind) => {
    const file = path.join(root, "source.txt");
    seed(file, "old = {}\n");
    const snapshot = await readDocument(file);
    const doc = editor.documents.get(file)!;
    if (kind === "text") doc.text += "# unsaved";
    if (kind === "version") doc.version++;
    if (kind === "disk") fs.writeFileSync(file, "external");
    await expect(writeDocument(snapshot, "new = {}\n", true)).rejects.toThrow("changed during");
    expect(editor.applyEdit).not.toHaveBeenCalled();
  });
  it.each(["", BOM])("keeps one BOM on older hosts with initial BOM %j", async (bom) => {
    const file = path.join(root, "source.txt");
    fs.writeFileSync(file, bom + "old = {}\n");
    await vscode.workspace.openTextDocument(file);
    editor.documents.get(file)!.encoding = undefined;
    await writeDocument(await readDocument(file), "first = {}\n", true);
    await writeDocument(await readDocument(file), "second = {}\n", true);
    expect(savedText(file)).toBe("second = {}\n");
  });
});

describe("creator save outcomes", () => {
  it.each(["edit", "reject", "throw", "stale", "ok"])(
    "reports %s and gates localization in the trait caller",
    async (failure) => {
      const file = path.join(root, "common/traits/audit.txt");
      seed(file, "old = {}\n");
      editor.rejectEdit = failure === "edit";
      if (failure === "reject" || failure === "throw") editor.saveMode = failure;
      const lookupLoc = vi.fn(async () => []);
      const posted = vi.fn();
      const panel = Object.assign(Object.create(TraitCreatorPanel.prototype), {
        form: { folder: "common/traits", current: { source: "mod", file } },
        options: {
          cfg,
          lookupLoc,
          actions: {
            editDefinition: async () => {
              if (failure === "stale") editor.documents.get(file)!.text += "# changed";
              return { ops: [], edits: [{ start: 0, end: 8, newText: "new = {}" }] };
            },
          },
        },
        targetChoice: () => ({ modPath: root, file: "audit.txt" }),
        post: posted,
      }) as { save(save: TraitSave): Promise<string | null> };
      const result = await panel.save({
        mode: "edit",
        name: "old",
        block: "new = {}",
        loc: [{ key: "new_name", value: "New" }],
      } as TraitSave);
      if (failure === "ok") {
        expect(result).toBe(file);
        expect(lookupLoc).toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith({ type: "saved", ok: true, name: "old" });
      } else {
        expect(result).toBeNull();
        expect(lookupLoc).not.toHaveBeenCalled();
        expect(posted).toHaveBeenCalledWith({ type: "saved", ok: false, name: "old" });
        expect(fs.readFileSync(file, "utf8")).toBe(BOM + "old = {}\n");
        if (failure === "stale") expect(editor.showWarningMessage).toHaveBeenCalled();
        else expect(editor.showErrorMessage).toHaveBeenCalled();
        if (failure === "reject" || failure === "throw")
          expect(editor.documents.get(file)!.text).toContain("new = {}");
      }
    }
  );
  it("distinguishes stale text from a rejected save with no new edits", async () => {
    const file = path.join(root, "audit.txt");
    seed(file, "old = {}\n");
    expect(await applyDefinitionEdits(file, "wrong", [])).toBe("stale");
    editor.saveMode = "reject";
    expect(await applyDefinitionEdits(file, "old = {}\n", [])).toBe("failed");
  });
});

describe.each(["edit", "reject", "throw"] as const)("dynasty history with %s failure", (failure) => {
  it.each(["undo", "redo"] as const)(
    "does not move %s history when the document save fails",
    async (direction) => {
      const file = path.join(root, "history.txt");
      seed(file, "after");
      const post = vi.fn();
      const panel = Object.assign(Object.create(DynastyTreePanel.prototype), { post }) as {
        replaceDocument(file: string, text: string): Promise<boolean>;
      };
      const journal = new WriteJournal({
        read: async (file) => (await vscode.workspace.openTextDocument(file)).getText(),
        write: (file, text) => panel.replaceDocument(file, text),
        refuse: post,
      });
      journal.record({ file, before: "before", after: "after" });
      if (direction === "redo") expect(await journal.undo()).toBe(true);
      const previousDepth = journal.depth;
      const previousDisk = fs.readFileSync(file, "utf8");
      if (failure === "edit") editor.rejectEdit = true;
      else editor.saveMode = failure;
      expect(await journal[direction]()).toBe(false);
      expect(journal.depth).toEqual(previousDepth);
      expect(fs.readFileSync(file, "utf8")).toBe(previousDisk);
      const intended = direction === "undo" ? "before" : "after";
      expect(editor.documents.get(file)!.text).toBe(failure === "edit" ? previousDisk.slice(1) : intended);
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "toast", variant: "destructive" }));
    }
  );
});
