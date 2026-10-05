import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import * as fs from "node:fs";
import * as path from "node:path";
import manifest from "../package.json";
import {
  getMachineSetting,
  normalizeMachineUri,
  type MachineSettings,
} from "@px-lsp/protocol/machineSettings";
import type { AppToHost, HostToApp, SettingsState, SettingsTarget } from "../src/webviews/settings/messages";
import type { PxConfig } from "../src/config";

interface TestDocument {
  uri: URI;
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
  posted: [] as HostToApp[],
  receive: (_msg: AppToHost) => {},
  close: () => {},
  values: {} as Record<number, Record<string, unknown>>,
  update: vi.fn(),
  command: vi.fn(),
  modPath: null as string | null,
  workspaceMods: [] as string[],
  gameId: "ck3",
  gamePath: null as string | null,
  parentPaths: [] as string[],
  readResources: [] as string[],
  folderValues: new Map<string, Record<string, unknown>>(),
  documents: new Map<string, TestDocument>(),
  trusted: true,
  rejectSave: false,
}));
vi.mock("vscode", async () => {
  const { URI } = await import("vscode-uri");
  const disposable = { dispose() {} };
  return {
    Uri: URI,
    ViewColumn: { Active: 1 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Range: class {
      constructor(
        public start: number,
        public end: number
      ) {}
    },
    WorkspaceEdit: class {
      changes: { uri: URI; text: string }[] = [];
      replace(uri: URI, _range: unknown, text: string) {
        this.changes.push({ uri, text });
      }
    },
    commands: { executeCommand: (...args: unknown[]) => host.command(...args) },
    workspace: {
      workspaceFolders: [{ uri: URI.file("/mods/test"), name: "Test" }],
      workspaceFile: URI.file("/mods/test.code-workspace"),
      get isTrusted() {
        return host.trusted;
      },
      get textDocuments() {
        return [...host.documents.values()];
      },
      getWorkspaceFolder: () => ({ uri: URI.file("/mods/test"), name: "Test" }),
      onDidChangeConfiguration: () => disposable,
      onDidChangeWorkspaceFolders: () => disposable,
      onDidChangeTextDocument: () => disposable,
      createFileSystemWatcher: () => ({
        ...disposable,
        onDidChange: () => disposable,
        onDidCreate: () => disposable,
        onDidDelete: () => disposable,
      }),
      openTextDocument: async (uri: URI) => {
        let document = host.documents.get(uri.fsPath);
        if (!document) {
          document = {
            uri,
            text: fs.readFileSync(uri.fsPath, "utf8"),
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
              fs.writeFileSync(this.uri.fsPath, this.text);
              this.isDirty = false;
              return true;
            },
          };
          host.documents.set(uri.fsPath, document);
        }
        return document;
      },
      applyEdit: async (edit: { changes: { uri: URI; text: string }[] }) => {
        for (const change of edit.changes) {
          const document = host.documents.get(change.uri.fsPath)!;
          document.text = change.text;
          document.version++;
          document.isDirty = true;
        }
        return true;
      },
      getConfiguration: (_section: string, uri?: URI) => ({
        get: (key: string, fallback: unknown) =>
          (uri ? (host.folderValues.get(uri.fsPath) ?? host.values[3])?.[key] : undefined) ??
          host.values[2]?.[key] ??
          host.values[1]?.[key] ??
          fallback,
        inspect: (key: string) => ({
          globalValue: host.values[1]?.[key],
          workspaceValue: host.values[2]?.[key],
          workspaceFolderValue: uri
            ? (host.folderValues.get(uri.fsPath) ?? host.values[3])?.[key]
            : undefined,
        }),
        update: (key: string, value: unknown, target: number) => host.update(key, value, target),
      }),
    },
    window: {
      showOpenDialog: async () => undefined,
      createWebviewPanel: () => ({
        reveal() {},
        dispose() {},
        onDidDispose: (cb: () => void) => {
          host.close = cb;
          return disposable;
        },
        webview: {
          html: "",
          postMessage: (m: HostToApp) => host.posted.push(m),
          onDidReceiveMessage: (cb: (m: AppToHost) => void) => {
            host.receive = cb;
            return disposable;
          },
        },
      }),
    },
  };
});
vi.mock("../src/config", () => ({
  coaLibraryDir: () => null,
  readConfig: (resource: URI) => {
    host.readResources.push(resource.fsPath);
    return {
      gameId: host.gameId,
      gamePath: null,
      logsPath: null,
      tigerPath: null,
      modPath: resource.fsPath,
      workspaceMods: host.workspaceMods,
      parentPaths: [],
      warnings: [],
    };
  },
}));
vi.mock("../src/webviews/devReload", () => ({
  webviewSource: () => ({ root: URI.file("/extension"), watch: false }),
  bundleUri: () => "app.js",
  watchBundle: () => ({ dispose() {} }),
}));
vi.mock("../src/webviews/tabIcons", () => ({ tabIcon: () => undefined }));
import { SettingsPanel } from "../src/webviews/settings/panel";

