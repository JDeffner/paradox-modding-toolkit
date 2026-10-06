import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseScript } from "@px-lsp/server/parser";

interface Document {
  uri: { fsPath: string };
  text: string;
  version: number;
  encoding: string;
  eol: number;
  getText(): string;
  positionAt(offset: number): number;
  save(): Promise<boolean>;
}
const host = vi.hoisted(() => ({
  documents: new Map<string, Document>(),
  save: "ok" as "ok" | "false" | "throw",
  rejectEdit: false,
  newDocumentEol: 1,
  applyEdit: vi.fn(),
}));
vi.mock("vscode", () => ({
  EndOfLine: { LF: 1, CRLF: 2 },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
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
  workspace: {
    openTextDocument: async (uri: { fsPath: string }) => {
      let document = host.documents.get(uri.fsPath);
      if (!document) {
        const disk = fs.readFileSync(uri.fsPath, "utf8");
        document = {
          uri,
          text: disk.replace(/^\uFEFF/, ""),
          version: 1,
          encoding: disk.startsWith("\uFEFF") ? "utf8bom" : "utf8",
          eol: disk.includes("\r\n") ? 2 : disk.includes("\n") ? 1 : host.newDocumentEol,
          getText() {
            return this.text;
          },
          positionAt(offset) {
            return offset;
          },
          async save() {
            if (host.save === "false") return false;
            if (host.save === "throw") throw new Error("Disk unavailable");
            fs.writeFileSync(uri.fsPath, (this.encoding === "utf8bom" ? "\uFEFF" : "") + this.text);
            return true;
          },
        };
        host.documents.set(uri.fsPath, document);
      }
      return document;
    },
    applyEdit: host.applyEdit,
  },
}));

import * as vscode from "vscode";
import { EventGraphWriters } from "../src/eventGraphWriters";

let root: string;
let file: string;
let writers: EventGraphWriters;
beforeEach(() => {
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/graph-writers-"));
  file = path.join(root, "events", "sample_events.txt");
  fs.mkdirSync(path.dirname(file));
  writers = new EventGraphWriters();
  host.save = "ok";
  host.rejectEdit = false;
  host.newDocumentEol = 1;
  host.applyEdit
    .mockReset()
    .mockImplementation(
      async (edit: {
        changes: { uri: { fsPath: string }; range: { start: number; end: number }; text: string }[];
      }) => {
        if (host.rejectEdit) return false;
        for (const change of edit.changes) {
          const doc = host.documents.get(change.uri.fsPath)!;
          const replacement = change.text.replace(/\r\n|\n/g, doc.eol === 2 ? "\r\n" : "\n");
          doc.text = doc.text.slice(0, change.range.start) + replacement + doc.text.slice(change.range.end);
          doc.version++;
        }
        return true;
      }
    );
});
afterEach(() => {
  host.documents.clear();
  fs.rmSync(root, { recursive: true, force: true });
});
function seed(text = "namespace = sample\nsample.1 = {\n\ttype = character_event\n}\n") {
  fs.writeFileSync(file, "\uFEFF" + text);
}
async function dirty(text: string) {
  await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const document = host.documents.get(file)!;
  document.text = text;
  document.eol = text.includes("\r\n") ? 2 : 1;
  document.version++;
}
function saved(): string {
  const text = fs.readFileSync(file, "utf8");
  expect(text.startsWith("\uFEFF")).toBe(true);
  expect(text.startsWith("\uFEFF\uFEFF")).toBe(false);
  expect(parseScript(text).errors).toEqual([]);
  return text.slice(1);
}
const noop = async () => {};
const create = (finish: (key: string, value: string) => Promise<void> = noop) =>
  writers.createEvent("sample.2", file, "character_event", "Title", "Description", 2, finish);

