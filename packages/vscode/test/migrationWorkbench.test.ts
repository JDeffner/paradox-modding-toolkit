import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { promises as fileSystem } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { URI } from "vscode-uri";
import type * as VSCode from "vscode";
import type { MigrationManifest, MigrationSession } from "../../protocol/src/migration";
import type { MigrationEntry } from "../../server/src/migrations/sdk";
import type { MigrationViewState } from "../src/webviews/compatch/messages";
import type { PxConfig } from "../src/config";
import { discoverMigration, inspectMigration, prepareMigration } from "../../server/src/migrations/engine";
import type { captureMigration } from "../../server/src/migrations/node/files";

const ui = vi.hoisted(() => ({
  state: undefined as MigrationViewState | undefined,
  entries: new Map<string, MigrationEntry[]>(),
  builtin: [] as MigrationEntry[],
  trusted: true,
  warning: vi.fn(),
  folders: vi.fn(),
  picker: vi.fn(),
  versions: new Map<string, string>(),
  worker: vi.fn(),
  documents: [] as VSCode.TextDocument[],
  capture: vi.fn(),
  fileChanged: undefined as ((uri: URI) => Promise<void>) | undefined,
  editorChanged: undefined as ((event: { document: { uri: URI } }) => void) | undefined,
}));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { One: 1 },
    TabInputCustom: class {},
    Range: class {},
    WorkspaceEdit: class {
      changes: { uri: URI; text: string }[] = [];
      replace(uri: URI, _range: unknown, text: string) {
        this.changes.push({ uri, text });
      }
    },
    commands: { executeCommand: vi.fn() },
    window: {
      createWebviewPanel: () => ({
        webview: {
          html: "",
          onDidReceiveMessage: () => disposable,
          postMessage: (message: { state: MigrationViewState }) => {
            ui.state = structuredClone(message.state);
          },
        },
        onDidDispose: () => disposable,
        dispose() {},
        reveal() {},
      }),
      tabGroups: { all: [] },
      showWarningMessage: ui.warning,
      showOpenDialog: ui.folders,
      showQuickPick: ui.picker,
    },
    workspace: {
      get isTrusted() {
        return ui.trusted;
      },
      get textDocuments() {
        return ui.documents;
      },
      applyEdit: async (edit: { changes: { uri: URI; text: string }[] }) => {
        for (const change of edit.changes) {
          const document = ui.documents.find((doc) => doc.uri.fsPath === change.uri.fsPath) as unknown as {
            text: string;
            version: number;
            isDirty: boolean;
          };
          if (!document) return false;
          document.text = change.text;
          document.version++;
          document.isDirty = true;
        }
        return true;
      },
      getConfiguration: () => ({ get: () => true }),
      registerTextDocumentContentProvider: () => disposable,
      onDidChangeTextDocument: (callback: (event: { document: { uri: URI } }) => void) => {
        ui.editorChanged = callback;
        return disposable;
      },
      createFileSystemWatcher: () => ({
        onDidChange: (callback: (uri: URI) => Promise<void>) => {
          ui.fileChanged = callback;
          return disposable;
        },
        onDidCreate: () => disposable,
        onDidDelete: () => disposable,
        dispose() {},
      }),
    },
  };
});
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/fixture/dist/webview"), watch: false }),
  bundleUri: () => "https://fixture.invalid/compatch.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/descriptorMod", () => ({
  detectGameVersion: (folder: string | null) => (folder ? (ui.versions.get(folder) ?? null) : null),
}));
vi.mock("@px-lsp/server/migrations/routes", async () => await import("../../server/src/migrations/routes"));
vi.mock("@px-lsp/server/migrations/engine", async () => await import("../../server/src/migrations/engine"));
vi.mock("@px-lsp/server/migrations/node/runner", () => ({ runMigrationWorker: ui.worker }));
vi.mock("@px-lsp/server/migrations/node/files", async () => ({
  ...(await vi.importActual("../../server/src/migrations/node/files")),
  captureMigration: ui.capture,
}));

import { MigrationWorkbench } from "../src/compatch/migrations";
import { entryBlock, clearDownstream, mergeMigrationCatalog } from "../src/compatch/migrationRouteSession";

let scratch: string;
let mod: string;
let storage: string;
let artifact: string;
let saved: Map<string, unknown>;
let captureInputs: typeof captureMigration;
const workbenches: MigrationWorkbench[] = [];

