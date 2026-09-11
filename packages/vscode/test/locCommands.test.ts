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
      getText(): string;
      positionAt(offset: number): number;
      save(): Promise<boolean>;
    }
  >(),
  rejectEdit: false,
  rejectSave: false,
}));

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
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
import { locTargetFile, replaceLocLineValue, upsertNewModLoc, writeLocSmart } from "../src/locCommands";

let root: string;
let file: string;
let cfg: PxConfig;
const BOM = "\uFEFF";

beforeEach(() => {
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
