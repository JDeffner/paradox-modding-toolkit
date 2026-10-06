import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { URI } from "vscode-uri";

const editor = vi.hoisted(() => ({
  documents: new Map<string, string>(),
  readError: undefined as Error | undefined,
}));

vi.mock("vscode", () => ({
  Uri: { file: (file: string) => URI.file(file) },
  workspace: {
    get textDocuments() {
      return [...editor.documents.keys()].map((file) => ({
        uri: URI.file(file),
        getText: () => {
          if (editor.readError) throw editor.readError;
          return editor.documents.get(file)!;
        },
      }));
    },
    openTextDocument: async (uri: URI) => {
      if (editor.readError) throw editor.readError;
      return { getText: () => editor.documents.get(uri.fsPath) ?? "" };
    },
  },
}));

import { DynastyTreePanel, type DynastyTreeActions } from "../src/webviews/dynastyTree/panel";

let root: string;
let file: string;
const before = 'l_english:\n dynasty_name: "Unsaved name"\n sibling: "Keep"\n';
const after = before.replace("Unsaved name", "New name");

beforeEach(() => {
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/dynasty-loc-"));
  file = path.join(root, "names_l_english.yml");
  fs.writeFileSync(file, before.replace("Unsaved name", "Saved name"));
  editor.documents.set(URI.file(file).fsPath, before);
  editor.readError = undefined;
});

afterEach(() => {
  editor.documents.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

function panel(actions: Partial<DynastyTreeActions>) {
  const post = vi.fn();
  const record = vi.fn();
  const postJournal = vi.fn();
  const instance = Object.assign(Object.create(DynastyTreePanel.prototype), {
    actions,
    post,
    postJournal,
    journal: { record },
    options: { modRoot: "primary-mod" },
    targetChoice: () => ({ modPath: root }),
  }) as { writeName(key: string, value: string, modPath: string): Promise<void> };
  return { instance, post, record, postJournal };
}

it("uses one prepared destination in the selected mod for the write and undo pre-image", async () => {
  const apply = vi.fn(async () => {
    editor.documents.set(URI.file(file).fsPath, after);
    fs.writeFileSync(file, after);
    return file;
  });
  const prepareLoc = vi.fn(async () => ({ file, language: "english", apply }));
  const writeLoc = vi.fn();
  const locTarget = vi.fn();
  const { instance, record, post, postJournal } = panel({ prepareLoc, writeLoc, locTarget });
  await instance.writeName("dynasty_name", "New name", root);
  expect(prepareLoc).toHaveBeenCalledExactlyOnceWith("dynasty_name", root);
  expect(apply).toHaveBeenCalledExactlyOnceWith("New name");
  expect(writeLoc).not.toHaveBeenCalled();
  expect(locTarget).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledExactlyOnceWith({ file, before, after, disk: Buffer.from(after) }, true);
  expect(postJournal).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith({ type: "toast", message: "Wrote dynasty_name to names_l_english.yml." });
});

it("reports a failed undo pre-image read and does not write without that pre-image", async () => {
  editor.readError = new Error("Editor read failed");
  const apply = vi.fn();
  const { instance, record, post } = panel({
    prepareLoc: async () => ({ file, language: "english", apply }),
  });
  await instance.writeName("dynasty_name", "New name", root);
  expect(apply).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith({
    type: "toast",
    message: "Could not write dynasty_name: Editor read failed",
    variant: "destructive",
  });
});

it("reports failed prepared writes without recording undo or posting success", async () => {
  const apply = vi.fn(async () => {
    throw new Error("Stale localization plan");
  });
  const { instance, record, post } = panel({
    prepareLoc: async () => ({ file, language: "english", apply }),
  });
  await instance.writeName("dynasty_name", "New name", root);
  expect(record).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledExactlyOnceWith({
    type: "toast",
    message: "Could not write dynasty_name: Stale localization plan",
    variant: "destructive",
  });
});

it("stops a cancelled preparation without invoking the legacy writer", async () => {
  const writeLoc = vi.fn();
  const { instance, post, record } = panel({ prepareLoc: async () => undefined, writeLoc });
  await instance.writeName("dynasty_name", "New name", root);
  expect(writeLoc).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("undoes added keys in a new file to a valid empty header in the prepared language", async () => {
  fs.unlinkSync(file);
  editor.documents.clear();
  const written = '\uFEFFl_german:\n dynasty_name: "New name"\n';
  const apply = vi.fn(async () => {
    editor.documents.set(URI.file(file).fsPath, written);
    fs.writeFileSync(file, written);
    return file;
  });
  const { instance, record, post } = panel({ prepareLoc: async () => ({ file, language: "german", apply }) });
  await instance.writeName("dynasty_name", "New name", root);
  expect(apply).toHaveBeenCalledExactlyOnceWith("New name");
  expect(record).toHaveBeenCalledExactlyOnceWith(
    { file, before: "l_german:\n", after: written, disk: Buffer.from(written) },
    true
  );
  expect(post).toHaveBeenCalledWith({ type: "toast", message: "Wrote dynasty_name to names_l_english.yml." });
});

it("keeps an existing unsaved buffer as the undo pre-image when its disk file is absent", async () => {
  fs.unlinkSync(file);
  const apply = vi.fn(async () => {
    editor.documents.set(URI.file(file).fsPath, after);
    fs.writeFileSync(file, after);
    return file;
  });
  const { instance, record } = panel({ prepareLoc: async () => ({ file, language: "english", apply }) });
  await instance.writeName("dynasty_name", "New name", root);
  expect(record).toHaveBeenCalledExactlyOnceWith({ file, before, after, disk: Buffer.from(after) }, true);
});

it("retains the legacy callbacks for clients that do not expose preparation", async () => {
  const writeLoc = vi.fn(async () => {
    editor.documents.set(URI.file(file).fsPath, after);
    fs.writeFileSync(file, after);
    return file;
  });
  const { instance, record } = panel({ locTarget: async () => file, writeLoc });
  await instance.writeName("dynasty_name", "New name", root);
  expect(writeLoc).toHaveBeenCalledExactlyOnceWith("dynasty_name", "New name");
  expect(record).toHaveBeenCalledExactlyOnceWith({ file, before, after, disk: Buffer.from(after) }, true);
});