beforeEach(() => {
  host.modPath = null;
  host.workspaceMods = [];
  host.gameId = "ck3";
  host.gamePath = null;
  host.parentPaths = [];
  host.readResources = [];
  host.folderValues.clear();
  host.documents.clear();
  host.trusted = true;
  host.rejectSave = false;
  host.values = { 1: {}, 2: { unrelated: "keep" }, 3: {} };
  host.posted = [];
  host.command.mockReset();
  host.update.mockReset().mockImplementation(async (key, value, target) => {
    host.values[target][key] = value;
  });
  SettingsPanel.show(
    {
      subscriptions: [],
      extension: { packageJSON: manifest },
    } as unknown as import("vscode").ExtensionContext,
    {
      getCfg: () =>
        ({
          gameId: host.gameId,
          gamePath: host.gamePath,
          logsPath: null,
          modPath: host.modPath,
          workspaceMods: host.workspaceMods,
          parentPaths: host.parentPaths,
          tigerPath: null,
          warnings: [],
        }) as unknown as PxConfig,
      getStatus: () => ({ tokens: 0, definitions: 0, tokensFromScriptDocs: false, indexing: false }),
    }
  );
});
let scratch: string | undefined;
afterEach(() => {
  host.close();
  if (scratch) {
    const base = path.resolve(".local/testing");
    expect(scratch.startsWith(base + path.sep)).toBe(true);
    fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});
type TestMessage =
  | Exclude<AppToHost, { type: "save" | "browse" }>
  | (Omit<Extract<AppToHost, { type: "save" }>, "context"> & { context?: SettingsTarget })
  | (Omit<Extract<AppToHost, { type: "browse" }>, "context"> & { context?: SettingsTarget });
async function receive(message: TestMessage) {
  const state = host.posted
    .slice()
    .reverse()
    .find((reply) => reply.type === "state");
  const m: AppToHost =
    message.type === "save" || message.type === "browse"
      ? {
          ...message,
          context: message.context ?? (state?.type === "state" ? state.state.target : "workspace"),
        }
      : message;
  const before = host.posted.length;
  host.receive(m);
  await vi.waitFor(() => {
    if (m.type === "saveBatch") {
      for (const change of m.changes)
        expect(host.posted.slice(before)).toContainEqual(
          expect.objectContaining({ type: "result", id: change.id })
        );
    } else if (m.type === "save" || m.type === "browse")
      expect(host.posted.slice(before).some((reply) => reply.type === "result" && reply.id === m.id)).toBe(
        true
      );
    else expect(host.posted.length).toBeGreaterThan(before);
  });
}
async function open(): Promise<SettingsState> {
  await receive({ type: "ready" });
  const m = host.posted.at(-1)!;
  if (m.type !== "state") throw new Error("No state");
  return m.state;
}

async function scope(target: SettingsTarget): Promise<SettingsState> {
  let latest = host.posted
    .slice()
    .reverse()
    .find((reply) => reply.type === "state");
  if (latest?.type !== "state") throw new Error("No settings state");
  if (latest.state.targets.some((item) => item.id === target)) await receive({ type: "target", target });
  else {
    for (const row of latest.state.rows) {
      if (row.targets.some((item) => item.id === target))
        await receive({ type: "destination", context: latest.state.target, key: row.key, target });
    }
  }
  latest = host.posted
    .slice()
    .reverse()
    .find((reply) => reply.type === "state");
  if (latest?.type !== "state") throw new Error("No settings state");
  return latest.state;
}

function teamFixture(initial: Record<string, unknown> = { version: 1 }) {
  fs.mkdirSync(".local/testing", { recursive: true });
  scratch = fs.mkdtempSync(path.resolve(".local/testing/settings-panel-"));
  host.modPath = scratch;
  fs.mkdirSync(path.join(scratch, ".px-toolkit"));
  fs.writeFileSync(path.join(scratch, "descriptor.mod"), 'name="Settings fixture"\n');
  const file = path.join(scratch, ".px-toolkit/project.json");
  fs.writeFileSync(file, JSON.stringify(initial));
  return { file, target: `project:${URI.file(scratch).toString()}` as const };
}

function setting(state: SettingsState, key: string) {
  const row = state.rows.find((item) => item.key === key);
  if (!row) throw new Error(`Missing settings row ${key}`);
  return row;
}

it("writes and resets only the selected setting and scope", async () => {
  await open();
  await receive({
    type: "save",
    id: 1,
    key: "scopeInlayHints",
    target: "user",
    stamp: "undefined",
    value: true,
  });
  expect(host.values[1].scopeInlayHints).toBe(true);
  expect(host.values[2]).toEqual({ unrelated: "keep" });
  await receive({
    type: "save",
    id: 2,
    key: "scopeInlayHints",
    target: "user",
    stamp: "true",
    value: null,
    reset: true,
  });
  expect(host.values[1].scopeInlayHints).toBeUndefined();
});

it("refuses stale values, unsupported folder scopes, unknown keys and invalid values", async () => {
  teamFixture();
  await open();
  const folder = `folder:${URI.file("/mods/test").toString()}` as const;
  for (const [id, key, target, stamp, value] of [
    [1, "scopeInlayHints", "workspace", "true", false],
    [2, "gamePath", folder, "undefined", ""],
    [3, "unknown", "workspace", "undefined", true],
    [4, "hover.detail", "workspace", "undefined", "huge"],
  ] as const)
    await receive({ type: "save", id, key, target, stamp, value });
  expect(host.update).not.toHaveBeenCalled();
  expect(host.posted.filter((m) => m.type === "result" && m.error)).toHaveLength(4);
  await receive({
    type: "save",
    id: 5,
    key: "characterHistory.quoteNames",
    target: folder,
    stamp: "undefined",
    value: false,
  });
  expect(host.values[3]["characterHistory.quoteNames"]).toBeUndefined();
  expect(host.posted).toContainEqual({
    type: "result",
    id: 5,
    error: expect.stringMatching(/shared settings/),
  });
});

it("reports write failures and refuses arbitrary commands", async () => {
  await open();
  host.update.mockRejectedValueOnce(new Error("Cannot write settings"));
  await receive({
    type: "save",
    id: 1,
    key: "scopeInlayHints",
    target: "workspace",
    stamp: "undefined",
    value: true,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 1, error: "Cannot write settings" });
  await receive({ type: "action", command: "arbitrary.command" });
  expect(host.command).not.toHaveBeenCalled();
});

it("keeps settings usable while an action waits for its own prompt", async () => {
  await open();
  let finish!: () => void;
  host.command.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  host.receive({ type: "action", command: "px.setup" });
  await receive({
    type: "save",
    id: 1,
    key: "scopeInlayHints",
    target: "workspace",
    stamp: "undefined",
    value: true,
  });
  expect(host.values[2].scopeInlayHints).toBe(true);
  finish();
});

it("shows one catalogue with each row's destination and active value", async () => {
  const { target } = teamFixture();
  const state = await open();
  expect(state.targets).toEqual([{ id: target, label: "Settings fixture" }]);
  const keys = state.rows.map((row) => row.key);
  expect(keys).toContain("gamePath");
  expect(keys).toContain("characterHistory.quoteNames");
  expect(keys).toContain("scopeInlayHints");
  expect(keys).not.toContain("machinePaths");
  expect(setting(state, "gamePath").target).toBe("user");
  expect(setting(state, "characterHistory.quoteNames").target).toBe(target);
  expect(setting(state, "scopeInlayHints").target).toBe("workspace");
  const personal = await scope("user");
  expect(personal.rows.map((row) => row.key)).toEqual(keys);
  expect(personal.target).toBe(target);
});

it("writes machine-path scopes only to the User registry and preserves unrelated slots", async () => {
  teamFixture();
  host.values[1].machinePaths = {
    version: 1,
    future: "keep",
    defaults: { vic3: { gamePath: "other game" } },
  };
  const initial = await open();
  const folder = setting(initial, "gamePath").targets.find((target) =>
    target.id.startsWith("machine-folder:")
  )!.id;
  const identity = {
    workspaceUri: normalizeMachineUri(
      URI.file("/mods/test.code-workspace").toString(),
      process.platform === "win32"
    ),
    folderUri: normalizeMachineUri(URI.file("/mods/test").toString(), process.platform === "win32"),
  };
  const scopes = [
    ["user", "default"],
    ["machine:workspace", "workspace"],
    [folder, "folder"],
  ] as const;
  for (const [index, [target, registryScope]] of scopes.entries()) {
    const state = await scope(target);
    const value = path.join(scratch!, `game-${index}`);
    fs.mkdirSync(value);
    await receive({
      type: "save",
      id: index,
      key: "gamePath",
      target,
      stamp: setting(state, "gamePath").stamp,
      value,
    });
    expect(host.posted).toContainEqual({ type: "result", id: index });
    expect(
      getMachineSetting(
        host.values[1].machinePaths as MachineSettings,
        "gamePath",
        "ck3",
        registryScope,
        identity
      )
    ).toBe(value);
  }
  expect(
    host.update.mock.calls.every(([key, _value, target]) => key === "machinePaths" && target === 1)
  ).toBe(true);
  expect(host.values[1].machinePaths).toMatchObject({
    future: "keep",
    defaults: { vic3: { gamePath: "other game" } },
  });
  expect(host.values[2]).toEqual({ unrelated: "keep" });
  expect(host.values[3]).toEqual({});
  const defaults = await scope("user");
  await receive({
    type: "save",
    id: 10,
    key: "gamePath",
    target: "user",
    stamp: setting(defaults, "gamePath").stamp,
    value: null,
    reset: true,
  });
  expect(
    getMachineSetting(host.values[1].machinePaths as MachineSettings, "gamePath", "ck3", "default")
  ).toBeUndefined();
  expect(
    getMachineSetting(host.values[1].machinePaths as MachineSettings, "gamePath", "vic3", "default")
  ).toBe("other game");
});

it("exposes stale personal paths, failed native writes and saves that fail readback", async () => {
  teamFixture();
  await open();
  const old = setting(await scope("machine:workspace"), "logsPath");
  host.values[1].machinePaths = { version: 1, defaults: { ck3: { logsPath: scratch } } };
  await receive({
    type: "save",
    id: 1,
    key: "logsPath",
    target: "machine:workspace",
    stamp: old.stamp,
    value: scratch!,
  });
  expect(host.posted).toContainEqual({
    type: "result",
    id: 1,
    error: expect.stringMatching(/Personal paths changed/),
  });
  expect(host.update).not.toHaveBeenCalled();
  const fresh = setting(await scope("machine:workspace"), "logsPath");
  host.update.mockRejectedValueOnce(new Error("Personal settings are read-only"));
  await receive({
    type: "save",
    id: 2,
    key: "logsPath",
    target: "machine:workspace",
    stamp: fresh.stamp,
    value: scratch!,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 2, error: "Personal settings are read-only" });
  host.update.mockImplementationOnce(async () => {});
  await receive({
    type: "save",
    id: 3,
    key: "logsPath",
    target: "machine:workspace",
    stamp: fresh.stamp,
    value: scratch!,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 3, error: expect.stringMatching(/did not save/) });
  expect(host.values[2]).toEqual({ unrelated: "keep" });
});

it("saves Team authoring rules in project.json and preserves unrelated properties", async () => {
  const initial = {
    version: 1,
    authoring: { characterHistory: { quoteCultures: false, future: "keep" }, extra: ["keep"] },
    validation: { ignore: ["existing"] },
    unrelated: { keep: true },
  };
  const { target, file } = teamFixture(initial);
  await open();
  const state = await scope(target);
  await receive({
    type: "save",
    id: 1,
    key: "characterHistory.quoteNames",
    target,
    stamp: setting(state, "characterHistory.quoteNames").stamp,
    value: false,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 1 });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
    ...initial,
    authoring: {
      ...initial.authoring,
      characterHistory: { ...initial.authoring.characterHistory, quoteNames: false },
    },
  });
  expect(host.update).not.toHaveBeenCalled();
  expect(host.values[2]).toEqual({ unrelated: "keep" });
  const saved = await scope(target);
  expect(setting(saved, "characterHistory.quoteNames")).toMatchObject({
    explicit: true,
    value: false,
    source: "Mod rules",
  });
  await receive({
    type: "save",
    id: 2,
    key: "characterHistory.quoteNames",
    target,
    stamp: setting(saved, "characterHistory.quoteNames").stamp,
    value: null,
    reset: true,
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(initial);
});

it("saves personal Workshop changelogs independently of shared rules and restores inherited defaults", async () => {
  const initial = { version: 1, publishing: { changelog: "shared.md", future: "keep" } };
  const { target, file } = teamFixture(initial);
  host.values[1]["workshop.changelog"] = "legacy.md";
  host.values[1].machinePaths = {
    version: 1,
    future: "keep",
    defaults: { ck3: { "workshop.changelog": "personal.md" } },
  };
  await open();
  const personal = setting(await scope("user"), "workshop.changelog");
  expect(personal).toMatchObject({
    value: "personal.md",
    effectiveValue: "shared.md",
    effectiveSource: "Mod rules",
    resetValue: "shared.md",
  });
  await receive({
    type: "save",
    id: 1,
    key: "workshop.changelog",
    target: "user",
    stamp: personal.stamp,
    value: "next.md",
  });
  expect(host.posted).toContainEqual({ type: "result", id: 1 });
  expect(host.values[1].machinePaths).toEqual({
    version: 1,
    future: "keep",
    defaults: { ck3: { "workshop.changelog": "next.md" } },
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(initial);
  await receive({ type: "destination", context: target, key: "workshop.changelog", target });
  const shared = setting(await scope(target), "workshop.changelog");
  expect(shared.resetValue).toBe("next.md");
  await receive({
    type: "save",
    id: 2,
    key: "workshop.changelog",
    target,
    stamp: shared.stamp,
    value: null,
    reset: true,
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
    version: 1,
    publishing: { future: "keep" },
  });
  const inherited = setting(await scope("user"), "workshop.changelog");
  expect(inherited).toMatchObject({
    value: "next.md",
    effectiveValue: "next.md",
    effectiveSource: "Personal defaults",
    resetValue: "legacy.md",
  });
  await receive({
    type: "save",
    id: 3,
    key: "workshop.changelog",
    target: "user",
    stamp: inherited.stamp,
    value: null,
    reset: true,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 3 });
  expect(setting(await scope("user"), "workshop.changelog")).toMatchObject({
    value: "legacy.md",
    effectiveValue: "legacy.md",
    effectiveSource: "Legacy User setting",
  });
});

it("rejects automatic game pins and authoring writes to Workspace or Folder settings", async () => {
  const { target, file } = teamFixture();
  await open();
  const team = await scope(target);
  await receive({
    type: "save",
    id: 1,
    key: "gameId",
    target,
    stamp: setting(team, "gameId").stamp,
    value: "auto",
  });
  expect(host.posted).toContainEqual({
    type: "result",
    id: 1,
    error: expect.stringMatching(/auto|specific|concrete|game/i),
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1 });
  await receive({
    type: "save",
    id: 2,
    key: "gameId",
    target,
    stamp: setting(team, "gameId").stamp,
    value: "ck3",
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, gameId: "ck3" });
  const folder = `folder:${URI.file("/mods/test").toString()}` as const;
  for (const [index, rejectedTarget] of ["workspace", folder].entries()) {
    await receive({
      type: "save",
      id: index + 3,
      key: "characterHistory.quoteNames",
      target: rejectedTarget as SettingsTarget,
      stamp: "undefined",
      value: false,
    });
    expect(host.posted).toContainEqual({
      type: "result",
      id: index + 3,
      error: expect.stringMatching(/shared settings/),
    });
  }
  expect(host.update).not.toHaveBeenCalled();
  expect(host.values[3]).toEqual({});
});

it("rejects stale Team settings and reports failed saves while keeping the edited buffer", async () => {
  const { target, file } = teamFixture();
  await open();
  const stale = setting(await scope(target), "characterHistory.quoteNames");
  const current = '{"version":1,"unrelated":"newer content"}';
  fs.writeFileSync(file, current);
  await receive({
    type: "save",
    id: 1,
    key: "characterHistory.quoteNames",
    target,
    stamp: stale.stamp,
    value: false,
  });
  expect(host.posted).toContainEqual({
    type: "result",
    id: 1,
    error: expect.stringMatching(/Mod settings changed/),
  });
  expect(fs.readFileSync(file, "utf8")).toBe(current);
  const fresh = setting(await scope(target), "characterHistory.quoteNames");
  host.rejectSave = true;
  await receive({
    type: "save",
    id: 2,
    key: "characterHistory.quoteNames",
    target,
    stamp: fresh.stamp,
    value: false,
  });
  expect(host.posted).toContainEqual({
    type: "result",
    id: 2,
    error: expect.stringMatching(/could not be saved/),
  });
  expect(fs.readFileSync(file, "utf8")).toBe(current);
  const document = host.documents.get(URI.file(file).fsPath)!;
  expect(document).toMatchObject({ isDirty: true });
  expect(JSON.parse(document.getText())).toMatchObject({
    unrelated: "newer content",
    authoring: { characterHistory: { quoteNames: false } },
  });
  host.trusted = false;
  await receive({
    type: "save",
    id: 3,
    key: "characterHistory.quoteNames",
    target,
    stamp: fresh.stamp,
    value: true,
  });
  expect(host.posted).toContainEqual({
    type: "result",
    id: 3,
    error: expect.stringMatching(/Trust this workspace/),
  });
  expect(fs.readFileSync(file, "utf8")).toBe(current);
});

it("keeps the active folder value when editing a User default", async () => {
  const { target } = teamFixture();
  host.values[1]["characterHistory.quoteNames"] = false;
  host.values[3]["characterHistory.quoteNames"] = true;
  const initial = await open();
  expect(setting(initial, "characterHistory.quoteNames").target).toBe(target);
  await receive({ type: "destination", context: target, key: "characterHistory.quoteNames", target: "user" });
  const before = host.posted.at(-1)!;
  expect(before.type === "state" && setting(before.state, "characterHistory.quoteNames")).toMatchObject({
    value: false,
    effectiveValue: true,
    source: "User",
    effectiveSource: "Folder",
  });
  await receive({
    type: "save",
    id: 1,
    context: target,
    key: "characterHistory.quoteNames",
    target: "user",
    stamp: "false",
    value: true,
  });
  await vi.waitFor(() => {
    const reply = host.posted.at(-1)!;
    expect(reply.type === "state" && setting(reply.state, "characterHistory.quoteNames")).toMatchObject({
      value: true,
      effectiveValue: true,
      effectiveSource: "Folder",
    });
  });
});

it("uses the selected mod for effective values and saves captured contexts without moving focus", async () => {
  const { target, file } = teamFixture();
  const secondRoot = path.join(scratch!, "second");
  fs.mkdirSync(path.join(secondRoot, ".px-toolkit"), { recursive: true });
  fs.writeFileSync(path.join(secondRoot, "descriptor.mod"), 'name="Second mod"');
  const secondFile = path.join(secondRoot, ".px-toolkit/project.json");
  fs.writeFileSync(
    secondFile,
    JSON.stringify({ version: 1, authoring: { characterHistory: { quoteNames: false } } })
  );
  host.workspaceMods = [secondRoot];
  host.folderValues.set(URI.parse(target.slice("project:".length)).fsPath, { scopeInlayHints: true });
  host.folderValues.set(URI.file(secondRoot).fsPath, { scopeInlayHints: false });
  const first = await open();
  const secondContext = `project:${URI.file(secondRoot).toString()}` as const;
  const second = await scope(secondContext);
  expect(second.rows.map((row) => row.key)).toEqual(first.rows.map((row) => row.key));
  expect(setting(second, "scopeInlayHints").effectiveValue).toBe(false);
  expect(setting(second, "characterHistory.quoteNames").effectiveValue).toBe(false);
  expect(setting(second, "modPath").resolved).toBe(URI.parse(secondContext.slice("project:".length)).fsPath);
  expect(host.modPath).toBe(scratch);
  expect(host.readResources).toContain(URI.parse(secondContext.slice("project:".length)).fsPath);
  await receive({
    type: "save",
    id: 1,
    context: target,
    target,
    key: "characterHistory.quoteNames",
    stamp: setting(first, "characterHistory.quoteNames").stamp,
    value: false,
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({
    authoring: { characterHistory: { quoteNames: false } },
  });
  expect(JSON.parse(fs.readFileSync(secondFile, "utf8"))).toEqual({
    version: 1,
    authoring: { characterHistory: { quoteNames: false } },
  });
  await vi.waitFor(() =>
    expect(host.posted.at(-1)).toMatchObject({ type: "state", state: { target: secondContext } })
  );
  await receive({
    type: "save",
    id: 2,
    context: target,
    target: secondContext,
    key: "characterHistory.quoteNames",
    stamp: setting(first, "characterHistory.quoteNames").stamp,
    value: true,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 2, error: expect.stringMatching(/this mod/) });
  await receive({
    type: "browse",
    id: 3,
    context: secondContext,
    key: "gamePath",
    target: `machine-folder:${URI.file("/other-folder").toString()}`,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 3, error: expect.stringMatching(/destination/) });
});

it("remembers each row destination per mod and labels actions with their real context", async () => {
  const { target } = teamFixture();
  const second = path.join(scratch!, "second");
  fs.mkdirSync(second);
  host.workspaceMods = [second];
  await open();
  await receive({ type: "destination", context: target, key: "scopeInlayHints", target: "user" });
  const secondContext = `project:${URI.file(second).toString()}` as const;
  expect(setting(await scope(secondContext), "scopeInlayHints").target).toBe("workspace");
  const first = await scope(target);
  expect(setting(first, "scopeInlayHints").target).toBe("user");
  expect(first.actions.find((action) => action.command === "px.addDependencyMod")?.label).toContain(
    "Current workspace"
  );
  await receive({ type: "action", command: "px.configureLocalizationDefaults" });
  expect(host.command).toHaveBeenCalledWith(
    "px.configureLocalizationDefaults",
    URI.parse(target.slice("project:".length))
  );
});

it("shows unsupported rows disabled and never offers read-only roots for writes", async () => {
  teamFixture();
  host.gameId = "eu5";
  const state = await open();
  expect(setting(state, "tigerPath").disabled).toContain("not available");
  expect(setting(state, "characterHistory.quoteNames").disabled).toContain("not available");
  const before = state.rows.map((row) => row.key);
  host.gamePath = scratch!;
  await receive({ type: "target", target: "workspace" });
  const reply = host.posted.at(-1)!;
  if (reply.type !== "state") throw new Error("No workspace state");
  const withoutEditableMod = reply.state;
  expect(withoutEditableMod.rows.map((row) => row.key)).toEqual(before);
  expect(withoutEditableMod.targets).toEqual([{ id: "workspace", label: "This workspace" }]);
  expect(setting(withoutEditableMod, "characterHistory.quoteNames").targets).toEqual([
    { id: "user", label: "Personal defaults" },
  ]);
});

it("reports private destination and active folder values separately", async () => {
  const { target } = teamFixture();
  const folderUri = normalizeMachineUri(URI.file("/mods/test").toString(), process.platform === "win32");
  const workspaceUri = normalizeMachineUri(
    URI.file("/mods/test.code-workspace").toString(),
    process.platform === "win32"
  );
  host.values[1].machinePaths = {
    version: 1,
    defaults: { ck3: { logsPath: "personal" } },
    workspaces: { [workspaceUri]: { ck3: { logsPath: "workspace" } } },
    folders: { [folderUri]: { ck3: { logsPath: scratch! } } },
  };
  const initial = await open();
  expect(setting(initial, "logsPath").target).toMatch(/^machine-folder:/);
  await receive({ type: "destination", context: target, key: "logsPath", target: "machine:workspace" });
  const state = host.posted.at(-1)!;
  expect(state.type === "state" && setting(state.state, "logsPath")).toMatchObject({
    value: "workspace",
    effectiveValue: scratch!,
    effectiveSource: "Personal folder paths",
    source: "Personal workspace paths",
    resolved: scratch!,
    resetLabel: "Remove workspace override",
  });
  await receive({
    type: "save",
    id: 1,
    context: target,
    key: "logsPath",
    target: "machine:workspace",
    stamp: state.type === "state" ? setting(state.state, "logsPath").stamp : "",
    value: scratch!,
  });
  expect(host.update).toHaveBeenCalledWith("machinePaths", expect.any(Object), 1);
  expect(host.values[2]).toEqual({ unrelated: "keep" });
});

it("saves multiple shared rules and private paths from one preview without invalidating other drafts", async () => {
  const { target, file } = teamFixture({ version: 1, unknown: { keep: true } });
  host.values[1].machinePaths = { version: 1, unknown: "keep", defaults: { vic3: { gamePath: "other" } } };
  const state = await open();
  const drafts = [
    { id: 1, key: "gamePath", target: "user" as const, value: scratch! },
    { id: 2, key: "logsPath", target: "user" as const, value: scratch! },
    { id: 3, key: "characterHistory.quoteNames", target, value: false },
    { id: 4, key: "diagnostics.requireDescriptor", target, value: true },
    { id: 5, key: "scopeInlayHints", target: "workspace" as const, value: true },
  ];
  await receive({
    type: "saveBatch",
    changes: drafts.map((draft) => ({ ...draft, context: target, stamp: setting(state, draft.key).stamp })),
  });
  for (const draft of drafts) expect(host.posted).toContainEqual({ type: "result", id: draft.id });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
    version: 1,
    unknown: { keep: true },
    authoring: { characterHistory: { quoteNames: false } },
    validation: { requireDescriptor: true },
  });
  expect(host.values[1].machinePaths).toMatchObject({
    unknown: "keep",
    defaults: { ck3: { gamePath: scratch!, logsPath: scratch! }, vic3: { gamePath: "other" } },
  });
  expect(host.update.mock.calls.filter(([key]) => key === "machinePaths")).toHaveLength(1);
  expect(host.values[2]).toEqual({ unrelated: "keep", scopeInlayHints: true });
});

it("rejects whole storage groups for an externally stale or invalid draft", async () => {
  const { target, file } = teamFixture();
  const state = await open();
  host.values[1].machinePaths = { version: 1, future: "external" };
  fs.writeFileSync(file, '{"version":1,"future":"external"}');
  const rows = ["gamePath", "logsPath", "characterHistory.quoteNames", "diagnostics.requireDescriptor"];
  await receive({
    type: "saveBatch",
    changes: rows.map((key, id) => ({
      id,
      key,
      context: target,
      target: id < 2 ? "user" : target,
      stamp: setting(state, key).stamp,
      value: id < 2 ? scratch! : true,
    })),
  });
  for (const [id] of rows.entries())
    expect(host.posted).toContainEqual({ type: "result", id, error: expect.stringMatching(/changed/) });
  expect(host.update).not.toHaveBeenCalled();
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, future: "external" });
  const current = await scope(target);
  await receive({
    type: "saveBatch",
    changes: [
      {
        id: 5,
        context: target,
        key: "gamePath",
        target: "user",
        stamp: setting(current, "gamePath").stamp,
        value: scratch!,
      },
      {
        id: 6,
        context: target,
        key: "logsPath",
        target: "workspace",
        stamp: setting(current, "logsPath").stamp,
        value: scratch!,
      },
    ],
  });
  for (const id of [5, 6])
    expect(host.posted).toContainEqual({ type: "result", id, error: expect.stringMatching(/destination/) });
  expect(host.update).not.toHaveBeenCalled();
});

it("saves project overrides before native User defaults from the same shared-rule preview", async () => {
  const { target, file } = teamFixture();
  const initial = await open();
  await receive({
    type: "destination",
    context: target,
    key: "diagnostics.requireDescriptor",
    target: "user",
  });
  const reply = host.posted.at(-1)!;
  if (reply.type !== "state") throw new Error("No state");
  const state = reply.state;
  await receive({
    type: "saveBatch",
    changes: [
      {
        id: 1,
        context: target,
        key: "diagnostics.requireDescriptor",
        target: "user",
        stamp: setting(state, "diagnostics.requireDescriptor").stamp,
        value: true,
      },
      {
        id: 2,
        context: target,
        key: "diagnostics.requireDescriptor",
        target,
        stamp: setting(initial, "diagnostics.requireDescriptor").stamp,
        value: false,
      },
    ],
  });
  expect(host.posted).toContainEqual({ type: "result", id: 1 });
  expect(host.posted).toContainEqual({ type: "result", id: 2 });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
    version: 1,
    validation: { requireDescriptor: false },
  });
  expect(host.values[1]["diagnostics.requireDescriptor"]).toBe(true);
});

