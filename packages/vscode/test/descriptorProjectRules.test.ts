import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PxConfig } from "../src/config";

interface TestUri {
  fsPath: string;
  scheme: string;
}
interface TestDocument {
  uri: TestUri;
  text: string;
  getText(): string;
  isClosed: boolean;
  version: number;
}
interface TestWatcher {
  root: string;
  pattern: string;
  disposed: boolean;
  create?: (uri: TestUri) => void;
  change?: (uri: TestUri) => void;
  delete?: (uri: TestUri) => void;
}
const host = vi.hoisted(() => ({
  diagnostics: new Map<string, { code: string; message: string }[]>(),
  documents: [] as TestDocument[],
  native: new Map<string, boolean>(),
  watchers: [] as TestWatcher[],
  commands: new Map<string, (arg?: unknown) => Promise<void>>(),
  onChange: (_event: { document: TestDocument }) => {},
  onOpen: (_document: TestDocument) => {},
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
}));

vi.mock("vscode", () => {
  class Uri {
    scheme = "file";
    constructor(public fsPath: string) {}
    static file(file: string) {
      return new Uri(file);
    }
  }
  const disposable = () => ({ dispose() {} });
  return {
    Uri,
    RelativePattern: class {
      constructor(
        public base: TestUri,
        public pattern: string
      ) {}
    },
    Range: class {
      constructor(..._args: unknown[]) {}
    },
    Diagnostic: class {
      source?: string;
      code?: string;
      constructor(
        public range: unknown,
        public message: string,
        public severity: number
      ) {}
    },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    window: host,
    commands: {
      registerCommand: (id: string, handler: (arg?: unknown) => Promise<void>) => {
        host.commands.set(id, handler);
        return disposable();
      },
      executeCommand: host.executeCommand,
    },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: TestUri, values: { code: string; message: string }[]) =>
          host.diagnostics.set(uri.fsPath, values),
        delete: (uri: TestUri) => host.diagnostics.delete(uri.fsPath),
        dispose() {
          host.diagnostics.clear();
        },
      }),
      registerCompletionItemProvider: disposable,
      registerHoverProvider: disposable,
    },
    workspace: {
      isTrusted: true,
      get textDocuments() {
        return host.documents;
      },
      getConfiguration: (_section: string, uri: TestUri) => ({
        get: (key: string) =>
          key === "diagnostics.requireDescriptor" ? (host.native.get(uri.fsPath) ?? false) : undefined,
      }),
      createFileSystemWatcher: (relative: { base: TestUri; pattern: string }) => {
        const watcher: TestWatcher = {
          root: relative.base.fsPath,
          pattern: relative.pattern,
          disposed: false,
        };
        host.watchers.push(watcher);
        return {
          onDidCreate: (handler: (uri: TestUri) => void) => {
            watcher.create = handler;
          },
          onDidChange: (handler: (uri: TestUri) => void) => {
            watcher.change = handler;
          },
          onDidDelete: (handler: (uri: TestUri) => void) => {
            watcher.delete = handler;
          },
          dispose: () => {
            watcher.disposed = true;
          },
        };
      },
      onDidOpenTextDocument: (handler: typeof host.onOpen) => {
        host.onOpen = handler;
        return disposable();
      },
      onDidChangeTextDocument: (handler: typeof host.onChange) => {
        host.onChange = handler;
        return disposable();
      },
      openTextDocument: async (uri: TestUri) => {
        const document: TestDocument = {
          uri,
          text: fs.readFileSync(uri.fsPath, "utf8"),
          isClosed: false,
          version: 1,
          getText() {
            return this.text;
          },
        };
        host.documents.push(document);
        return document;
      },
    },
  };
});

import * as vscode from "vscode";
import { registerDescriptorMod, type DescriptorModFeature } from "../src/descriptorMod";

