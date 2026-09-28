import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const host = vi.hoisted(() => ({
  folders: [] as string[],
  settings: {} as Record<string, unknown>,
}));
vi.mock("vscode", () => ({
  Uri: class {
    scheme = "file";
    constructor(public fsPath: string) {}
    static file(file: string) {
      return new this(file);
    }
  },
  window: {},
  workspace: {
    get workspaceFolders() {
      return host.folders.map((fsPath) => ({ uri: { fsPath, scheme: "file" } }));
    },
    getConfiguration: () => ({ get: (key: string) => host.settings[key] }),
  },
}));
vi.mock("../src/steamDetect", () => ({ findGameFolder: () => null }));
import * as vscode from "vscode";
import { allWorkspaceModCandidates, modRootFor, readConfig } from "../src/config";
import { configForTarget, writableRoot } from "../src/commandTargets";

const base = path.resolve(".local/testing");
const temporary: string[] = [];
function fixture() {
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "mods-audit-config-"));
  temporary.push(root);
  const mods = Array.from({ length: 12 }, (_, i) => path.join(root, `Mod${String(i + 1).padStart(2, "0")}`));
  for (const mod of mods) {
    fs.mkdirSync(mod);
    fs.writeFileSync(path.join(mod, "descriptor.mod"), `name="${path.basename(mod)}"\n`);
  }
  host.settings = { gameId: "ck3", logsPath: root, tigerRunOn: "manual" };
  return { root, mods };
}

afterEach(() => {
  host.folders = [];
  for (const root of temporary.splice(0)) {
    if (!root.startsWith(base + path.sep)) throw new Error("Unexpected test cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("multi-mod workspace capacity", () => {
  it.each(["individual roots", "container"])(
    "keeps all 12 mods from %s in discovery and indexing configuration",
    (layout) => {
      const { root, mods } = fixture();
      host.folders = layout === "container" ? [root] : mods;
      expect(allWorkspaceModCandidates()).toEqual(mods);
      const cfg = readConfig();
      expect([cfg.modPath, ...cfg.workspaceMods]).toEqual(mods);
      expect(cfg.parentPaths).toEqual(mods.slice(1));
      const lastFile = path.join(mods[11], "common/scripted_effects/test.txt");
      expect(modRootFor(lastFile, cfg)).toBe(mods[11]);
      expect(writableRoot(vscode.Uri.file(lastFile), cfg)).toBe(mods[11]);
      expect(configForTarget(cfg, vscode.Uri.file(lastFile)).modPath).toBe(mods[11]);
    }
  );

  it("can exclude and restore the twelfth mod without losing it from the candidate list", () => {
    const { mods } = fixture();
    host.folders = mods;
    host.settings.excludedMods = [mods[11]];
    const excluded = readConfig();
    expect([excluded.modPath, ...excluded.workspaceMods]).toEqual(mods.slice(0, 11));
    expect(excluded.parentPaths).not.toContain(mods[11]);
    expect(allWorkspaceModCandidates()).toEqual(mods);
    expect(writableRoot(vscode.Uri.file(mods[11]), excluded)).toBeNull();
    host.settings.excludedMods = [];
    expect([readConfig().modPath, ...readConfig().workspaceMods]).toEqual(mods);
  });

  it("deduplicates a container and individually added roots without imposing a count limit", () => {
    const { root, mods } = fixture();
    host.folders = [root, ...mods];
    expect(allWorkspaceModCandidates()).toEqual(mods);
    const cfg = readConfig();
    expect([cfg.modPath, ...cfg.workspaceMods]).toEqual(mods);
  });
});