it("keeps new-project locations independent of existing mod folder bindings", async () => {
  const { target } = teamFixture();
  const folderUri = normalizeMachineUri(URI.file("/mods/test").toString(), process.platform === "win32");
  host.values[1].machinePaths = {
    version: 1,
    folders: { [folderUri]: { ck3: { modProjectsDir: scratch! } } },
  };
  const state = await open();
  const row = setting(state, "modProjectsDir");
  expect(row.targets.map((destination) => destination.id)).toEqual(["user", "machine:workspace"]);
  expect(row.target).toBe("user");
  expect(row.effectiveValue).toBe(row.schema.default);
  expect(row.effectiveSource).toBe("Not set");
  const folderTarget = `machine-folder:${URI.file("/mods/test").toString()}` as const;
  await receive({ type: "destination", context: target, key: "modProjectsDir", target: folderTarget });
  expect(host.posted.at(-1)).toEqual({ type: "error", message: expect.stringMatching(/destination/) });
  await receive({
    type: "save",
    id: 1,
    context: target,
    key: "modProjectsDir",
    target: folderTarget,
    stamp: row.stamp,
    value: "new path",
  });
  expect(host.posted).toContainEqual({ type: "result", id: 1, error: expect.stringMatching(/destination/) });
  expect(host.update).not.toHaveBeenCalled();
  await receive({
    type: "save",
    id: 2,
    context: target,
    key: "modProjectsDir",
    target: "user",
    stamp: row.stamp,
    value: scratch!,
  });
  expect(host.posted).toContainEqual({ type: "result", id: 2 });
  expect(host.values[1].machinePaths).toEqual({
    version: 1,
    folders: { [folderUri]: { ck3: { modProjectsDir: scratch! } } },
    defaults: { ck3: { modProjectsDir: scratch! } },
  });
});
