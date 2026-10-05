import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PxConfig } from "../src/config";

interface Document {
  uri: { fsPath: string; scheme: string };
  text: string;
  version: number;
  isDirty: boolean;
  isClosed: boolean;
  encoding: string;
  getText(): string;
  positionAt(offset: number): number;
  save(): Promise<boolean>;
}
const host = vi.hoisted(() => ({
  documents: new Map<string, Document>(),
  global: new Map<string, unknown>(),
  workspace: new Map<string, unknown>(),
  folderValues: new Map<string, Map<string, unknown>>(),
  folders: [] as string[],
  trusted: true,
  rejectEdit: false,
  rejectSave: false,
  falseSave: false,
  rejectUpdate: false,
  updates: [] as { key: string; target: number; root: string }[],
  onOpen: (_file: string) => {},
  copyFailure: "",
  onCopy: () => {},
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    copyFileSync: (source: fs.PathLike, destination: fs.PathLike, flags?: number) => {
      if (host.copyFailure && String(source).endsWith(host.copyFailure)) throw new Error("locked");
      actual.copyFileSync(source, destination, flags);
      host.onCopy();
    },
  };
});

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath, scheme: "file", toString: () => "file:" + fsPath }) },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  Range: class {
    constructor(
      public start: number,
      public end: number
    ) {}
  },
  WorkspaceEdit: class {
    changes: { uri: { fsPath: string }; text: string }[] = [];
    replace(uri: { fsPath: string }, _range: unknown, text: string) {
      this.changes.push({ uri, text });
    }
  },
  workspace: {
    get isTrusted() {
      return host.trusted;
    },
    get textDocuments() {
      return [...host.documents.values()];
    },
    getWorkspaceFolder: (uri: { fsPath: string }) => {
      const folder = host.folders
        .filter((folder) => uri.fsPath === folder || uri.fsPath.startsWith(folder + path.sep))
        .sort((a, b) => b.length - a.length)[0];
      return folder ? { uri: { fsPath: folder, scheme: "file" } } : undefined;
    },
    getConfiguration: (_section: string, uri: { fsPath: string }) => {
      const folder = host.folders
        .filter((folder) => uri.fsPath === folder || uri.fsPath.startsWith(folder + path.sep))
        .sort((a, b) => b.length - a.length)[0];
      return {
        inspect: (key: string) => ({
          key,
          defaultValue: undefined,
          globalValue: host.global.get(key),
          workspaceValue: host.workspace.get(key),
          workspaceFolderValue: host.folderValues.get(folder)?.get(key),
        }),
        get: (key: string) =>
          host.folderValues.get(folder)?.get(key) ?? host.workspace.get(key) ?? host.global.get(key),
        update: async (key: string, value: unknown, target: number) => {
          if (host.rejectUpdate) throw new Error("Configuration update failed");
          host.updates.push({ key, target, root: folder });
          const values = target === 2 ? host.workspace : host.folderValues.get(folder)!;
          if (value === undefined) values.delete(key);
          else values.set(key, value);
        },
      };
    },
    openTextDocument: async (uri: { fsPath: string }) => {
      let doc = host.documents.get(uri.fsPath);
      if (!doc) {
        doc = {
          uri: { fsPath: uri.fsPath, scheme: "file" },
          text: fs.readFileSync(uri.fsPath, "utf8").replace(/^\uFEFF/, ""),
          version: 1,
          isDirty: false,
          isClosed: false,
          encoding: "utf8",
          getText() {
            return this.text;
          },
          positionAt(offset) {
            return offset;
          },
          async save() {
            if (host.rejectSave) return false;
            if (!host.falseSave) fs.writeFileSync(this.uri.fsPath, this.text);
            this.isDirty = false;
            return true;
          },
        };
        host.documents.set(uri.fsPath, doc);
      }
      host.onOpen(uri.fsPath);
      return doc;
    },
    applyEdit: async (edit: { changes: { uri: { fsPath: string }; text: string }[] }) => {
      if (host.rejectEdit) return false;
      for (const change of edit.changes) {
        const doc = host.documents.get(change.uri.fsPath)!;
        doc.text = change.text;
        doc.version++;
        doc.isDirty = true;
      }
      return true;
    },
  },
}));

import * as vscode from "vscode";
import { inspectProjectSetting, saveProjectSetting, saveProjectSettings } from "../src/projectSettings";
import { migrateProjectStorage } from "../src/storageUpgrade";

