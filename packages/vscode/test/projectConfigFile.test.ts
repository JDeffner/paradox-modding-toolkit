import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";

const host = vi.hoisted(() => ({
  documents: new Map<
    string,
    {
      uri: URI;
      encoding: string;
      text: string;
      version: number;
      getText(): string;
      positionAt(offset: number): number;
      save(): Promise<boolean>;
    }
  >(),
  rejectSave: false,
}));
vi.mock("vscode", () => ({
  Uri: URI,
  Range: class {},
  WorkspaceEdit: class {
    file!: string;
    text!: string;
    replace(uri: URI, _range: unknown, text: string) {
      this.file = uri.fsPath;
      this.text = text;
    }
  },
  workspace: {
    get textDocuments() {
      return [...host.documents.values()];
    },
    openTextDocument: async (uri: URI) => {
      const existing = host.documents.get(uri.fsPath.toLowerCase());
      if (existing) return existing;
      const document = {
        uri,
        encoding: "utf8",
        text: fs.readFileSync(uri.fsPath, "utf8"),
        version: 1,
        getText() {
          return this.text;
        },
        positionAt: (offset: number) => offset,
        async save() {
          if (host.rejectSave) return false;
          fs.writeFileSync(uri.fsPath, this.text);
          return true;
        },
      };
      host.documents.set(uri.fsPath.toLowerCase(), document);
      return document;
    },
    applyEdit: async (edit: { file: string; text: string }) => {
      const document = host.documents.get(edit.file.toLowerCase())!;
      document.text = edit.text;
      document.version++;
      return true;
    },
  },
}));
import * as vscode from "vscode";
import {
  prepareProjectConfigWrite,
  readProjectAuthoringSettings,
  readProjectConfigText,
} from "../src/projectConfigFile";

const names = { configDirName: ".px-toolkit", legacyConfigDirName: ".ck3modding" };
let root: string;
beforeEach(() => {
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  root = fs.mkdtempSync(path.join(base, "project-config-"));
  host.documents.clear();
  host.rejectSave = false;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function artifact(relative: string, text: string, legacy = false): string {
  const file = path.join(root, legacy ? names.legacyConfigDirName : names.configDirName, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

it("copies current editor content from the legacy artifact and preserves its source", async () => {
  artifact("schema.json", "{}");
  const legacy = artifact("localization.json", '{"language":"german"}', true);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(legacy));
  const dirty = host.documents.get(legacy.toLowerCase())!;
  dirty.text = '{"language":"french","future":{"keep":true}}';
  dirty.version++;
  const prepared = await prepareProjectConfigWrite(root, names, "localization.json");
  expect(prepared.text).toBe(document.getText());
  await prepared.write(JSON.stringify({ ...JSON.parse(prepared.text!), entryVersion: "none" }));
  expect(JSON.parse(fs.readFileSync(prepared.target, "utf8"))).toEqual({
    language: "french",
    future: { keep: true },
    entryVersion: "none",
  });
  expect(fs.readFileSync(legacy, "utf8")).toBe('{"language":"german"}');
  expect(document.getText()).toBe('{"language":"french","future":{"keep":true}}');
});

it.each(["source disk", "source editor", "destination"])(
  "rejects a changed %s after preparation",
  async (change) => {
    const legacy = artifact("calendar.json", "{}", true);
    const prepared = await prepareProjectConfigWrite(root, names, "calendar.json");
    if (change === "source disk") fs.writeFileSync(legacy, "changed");
    else if (change === "source editor") {
      const doc = host.documents.get(legacy.toLowerCase())!;
      doc.text = "changed";
      doc.version++;
    } else artifact("calendar.json", "changed");
    await expect(prepared.write("replacement")).rejects.toThrow("changed during the operation");
    expect(fs.existsSync(prepared.target)).toBe(change === "destination");
  }
);

it("reports a failed save and leaves the legacy source untouched", async () => {
  const legacy = artifact("workshop.json", '{"description":"keep"}', true);
  const prepared = await prepareProjectConfigWrite(root, names, "workshop.json");
  host.rejectSave = true;
  await expect(prepared.write('{"description":"new"}')).rejects.toThrow("could not be saved");
  expect(fs.readFileSync(legacy, "utf8")).toBe('{"description":"keep"}');
});

it("current invalid project settings win over usable legacy settings", () => {
  artifact("project.json", '{"version":1,"gameId":"ck3"}', true);
  artifact("project.json", "broken");
  expect(() => readProjectAuthoringSettings(root, names, "ck3")).toThrow();
});

it("keeps per-mod rules separate in a multi-mod workspace", () => {
  artifact(
    "project.json",
    '{"version":1,"gameId":"ck3","authoring":{"characterHistory":{"quoteNames":false}}}',
    true
  );
  const other = path.join(root, "Other");
  fs.mkdirSync(other);
  fs.mkdirSync(path.join(other, names.configDirName));
  fs.writeFileSync(
    path.join(other, names.configDirName, "project.json"),
    '{"version":1,"gameId":"ck3","authoring":{"characterHistory":{"quoteNames":true}}}'
  );
  expect(readProjectAuthoringSettings(root, names, "ck3")?.authoring?.characterHistory?.quoteNames).toBe(
    false
  );
  expect(readProjectAuthoringSettings(other, names, "ck3")?.authoring?.characterHistory?.quoteNames).toBe(
    true
  );
  expect(readProjectConfigText(root, names, "missing.json")).toBeUndefined();
});
