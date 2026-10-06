import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
const host = vi.hoisted(() => ({
  setting: undefined as string | undefined,
  trusted: true,
  copies: 0,
  failCopyAt: 0,
  documents: [] as { uri: URI; isDirty: boolean; encoding: string; getText(): string; version: number }[],
}));
vi.mock("fs", async (original) => {
  const real = await original<typeof import("fs")>();
  return {
    ...real,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (typeof args[0] === "number" && ++host.copies === host.failCopyAt) throw new Error("copy rejected");
      return real.writeFileSync(...args);
    },
  };
});
vi.mock("vscode", () => ({
  Uri: URI,
  workspace: {
    get textDocuments() {
      return host.documents;
    },
    get isTrusted() {
      return host.trusted;
    },
  },
}));
vi.mock("../src/machineSettings", () => ({
  readMachineSetting: () => host.setting,
  writeMachineSetting: vi.fn(),
}));
import { prepareWorkshopDirectory } from "../src/steam/workshop";
import { metaFor } from "../src/meta";

let root: string;
const meta = metaFor("ck3");
beforeEach(() => {
  const base = path.resolve(".local/testing");
  fs.mkdirSync(base, { recursive: true });
  root = fs.mkdtempSync(path.join(base, "workshop-storage-"));
  host.setting = undefined;
  host.trusted = true;
  host.documents = [];
  host.copies = 0;
  host.failCopyAt = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
function write(relative: string, bytes: string | Buffer, legacy = true): string {
  const file = path.join(root, legacy ? meta.legacyConfigDirName! : meta.configDirName, "workshop", relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

it("completes a partial current listing without replacing current files or changing sources", async () => {
  const original = Buffer.from([1, 2, 255, 0]);
  const source = write("previews/photo.png", original);
  const legacyText = write("description.md", "old description");
  const currentText = write("description.md", "current description", false);
  const directory = await prepareWorkshopDirectory(root, meta);
  expect(fs.readFileSync(path.join(directory, "previews/photo.png"))).toEqual(original);
  expect(fs.readFileSync(currentText, "utf8")).toBe("current description");
  expect(fs.readFileSync(legacyText, "utf8")).toBe("old description");
  expect(fs.readFileSync(source)).toEqual(original);
});

it("does not save or copy an unsaved legacy source during automatic upgrade", async () => {
  const source = write("description.md", "saved text");
  host.documents = [
    { uri: URI.file(source), isDirty: true, encoding: "utf8", getText: () => "unsaved text", version: 2 },
  ];
  await expect(prepareWorkshopDirectory(root, meta)).rejects.toThrow("Save");
  expect(fs.readFileSync(source, "utf8")).toBe("saved text");
  expect(fs.existsSync(path.join(root, meta.configDirName, "workshop/description.md"))).toBe(false);
});

it("blocks required upgrade in an untrusted workspace", async () => {
  write("description.md", "saved text");
  host.trusted = false;
  await expect(prepareWorkshopDirectory(root, meta)).rejects.toThrow("Trust this workspace");
  expect(fs.existsSync(path.join(root, meta.configDirName))).toBe(false);
});

it("leaves an explicit listing path alone", async () => {
  write("description.md", "saved text");
  host.setting = "../custom-listing";
  expect(await prepareWorkshopDirectory(root, meta)).toBe(path.resolve(root, host.setting));
  expect(fs.existsSync(path.join(root, meta.configDirName))).toBe(false);
});

it("rolls back copied files if a later copy fails, preserving pre-existing current work", async () => {
  write("description.md", "saved text");
  write("item.json", '{"future":true}');
  const current = write("notes.txt", "keep", false);
  host.failCopyAt = 2;
  await expect(prepareWorkshopDirectory(root, meta)).rejects.toThrow("copy rejected");
  expect(fs.readdirSync(path.dirname(current))).toEqual(["notes.txt"]);
  expect(fs.readFileSync(current, "utf8")).toBe("keep");
  expect(fs.existsSync(path.join(root, meta.legacyConfigDirName!, "workshop/item.json"))).toBe(true);
});