describe("Event Graph script writers", () => {
  it("locates the current event brace and preserves dirty text, comments and CRLF", async () => {
    seed();
    const before =
      'namespace = sample\r\n# unsaved changes\r\nsample.1 = {\r\n\tdesc = "brace } in text" # }\r\n}\r\nsample.9 = {}\r\n';
    await dirty(before);
    const finish = vi.fn(noop);
    await writers.addOption("sample.1", file, 0, finish);
    expect(saved()).toBe(
      before.replace("}\r\nsample.9", "\toption = {\r\n\t\tname = sample.1.a\r\n\t}\r\n}\r\nsample.9")
    );
    expect(finish).toHaveBeenCalledWith("sample.1.a");
  });

  it("appends to dirty editor contents instead of disk and preserves the namespace", async () => {
    seed();
    const text = "namespace = sample\r\n# edited in the editor\r\nsample.1 = { type = character_event }\r\n";
    await dirty(text);
    const finish = vi.fn(noop);
    await create(finish);
    expect(saved().startsWith(text + "\r\nsample.2 = {")).toBe(true);
    expect(saved()).not.toMatch(/(?<!\r)\n/);
    expect(finish.mock.calls).toEqual([
      ["sample.2.t", "Title"],
      ["sample.2.desc", "Description"],
      ["sample.2.a", "New option"],
      ["sample.2.b", "New option"],
    ]);
  });

  it("creates a BOM file starting with its namespace", async () => {
    await create();
    expect(saved().startsWith("namespace = sample\n\nsample.2 = {")).toBe(true);
  });

  it("retries localization for a native CRLF new document without inserting a duplicate event", async () => {
    host.newDocumentEol = 2;
    const finish = vi.fn(noop).mockRejectedValueOnce(new Error("Loc save failed"));
    await expect(create(finish)).rejects.toThrow("Loc save failed");
    const partial = fs.readFileSync(file);
    await create(finish);
    expect(fs.readFileSync(file)).toEqual(partial);
    expect(saved()).toMatch(/^namespace = sample\r\n\r\nsample\.2 = \{/);
    expect(saved()).not.toMatch(/(?<!\r)\n/);
    expect(saved().match(/sample\.2 = \{/g)).toHaveLength(1);
    expect(host.applyEdit).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(5);
  });

  it("retries a failed native CRLF new document save without inserting a duplicate event", async () => {
    host.newDocumentEol = 2;
    host.save = "false";
    await expect(create()).rejects.toThrow("could not be saved");
    expect(fs.readFileSync(file)).toEqual(Buffer.alloc(0));
    host.save = "ok";
    await create();
    expect(saved()).toMatch(/^namespace = sample\r\n/);
    expect(saved().match(/sample\.2 = \{/g)).toHaveLength(1);
  });

  it.each(["event", "option"] as const)(
    "retries a native CRLF single-line %s destination without inserting twice",
    async (kind) => {
      host.newDocumentEol = 2;
      seed(kind === "event" ? "namespace = sample" : "namespace = sample sample.1 = {}");
      const finish = vi.fn(noop).mockRejectedValueOnce(new Error("Loc save failed"));
      const write = () =>
        kind === "event" ? create(finish) : writers.addOption("sample.1", file, 0, finish);
      await expect(write()).rejects.toThrow("Loc save failed");
      const partial = fs.readFileSync(file);
      await write();
      expect(fs.readFileSync(file)).toEqual(partial);
      expect(saved()).not.toMatch(/(?<!\r)\n/);
      expect(saved().match(kind === "event" ? /sample\.2 = \{/g : /name = sample\.1\.a/g)).toHaveLength(1);
      expect(host.applyEdit).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects changed native CRLF recovery text and preserves the partial event bytes", async () => {
    host.newDocumentEol = 2;
    const finish = vi.fn(noop).mockRejectedValueOnce(new Error("Loc save failed"));
    await expect(create(finish)).rejects.toThrow("Loc save failed");
    const partial = fs.readFileSync(file);
    const document = host.documents.get(file)!;
    await dirty(document.text + "# user's unsaved work\r\n");
    const changed = document.text;
    await expect(create(finish)).rejects.toThrow("changed after an incomplete write");
    expect(document.text).toBe(changed);
    expect(fs.readFileSync(file)).toEqual(partial);
    expect(host.applyEdit).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("adds a missing namespace without deleting existing comments or events", async () => {
    seed("# author comment\nsample.1 = {}\n");
    await create();
    expect(saved().startsWith("namespace = sample\n\n# author comment\nsample.1 = {}\n")).toBe(true);
  });

  it.each(["false", "throw"] as const)("reports %s save and retries an option once", async (mode) => {
    seed();
    const original = fs.readFileSync(file);
    host.save = mode;
    const finish = vi.fn(noop);
    await expect(writers.addOption("sample.1", file, 0, finish)).rejects.toMatchObject({
      scriptText: expect.stringContaining("name = sample.1.a"),
    });
    expect(fs.readFileSync(file)).toEqual(original);
    expect(finish).not.toHaveBeenCalled();
    host.save = "ok";
    await writers.addOption("sample.1", file, 0, finish);
    expect(saved().match(/name = sample\.1\.a/g)).toHaveLength(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("retries a failed new event save without creating duplicate events", async () => {
    seed();
    host.save = "false";
    await expect(create()).rejects.toThrow("could not be saved");
    host.save = "ok";
    await create();
    expect(saved().match(/sample\.2 = \{/g)).toHaveLength(1);
  });

  it("retries localization after the script saved without inserting again", async () => {
    seed();
    const finish = vi.fn(noop).mockRejectedValueOnce(new Error("Loc save failed"));
    await expect(create(finish)).rejects.toMatchObject({
      message: "Loc save failed",
      scriptText: expect.stringContaining("sample.2 = {"),
    });
    await create(finish);
    expect(saved().match(/sample\.2 = \{/g)).toHaveLength(1);
    expect(host.applyEdit).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(5);
  });

  it("preserves a user edit to completed localization when retrying a partial event write", async () => {
    seed();
    const entries = new Map<string, string>();
    let failDescription = true;
    const finish = async (key: string, value: string) => {
      if (key === "sample.2.desc" && failDescription) throw new Error("Description save failed");
      entries.set(key, value);
    };
    await expect(create(finish)).rejects.toThrow("Description save failed");
    expect(entries).toEqual(new Map([["sample.2.t", "Title"]]));
    entries.set("sample.2.t", "User's revised title");
    failDescription = false;
    await create(finish);
    expect(entries).toEqual(
      new Map([
        ["sample.2.t", "User's revised title"],
        ["sample.2.desc", "Description"],
        ["sample.2.a", "New option"],
        ["sample.2.b", "New option"],
      ])
    );
    expect(saved().match(/sample\.2 = \{/g)).toHaveLength(1);
    expect(host.applyEdit).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed recovery buffer instead of guessing what already landed", async () => {
    seed();
    host.save = "false";
    await expect(create()).rejects.toThrow();
    await dirty(host.documents.get(file)!.text + "# user edit\n");
    host.save = "ok";
    await expect(create()).rejects.toThrow("changed after an incomplete write");
    expect(host.applyEdit).toHaveBeenCalledTimes(1);
  });

  it("reports rejected edits and can retry before any script landed", async () => {
    seed();
    host.rejectEdit = true;
    await expect(create()).rejects.toThrow("edit was rejected");
    host.rejectEdit = false;
    await create();
    expect(saved().match(/sample\.2 = \{/g)).toHaveLength(1);
  });

  it.each([
    "namespace = other\nsample.1 = {}\n",
    "namespace = sample\nnamespace = sample\nsample.1 = {}\n",
    "sample.1 = {}\nnamespace = sample\n",
    "namespace = sample\nsample.2 = {}\n",
    "namespace = sample\nsample.1 = {\n",
  ])("refuses invalid or duplicate create destinations: %s", async (text) => {
    seed(text);
    const original = fs.readFileSync(file);
    await expect(create()).rejects.toThrow();
    expect(fs.readFileSync(file)).toEqual(original);
    expect(host.applyEdit).not.toHaveBeenCalled();
  });

  it.each([
    "namespace = sample\nsample.1 = {}\nsample.1 = {}\n",
    "namespace = sample\nsample.9 = {}\n",
    "namespace = sample\nsample.1 = { option = {} }\n",
    "namespace = sample\nsample.1 = {\n",
  ])("refuses ambiguous, missing, changed or malformed option destinations: %s", async (text) => {
    seed(text);
    await expect(writers.addOption("sample.1", file, 0, noop)).rejects.toThrow();
    expect(host.applyEdit).not.toHaveBeenCalled();
  });

  it("refuses option key collisions and counts outside bounded integer ranges", async () => {
    seed("namespace = sample\nsample.1 = { option = { name = sample.1.b } }\n");
    await expect(writers.addOption("sample.1", file, 1, noop)).rejects.toThrow("already exists");
    for (const count of [-1, 26, NaN, 0.5])
      await expect(writers.addOption("sample.1", file, count, noop)).rejects.toThrow("integer");
    for (const count of [-1, 27, NaN, 1.5])
      await expect(
        writers.createEvent("sample.2", file, "character_event", "", "", count, noop)
      ).rejects.toThrow("integer");
    expect(host.applyEdit).not.toHaveBeenCalled();
  });
});
