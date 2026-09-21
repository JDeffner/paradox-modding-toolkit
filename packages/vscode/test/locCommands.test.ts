import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { devPath } from "../../../scripts/devPaths";
import type { PxConfig } from "../src/config";
import { parseLoc } from "@px-lsp/server/parser/locParser";

const editor = vi.hoisted(() => ({
  documents: new Map<
    string,
    {
      uri: { fsPath: string };
      text: string;
      encoding: string;
      languageId: string;
      readonly lineCount: number;
      lineAt(line: number): { text: string; firstNonWhitespaceCharacterIndex: number };
      validatePosition(position: { line: number; character: number }): { line: number; character: number };
      getText(): string;
      positionAt(offset: number): number;
      save(): Promise<boolean>;
    }
  >(),
  rejectEdit: false,
  rejectSave: false,
  showInputBox: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
}));

vi.mock("vscode", () => ({
  Uri: class {
    readonly scheme = "file";
    constructor(public fsPath: string) {}
    static file(fsPath: string) {
      return new this(fsPath);
    }
    toString() {
      return `file:${this.fsPath}`;
    }
  },
  Position: class {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  window: {
    showInputBox: editor.showInputBox,
    showWarningMessage: editor.showWarningMessage,
    showErrorMessage: editor.showErrorMessage,
  },
  Range: class {
    constructor(
      public start: number,
      public end: number
    ) {}
  },
  WorkspaceEdit: class {
    uri!: { fsPath: string };
    text!: string;
    replace(uri: { fsPath: string }, _range: unknown, text: string) {
      this.uri = uri;
      this.text = text;
    }
  },
  workspace: {
    openTextDocument: async (uri: { fsPath: string }) => {
      let doc = editor.documents.get(uri.fsPath);
      if (!doc) {
        const disk = fs.readFileSync(uri.fsPath, "utf8");
        const encoding = disk.startsWith("\uFEFF") ? "utf8bom" : "utf8";
        doc = {
          uri,
          text: disk.replace(/^\uFEFF/, ""),
          encoding,
          languageId: "paradox-loc",
          get lineCount() {
            return this.text.split(/\r?\n/).length;
          },
          lineAt(line: number) {
            const text = this.text.split(/\r?\n/)[line];
            return { text, firstNonWhitespaceCharacterIndex: text.search(/\S/) };
          },
          validatePosition(position: { line: number; character: number }) {
            return position;
          },
          getText() {
            return this.text;
          },
          positionAt(offset: number) {
            return offset;
          },
          async save() {
            if (editor.rejectSave) return false;
            fs.writeFileSync(uri.fsPath, (encoding === "utf8bom" ? "\uFEFF" : "") + this.text, "utf8");
            return true;
          },
        };
        editor.documents.set(uri.fsPath, doc);
      }
      return doc;
    },
    applyEdit: async (edit: { uri: { fsPath: string }; text: string }) => {
      if (editor.rejectEdit) return false;
      editor.documents.get(edit.uri.fsPath)!.text = edit.text;
      return true;
    },
  },
}));

import * as vscode from "vscode";
import {
  editLocalizationCommand,
  locTargetFile,
  replaceLocLineValue,
  upsertNewModLoc,
  writeLocSmart,
} from "../src/locCommands";

let root: string;
let file: string;
let cfg: PxConfig;
const BOM = "\uFEFF";

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "px-loc-writer-"));
  file = path.join(root, "localization", "english", "audit_l_english.yml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  cfg = { modPath: root, locLanguage: "english", gameId: "ck3" } as PxConfig;
});

afterEach(() => {
  editor.documents.clear();
  editor.rejectEdit = false;
  editor.rejectSave = false;
  fs.rmSync(root, { recursive: true, force: true });
});

function validOutput(target = file) {
  const bytes = fs.readFileSync(target);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3, 6).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  const result = parseLoc(bytes.toString("utf8"));
  expect(result.errors).toEqual([]);
  return result.entries;
}

