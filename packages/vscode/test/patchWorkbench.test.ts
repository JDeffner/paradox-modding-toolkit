import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { URI } from "vscode-uri";
import type * as VSCode from "vscode";
import type { PatchProject, PatchResolution } from "@px-lsp/server/compatch/model";
import type { PatchViewState } from "../src/webviews/patches/messages";
import type { PxConfig } from "../src/config";
import { parseDescriptor } from "@px-lsp/protocol/descriptorMod";

interface Editor {
  uri: URI;
  text: string;
  version: number;
  isDirty: boolean;
  isClosed: boolean;
  encoding: string;
  getText(): string;
  positionAt(offset: number): { line: number; character: number };
  save(): Promise<boolean>;
}
const ui = vi.hoisted(() => ({
  state: undefined as PatchViewState | undefined,
  experimental: true,
  trusted: true,
  registry: undefined as unknown,
  documents: [] as Editor[],
  folders: vi.fn(),
  updates: [] as { key: string; target: number }[],
  rejectEdit: "",
  launcher: null as string | null,
}));
vi.mock("../src/config", async () => ({
  ...(await vi.importActual<typeof import("../src/config")>("../src/config")),
  gameDocsSubdir: (_meta: unknown, subdir: string) => (subdir === "mod" ? ui.launcher : null),
}));
vi.mock("vscode", () => {
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { One: 1 },
    ConfigurationTarget: { Global: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
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
          postMessage: (message: { state: PatchViewState }) => {
            ui.state = structuredClone(message.state);
          },
        },
        onDidDispose: () => disposable,
        dispose() {},
        reveal() {},
      }),
      showOpenDialog: ui.folders,
      showTextDocument: vi.fn(),
    },
    workspace: {
      get isTrusted() {
        return ui.trusted;
      },
      get textDocuments() {
        return ui.documents;
      },
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === "experimentalFeatures" ? ui.experimental : fallback,
        inspect: (key: string) => (key === "machinePaths" ? { globalValue: ui.registry } : undefined),
        update: async (key: string, value: unknown, target: number) => {
          ui.updates.push({ key, target });
          ui.registry = structuredClone(value);
        },
      }),
      openTextDocument: async (uri: URI) => {
        const opened = ui.documents.find((doc) => doc.uri.fsPath === uri.fsPath && !doc.isClosed);
        if (opened) return opened;
        const text = await fs.readFile(uri.fsPath, "utf8");
        const doc: Editor = {
          uri,
          text: text.replace(/^\uFEFF/, ""),
          version: 1,
          isDirty: false,
          isClosed: false,
          encoding: text.startsWith("\uFEFF") ? "utf8bom" : "utf8",
          getText() {
            return this.text;
          },
          positionAt(offset) {
            return { line: 0, character: offset };
          },
          async save() {
            await fs.writeFile(this.uri.fsPath, (this.encoding === "utf8bom" ? "\uFEFF" : "") + this.text);
            this.isDirty = false;
            return true;
          },
        };
        ui.documents.push(doc);
        return doc;
      },
      applyEdit: async (edit: { changes: { uri: URI; text: string }[] }) => {
        if (
          edit.changes.some(
            (change) => ui.rejectEdit && path.relative(ui.rejectEdit, change.uri.fsPath) === ""
          )
        )
          return false;
        for (const change of edit.changes) {
          const doc = ui.documents.find((item) => item.uri.fsPath === change.uri.fsPath && !item.isClosed);
          if (!doc) return false;
          doc.text = change.text;
          doc.version++;
          doc.isDirty = true;
        }
        return true;
      },
      registerTextDocumentContentProvider: () => disposable,
      onDidChangeTextDocument: () => disposable,
      createFileSystemWatcher: () => ({
        onDidChange: () => disposable,
        onDidCreate: () => disposable,
        onDidDelete: () => disposable,
        dispose() {},
      }),
    },
  };
});
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/fixture/dist/webview"), watch: false }),
  bundleUri: () => "https://fixture.invalid/patches.js",
  watchBundle: () => ({ dispose() {} }),
}));

import * as vscode from "vscode";
import { PatchWorkbench } from "../src/compatch/patches";
import { readPatchBindings } from "../src/machineSettings";

