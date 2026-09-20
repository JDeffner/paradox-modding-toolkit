import { describe, expect, it, vi, beforeEach } from "vitest";
import * as path from "path";
import type { PxConfig } from "../src/config";

const host = vi.hoisted(() => ({
  activeTextEditor: undefined as unknown,
  openTextDocument: vi.fn(),
  showOpenDialog: vi.fn(),
  showInformationMessage: vi.fn(),
}));
vi.mock("vscode", () => {
  class Uri {
    constructor(
      public scheme: string,
      public fsPath: string
    ) {}
    get path() {
      return this.fsPath.replace(/\\/g, "/");
    }
    static file(file: string) {
      return new Uri("file", file);
    }
    static parse(value: string) {
      return new Uri(value.split(":")[0], value.slice(value.indexOf(":") + 1));
    }
    toString() {
      return `${this.scheme}:${this.path}`;
    }
  }
  return {
    Uri,
    window: host,
    workspace: { openTextDocument: host.openTextDocument },
    Position: class {
      constructor(
        public line: number,
        public character: number
      ) {}
    },
  };
});
import * as vscode from "vscode";
import {
  configForTarget,
  targetUri,
  targetDocument,
  targetPosition,
  templatesForFolder,
  writableRoot,
} from "../src/commandTargets";
const modA = path.resolve("fixture/mod-a"),
  modB = path.resolve("fixture/mod-b"),
  vanilla = path.resolve("fixture/game");
const cfg = {
  gameId: "ck3",
  modPath: modA,
  workspaceMods: [modB],
  parentPaths: [path.resolve("fixture/parent")],
  gamePath: vanilla,
} as PxConfig;

beforeEach(() => {
  vi.clearAllMocks();
  host.activeTextEditor = {
    document: { uri: vscode.Uri.file(path.join(modA, "events/a.txt")) },
    selection: { active: { line: 9, character: 4 } },
  };
});

describe("command targets", () => {
  it("uses the clicked definition's mod while another mod is active", () => {
    const target = { pxKey: "same.1", pxLoc: { file: path.join(modB, "events/b.txt"), line: 7 } };
    expect(configForTarget(cfg, target).modPath).toBe(modB);
    expect(configForTarget(cfg).modPath).toBe(modA);
  });
  it("never falls back for invalid explicit, virtual, or multiple targets", () => {
    for (const target of [
      {},
      [vscode.Uri.file(modB)],
      vscode.Uri.parse("untitled:scratch"),
      vscode.Uri.file(vanilla),
    ]) {
      expect(configForTarget(cfg, target).modPath).toBeNull();
    }
  });
  it("does not permit writes to dependency or game files", () => {
    expect(writableRoot(vscode.Uri.file(path.join(vanilla, "events/x.txt")), cfg)).toBeNull();
    expect(writableRoot(vscode.Uri.file(path.resolve("fixture/parent/events/x.txt")), cfg)).toBeNull();
    expect(writableRoot(vscode.Uri.file(modB), cfg)).toBe(modB);
    expect(writableRoot(vscode.Uri.file(`${modB}-other/events/x.txt`), cfg)).toBeNull();
  });
  it("derives a nested scaffold kind from the profile path", () => {
    expect(templatesForFolder(cfg, path.join(modB, "events/nested")).map((t) => t.id)).toEqual(["event"]);
    expect(templatesForFolder(cfg, path.join(vanilla, "events"))).toEqual([]);
    expect(templatesForFolder(cfg, path.join(modB, "unknown"))).toEqual([]);
  });
  it("opens the clicked unopened GUI file, without choosing the active file", async () => {
    const uri = vscode.Uri.file(path.join(modB, "gui/b.gui"));
    host.openTextDocument.mockResolvedValue({ uri });
    expect(await targetDocument(uri, ".gui")).toEqual({ uri });
    expect(host.openTextDocument).toHaveBeenCalledWith(uri);
    expect(host.showOpenDialog).not.toHaveBeenCalled();
  });
  it("offers a GUI picker only for a palette invocation", async () => {
    const uri = vscode.Uri.file(path.join(modB, "gui/b.gui"));
    host.showOpenDialog.mockResolvedValue([uri]);
    host.openTextDocument.mockResolvedValue({ uri });
    expect(await targetDocument(undefined, ".gui")).toEqual({ uri });
    expect(host.showOpenDialog).toHaveBeenCalledOnce();
    await targetDocument(vscode.Uri.file(path.join(modB, "wrong.txt")), ".gui");
    expect(host.showOpenDialog).toHaveBeenCalledOnce();
  });
  it("resolves webview source metadata and explicit positions", async () => {
    const uri = vscode.Uri.file(path.join(modB, "events/b.txt"));
    host.openTextDocument.mockResolvedValue({
      uri,
      lineCount: 10,
      lineAt: () => ({ firstNonWhitespaceCharacterIndex: 2 }),
      validatePosition: (p: unknown) => p,
    });
    const target = { pxSourceFile: uri.fsPath, pxSourceLine: 5, pxDefinitionId: "b.1" };
    expect(targetUri(target)?.fsPath).toBe(uri.fsPath);
    expect((await targetPosition(target))?.position).toMatchObject({ line: 5, character: 2 });
    expect((await targetPosition({ uri, position: { line: 3, character: 10 } }))?.position).toMatchObject({
      line: 3,
      character: 10,
    });
  });
});