let root: string;
let cfg: PxConfig;
function seed(relative: string, text: string | Buffer, mod = root): string {
  const file = path.join(mod, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
function declaration(text = '{"version":1}', mod = root): string {
  return seed(".px-toolkit/project.json", text, mod);
}
function persisted(mod = root): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(mod, ".px-toolkit/project.json"), "utf8"));
}
async function dirty(file: string, text: string): Promise<Document> {
  await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const doc = host.documents.get(file)!;
  doc.text = text;
  doc.version++;
  doc.isDirty = true;
  return doc;
}
beforeEach(() => {
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/project-storage-"));
  cfg = {
    gameId: "ck3",
    modPath: root,
    workspaceMods: [],
    parentPaths: [],
    gamePath: null,
  } as unknown as PxConfig;
  host.documents.clear();
  host.global.clear();
  host.workspace.clear();
  host.folderValues.clear();
  host.updates.length = 0;
  host.folders = [root];
  host.folderValues.set(root, new Map());
  host.trusted = true;
  host.rejectEdit = false;
  host.rejectSave = false;
  host.falseSave = false;
  host.rejectUpdate = false;
  host.onOpen = () => {};
  host.copyFailure = "";
  host.onCopy = () => {};
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("project settings write boundary", () => {
  it("allows an explicit supported game switch and rejects auto or unknown games", async () => {
    const inspected = await inspectProjectSetting(cfg, "gameId");
    await expect(saveProjectSetting(cfg, "gameId", "auto", inspected.stamp)).rejects.toThrow("supported");
    await expect(saveProjectSetting(cfg, "gameId", "unknown", inspected.stamp)).rejects.toThrow("supported");
    await saveProjectSetting(cfg, "gameId", "vic3", inspected.stamp);
    expect(persisted()).toEqual({ version: 1, gameId: "vic3" });
    expect((await inspectProjectSetting({ ...cfg, gameId: "vic3" }, "gameId")).error).toBeUndefined();
  });
  it("reads legacy settings without writing and reports inherited personal defaults", async () => {
    seed(".ck3modding/project.json", '{"version":1,"validation":{"ignore":["old"]}}');
    host.global.set("characterHistory.quoteNames", true);
    expect(await inspectProjectSetting(cfg, "diagnostics.ignore")).toMatchObject({
      ownValue: ["old"],
      source: "project",
      legacy: true,
    });
    expect(await inspectProjectSetting(cfg, "characterHistory.quoteNames")).toMatchObject({
      ownValue: undefined,
      value: true,
      source: "user",
    });
    expect(fs.existsSync(path.join(root, ".px-toolkit"))).toBe(false);
  });
  it("edits the current dirty document and preserves unknown fields", async () => {
    const file = declaration();
    await dirty(file, '{"version":1,"custom":{"unsaved":true},"authoring":{"future":2}}');
    const inspected = await inspectProjectSetting(cfg, "characterHistory.quoteNames");
    await saveProjectSetting(cfg, "characterHistory.quoteNames", true, inspected.stamp);
    expect(persisted()).toEqual({
      version: 1,
      custom: { unsaved: true },
      authoring: { future: 2, characterHistory: { quoteNames: true } },
    });
  });
  it("copies dirty legacy declaration contents into canonical storage without changing the source", async () => {
    const old = seed(".ck3modding/project.json", '{"version":1,"unknown":1}');
    await dirty(old, '{"version":1,"unknown":2}');
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    await saveProjectSetting(cfg, "diagnostics.ignore", ["new"], inspected.stamp);
    expect(persisted()).toEqual({ version: 1, unknown: 2, validation: { ignore: ["new"] } });
    expect(fs.readFileSync(old, "utf8")).toBe('{"version":1,"unknown":1}');
    expect(host.documents.get(old)?.isDirty).toBe(true);
  });
  it("reset removes only the selected project override", async () => {
    declaration('{"version":1,"validation":{"ignore":["old"],"requireDescriptor":true},"unknown":3}');
    host.global.set("diagnostics.ignore", ["personal"]);
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    await saveProjectSetting(cfg, "diagnostics.ignore", undefined, inspected.stamp);
    expect(persisted()).toEqual({ version: 1, validation: { requireDescriptor: true }, unknown: 3 });
    expect(await inspectProjectSetting(cfg, "diagnostics.ignore")).toMatchObject({
      value: ["personal"],
      source: "user",
    });
  });
  it.each(["{", '{"version":2}', '{"version":1,"gameId":"vic3"}'])(
    "blocks an invalid current declaration %s",
    async (text) => {
      declaration(text);
      seed(".ck3modding/project.json", '{"version":1}');
      const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
      expect(inspected.error).toBeTruthy();
      await expect(saveProjectSetting(cfg, "diagnostics.ignore", [], inspected.stamp)).rejects.toThrow();
      expect(fs.readFileSync(path.join(root, ".px-toolkit/project.json"), "utf8")).toBe(text);
    }
  );
  it.each(["disk", "editor", "native"])("rejects stale %s state", async (kind) => {
    const file = declaration();
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    if (kind === "disk") fs.writeFileSync(file, '{"version":1,"external":true}');
    if (kind === "editor") await dirty(file, '{"version":1,"unsaved":true}');
    if (kind === "native") host.global.set("diagnostics.ignore", ["changed"]);
    await expect(saveProjectSetting(cfg, "diagnostics.ignore", [], inspected.stamp)).rejects.toThrow(
      "changed"
    );
    expect(persisted().validation).toBeUndefined();
  });
  it("rejects a disk edit made while opening the target", async () => {
    const file = declaration();
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    host.onOpen = () => fs.writeFileSync(file, '{"version":1,"external":true}');
    await expect(saveProjectSetting(cfg, "diagnostics.ignore", [], inspected.stamp)).rejects.toThrow(
      "changed"
    );
    expect(persisted()).toEqual({ version: 1, external: true });
  });
  it("rejects a native settings edit made while opening the target", async () => {
    declaration();
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    host.onOpen = () => host.global.set("diagnostics.ignore", ["changed"]);
    await expect(saveProjectSetting(cfg, "diagnostics.ignore", [], inspected.stamp)).rejects.toThrow(
      "changed"
    );
    expect(persisted()).toEqual({ version: 1 });
  });
  it.each(["edit", "save", "readback"])("reports %s failure", async (kind) => {
    declaration();
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    host.rejectEdit = kind === "edit";
    host.rejectSave = kind === "save";
    host.falseSave = kind === "readback";
    await expect(saveProjectSetting(cfg, "diagnostics.ignore", [], inspected.stamp)).rejects.toThrow();
    expect(persisted()).toEqual({ version: 1 });
  });
  it("blocks untrusted and vanilla writes", async () => {
    const inspected = await inspectProjectSetting(cfg, "diagnostics.ignore");
    host.trusted = false;
    await expect(saveProjectSetting(cfg, "diagnostics.ignore", [], inspected.stamp)).rejects.toThrow("Trust");
    host.trusted = true;
    await expect(
      saveProjectSetting({ ...cfg, gamePath: root }, "diagnostics.ignore", [], inspected.stamp)
    ).rejects.toThrow("read-only");
    expect(fs.existsSync(path.join(root, ".px-toolkit"))).toBe(false);
  });
});

describe("legacy storage upgrade", () => {
  it("repeats a legacy project and native settings upgrade without an expected-divergence conflict", async () => {
    const legacy = '{"version":1,"authoring":{"custom":{"nested":true}},"unknown":{"entries":[{"value":1}]}}';
    const source = seed(".ck3modding/project.json", legacy);
    host.workspace.set("diagnostics.ignore", ["team"]);
    host.workspace.set("characterHistory.quoteNames", false);
    const first = await migrateProjectStorage([cfg]);
    expect(first.errors).toEqual([]);
    expect(first.conflicts).toEqual([]);
    expect(first.copied).toHaveLength(1);
    expect(first.imported).toHaveLength(2);
    expect(first.removed).toHaveLength(2);
    const saved = fs.readFileSync(path.join(root, ".px-toolkit/project.json"), "utf8");
    expect(persisted()).toEqual({
      version: 1,
      authoring: { custom: { nested: true }, characterHistory: { quoteNames: false } },
      unknown: { entries: [{ value: 1 }] },
      validation: { ignore: ["team"] },
    });
    const second = await migrateProjectStorage([cfg]);
    expect(second).toEqual({ copied: [], imported: [], conflicts: [], errors: [], removed: [], noOp: true });
    expect(fs.readFileSync(path.join(root, ".px-toolkit/project.json"), "utf8")).toBe(saved);
    expect(fs.readFileSync(source, "utf8")).toBe(legacy);
  });
  it.each([
    [{ nested: 1 }, { nested: 2 }],
    [null, {}],
    [{}, []],
    [
      [1, 2],
      [1, 2, 3],
    ],
    [[{ value: 1 }], [{ value: 1, added: true }]],
  ])("retains a real unknown-field conflict between %j and %j", async (legacy, current) => {
    seed(".ck3modding/project.json", JSON.stringify({ version: 1, unknown: legacy }));
    const text = JSON.stringify({ version: 1, unknown: current });
    declaration(text);
    const report = await migrateProjectStorage([cfg]);
    expect(report.conflicts).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, ".px-toolkit/project.json"), "utf8")).toBe(text);
  });
  it("rejects config junctions without copying their targets", async () => {
    seed("linked/schema.json", "private");
    fs.mkdirSync(path.join(root, ".ck3modding"));
    fs.symlinkSync(path.join(root, "linked"), path.join(root, ".ck3modding/workshop"), "junction");
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors.join(" ")).toContain("links");
    expect(fs.existsSync(path.join(root, ".px-toolkit/workshop/schema.json"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "linked/schema.json"), "utf8")).toBe("private");
  });
  it.each([
    ["ck3", ".ck3modding"],
    ["vic3", ".vic3modding"],
    ["eu5", ".eu5modding"],
  ])("copies %s artifacts independently, retaining conflicts and binary assets", async (gameId, old) => {
    cfg.gameId = gameId;
    seed(old + "/schema.json", '{"old":true}');
    const bytes = Buffer.from([0, 255, 40, 12]);
    seed(old + "/workshop/previews/image.bin", bytes);
    seed(old + "/unknown.dat", "recovery");
    seed(".px-toolkit/schema.json", '{"new":true}');
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors).toEqual([]);
    expect(result.copied).toHaveLength(2);
    expect(result.conflicts).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, ".px-toolkit/workshop/previews/image.bin"))).toEqual(bytes);
    expect(fs.readFileSync(path.join(root, ".px-toolkit/schema.json"), "utf8")).toBe('{"new":true}');
    expect(fs.existsSync(path.join(root, old, "unknown.dat"))).toBe(true);
    expect((await migrateProjectStorage([cfg])).noOp).toBe(true);
  });
  it("imports only explicit team settings and leaves private/editor values out", async () => {
    host.global.set("characterHistory.quoteNames", true);
    host.global.set("gamePath", "private");
    host.workspace.set("diagnostics.ignore", ["team"]);
    host.workspace.set("hover.detail", "full");
    host.folderValues.get(root)!.set("characterHistory.quoteCultures", false);
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors).toEqual([]);
    expect(result.removed).toHaveLength(2);
    expect(persisted()).toEqual({
      version: 1,
      validation: { ignore: ["team"] },
      authoring: { characterHistory: { quoteCultures: false } },
    });
    expect(host.workspace.get("hover.detail")).toBe("full");
    expect(host.global.get("characterHistory.quoteNames")).toBe(true);
  });
  it("preserves native sources when an existing project value conflicts", async () => {
    declaration('{"version":1,"validation":{"ignore":["project"]}}');
    host.workspace.set("diagnostics.ignore", ["native"]);
    const result = await migrateProjectStorage([cfg]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.removed).toEqual([]);
    expect(host.workspace.get("diagnostics.ignore")).toEqual(["native"]);
  });
  it.each(["{", '{"version":2}', '{"version":1,"gameId":"vic3"}'])(
    "retains native settings for invalid canonical declaration %s",
    async (text) => {
      declaration(text);
      seed(".ck3modding/unknown.dat", "still copied");
      host.workspace.set("diagnostics.ignore", ["native"]);
      const result = await migrateProjectStorage([cfg]);
      expect(result.errors).not.toHaveLength(0);
      expect(result.copied).toHaveLength(1);
      expect(result.removed).toEqual([]);
      expect(fs.readFileSync(path.join(root, ".px-toolkit/project.json"), "utf8")).toBe(text);
    }
  );
  it("resumes after a partial copy failure without overwriting either side", async () => {
    seed(".ck3modding/a.bin", "a");
    seed(".ck3modding/b.bin", "b");
    host.copyFailure = "b.bin";
    const first = await migrateProjectStorage([cfg]);
    expect(first.copied).toHaveLength(1);
    expect(first.errors).toHaveLength(1);
    host.copyFailure = "";
    const second = await migrateProjectStorage([cfg]);
    expect(second.errors).toEqual([]);
    expect(second.copied).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, ".ck3modding/b.bin"), "utf8")).toBe("b");
  });
  it("rejects changed inputs before copying subsequent artifacts", async () => {
    seed(".ck3modding/a.bin", "a");
    const b = seed(".ck3modding/b.bin", "b");
    host.onCopy = () => fs.writeFileSync(b, "changed");
    const result = await migrateProjectStorage([cfg]);
    expect(result.copied).toHaveLength(1);
    expect(result.errors.join(" ")).toContain("changed during");
    expect(fs.existsSync(path.join(root, ".px-toolkit/b.bin"))).toBe(false);
  });
  it.each(["source", "destination", "settings"])("blocks dirty %s configuration", async (kind) => {
    const source = seed(".ck3modding/schema.json", "source");
    const file =
      kind === "source"
        ? source
        : kind === "destination"
          ? seed(".px-toolkit/schema.json", "destination")
          : seed(".vscode/settings.json", "{}");
    await dirty(file, "unsaved");
    host.workspace.set("diagnostics.ignore", ["native"]);
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors.join(" ")).toContain("Save");
    if (kind === "source") expect(fs.existsSync(path.join(root, ".px-toolkit/schema.json"))).toBe(false);
    if (kind === "settings") expect(result.removed).toEqual([]);
    expect(host.documents.get(file)?.text).toBe("unsaved");
  });
  it("imports Workspace rules into all mods, Folder rules only into their owner, then clears both", async () => {
    const first = path.join(root, "first"),
      second = path.join(root, "second");
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    host.folders = [first, second];
    host.folderValues.set(first, new Map([["characterHistory.quoteNames", false]]));
    host.folderValues.set(second, new Map());
    host.workspace.set("diagnostics.ignore", ["both"]);
    const a = { ...cfg, modPath: first, workspaceMods: [second] };
    const b = { ...cfg, modPath: second, workspaceMods: [first] };
    const result = await migrateProjectStorage([a, b]);
    expect(result.errors).toEqual([]);
    expect(result.removed).toHaveLength(2);
    expect(persisted(first)).toEqual({
      version: 1,
      validation: { ignore: ["both"] },
      authoring: { characterHistory: { quoteNames: false } },
    });
    expect(persisted(second)).toEqual({ version: 1, validation: { ignore: ["both"] } });
  });
  it("retains Workspace sources when the batch is incomplete", async () => {
    const second = path.join(root, "second");
    fs.mkdirSync(second);
    host.workspace.set("diagnostics.ignore", ["both"]);
    const result = await migrateProjectStorage([{ ...cfg, workspaceMods: [second] }]);
    expect(result.removed).toEqual([]);
    expect(host.workspace.get("diagnostics.ignore")).toEqual(["both"]);
  });
  it("reports cleanup failure and keeps verified project values for retry", async () => {
    host.workspace.set("diagnostics.ignore", ["team"]);
    host.rejectUpdate = true;
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors.join(" ")).toContain("update failed");
    expect(result.removed).toEqual([]);
    expect(persisted()).toEqual({ version: 1, validation: { ignore: ["team"] } });
    host.rejectUpdate = false;
    const retry = await migrateProjectStorage([cfg]);
    expect(retry.errors).toEqual([]);
    expect(retry.removed).toHaveLength(1);
  });
  it("retains absolute changelog paths for the personal migration phase", async () => {
    host.workspace.set("workshop.changelog", path.join(root, "CHANGELOG.md"));
    host.workspace.set("diagnostics.ignore", ["team"]);
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors).toEqual([]);
    expect(result.conflicts.join(" ")).toContain("personal settings");
    expect(persisted()).toEqual({ version: 1, validation: { ignore: ["team"] } });
    expect(host.workspace.has("workshop.changelog")).toBe(true);
  });
  it("does not write in an untrusted workspace", async () => {
    seed(".ck3modding/schema.json", "data");
    host.workspace.set("diagnostics.ignore", ["team"]);
    host.trusted = false;
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors.join(" ")).toContain("Trust");
    expect(fs.existsSync(path.join(root, ".px-toolkit"))).toBe(false);
  });
  it("imports an explicit team calendar without copying personal calendar defaults", async () => {
    host.global.set("calendar", { epoch: 10, after: "Personal" });
    expect((await migrateProjectStorage([cfg])).imported).toEqual([]);
    expect(fs.existsSync(path.join(root, ".px-toolkit/calendar.json"))).toBe(false);
    host.workspace.set("calendar", { epoch: 4000, after: "AD", before: "BC" });
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(root, ".px-toolkit/calendar.json"), "utf8"))).toEqual({
      epoch: 4000,
      after: "AD",
      before: "BC",
    });
    expect(host.global.get("calendar")).toEqual({ epoch: 10, after: "Personal" });
    expect(fs.existsSync(path.join(root, ".px-toolkit/project.json"))).toBe(false);
  });
  it("retains different native calendars and preserves unknown canonical calendar fields", async () => {
    const file = seed(".px-toolkit/calendar.json", '{"epoch":4000,"after":"AD","custom":true}');
    host.workspace.set("calendar", { epoch: 100, after: "TA" });
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors).toEqual([]);
    expect(result.conflicts.join(" ")).toContain("calendar differs");
    expect(result.removed).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe('{"epoch":4000,"after":"AD","custom":true}');
  });
  it("cleans up identical calendars without rewriting unknown fields or BOM", async () => {
    const text = "\uFEFF" + '{"epoch":4000,"after":"AD","custom":true}';
    const file = seed(".px-toolkit/calendar.json", text);
    host.workspace.set("calendar", { epoch: 4000, after: "AD" });
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(result.imported).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
  it("keeps invalid and dirty calendar sources for recovery", async () => {
    const file = seed(".px-toolkit/calendar.json", '{"epoch":0}');
    host.workspace.set("calendar", { epoch: 100, after: "TA" });
    expect((await migrateProjectStorage([cfg])).errors.join(" ")).toContain("valid calendar");
    await dirty(file, '{"epoch":4000,"after":"AD"}');
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors.join(" ")).toContain("Save");
    expect(result.removed).toEqual([]);
    expect(host.workspace.has("calendar")).toBe(true);
  });
  it("migrates calendar ownership for all child mods before removing container settings", async () => {
    const first = path.join(root, "first"),
      second = path.join(root, "second");
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    host.folderValues.get(root)!.set("calendar", { epoch: 100, after: "TA" });
    const result = await migrateProjectStorage([
      { ...cfg, modPath: first, workspaceMods: [second] },
      { ...cfg, modPath: second, workspaceMods: [first] },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.imported).toHaveLength(2);
    expect(result.removed).toHaveLength(1);
    for (const mod of [first, second])
      expect(JSON.parse(fs.readFileSync(path.join(mod, ".px-toolkit/calendar.json"), "utf8"))).toEqual({
        epoch: 100,
        after: "TA",
      });
  });
  it("retains calendar source settings when saving fails", async () => {
    host.workspace.set("calendar", { epoch: 100, after: "TA" });
    host.rejectSave = true;
    const result = await migrateProjectStorage([cfg]);
    expect(result.errors.join(" ")).toContain("could not be saved");
    expect(result.removed).toEqual([]);
    expect(host.workspace.has("calendar")).toBe(true);
  });
});