const script = "common/decisions/overlap.txt";
const config = ".px-toolkit/compatibility.json";
let scratch: string;
let sources: string[];
let output: string;
let saved: Map<string, unknown>;
let global: Map<string, unknown>;
const benches: PatchWorkbench[] = [];

async function put(root: string, relative: string, text: string) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
async function open(gameId = "ck3", gamePath: string | null = null) {
  const store = (values: Map<string, unknown>) => ({
    get: (key: string) => values.get(key),
    update: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
  });
  const context = {
    workspaceState: store(saved),
    globalState: store(global),
    subscriptions: [],
    globalStorageUri: URI.file(path.join(scratch, "storage")),
    asAbsolutePath: (relative: string) => path.join(scratch, relative),
  } as unknown as VSCode.ExtensionContext;
  const bench = new PatchWorkbench(context, {
    gameId,
    modPath: null,
    gamePath,
    locLanguage: "english",
    parentPaths: [],
  } as unknown as PxConfig);
  benches.push(bench);
  await bench.ready;
  return bench;
}
function state() {
  if (!ui.state) throw new Error("Host has not posted state");
  return ui.state;
}
async function project(): Promise<PatchProject> {
  return JSON.parse((await fs.readFile(path.join(output, config), "utf8")).replace(/^\uFEFF/, ""));
}
async function create() {
  const bench = await open();
  ui.folders.mockResolvedValueOnce([URI.file(scratch)]);
  await bench.handle({ type: "create", name: "Patch host fixture" });
  expect(state().error).toBeUndefined();
  output = state().output!;
  ui.folders.mockResolvedValueOnce(sources.map((root) => URI.file(root)));
  await bench.handle({ type: "add" });
  expect(state().error).toBeUndefined();
  return bench;
}
async function scan(bench: PatchWorkbench) {
  await bench.handle({ type: "scan" });
  expect(state().error).toBeUndefined();
  await bench.handle({ type: "filter", value: "all" });
}
async function decide(bench: PatchWorkbench, name: string, resolution: PatchResolution | "first") {
  const row = state().rows.find((item) => item.name === name);
  if (!row) throw new Error(`Missing fixture conflict ${name}`);
  await bench.handle({ type: "select", id: row.id });
  const selected = state().selected!;
  await bench.handle({
    type: "resolve",
    id: row.id,
    resolution:
      resolution === "first"
        ? { mode: "source", contributorId: selected.contributors[0].id, note: "Use the first mod" }
        : resolution,
  });
  expect(state().error).toBeUndefined();
}
async function prepared() {
  const bench = await create();
  await scan(bench);
  for (const name of ["alpha", "beta", "gamma"]) await decide(bench, name, "first");
  await bench.handle({ type: "prepare" });
  expect(state().error).toBeUndefined();
  expect(state().canApply).toBe(true);
  return bench;
}
async function editor(root: string, relative: string) {
  return (await vscode.workspace.openTextDocument(URI.file(path.join(root, relative)))) as unknown as Editor;
}

beforeEach(async () => {
  const parent = path.join(process.cwd(), ".local/testing");
  await fs.mkdir(parent, { recursive: true });
  scratch = await fs.realpath(await fs.mkdtemp(path.join(parent, "patch-host-")));
  sources = [1, 2, 3].map((index) => path.join(scratch, `source-${index}`));
  for (const [index, root] of sources.entries()) {
    await put(root, "descriptor.mod", `\uFEFFname = "Source ${index + 1}"\n`);
    await put(
      root,
      script,
      `\uFEFFalpha = { value = ${index + 1} }\n${Array.from({ length: 8 }, (_, line) => `# alpha anchor ${line}`).join("\n")}\nbeta = { value = ${index + 1} }\n${Array.from({ length: 8 }, (_, line) => `# beta anchor ${line}`).join("\n")}\ngamma = { value = ${index + 1} }\nuntouched = { value = yes }\n${Array.from({ length: 8 }, (_, line) => `# trailing anchor ${line}`).join("\n")}\n`
    );
  }
  saved = new Map();
  global = new Map();
  ui.state = undefined;
  ui.registry = undefined;
  ui.documents = [];
  ui.updates = [];
  ui.experimental = true;
  ui.trusted = true;
  ui.rejectEdit = "";
  ui.launcher = path.join(scratch, "launcher");
  ui.folders.mockReset();
});
afterEach(async () => {
  for (const bench of benches.splice(0)) bench.dispose();
  await fs.rm(scratch, { recursive: true, force: true });
});

