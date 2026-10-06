import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "../src/config";

vi.mock("fs", async () => ({ ...(await vi.importActual<typeof import("fs")>("fs")) }));

const host = vi.hoisted(() => ({
  documents: [] as Array<{
    uri: { scheme: string; fsPath: string };
    isDirty: boolean;
    isClosed: boolean;
    version: number;
    encoding: string;
    text: string;
    getText(): string;
  }>,
  activeTextEditor: undefined as unknown,
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  executeCommand: vi.fn(),
}));
vi.mock("vscode", () => {
  class Uri {
    readonly scheme = "file";
    constructor(public fsPath: string) {}
    static file(file: string) {
      return new Uri(file);
    }
  }
  return {
    Uri,
    window: host,
    workspace: {
      get textDocuments() {
        return host.documents;
      },
    },
    commands: { executeCommand: host.executeCommand },
  };
});
import * as vscode from "vscode";
import { containsPath } from "../src/commandTargets";
import { importVanillaFile, importVanillaFolder, importVanillaResource } from "../src/vanillaImport";

const testing = path.resolve(".local/testing");
let fixture: string;
let game: string;
let mod: string;
let cfg: PxConfig;

function source(relative: string, bytes: string | Buffer = "vanilla content"): vscode.Uri {
  const file = path.join(game, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return vscode.Uri.file(file);
}

function dirty(file: string, text: string) {
  const document = {
    uri: vscode.Uri.file(file),
    isDirty: true,
    isClosed: false,
    version: 2,
    encoding: "utf8",
    text,
    getText() {
      return this.text;
    },
  };
  host.documents.push(document);
  return document;
}

beforeEach(() => {
  vi.clearAllMocks();
  host.documents = [];
  host.activeTextEditor = undefined;
  fs.mkdirSync(testing, { recursive: true });
  fixture = fs.mkdtempSync(path.join(testing, "vanilla-import-"));
  game = path.join(fixture, "game");
  mod = path.join(fixture, "mod");
  fs.mkdirSync(game);
  fs.mkdirSync(mod);
  cfg = { gameId: "ck3", gamePath: game, modPath: mod } as PxConfig;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (!containsPath(testing, fixture)) throw new Error("Test fixture escaped the testing directory");
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe("vanilla import", () => {
  it("creates only the selected folder and missing parents", async () => {
    source("common/traits/nested/file.txt");
    source("common/traits/sibling.txt");
    source("common/other/file.txt");
    await importVanillaFolder(cfg, vscode.Uri.file(path.join(game, "common/traits")));
    expect(fs.readdirSync(path.join(mod, "common"))).toEqual(["traits"]);
    expect(fs.readdirSync(path.join(mod, "common/traits"))).toEqual([]);
    expect(fs.readFileSync(path.join(game, "common/traits/nested/file.txt"), "utf8")).toBe("vanilla content");
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(host.showInformationMessage).toHaveBeenCalledWith(
      `Created ${path.join("common", "traits")} in the focused mod.`
    );
  });

  it("preserves file bytes and EU5 load-stage paths", () => {
    cfg.gameId = "eu5";
    const bytes = Buffer.from([0x44, 0x44, 0x53, 0x20, 0, 0xff, 0x80]);
    const uri = source("in_game/gfx/models/image.dds", bytes);
    const result = importVanillaResource(cfg, uri, "file");
    expect(result.status).toBe("created");
    expect(result.target.fsPath).toBe(path.join(mod, "in_game/gfx/models/image.dds"));
    expect(fs.readFileSync(result.target.fsPath)).toEqual(bytes);
    expect(fs.readFileSync(uri.fsPath)).toEqual(bytes);
  });

  it("copies dirty script text with BOM without saving the source", () => {
    const uri = source("events/example.txt", "\uFEFFnamespace = example\nold = {}\n");
    const document = dirty(uri.fsPath, "namespace = example\nnew = {}\n");
    const original = fs.readFileSync(uri.fsPath);
    const result = importVanillaResource(cfg, uri, "file");
    expect(fs.readFileSync(result.target.fsPath, "utf8")).toBe("\uFEFFnamespace = example\nnew = {}\n");
    expect(fs.readFileSync(uri.fsPath)).toEqual(original);
    expect(document.isDirty).toBe(true);
    expect(document.text).toBe("namespace = example\nnew = {}\n");
  });

  it("writes dirty localization with one BOM and its original language", () => {
    cfg.gameId = "eu5";
    const uri = source("in_game/localization/german/example_l_german.yml", '\uFEFFl_german:\n key:0 "Old"\n');
    dirty(uri.fsPath, '\uFEFFl_german:\n key:0 "Unsaved"\n');
    const result = importVanillaResource(cfg, uri, "file");
    expect(fs.readFileSync(result.target.fsPath, "utf8")).toBe('\uFEFFl_german:\n key:0 "Unsaved"\n');
  });

  it("rejects invalid localization, event namespace, and unsupported editor encodings", () => {
    const loc = source("localization/example_l_german.yml");
    const locDoc = dirty(loc.fsPath, 'l_english:\n key:0 "Wrong language"\n');
    expect(() => importVanillaResource(cfg, loc, "file")).toThrow("l_german: header");
    const event = source("events/example.txt");
    dirty(event.fsPath, "example.1 = {}\n");
    expect(() => importVanillaResource(cfg, event, "file")).toThrow("namespace = line");
    locDoc.encoding = "windows1252";
    expect(() => importVanillaResource(cfg, loc, "file")).toThrow("UTF-8");
    expect(fs.readdirSync(mod)).toEqual([]);
  });

  it("preserves existing mod files and offers the comparison entry point", async () => {
    const uri = source("common/traits/example.txt");
    const destination = path.join(mod, "common/traits/example.txt");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "user work");
    const document = dirty(destination, "unsaved mod work");
    host.showInformationMessage.mockResolvedValueOnce("Compare with Vanilla");
    await importVanillaFile(cfg, uri);
    expect(fs.readFileSync(destination, "utf8")).toBe("user work");
    expect(document.text).toBe("unsaved mod work");
    expect(host.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      uri,
      vscode.Uri.file(destination),
      path.relative(game, uri.fsPath)
    );
    expect(host.showInformationMessage.mock.calls[0][0]).toContain("contents were preserved");
  });

  it("does not create a backing file for an existing unsaved destination document", () => {
    const uri = source("example.txt");
    const destination = path.join(mod, "example.txt");
    dirty(destination, "unsaved destination");
    expect(importVanillaResource(cfg, uri, "file").status).toBe("exists");
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("reports an existing folder and rejects file/folder collisions", () => {
    const uri = source("common/traits/example.txt");
    fs.mkdirSync(path.join(mod, "common/traits"), { recursive: true });
    expect(importVanillaResource(cfg, vscode.Uri.file(path.dirname(uri.fsPath)), "folder").status).toBe(
      "exists"
    );
    fs.mkdirSync(path.join(mod, "common/traits/example.txt"));
    expect(() => importVanillaResource(cfg, uri, "file")).toThrow("different resource");
  });

  it("rejects paths outside vanilla, missing focused mods, and overlapping roots", () => {
    const external = path.join(fixture, "game-other/file.txt");
    fs.mkdirSync(path.dirname(external));
    fs.writeFileSync(external, "external");
    expect(() => importVanillaResource(cfg, vscode.Uri.file(external), "file")).toThrow("outside the game");
    const uri = source("example.txt");
    expect(() => importVanillaResource({ ...cfg, modPath: null }, uri, "file")).toThrow("Focus a mod");
    expect(() => importVanillaResource({ ...cfg, modPath: game }, uri, "file")).toThrow("must not overlap");
    expect(() => importVanillaResource({ ...cfg, modPath: fixture }, uri, "file")).toThrow(
      "must not overlap"
    );
    expect(fs.readFileSync(uri.fsPath, "utf8")).toBe("vanilla content");
  });

  it("rejects source and destination junction escapes", () => {
    const outside = path.join(fixture, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "example.txt"), "outside content");
    fs.symlinkSync(outside, path.join(game, "linked"), "junction");
    expect(() =>
      importVanillaResource(cfg, vscode.Uri.file(path.join(game, "linked/example.txt")), "file")
    ).toThrow("junction");
    const uri = source("common/example.txt");
    fs.symlinkSync(outside, path.join(mod, "common"), "junction");
    expect(() => importVanillaResource(cfg, uri, "file")).toThrow("junction");
    expect(fs.readdirSync(outside)).toEqual(["example.txt"]);
    expect(fs.readFileSync(path.join(outside, "example.txt"), "utf8")).toBe("outside content");
  });

  it("rejects source disk changes after the snapshot", () => {
    const uri = source("common/example.txt");
    const mkdir = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementation(((folder: fs.PathLike) => {
      fs.writeFileSync(uri.fsPath, "externally changed");
      return mkdir(folder);
    }) as typeof fs.mkdirSync);
    expect(() => importVanillaResource(cfg, uri, "file")).toThrow("source changed");
    expect(fs.existsSync(path.join(mod, "common/example.txt"))).toBe(false);
  });

  it("rejects source editor changes after the snapshot", () => {
    const uri = source("common/example.txt");
    const document = dirty(uri.fsPath, "unsaved script");
    const mkdir = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementation(((folder: fs.PathLike) => {
      document.version++;
      document.text = "newer unsaved script";
      return mkdir(folder);
    }) as typeof fs.mkdirSync);
    expect(() => importVanillaResource(cfg, uri, "file")).toThrow("source changed");
    expect(fs.existsSync(path.join(mod, "common/example.txt"))).toBe(false);
    expect(document.text).toBe("newer unsaved script");
  });

  it("reports source read failures without falling back to editor text", async () => {
    const uri = source("example.txt");
    dirty(uri.fsPath, "unsaved script");
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("read denied");
    });
    await importVanillaFile(cfg, uri);
    expect(host.showErrorMessage).toHaveBeenCalledWith("Vanilla import failed: read denied");
    expect(host.showInformationMessage).not.toHaveBeenCalled();
    expect(fs.readdirSync(mod)).toEqual([]);
  });

  it("removes only its partial output and reports write failure", async () => {
    const uri = source("example.txt");
    const write = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      bytes: string | NodeJS.ArrayBufferView
    ) => {
      expect(Buffer.isBuffer(bytes)).toBe(true);
      if (!Buffer.isBuffer(bytes)) throw new Error("Expected import bytes");
      write(file, bytes.subarray(0, 2));
      throw new Error("disk full");
    }) as typeof fs.writeFileSync);
    await importVanillaFile(cfg, uri);
    expect(host.showErrorMessage).toHaveBeenCalledWith("Vanilla import failed: disk full");
    expect(host.showInformationMessage).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(mod, "example.txt"))).toBe(false);
    expect(fs.readFileSync(uri.fsPath, "utf8")).toBe("vanilla content");
  });

  it("opens a successful import and handles invalid explicit targets", async () => {
    const uri = source("example.txt");
    await importVanillaFile(cfg, uri);
    expect(host.executeCommand).toHaveBeenCalledWith(
      "vscode.open",
      vscode.Uri.file(path.join(mod, "example.txt"))
    );
    expect(host.showInformationMessage).toHaveBeenCalledOnce();
    await importVanillaFile(cfg, {});
    expect(host.showErrorMessage).toHaveBeenCalledWith("Vanilla import failed: Choose a vanilla file");
  });
});