function manifest(
  id: string,
  fromVersion = "1.0",
  toVersion = "2.0",
  extra: Partial<MigrationManifest> = {}
): MigrationManifest {
  return {
    id,
    revision: "1",
    sdkVersion: 1,
    gameId: "ck3",
    fromVersion,
    toVersion,
    kind: "advisory",
    detection: "none",
    requirement: "required",
    title: id,
    description: "Fixture",
    guidance: "Resolve the fixture requirement.",
    limitations: ["Synthetic fixture only."],
    dependsOn: [],
    evidence: ["Synthetic fixture"],
    inputs: [],
    ...extra,
  };
}
function recipe(
  id: string,
  fromVersion: string,
  toVersion: string,
  from: string,
  to: string
): MigrationEntry {
  return {
    manifest: manifest(id, fromVersion, toVersion, {
      kind: "recipe",
      detection: "script",
      inputs: [{ root: "mod", path: "fixture.txt" }],
    }),
    inspect: (context) => ({
      applicability: context.readText("mod", "fixture.txt")?.includes(from) ? "applicable" : "not-applicable",
      questions: [],
      findings: [],
      coverage: ["Synthetic fixture"],
    }),
    prepare: (context) => ({
      groups: [
        {
          id: "edit",
          title: "Edit fixture",
          dependsOn: [],
          changes: [
            {
              kind: "text",
              path: "fixture.txt",
              edits: [
                {
                  start: context.readText("mod", "fixture.txt")!.indexOf(from),
                  end: context.readText("mod", "fixture.txt")!.indexOf(from) + from.length,
                  text: to,
                },
              ],
            },
          ],
        },
      ],
      checks: [],
      unresolved: [],
    }),
  };
}
async function open(gamePath: string | null = null): Promise<MigrationWorkbench> {
  const context = {
    workspaceState: {
      get: (key: string) => saved.get(key),
      update: async (key: string, value: unknown) => {
        if (value === undefined) saved.delete(key);
        else saved.set(key, structuredClone(value));
      },
    },
    subscriptions: [],
    storageUri: URI.file(storage),
    globalStorageUri: URI.file(storage),
    asAbsolutePath: () => artifact,
  } as unknown as VSCode.ExtensionContext;
  const bench = new MigrationWorkbench(context, { gameId: "ck3", modPath: mod, gamePath } as PxConfig);
  workbenches.push(bench);
  await bench.ready;
  return bench;
}
const session = () => saved.get("migrationSession.v2") as MigrationSession;
async function contribution(filename: string, entries: MigrationEntry[]): Promise<string> {
  const localPath = path.join(scratch, filename);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, "fixture contribution");
  ui.entries.set(localPath, entries);
  return localPath;
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "px-migration-host-"));
  mod = path.join(scratch, "mod");
  storage = path.join(scratch, "storage");
  artifact = path.join(scratch, "worker.cjs");
  await fs.mkdir(mod);
  await fs.mkdir(storage);
  await fs.writeFile(artifact, "fixture artifact");
  saved = new Map();
  ui.entries.clear();
  ui.versions.clear();
  ui.builtin = [];
  ui.documents = [];
  ui.trusted = true;
  ui.warning.mockReset();
  ui.warning.mockResolvedValue("Trust and load");
  ui.folders.mockReset();
  ui.picker.mockReset();
  ui.picker.mockImplementation(async (items) => items);
  ui.worker.mockReset();
  ui.capture.mockReset();
  captureInputs = (
    await vi.importActual<typeof import("../../server/src/migrations/node/files")>(
      "../../server/src/migrations/node/files"
    )
  ).captureMigration;
  ui.capture.mockImplementation(captureInputs);
  ui.worker.mockImplementation(async (_file, request) => {
    if (request.action === "catalog")
      return { kind: "catalog", manifests: ui.builtin.map((entry) => entry.manifest) };
    const entries = request.selection.localPath ? ui.entries.get(request.selection.localPath)! : ui.builtin;
    if (!entries) throw new Error("Invalid contribution file.");
    const codeHash = createHash("sha256")
      .update(await fs.readFile(request.selection.localPath ?? artifact))
      .digest("hex");
    if (request.selection.codeHash && request.selection.codeHash !== codeHash)
      throw new Error("Artifact changed.");
    if (request.action === "load")
      return { kind: "loaded", manifests: entries.map((entry) => entry.manifest), codeHash };
    const entry = entries.find((item) => item.manifest.id === request.selection.id)!;
    if (request.action === "discover")
      return {
        kind: "discovered",
        selected: await discoverMigration(entry, request.snapshot, request.answers),
      };
    if (request.action === "inspect")
      return { kind: "inspected", result: await inspectMigration(entry, request.snapshot, request.answers) };
    return {
      kind: "prepared",
      plan: await prepareMigration(entry, request.snapshot, request.answers, codeHash),
    };
  });
});
afterEach(async () => {
  for (const bench of workbenches.splice(0)) bench.dispose();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe("ordered compatibility host", () => {
  it("recaptures discovery after answers and resumes completion without running author code", async () => {
    const entry = recipe("a", "1.0", "2.0", "old", "new");
    entry.manifest.sdkVersion = 2;
    entry.manifest.inputs = [{ root: "mod", path: "", extensions: [".bin"], capture: "listing" }];
    const discover = vi.fn((_context, answers) =>
      answers.batch ? [{ root: "mod" as const, path: "selected.bin" }] : []
    );
    entry.discover = discover;
    entry.inspect = (context) => ({
      applicability: "applicable",
      findings: [],
      questions: [{ id: "batch", label: "Batch", kind: "boolean", required: true }],
      coverage: [context.readBytes("mod", "selected.bin") ? "full" : "listing"],
    });
    entry.prepare = () => ({
      groups: [
        {
          id: "binary",
          title: "Binary",
          dependsOn: [],
          changes: [{ kind: "replace", path: "selected.bin", bytes: new Uint8Array([2]) }],
        },
      ],
      unresolved: [],
      checks: [],
    });
    ui.builtin = [entry];
    await fs.writeFile(path.join(mod, "selected.bin"), new Uint8Array([1]));
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "scan" });
    expect(ui.state!.inspection!.coverage).toEqual(["listing"]);
    await bench.handle({ type: "answer", id: "batch", value: true });
    expect(ui.state!.inspection!.coverage).toEqual(["full"]);
    await bench.handle({ type: "prepare" });
    await bench.handle({ type: "apply" });
    expect(session().completions.a.capture).toEqual({ selected: [{ root: "mod", path: "selected.bin" }] });
    const runs = discover.mock.calls.length;
    await open();
    expect(discover).toHaveBeenCalledTimes(runs);
    expect(session().completions.a.state).toBe("applied");
    await fs.writeFile(path.join(mod, "selected.bin"), new Uint8Array([3]));
    await open();
    expect(discover).toHaveBeenCalledTimes(runs);
    expect(session().completions).toEqual({});
  });

  it("keeps an applied batch in the current entry while continuation remains", async () => {
    const entry = recipe("a", "1.0", "2.0", "old", "new");
    const prepare = entry.prepare!;
    entry.prepare = async (context, answers) => ({
      ...(await prepare(context, answers)),
      continuation: true,
    });
    ui.builtin = [entry];
    await fs.writeFile(path.join(mod, "fixture.txt"), "old");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "prepare" });
    await bench.handle({ type: "apply" });
    expect(session().completions).toEqual({});
    expect(ui.state!.status).toContain("Applied this batch");
    expect(ui.state!.canRestore).toBe(true);
  });

  it("discards an older delayed watcher result after a newer manual completion", async () => {
    ui.builtin = [
      { manifest: manifest("a", "1.0", "2.0", { inputs: [{ root: "mod", path: "fixture.txt" }] }) },
      { manifest: manifest("b", "2.0", "3.0", { inputs: [{ root: "mod", path: "fixture.txt" }] }) },
    ];
    const file = path.join(mod, "fixture.txt");
    await fs.writeFile(file, "fixture");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    await bench.handle({ type: "complete", state: "manual", note: "First resolution" });
    await bench.handle({ type: "next" });
    let release!: () => void, captured!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      captured = resolve;
    });
    ui.capture.mockImplementationOnce(async (...args: Parameters<typeof captureMigration>) => {
      const snapshot = await captureInputs(...args);
      captured();
      await paused;
      return snapshot;
    });
    const observer = ui.fileChanged!(URI.file(file));
    await started;
    await bench.handle({ type: "complete", state: "manual", note: "Second resolution" });
    expect(session().completions.b.state).toBe("manual");
    release();
    await observer;
    expect(Object.keys(session().completions)).toEqual(["a", "b"]);
    expect(ui.state!.entries.b.completion!.state).toBe("manual");
    expect(ui.state!.error).toBeUndefined();
    await fs.writeFile(file, "genuine external edit");
    await ui.fileChanged!(URI.file(file));
    expect(session().completions).toEqual({});
    expect(ui.state!.status).toContain("progress was reopened");
  });
  it("ignores editor lifecycle and version changes for progress while detecting changed effective text", async () => {
    ui.builtin = [
      { manifest: manifest("a", "1.0", "2.0", { inputs: [{ root: "mod", path: "fixture.txt" }] }) },
    ];
    const file = path.join(mod, "fixture.txt");
    await fs.writeFile(file, "\uFEFFfixture");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "complete", state: "manual", note: "Resolved" });
    const document = {
      uri: URI.file(file),
      text: "fixture",
      version: 1,
      isDirty: false,
      isClosed: false,
      getText() {
        return this.text;
      },
    };
    ui.documents = [document as unknown as VSCode.TextDocument];
    await ui.fileChanged!(URI.file(file));
    expect(session().completions.a.state).toBe("manual");
    document.version = 42;
    await ui.fileChanged!(URI.file(file));
    expect(session().completions.a.state).toBe("manual");
    ui.documents = [];
    await ui.fileChanged!(URI.file(file));
    expect(session().completions.a.state).toBe("manual");
    document.text = "changed dirty text";
    document.isDirty = true;
    ui.documents = [document as unknown as VSCode.TextDocument];
    await ui.fileChanged!(URI.file(file));
    expect(session().completions).toEqual({});
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFfixture");
  });
  it.each(["unknown", "no-op", "unresolved"])("does not record a %s recipe as applied", async (kind) => {
    const entry = recipe("a", "1.0", "2.0", "old", "new");
    if (kind === "unknown")
      entry.inspect = () => ({
        applicability: "unknown",
        questions: [],
        findings: [],
        coverage: ["Cannot determine fixture applicability"],
      });
    if (kind === "no-op") entry.prepare = () => ({ groups: [], checks: [], unresolved: [] });
    if (kind === "unresolved") {
      const original = entry.prepare!;
      entry.prepare = async (context, answers) => ({
        ...(await original(context, answers)),
        unresolved: [{ id: "manual", severity: "warning", message: "Manual work remains" }],
      });
    }
    ui.builtin = [entry];
    const file = path.join(mod, "fixture.txt");
    await fs.writeFile(file, "\uFEFFold");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "prepare" });
    if (kind === "unknown") expect(ui.state!.error).toContain("applicable inspection");
    if (kind === "unresolved") expect(ui.state!.preview!.blocked).toContain("remaining recipe work");
    await bench.handle({ type: "apply" });
    expect(ui.state!.error).toBeDefined();
    expect(session().completions.a).toBeUndefined();
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFold");
    await bench.handle({
      type: "complete",
      state: "manual",
      note: "Completed and checked the fixture manually",
    });
    expect(session().completions.a.state).toBe("manual");
  });
  it("allows blocked guidance to be read, gates completion, and requires a manual note", async () => {
    ui.builtin = [{ manifest: manifest("a") }, { manifest: manifest("b", "2.0", "3.0") }];
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    await bench.handle({ type: "recipe", id: "b" });
    expect(ui.state!.selected!.id).toBe("b");
    await bench.handle({ type: "complete", state: "manual", note: "Finished" });
    expect(ui.state!.error).toContain("earlier required entry a");
    await bench.handle({ type: "recipe", id: "a" });
    await bench.handle({ type: "complete", state: "read" });
    expect(ui.state!.error).toContain("manual resolution note");
    await bench.handle({ type: "complete", state: "manual" });
    expect(ui.state!.error).toContain("Describe how");
    await bench.handle({
      type: "complete",
      state: "manual",
      note: "Checked and resolved fixture requirement",
    });
    await bench.handle({ type: "next" });
    expect(ui.state!.selected!.id).toBe("b");
    expect(session().completions.a.state).toBe("manual");
  });
  it("does not select among alternative routes", async () => {
    ui.builtin = [
      { manifest: manifest("a") },
      { manifest: manifest("b", "2.0", "3.0") },
      { manifest: manifest("direct", "1.0", "3.0") },
    ];
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    expect(ui.state!.routes).toHaveLength(2);
    expect(ui.state!.route).toBeUndefined();
    await bench.handle({ type: "route", id: "1.0->2.0->3.0" });
    expect(ui.state!.selected!.id).toBe("a");
  });
  it("loads a data-only note without trust and requires reload for saved local code", async () => {
    const local = path.join(scratch, "note.json");
    await fs.writeFile(local, "{}");
    ui.entries.set(local, [{ manifest: manifest("note") }]);
    ui.trusted = false;
    const bench = await open();
    await bench.handle({ type: "load" }, URI.file(local));
    expect(ui.warning).not.toHaveBeenCalled();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "complete", state: "manual", note: "Resolved" });
    expect(session().completions.note.state).toBe("manual");
    bench.dispose();
    const script = path.join(scratch, "recipe.cjs");
    await fs.writeFile(script, "fixture recipe");
    ui.entries.set(script, [recipe("code", "1.0", "2.0", "a", "b")]);
    ui.trusted = true;
    const authoring = await open();
    await authoring.handle({ type: "load" }, URI.file(script));
    authoring.dispose();
    const resumed = await open();
    await resumed.handle({ type: "scan" });
    expect(ui.state!.error).toContain("explicitly trust");
    expect(ui.worker.mock.calls.filter(([, request]) => request.action === "inspect")).toHaveLength(0);
  });
  it("reopens stale route progress on resume while keeping answers", async () => {
    ui.builtin = [
      { manifest: manifest("a", "1.0", "2.0", { inputs: [{ root: "mod", path: "fixture.txt" }] }) },
    ];
    await fs.writeFile(path.join(mod, "fixture.txt"), "before");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "recipe", id: "a" });
    await bench.handle({ type: "complete", state: "manual", note: "Resolved" });
    const persisted = session();
    persisted.answers["a@1"] = { choice: "saved" };
    saved.set("migrationSession.v2", persisted);
    bench.dispose();
    await fs.writeFile(path.join(mod, "fixture.txt"), "external edit");
    await open();
    expect(session().completions).toEqual({});
    expect(session().answers["a@1"]).toEqual({ choice: "saved" });
  });
  it("rejects mismatched reference metadata and explicitly labels unknown metadata", async () => {
    ui.builtin = [{ manifest: manifest("a", "1.0", "2.0", { inputs: [{ root: "target", path: "" }] }) }];
    const reference = path.join(scratch, "reference");
    await fs.mkdir(reference);
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "recipe", id: "a" });
    ui.versions.set(reference, "9.0");
    ui.folders.mockResolvedValue([URI.file(reference)]);
    await bench.handle({ type: "root", root: "target" });
    expect(ui.state!.error).toContain("reports game version 9.0");
    expect(session().references).toEqual({});
    ui.versions.clear();
    ui.warning.mockResolvedValue("Use as selected version");
    await bench.handle({ type: "root", root: "target" });
    expect(ui.state!.references.find((item) => item.version === "2.0")).toEqual({
      version: "2.0",
      path: reference,
      verified: false,
    });
  });
  it("executes overlapping steps from current output and restores each journal in reverse order", async () => {
    ui.builtin = [
      recipe("a", "1.0", "2.0", "old_value", "middle_value"),
      recipe("b", "2.0", "3.0", "middle_value", "final_value"),
    ];
    const file = path.join(mod, "fixture.txt");
    await fs.writeFile(file, "\uFEFFold_value\nkeep = yes");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    await bench.handle({ type: "recipe", id: "a" });
    for (const id of ["a", "b"]) {
      await bench.handle({ type: "recipe", id });
      await bench.handle({ type: "prepare" });
      expect(ui.state!.error).toBeUndefined();
      await bench.handle({ type: "apply" });
      expect(ui.state!.error).toBeUndefined();
      expect(session().completions[id].state).toBe("applied");
    }
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFfinal_value\nkeep = yes");
    expect(saved.get("migrationJournals.v2")).toHaveLength(2);
    await bench.handle({ type: "restore" });
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFmiddle_value\nkeep = yes");
    expect(session().completions.a.state).toBe("applied");
    expect(session().completions.b).toBeUndefined();
    await bench.handle({ type: "restore" });
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFold_value\nkeep = yes");
    expect(ui.state!.canRestore).toBe(false);
  });
  it("finishes writes and route bookkeeping after a stale cancel and panel disposal", async () => {
    const entry = recipe("a", "1.0", "2.0", "old", "new");
    entry.manifest.inputs = [{ root: "mod", path: "" }];
    entry.prepare = (context) => ({
      groups: [
        {
          id: "both",
          title: "Update both files",
          dependsOn: [],
          changes: ["fixture.txt", "second.txt"].map((filename) => ({
            kind: "text" as const,
            path: filename,
            edits: [
              {
                start: context.readText("mod", filename)!.indexOf("old"),
                end: context.readText("mod", filename)!.indexOf("old") + 3,
                text: "new",
              },
            ],
          })),
        },
      ],
      checks: [],
      unresolved: [],
    });
    ui.builtin = [entry];
    const original = "\uFEFFold\nkeep = yes\n";
    for (const filename of ["fixture.txt", "second.txt"])
      await fs.writeFile(path.join(mod, filename), original);
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "recipe", id: "a" });
    await bench.handle({ type: "prepare" });
    expect(ui.state!.error).toBeUndefined();
    const rename = fileSystem.rename.bind(fileSystem);
    let interrupted = false;
    const spy = vi.spyOn(fileSystem, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (path.basename(String(to)) !== "fixture.txt" || interrupted) return;
      interrupted = true;
      expect(ui.state!.canCancel).toBe(false);
      await bench.handle({ type: "cancel" });
      bench.dispose();
    });
    try {
      await bench.handle({ type: "apply" });
    } finally {
      spy.mockRestore();
    }
    expect(interrupted).toBe(true);
    for (const filename of ["fixture.txt", "second.txt"])
      expect(await fs.readFile(path.join(mod, filename), "utf8")).toBe(original.replace("old", "new"));
    expect(session().completions.a.state).toBe("applied");
    expect(saved.get("migrationJournals.v2")).toEqual([expect.objectContaining({ complete: true })]);
    expect(saved.get("pendingMigrationJournal.v1")).toBeUndefined();
    const reopened = await open();
    await reopened.handle({ type: "restore" });
    expect(ui.state!.error).toBeUndefined();
    for (const filename of ["fixture.txt", "second.txt"])
      expect(await fs.readFile(path.join(mod, filename), "utf8")).toBe(original);
    expect(session().completions.a).toBeUndefined();
    expect(saved.get("migrationJournals.v2")).toEqual([]);
  });
  it("retains an incomplete crash journal and blocks later execution until restore", async () => {
    ui.builtin = [{ manifest: manifest("a") }];
    const journal = path.join(storage, "migration-crash.json");
    await fs.writeFile(
      journal,
      JSON.stringify({ version: 1, roots: { mod }, planHash: "fixture", files: [] })
    );
    saved.set("pendingMigrationJournal.v1", { path: journal, entryId: "a", complete: false });
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "recipe", id: "a" });
    await bench.handle({ type: "complete", state: "manual", note: "Resolved" });
    expect(ui.state!.error).toContain("incomplete migration");
    await bench.handle({ type: "restore" });
    expect(ui.state!.error).toBeUndefined();
    expect(ui.state!.canRestore).toBe(false);
  });
  it("restores two overlapping editor steps and the original unsaved buffer without losing disk bytes", async () => {
    ui.builtin = [
      recipe("a", "1.0", "2.0", "dirty_old", "middle_value"),
      recipe("b", "2.0", "3.0", "middle_value", "final_value"),
    ];
    const file = path.join(mod, "fixture.txt");
    await fs.writeFile(file, "\uFEFFdisk_old\nkeep = yes");
    const document = {
      uri: URI.file(file),
      text: "dirty_old\nkeep = yes",
      version: 1,
      isDirty: true,
      isClosed: false,
      encoding: "utf8bom",
      getText() {
        return this.text;
      },
      positionAt(offset: number) {
        return offset;
      },
      async save() {
        await fs.writeFile(file, "\uFEFF" + this.text);
        this.isDirty = false;
        return true;
      },
    };
    ui.documents = [document as unknown as VSCode.TextDocument];
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    for (const id of ["a", "b"]) {
      await bench.handle({ type: "recipe", id });
      await bench.handle({ type: "prepare" });
      await bench.handle({ type: "apply" });
      expect(ui.state!.error).toBeUndefined();
    }
    expect(document.text).toBe("final_value\nkeep = yes");
    await bench.handle({ type: "restore" });
    expect(ui.state!.error).toBeUndefined();
    expect(document.text).toBe("middle_value\nkeep = yes");
    await bench.handle({ type: "restore" });
    expect(ui.state!.error).toBeUndefined();
    expect(document.text).toBe("dirty_old\nkeep = yes");
    expect(document.isDirty).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("\uFEFFdisk_old\nkeep = yes");
  });
});