describe("maintained patch host", () => {
  it("creates all project files and a launcher pointer to the selected output", async () => {
    await create();
    const descriptor = await fs.readFile(path.join(output, "descriptor.mod"), "utf8");
    expect(descriptor.startsWith("\uFEFF")).toBe(true);
    expect(parseDescriptor(descriptor).find((field) => field.key === "name")?.value).toBe(
      '"Patch host fixture"'
    );
    expect((await project()).name).toBe("Patch host fixture");
    expect(JSON.parse(await fs.readFile(path.join(output, ".px-toolkit/project.json"), "utf8"))).toEqual({
      version: 1,
      gameId: "ck3",
    });
    expect(await fs.readFile(path.join(output, ".pxignore"), "utf8")).toContain(".git/");
    const pointer = await fs.readFile(path.join(ui.launcher!, "Patch_host_fixture.mod"), "utf8");
    const target = parseDescriptor(pointer).find((field) => field.key === "path")?.value;
    expect(target).toBeDefined();
    expect(await fs.realpath(JSON.parse(target!))).toBe(output);
  });

  it.each(["unavailable", "collision"] as const)(
    "preflights an %s launcher destination before creating output",
    async (failure) => {
      const bench = await open();
      const name = "Launcher preflight fixture";
      const root = path.join(scratch, "Launcher_preflight_fixture");
      const pointer = path.join(ui.launcher!, "Launcher_preflight_fixture.mod");
      if (failure === "unavailable") ui.launcher = null;
      else await put(path.dirname(pointer), path.basename(pointer), "Existing launcher pointer must survive");
      ui.folders.mockResolvedValueOnce([URI.file(scratch)]);
      await bench.handle({ type: "create", name });
      expect(state().error).toBeTruthy();
      await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
      expect(ui.updates).toEqual([]);
      if (failure === "collision")
        expect(await fs.readFile(pointer, "utf8")).toBe("Existing launcher pointer must survive");
    }
  );

  it("refuses an imported output ancestor of the game installation", async () => {
    await create();
    const gamePath = path.join(output, "game-installation");
    await put(gamePath, "common/protected.txt", "Vanilla content stays unchanged");
    const metadata = await fs.readFile(path.join(output, config));
    const registry = structuredClone(ui.registry);
    const bench = await open("ck3", gamePath);
    ui.folders.mockResolvedValueOnce([URI.file(output)]);
    await bench.handle({ type: "open" });
    expect(state().error).toMatch(/read-only|separate|overlap/i);
    expect(state().output).toBeUndefined();
    expect(ui.registry).toEqual(registry);
    expect(await fs.readFile(path.join(output, config))).toEqual(metadata);
    expect(await fs.readFile(path.join(gamePath, "common/protected.txt"), "utf8")).toBe(
      "Vanilla content stays unchanged"
    );
  });

  it("retains a compatibility metadata BOM through load, build, apply and restore", async () => {
    await create();
    const filename = path.join(output, config);
    const doc = await editor(output, config);
    doc.encoding = "utf8bom";
    await doc.save();
    const bench = await open();
    expect(state().error).toBeUndefined();
    await scan(bench);
    for (const name of ["alpha", "beta", "gamma"]) await decide(bench, name, "first");
    const before = await fs.readFile(filename);
    expect(before.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    await bench.handle({ type: "prepare" });
    expect(state().error).toBeUndefined();
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    expect((await fs.readFile(filename)).subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    await bench.handle({ type: "restore" });
    expect(state().error).toBeUndefined();
    expect(await fs.readFile(filename)).toEqual(before);
  });

  it("does not create output after Experimental features are disabled during the folder picker", async () => {
    const bench = await open();
    let finish!: (value: URI[]) => void;
    ui.folders.mockImplementationOnce(
      () =>
        new Promise<URI[]>((resolve) => {
          finish = resolve;
        })
    );
    const pending = bench.handle({ type: "create", name: "Disabled during picker" });
    await vi.waitFor(() => expect(ui.folders).toHaveBeenCalled());
    ui.experimental = false;
    finish([URI.file(scratch)]);
    await pending;
    expect(state().error).toContain("Experimental");
    await expect(fs.stat(path.join(scratch, "Disabled_during_picker"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(ui.updates).toEqual([]);
  });

  it("stops between output writes when Experimental features are disabled and keeps partial recovery", async () => {
    const bench = await prepared();
    const descriptor = await editor(output, "descriptor.mod");
    // Prepare with this clean editor included in the preview's document snapshot.
    await bench.handle({ type: "prepare" });
    expect(state().error).toBeUndefined();
    const before = await fs.readFile(path.join(output, "descriptor.mod"));
    const save = descriptor.save.bind(descriptor);
    descriptor.save = async () => {
      const result = await save();
      ui.experimental = false;
      return result;
    };
    await bench.handle({ type: "apply" });
    expect(state().error).toContain("Experimental");
    expect(state().recoveryBlocked).toBe(true);
    expect(state().canRestore).toBe(true);
    descriptor.save = save;
    ui.experimental = true;
    await bench.handle({ type: "restore" });
    expect(state().error).toBeUndefined();
    expect(await fs.readFile(path.join(output, "descriptor.mod"))).toEqual(before);
    await expect(fs.stat(path.join(output, script))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores a manually removed script BOM when merging an unrelated upstream change", async () => {
    const bench = await prepared();
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    const filename = path.join(output, script);
    const manual =
      (await fs.readFile(filename, "utf8")).replace(/^\uFEFF/, "") + "# Keep this manual comment\n";
    await fs.writeFile(filename, manual);
    const source = path.join(sources[0], script);
    await fs.writeFile(
      source,
      (await fs.readFile(source, "utf8")).replace("gamma = { value = 1 }", "gamma = { value = 8 }")
    );
    await scan(bench);
    await decide(bench, "gamma", "first");
    await bench.handle({ type: "prepare" });
    expect(state().error).toBeUndefined();
    expect(state().conflicts).toEqual([]);
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    const updated = await fs.readFile(filename, "utf8");
    expect(updated.startsWith("\uFEFF")).toBe(true);
    expect(updated).toContain("value = 8");
    expect(updated).toContain("# Keep this manual comment");
  });

  it("preserves a manual event comment while placing its namespace first after a merge", async () => {
    const bench = await create();
    const eventFile = "events/overlap.txt";
    for (const [index, root] of sources.entries())
      await put(
        root,
        eventFile,
        `\uFEFFnamespace = patch_fixture\n${Array.from({ length: 8 }, (_, line) => `# event anchor ${line}`).join("\n")}\npatch_fixture.1 = { title = title_${index + 1} }\n`
      );
    await scan(bench);
    for (const name of ["alpha", "beta", "gamma", "patch_fixture.1"]) await decide(bench, name, "first");
    await bench.handle({ type: "prepare" });
    expect(state().error).toBeUndefined();
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    const filename = path.join(output, eventFile);
    await fs.writeFile(
      filename,
      "\uFEFF# Keep this event comment\n" + (await fs.readFile(filename, "utf8")).replace(/^\uFEFF/, "")
    );
    await put(
      sources[0],
      eventFile,
      (await fs.readFile(path.join(sources[0], eventFile), "utf8")).replace("title_1", "changed_title")
    );
    await scan(bench);
    await decide(bench, "patch_fixture.1", "first");
    await bench.handle({ type: "prepare" });
    expect(state().error).toBeUndefined();
    expect(state().conflicts).toEqual([]);
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    const updated = await fs.readFile(filename, "utf8");
    expect(updated.startsWith("\uFEFFnamespace = patch_fixture")).toBe(true);
    expect(updated).toContain("# Keep this event comment");
    expect(updated).toContain("changed_title");
  });

  it("gates direct construction and actions on experimental support and workspace trust", async () => {
    ui.experimental = false;
    await expect(open()).rejects.toThrow("Experimental");
    ui.experimental = true;
    await expect(open("vic3")).rejects.toThrow("not supported");
    await expect(open("eu5")).rejects.toThrow("not supported");
    const bench = await open();
    ui.trusted = false;
    await bench.handle({ type: "create", name: "blocked" });
    expect(state().error).toContain("Trust this workspace");
    expect(ui.folders).not.toHaveBeenCalled();
  });

  it("creates portable intent, adds three folders together and persists launcher order privately", async () => {
    const bench = await create();
    expect(ui.folders.mock.calls[1][0].canSelectMany).toBe(true);
    expect(state().inputs.map((input) => input.name)).toEqual(["Source 1", "Source 2", "Source 3"]);
    await bench.handle({ type: "move", id: state().inputs[2].id, direction: -1 });
    expect(state().inputs.map((input) => input.name)).toEqual(["Source 1", "Source 3", "Source 2"]);
    const portable = await project();
    expect(JSON.stringify(portable)).not.toContain(scratch);
    expect(readPatchBindings(portable.id).bindings).toEqual({
      output,
      sources: Object.fromEntries(
        portable.inputs.map((input) => [input.id, sources[Number(input.name.slice(-1)) - 1]])
      ),
    });
    expect(ui.updates.every((update) => update.key === "machinePaths" && update.target === 1)).toBe(true);
    const resumed = await open();
    expect(state().inputs.map((input) => input.name)).toEqual(portable.inputs.map((input) => input.name));
    ui.folders.mockResolvedValueOnce([URI.file(output)]);
    await resumed.handle({ type: "open" });
    expect(state().error).toBeUndefined();
    expect(state().output).toBe(output);
  });

  it("scans three sources and retains winner, source and direct field decisions when reopened", async () => {
    const bench = await create();
    await scan(bench);
    expect(state().counts.attention).toBe(3);
    await decide(bench, "alpha", { mode: "winner", note: "Launcher result" });
    await decide(bench, "beta", "first");
    const gamma = state().rows.find((row) => row.name === "gamma")!;
    await bench.handle({ type: "select", id: gamma.id });
    await decide(bench, "gamma", {
      mode: "fields",
      fields: { value: state().selected!.contributors[1].id },
      note: "Combine one complete field",
    });
    expect(state().counts.ready).toBe(3);
    const savedDecisions = (await project()).decisions;
    const resumed = await open();
    await scan(resumed);
    expect(state().counts.ready).toBe(3);
    expect((await project()).decisions).toEqual(savedDecisions);
  });

  it("reopens only the decision whose contribution changed and ignores an unrelated sibling", async () => {
    const bench = await prepared();
    const filename = path.join(sources[0], script);
    const text = await fs.readFile(filename, "utf8");
    await fs.writeFile(filename, text.replace("untouched = { value = yes }", "untouched = { value = no }"));
    await scan(bench);
    expect(state().counts.ready).toBe(3);
    await fs.writeFile(filename, text.replace("alpha = { value = 1 }", "alpha = { value = 9 }"));
    await scan(bench);
    expect(state().rows.find((row) => row.name === "alpha")?.state).toBe("changed");
    expect(
      state()
        .rows.filter((row) => row.state === "ready")
        .map((row) => row.name)
        .sort()
    ).toEqual(["beta", "gamma"]);
  });

  it("applies real output with BOM, keeps effective source siblings and restores the exact previous output", async () => {
    const bench = await prepared();
    await put(output, "common/decisions/manual.txt", "\uFEFFmanual_sibling = { keep = yes }\n");
    const manual = await fs.readFile(path.join(output, "common/decisions/manual.txt"));
    const descriptorBefore = await fs.readFile(path.join(output, "descriptor.mod"));
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    const generated = await fs.readFile(path.join(output, script), "utf8");
    expect(generated.startsWith("\uFEFF")).toBe(true);
    expect(generated).toContain("untouched");
    expect(generated).toContain("value = 1");
    expect(await fs.readFile(path.join(output, "common/decisions/manual.txt"))).toEqual(manual);
    expect(await fs.readFile(path.join(output, "descriptor.mod"), "utf8")).toContain("dependencies");
    expect(state().canRestore).toBe(true);
    await bench.handle({ type: "restore" });
    expect(state().error).toBeUndefined();
    await expect(fs.stat(path.join(output, script))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(output, "descriptor.mod"))).toEqual(descriptorBefore);
    expect(await fs.readFile(path.join(output, "common/decisions/manual.txt"))).toEqual(manual);
  });

  it("routes localization to its owned replace file and preserves unrelated localization", async () => {
    const bench = await create();
    for (const [index, root] of sources.entries())
      await put(
        root,
        "localization/english/source_l_english.yml",
        `\uFEFFl_english:\n shared_key:0 "Source ${index + 1}"\n`
      );
    const destination = "localization/replace/owned_l_english.yml";
    await put(
      output,
      destination,
      '\uFEFFl_english:\n shared_key:0 "Old output"\n manual_key:0 "Keep this"\n'
    );
    await scan(bench);
    for (const name of ["alpha", "beta", "gamma", "shared_key"]) await decide(bench, name, "first");
    await bench.handle({ type: "prepare" });
    expect(state().error).toBeUndefined();
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    const text = await fs.readFile(path.join(output, destination), "utf8");
    expect(text.startsWith("\uFEFFl_english:")).toBe(true);
    expect(text).toContain('shared_key:0 "Source 1"');
    expect(text).toContain('manual_key:0 "Keep this"');
  });

  it("rejects an output editor encoder that would lose the required BOM", async () => {
    const bench = await prepared();
    const doc = await editor(output, "descriptor.mod");
    doc.encoding = "utf8";
    const before = await fs.readFile(path.join(output, "descriptor.mod"));
    await bench.handle({ type: "apply" });
    expect(state().error).toContain("UTF-8 with BOM");
    expect(await fs.readFile(path.join(output, "descriptor.mod"))).toEqual(before);
    await expect(fs.stat(path.join(output, script))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["output", "source", "metadata", "dirty-output", "dirty-source"] as const)(
    "rejects stale %s content before writing",
    async (changed) => {
      const bench = await prepared();
      if (changed === "output") await put(output, script, "\uFEFFexternal_output = { keep = yes }\n");
      if (changed === "source") await put(sources[0], script, "\uFEFFalpha = { changed = yes }\n");
      if (changed === "metadata") {
        const next = await project();
        next.name = "External metadata edit";
        await fs.writeFile(path.join(output, config), JSON.stringify(next));
      }
      if (changed === "dirty-output" || changed === "dirty-source") {
        const doc = await editor(
          changed === "dirty-output" ? output : sources[0],
          changed === "dirty-output" ? "descriptor.mod" : script
        );
        doc.text += "\n# Unsaved edit";
        doc.isDirty = true;
        doc.version++;
      }
      const descriptor = await fs.readFile(path.join(output, "descriptor.mod"));
      await bench.handle({ type: "apply" });
      expect(state().error).toBeTruthy();
      expect(await fs.readFile(path.join(output, "descriptor.mod"))).toEqual(descriptor);
      if (changed === "output")
        expect(await fs.readFile(path.join(output, script), "utf8")).toContain("external_output");
      else await expect(fs.stat(path.join(output, script))).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it("retains a recoverable journal after a rejected editor edit and restores completed writes", async () => {
    const bench = await prepared();
    const before = await fs.readFile(path.join(output, "descriptor.mod"));
    ui.rejectEdit = path.join(output, config);
    await bench.handle({ type: "apply" });
    expect(state().error).toBeTruthy();
    expect(state().recoveryBlocked).toBe(true);
    await bench.handle({ type: "scan" });
    expect(state().error).toContain("Restore the incomplete update");
    ui.rejectEdit = "";
    await bench.handle({ type: "restore" });
    expect(state().error).toBeUndefined();
    expect(state().recoveryBlocked).toBe(false);
    expect(await fs.readFile(path.join(output, "descriptor.mod"))).toEqual(before);
    await expect(fs.stat(path.join(output, script))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps later manual output edits when recovery detects a conflict", async () => {
    const bench = await prepared();
    await bench.handle({ type: "apply" });
    expect(state().error).toBeUndefined();
    await put(output, script, "\uFEFFmanual_after_apply = { keep = yes }\n");
    await bench.handle({ type: "restore" });
    expect(state().error).toBeTruthy();
    expect(await fs.readFile(path.join(output, script), "utf8")).toContain("manual_after_apply");
    expect(state().canRestore).toBe(true);
  });
});