describe("shared mod settings batches", () => {
  it("applies multiple rules to the current dirty document in one save", async () => {
    const file = declaration();
    const doc = await dirty(file, '{"version":1,"unknown":"unsaved","authoring":{"future":"keep"}}');
    const save = vi.spyOn(doc, "save");
    const names = await inspectProjectSetting(cfg, "characterHistory.quoteNames");
    const descriptor = await inspectProjectSetting(cfg, "diagnostics.requireDescriptor");
    await saveProjectSettings(cfg, [
      { key: "characterHistory.quoteNames", value: false, expectedStamp: names.stamp },
      { key: "diagnostics.requireDescriptor", value: true, expectedStamp: descriptor.stamp },
    ]);
    expect(save).toHaveBeenCalledOnce();
    expect(persisted()).toEqual({
      version: 1,
      unknown: "unsaved",
      authoring: { future: "keep", characterHistory: { quoteNames: false } },
      validation: { requireDescriptor: true },
    });
  });
  it("rejects every draft before a write if one inherited inspection changed", async () => {
    const file = declaration();
    const doc = await dirty(file, '{"version":1,"unknown":"unsaved"}');
    const save = vi.spyOn(doc, "save");
    const names = await inspectProjectSetting(cfg, "characterHistory.quoteNames");
    const descriptor = await inspectProjectSetting(cfg, "diagnostics.requireDescriptor");
    host.global.set("diagnostics.requireDescriptor", true);
    await expect(
      saveProjectSettings(cfg, [
        { key: "characterHistory.quoteNames", value: false, expectedStamp: names.stamp },
        { key: "diagnostics.requireDescriptor", value: true, expectedStamp: descriptor.stamp },
      ])
    ).rejects.toThrow("changed");
    expect(save).not.toHaveBeenCalled();
    expect(doc.text).toBe('{"version":1,"unknown":"unsaved"}');
    expect(persisted()).toEqual({ version: 1 });
  });
});