describe("batch contribution loading", () => {
  it("loads selected files as one catalog so entries can satisfy each other's prerequisites", async () => {
    const first = await contribution("first.json", [{ manifest: manifest("first") }]);
    const second = await contribution("second.json", [
      { manifest: manifest("second", "1.0", "2.0", { dependsOn: ["first"] }) },
    ]);
    ui.trusted = false;
    const bench = await open();
    await bench.handle({ type: "load" }, [URI.file(second), URI.file(first)]);
    expect(ui.state!.error).toBeUndefined();
    expect(ui.state!.status).toBe("Loaded 2 entries from 2 files.");
    expect(ui.state!.catalog.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(ui.warning).not.toHaveBeenCalled();
    expect(ui.picker).not.toHaveBeenCalled();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "recipe", id: "second" });
    expect(ui.state!.entries.second.blocked).toContain("prerequisite first");
    await bench.handle({ type: "recipe", id: "first" });
    await bench.handle({ type: "complete", state: "manual", note: "Resolved prerequisite" });
    expect(ui.state!.entries.second.blocked).toBeUndefined();
  });
  it("uses separate multi-selection file and folder dialogs", async () => {
    const note = await contribution("library/note.json", [{ manifest: manifest("note") }]);
    const bench = await open();
    ui.folders.mockResolvedValueOnce([URI.file(note)]);
    await bench.handle({ type: "load" });
    expect(ui.folders.mock.calls[0][0]).toMatchObject({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { "Migration contribution": ["json", "cjs", "js"] },
    });
    ui.folders.mockResolvedValueOnce([URI.file(path.dirname(note))]);
    ui.trusted = false;
    await bench.handle({ type: "load-folder" });
    expect(ui.folders.mock.calls[1][0]).toMatchObject({
      canSelectMany: true,
      canSelectFiles: false,
      canSelectFolders: true,
    });
    expect(ui.picker).toHaveBeenCalledOnce();
    expect(ui.warning).not.toHaveBeenCalled();
    expect(ui.state!.error).toBeUndefined();
  });
  it("deduplicates nested folders and explicit files, executes only picked contributions, and asks for trust once", async () => {
    const note = await contribution("library/note.json", [{ manifest: manifest("note") }]);
    const a = await contribution("library/nested/a.cjs", [recipe("a", "1.0", "2.0", "old", "new")]);
    const b = await contribution("library/nested/b.js", [recipe("b", "1.0", "2.0", "old", "new")]);
    const helper = await contribution("library/nested/helper.js", []);
    for (const directory of [".git", "node_modules", ".px-toolkit"])
      await contribution(`library/${directory}/hidden.js`, []);
    await fs.writeFile(path.join(scratch, "library/ignored.txt"), "not a contribution");
    ui.picker.mockImplementationOnce(async (items: { localPath: string }[]) =>
      items.filter((item) => item.localPath !== helper)
    );
    const bench = await open();
    await bench.handle({ type: "load" }, [
      URI.file(a),
      URI.file(path.join(scratch, "library")),
      URI.file(path.dirname(a)),
    ]);
    const candidates = ui.picker.mock.calls[0][0];
    expect(candidates.map((item: { label: string }) => item.label)).toEqual([
      "nested/a.cjs",
      "nested/b.js",
      "nested/helper.js",
      "note.json",
    ]);
    expect(candidates.every((item: { picked: boolean }) => item.picked)).toBe(true);
    expect(candidates.find((item: { localPath: string }) => item.localPath === note).description).toBe(
      "JSON note"
    );
    expect(candidates.find((item: { localPath: string }) => item.localPath === a).description).toBe(
      "Executable JavaScript"
    );
    expect(ui.warning).toHaveBeenCalledOnce();
    expect(ui.warning.mock.calls[0][0]).toContain(
      "3 contribution files, including 2 executable JavaScript files"
    );
    expect(ui.warning.mock.calls[0][0]).toContain(a);
    expect(ui.warning.mock.calls[0][0]).toContain(b);
    const loaded = ui.worker.mock.calls
      .filter(([, request]) => request.action === "load")
      .map(([, request]) => request.selection.localPath);
    expect(loaded).toEqual([a, b, note]);
    expect(loaded).not.toContain(helper);
    expect(ui.state!.status).toBe("Loaded 3 entries from 3 files.");
  });
  it.each(["invalid", "duplicate"])(
    "keeps the previous library, trust and preview when one file is %s",
    async (failure) => {
      const old = await contribution("old.cjs", [recipe("old", "1.0", "2.0", "before", "after")]);
      const first = await contribution("first.json", [{ manifest: manifest("new") }]);
      const bad = await contribution("second.json", [{ manifest: manifest("old") }]);
      if (failure === "invalid") ui.entries.delete(bad);
      await fs.writeFile(path.join(mod, "fixture.txt"), "\uFEFFbefore");
      const bench = await open();
      await bench.handle({ type: "load" }, URI.file(old));
      await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
      await bench.handle({ type: "complete", state: "manual", note: "Resolved with a saved checkpoint" });
      await bench.handle({ type: "prepare" });
      expect(ui.state!.preview).toBeDefined();
      const before = structuredClone(ui.state!);
      const savedBefore = structuredClone(session());
      await bench.handle({ type: "load" }, [URI.file(first), URI.file(bad)]);
      expect(ui.state!.error).toContain(bad);
      expect(ui.state!.error).toContain("Nothing was added");
      expect(session()).toEqual(savedBefore);
      expect(ui.state!.catalog).toEqual(before.catalog);
      expect(ui.state!.selected).toEqual(before.selected);
      expect(ui.state!.preview).toEqual(before.preview);
      expect(ui.state!.entries.old.trusted).toBe(true);
    }
  );
  it("rejects bytes changed during the one batch trust decision", async () => {
    const old = await contribution("old.json", [{ manifest: manifest("old") }]);
    const a = await contribution("a.cjs", [recipe("a", "1.0", "2.0", "old", "new")]);
    const b = await contribution("b.js", [recipe("b", "1.0", "2.0", "old", "new")]);
    const bench = await open();
    await bench.handle({ type: "load" }, URI.file(old));
    const before = structuredClone(session());
    ui.warning.mockImplementationOnce(async () => {
      await fs.writeFile(b, "changed during trust");
      return "Trust and load";
    });
    await bench.handle({ type: "load" }, [URI.file(a), URI.file(b)]);
    expect(ui.warning).toHaveBeenCalledOnce();
    expect(ui.state!.error).toContain(b);
    expect(ui.state!.error).toContain("Artifact changed");
    expect(session()).toEqual(before);
    expect(ui.state!.catalog.map((entry) => entry.id)).toEqual(["old"]);
  });
  it.each(["picker", "trust", "worker", "none-picked"])(
    "keeps the previous library after cancellation at %s",
    async (phase) => {
      const old = await contribution("old.json", [{ manifest: manifest("old") }]);
      const added = await contribution("library/new.cjs", [recipe("new", "1.0", "2.0", "old", "new")]);
      const bench = await open();
      await bench.handle({ type: "load" }, URI.file(old));
      const before = structuredClone(session());
      ui.worker.mockClear();
      if (phase === "picker") ui.picker.mockResolvedValueOnce(undefined);
      if (phase === "none-picked") ui.picker.mockResolvedValueOnce([]);
      if (phase === "trust") ui.warning.mockResolvedValueOnce(undefined);
      if (phase === "worker")
        ui.worker.mockImplementationOnce(async () => {
          await bench.handle({ type: "cancel" });
          return {
            kind: "loaded",
            manifests: [manifest("new")],
            codeHash: createHash("sha256")
              .update(await fs.readFile(added))
              .digest("hex"),
          };
        });
      await bench.handle({ type: "load-folder" }, URI.file(path.dirname(added)));
      expect(session()).toEqual(before);
      expect(ui.state!.catalog.map((entry) => entry.id)).toEqual(["old"]);
      expect(ui.state!.entries.old.trusted).toBe(true);
      if (phase !== "worker") expect(ui.worker).not.toHaveBeenCalled();
    }
  );
  it("removes no longer exported entries on successful reload and preserves answers by revision", async () => {
    const local = await contribution("library.json", [
      { manifest: manifest("old") },
      { manifest: manifest("retained") },
    ]);
    const bench = await open();
    await bench.handle({ type: "load" }, URI.file(local));
    // Seed answers through the same session object held by the workbench.
    (bench as unknown as { session: MigrationSession }).session.answers["retained@1"] = { choice: "saved" };
    ui.entries.set(local, [{ manifest: manifest("retained") }, { manifest: manifest("new") }]);
    await fs.writeFile(local, "new exports");
    await bench.handle({ type: "reload" });
    expect(ui.state!.error).toBeUndefined();
    expect(session().localEntries.map((entry) => entry.manifest.id)).toEqual(["retained", "new"]);
    expect(session().answers["retained@1"]).toEqual({ choice: "saved" });
    expect(ui.state!.entries.old).toBeUndefined();
    expect(ui.state!.status).toBe("Loaded 2 entries from 1 files.");
  });
  it("reports an empty folder without changing the library", async () => {
    const old = await contribution("old.json", [{ manifest: manifest("old") }]);
    const empty = path.join(scratch, "empty");
    await fs.mkdir(empty);
    const bench = await open();
    await bench.handle({ type: "load" }, URI.file(old));
    const before = structuredClone(session());
    await bench.handle({ type: "load-folder" }, URI.file(empty));
    expect(ui.state!.status).toContain("No .json, .cjs or .js contribution files");
    expect(session()).toEqual(before);
    expect(ui.picker).not.toHaveBeenCalled();
  });
});