let root: string;
let first: string;
let second: string;
let cfg: PxConfig;
let feature: DescriptorModFeature | undefined;
let log: (message: string) => void;
function seed(mod: string, relative: string, text: string): string {
  const file = path.join(mod, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
function requireRule(mod: string, required: boolean): string {
  return seed(
    mod,
    ".px-toolkit/project.json",
    JSON.stringify({ version: 1, validation: { requireDescriptor: required } })
  );
}
function register() {
  feature = registerDescriptorMod(
    { subscriptions: [] } as unknown as vscode.ExtensionContext,
    () => cfg,
    log
  );
  return feature;
}
function missing(mod: string, relative = "descriptor.mod") {
  return (
    host.diagnostics
      .get(path.join(mod, relative))
      ?.some((diagnostic) => diagnostic.code === "descriptor-missing") ?? false
  );
}
beforeEach(() => {
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/descriptor-project-"));
  first = path.join(root, "first");
  second = path.join(root, "second");
  fs.mkdirSync(path.join(first, "common"), { recursive: true });
  fs.mkdirSync(path.join(second, "common"), { recursive: true });
  cfg = {
    gameId: "ck3",
    modPath: first,
    workspaceMods: [second],
    parentPaths: [second],
    gamePath: null,
    requireDescriptor: false,
    enableForWorkspace: true,
  } as unknown as PxConfig;
  host.diagnostics.clear();
  host.documents = [];
  host.native.clear();
  host.watchers = [];
  host.commands.clear();
  vi.clearAllMocks();
  host.showErrorMessage.mockResolvedValue(undefined);
  log = vi.fn<(message: string) => void>();
  feature = undefined;
});
afterEach(() => {
  feature?.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("per-mod descriptor requirement", () => {
  it("checks a secondary editable mod independently of the primary mod rule", () => {
    requireRule(first, false);
    requireRule(second, true);
    register();
    expect(missing(first)).toBe(false);
    expect(missing(second)).toBe(true);
    expect(host.showErrorMessage).toHaveBeenCalledTimes(1);
  });
  it("uses each mod's native resource fallback and lets a project false value disable it", () => {
    host.native.set(first, true);
    host.native.set(second, true);
    requireRule(first, false);
    register();
    expect(missing(first)).toBe(false);
    expect(missing(second)).toBe(true);
  });
  it("reads a dirty project declaration and refreshes after its editor change", () => {
    const file = requireRule(second, false);
    register();
    expect(missing(second)).toBe(false);
    const document: TestDocument = {
      uri: vscode.Uri.file(file),
      text: '{"version":1,"validation":{"requireDescriptor":true}}',
      isClosed: false,
      version: 2,
      getText() {
        return this.text;
      },
    };
    host.documents.push(document);
    host.onChange({ document });
    expect(missing(second)).toBe(true);
    document.text = '{"version":1,"validation":{"requireDescriptor":false}}';
    document.version++;
    host.onChange({ document });
    expect(missing(second)).toBe(false);
  });
  it("clears removed and disabled roots and disposes their watchers", () => {
    requireRule(first, true);
    requireRule(second, true);
    register();
    expect(missing(first)).toBe(true);
    expect(missing(second)).toBe(true);
    cfg = { ...cfg, workspaceMods: [] };
    feature!.refresh();
    expect(missing(second)).toBe(false);
    expect(host.watchers.find((watcher) => watcher.root === second)?.disposed).toBe(true);
    cfg = { ...cfg, enableForWorkspace: false };
    feature!.refresh();
    expect(missing(first)).toBe(false);
    expect(host.watchers.every((watcher) => watcher.disposed)).toBe(true);
  });
  it("does not diagnose vanilla or reference roots", () => {
    const game = path.join(root, "game");
    const reference = path.join(root, "reference");
    fs.mkdirSync(path.join(game, "common"), { recursive: true });
    fs.mkdirSync(path.join(reference, "common"), { recursive: true });
    requireRule(game, true);
    requireRule(reference, true);
    cfg = { ...cfg, modPath: game, gamePath: game, workspaceMods: [], parentPaths: [reference] };
    register();
    expect(host.diagnostics.size).toBe(0);
    cfg = { ...cfg, modPath: reference };
    feature!.refresh();
    expect(host.diagnostics.size).toBe(0);
  });
  it("reports malformed current project rules without falling back to legacy or native true", () => {
    seed(second, ".px-toolkit/project.json", '{"version":2}');
    seed(second, ".ck3modding/project.json", '{"version":1,"validation":{"requireDescriptor":true}}');
    host.native.set(second, true);
    register();
    expect(missing(second)).toBe(false);
    expect(host.showErrorMessage.mock.calls[0][0]).toContain("Could not read mod settings");
    feature!.refresh();
    expect(host.showErrorMessage).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["vic3", ".metadata/metadata.json"],
    ["eu5", ".metadata/metadata.json"],
  ])("watches and clears %s metadata descriptor diagnostics when created", (gameId, relative) => {
    cfg.gameId = gameId;
    requireRule(second, true);
    register();
    expect(missing(second, relative)).toBe(true);
    const file = seed(second, relative, "{}");
    const watcher = host.watchers.find((watcher) => watcher.root === second)!;
    expect(watcher.pattern).toContain(relative);
    watcher.create!(vscode.Uri.file(file));
    expect(missing(second, relative)).toBe(false);
  });
  it("binds the Create notification action to the mod that lacks the descriptor", async () => {
    requireRule(second, true);
    host.showErrorMessage.mockResolvedValue("Create descriptor.mod");
    register();
    await Promise.resolve();
    expect(host.executeCommand).toHaveBeenCalledWith(
      "px.createDescriptor",
      expect.objectContaining({ fsPath: second })
    );
    await host.commands.get("px.createDescriptor")!(vscode.Uri.file(second));
    expect(fs.existsSync(path.join(second, "descriptor.mod"))).toBe(true);
    expect(fs.existsSync(path.join(first, "descriptor.mod"))).toBe(false);
    expect(missing(second)).toBe(false);
  });
});