describe("localization write boundary", () => {
  it.each(["", BOM])("keeps one BOM across repeated writes on older VS Code hosts (BOM %j)", async (bom) => {
    fs.writeFileSync(file, `${bom}l_english:\n wanted:0 "Old"\n`, "utf8");
    await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    Object.defineProperty(editor.documents.get(file), "encoding", { value: undefined });
    await replaceLocLineValue(file, 1, "wanted", "First");
    validOutput();
    await replaceLocLineValue(file, 1, "wanted", "Second");
    expect(validOutput()[0].value).toBe("Second");
  });
  it.each(["", BOM])(
    "finds a moved key in unsaved text and preserves its neighbors (BOM %j)",
    async (bom) => {
      fs.writeFileSync(file, `${bom}l_english:\r\n wanted:7 "Old" # keep comment\r\n`, "utf8");
      await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      editor.documents.get(file)!.text =
        'l_english:\r\n inserted:0 "Unsaved neighbor"\r\n wanted:7 "Unsaved target" # keep comment\r\n';
      const lookup = async () => [{ file, line: 1, source: "mod" as const, value: "Old" }];
      expect(await locTargetFile(cfg, lookup, "wanted")).toBe(file);
      expect(
        await writeLocSmart(cfg, lookup, "wanted", 'First\r\nSecond\rThird\nSay "hello" and \\"again\\"')
      ).toBe(file);
      expect(validOutput().map((entry) => [entry.key, entry.value])).toEqual([
        ["inserted", "Unsaved neighbor"],
        ["wanted", 'First\\nSecond\\nThird\\nSay \\"hello\\" and \\"again\\"'],
      ]);
      expect(fs.readFileSync(file, "utf8")).toContain(':7 "First');
      expect(fs.readFileSync(file, "utf8")).toContain('" # keep comment\r\n');
      await editor.documents.get(file)!.save();
      validOutput();
    }
  );

  it("does not overwrite another key when the requested key is gone", async () => {
    const original = 'l_english:\n other:0 "Untouched"\n';
    fs.writeFileSync(file, original, "utf8");
    expect(await replaceLocLineValue(file, 1, "missing", "New")).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    const lookup = async () => [{ file, line: 1, source: "mod" as const }];
    expect(await writeLocSmart(cfg, lookup, "missing", "Added")).toBe(
      await locTargetFile(cfg, lookup, "missing")
    );
    expect(validOutput().map((entry) => [entry.key, entry.value])).toEqual([
      ["other", "Untouched"],
      ["missing", "Added"],
    ]);
    expect(fs.existsSync(path.join(root, "localization", "replace"))).toBe(false);
  });

  it("adds and updates sibling keys through the same BOM and linebreak boundary", async () => {
    fs.writeFileSync(file, 'l_english: # language\n audit_old:0 "Old"\n', "utf8");
    expect(await upsertNewModLoc(cfg, "audit_new", "One\nTwo")).toBe(file);
    expect(await upsertNewModLoc(cfg, "audit_new", "Three\r\nFour")).toBe(file);
    expect(validOutput().map((entry) => [entry.key, entry.value])).toEqual([
      ["audit_old", "Old"],
      ["audit_new", "Three\\nFour"],
    ]);
  });

  it("writes into the selected mod when another mod has the same key", async () => {
    fs.writeFileSync(file, `${BOM}l_english:\n shared:0 "Other mod"\n`, "utf8");
    const selected = path.join(root, "selected-mod");
    const targetCfg = { ...cfg, modPath: selected };
    const lookup = async () => [{ file, line: 1, source: "mod" as const }];
    const written = await writeLocSmart(targetCfg, lookup, "shared", "Selected mod");
    expect(written.startsWith(selected + path.sep)).toBe(true);
    expect(written).not.toContain(`${path.sep}replace${path.sep}`);
    expect(fs.readFileSync(file, "utf8")).toContain('"Other mod"');
    expect(validOutput(written)[0].value).toBe("Selected mod");
  });

  it("creates a valid new localization file", async () => {
    const target = await upsertNewModLoc(cfg, "audit_new", "One\nTwo");
    expect(validOutput(target).map((entry) => entry.value)).toEqual(["One\\nTwo"]);
  });

  it("reports rejected edits and saves instead of claiming success", async () => {
    fs.writeFileSync(file, `${BOM}l_english:\n wanted:0 "Old"\n`, "utf8");
    editor.rejectEdit = true;
    await expect(replaceLocLineValue(file, 1, "wanted", "New")).rejects.toThrow("rejected");
    editor.rejectEdit = false;
    editor.rejectSave = true;
    await expect(replaceLocLineValue(file, 1, "wanted", "New")).rejects.toThrow("could not be saved");
    expect(fs.readFileSync(file, "utf8")).toContain('"Old"');
  });

  it("edits the selected German coverage row while English is configured", async () => {
    fs.writeFileSync(file, `${BOM}l_english:\n shared:0 "English"\n`, "utf8");
    const german = path.join(root, "localization", "german", "audit_l_german.yml");
    fs.mkdirSync(path.dirname(german), { recursive: true });
    fs.writeFileSync(german, `${BOM}l_german:\n shared:0 "German"\n`, "utf8");
    const lookup = vi.fn(async () => [
      { file, line: 1, source: "mod" as const },
      { file: german, line: 1, source: "mod" as const },
    ]);
    editor.showInputBox.mockResolvedValue("Deutsch");
    const changed = vi.fn();
    await editLocalizationCommand(lookup, cfg, changed, {
      pxKey: "shared",
      pxLanguage: "german",
      pxLoc: { file: german, line: 1 },
      modRoot: root,
    });
    expect(editor.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ value: "German" }));
    expect(lookup).toHaveBeenCalledWith("shared", "german");
    expect(changed).toHaveBeenCalledWith(german);
    expect(validOutput(german)[0].value).toBe("Deutsch");
    expect(validOutput()[0].value).toBe("English");
  });

  it("keeps the explicit duplicate source file and its unsaved sibling text", async () => {
    fs.writeFileSync(file, `${BOM}l_english:\n shared:0 "First file"\n`, "utf8");
    const selected = path.join(path.dirname(file), "selected_l_english.yml");
    fs.writeFileSync(selected, `${BOM}l_english:\n shared:0 "Second file"\n`, "utf8");
    const uri = vscode.Uri.file(selected);
    await vscode.workspace.openTextDocument(uri);
    editor.documents.get(selected)!.text =
      'l_english:\n sibling:0 "Unsaved sibling"\n shared:0 "Unsaved selection"\n';
    const lookup = async () => [{ file, line: 1, source: "mod" as const }];
    editor.showInputBox.mockResolvedValue("Edited selection");
    await editLocalizationCommand(lookup, cfg, vi.fn(), { uri, position: { line: 2, character: 3 } });
    expect(editor.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ value: "Unsaved selection" }));
    expect(validOutput(selected).map((entry) => [entry.key, entry.value])).toEqual([
      ["sibling", "Unsaved sibling"],
      ["shared", "Edited selection"],
    ]);
    expect(validOutput()[0].value).toBe("First file");
  });

  it("creates a missing German key in German localization without a source file", async () => {
    fs.writeFileSync(file, `${BOM}l_english:\n shared:0 "English"\n`, "utf8");
    const lookup = vi.fn(async (_key: string, language?: string) =>
      language === "german" ? [] : [{ file, line: 1, source: "mod" as const }]
    );
    editor.showInputBox.mockResolvedValue("Deutsch");
    const changed = vi.fn();
    await editLocalizationCommand(lookup, cfg, changed, {
      pxKey: "shared",
      pxLanguage: "german",
      modRoot: root,
    });
    const written = changed.mock.calls[0][0] as string;
    expect(written).toMatch(/_l_german\.yml$/);
    expect(written).not.toContain(`${path.sep}replace${path.sep}`);
    expect(validOutput(written)[0].value).toBe("Deutsch");
    expect(validOutput()[0].value).toBe("English");
  });

  const tiger = devPath("tigerPath");
  const game = devPath("gamePath");
  it.skipIf(!tiger || !game)(
    "validates written files with real ck3-tiger in a scratch mod",
    async () => {
      fs.writeFileSync(file, 'l_english:\n audit_existing:0 "Old"\n', "utf8");
      await replaceLocLineValue(file, 1, "audit_existing", 'First\nSecond with "quotes"');
      await upsertNewModLoc(cfg, "audit_added", "A\r\nB");
      validOutput();
      const descriptor = path.join(root, "descriptor.mod");
      fs.writeFileSync(
        descriptor,
        `name="Localization writer audit"\npath="${root.replace(/\\/g, "/")}"\n`,
        "utf8"
      );
      const result = spawnSync(tiger!, ["--game", path.dirname(game!), "--json", descriptor], {
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
    },
    200_000
  );
});