describe("route session contracts", () => {
  it("preserves completed inputs when adding a future reference or editing a future-only file", async () => {
    ui.builtin = [
      { manifest: manifest("a", "1.0", "2.0", { inputs: [{ root: "mod", path: "current.txt" }] }) },
      {
        manifest: manifest("b", "2.0", "3.0", {
          inputs: [
            { root: "mod", path: "future.txt" },
            { root: "target", path: "" },
          ],
        }),
      },
    ];
    await fs.writeFile(path.join(mod, "current.txt"), "current");
    await fs.writeFile(path.join(mod, "future.txt"), "future");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    await bench.handle({ type: "complete", state: "manual", note: "Resolved current input" });
    await fs.writeFile(path.join(mod, "future.txt"), "manual future work");
    await bench.handle({ type: "next" });
    expect(session().completions.a.state).toBe("manual");
    expect(ui.state!.selected!.id).toBe("b");
    const reference = path.join(scratch, "future-reference");
    await fs.mkdir(reference);
    ui.versions.set(reference, "3.0");
    ui.folders.mockResolvedValue([URI.file(reference)]);
    await bench.handle({ type: "root", root: "target" });
    expect(ui.state!.error).toBeUndefined();
    expect(session().completions.a.state).toBe("manual");
    await bench.handle({ type: "complete", state: "manual", note: "Resolved future input" });
    expect(session().completions.b.state).toBe("manual");
    await fs.writeFile(path.join(mod, "current.txt"), "changed completed input");
    await bench.handle({ type: "next" });
    expect(session().completions).toEqual({});
  });
  it("reopens downstream entries when an earlier manual resolution changes", async () => {
    ui.builtin = [{ manifest: manifest("a") }, { manifest: manifest("b", "2.0", "3.0") }];
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "3.0" });
    await bench.handle({ type: "complete", state: "manual", note: "First resolution" });
    await bench.handle({ type: "next" });
    await bench.handle({ type: "complete", state: "manual", note: "Later resolution" });
    await bench.handle({ type: "recipe", id: "a" });
    await bench.handle({ type: "complete", state: "manual", note: "First resolution" });
    expect(session().completions.b).toBeDefined();
    await bench.handle({ type: "complete", state: "manual", note: "Revised first resolution" });
    expect(session().completions.a.note).toBe("Revised first resolution");
    expect(session().completions.b).toBeUndefined();
  });
  it("keeps a successfully applied label when reinspection reports no remaining work", async () => {
    ui.builtin = [recipe("a", "1.0", "2.0", "old", "new")];
    await fs.writeFile(path.join(mod, "fixture.txt"), "\uFEFFold");
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    await bench.handle({ type: "prepare" });
    await bench.handle({ type: "apply" });
    expect(session().completions.a.state).toBe("applied");
    await bench.handle({ type: "scan" });
    expect(ui.state!.inspection!.applicability).toBe("not-applicable");
    expect(session().completions.a.state).toBe("applied");
  });
  it("shows file capture progress and cancels before starting recipe inspection", async () => {
    ui.builtin = [recipe("a", "1.0", "2.0", "old", "new")];
    const original = "\uFEFFold";
    await fs.writeFile(path.join(mod, "fixture.txt"), original);
    const bench = await open();
    await bench.handle({ type: "versions", fromVersion: "1.0", toVersion: "2.0" });
    let release: ((reason: Error) => void) | undefined;
    ui.capture.mockImplementationOnce(
      (...args: Parameters<typeof captureMigration>) =>
        new Promise((_, reject) => {
          release = reject;
          args[4]?.signal?.addEventListener("abort", () => reject(new Error("Capture cancelled")), {
            once: true,
          });
        })
    );
    const pending = bench.handle({ type: "scan" });
    try {
      await vi.waitFor(() => expect(release).toBeDefined());
      expect(ui.state!.status).toBe("Reading mod and game reference files…");
      expect(ui.state!.busy).toBe(true);
      await bench.handle({ type: "cancel" });
      await vi.waitFor(() => expect(ui.state!.busy).toBe(false));
      expect(ui.state!.error).toBe("Capture cancelled");
      expect(ui.state!.status).toBe("");
      expect(ui.worker.mock.calls.some(([, request]) => request.action === "inspect")).toBe(false);
      expect(await fs.readFile(path.join(mod, "fixture.txt"), "utf8")).toBe(original);
      expect(session().completions).toEqual({});
    } finally {
      release?.(new Error("Fixture closed"));
      await pending;
    }
  });
  it("rejects duplicate library IDs and gates explicit informational prerequisites", () => {
    const a = manifest("a", "1.0", "2.0", { requirement: "informational" });
    const b = manifest("b", "1.0", "2.0", { dependsOn: ["a"] });
    expect(() =>
      mergeMigrationCatalog([a], [{ manifest: a, localPath: "fixture.json", codeHash: "fixture" }])
    ).toThrow("Duplicate migration library ID: a");
    const progress = { completions: {} } as MigrationSession;
    const route = {
      id: "route",
      fromVersion: "1.0",
      toVersion: "2.0",
      entryIds: ["a", "b"],
      transitions: [],
    };
    expect(entryBlock(progress, [a, b], route, b)).toContain("prerequisite a");
    progress.completions.a = { revision: "1", state: "read" };
    expect(entryBlock(progress, [a, b], route, b)).toBeUndefined();
    progress.completions.b = { revision: "1", state: "manual", note: "Resolved" };
    clearDownstream(progress, route, "b");
    expect(progress.completions.a).toBeDefined();
    expect(progress.completions.b).toBeUndefined();
  });
});
