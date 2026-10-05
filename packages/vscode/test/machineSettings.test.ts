import { beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "node:path";

const state = vi.hoisted(() => ({
  workspace: "test://workspace/one",
  folder: "test://folder/one",
  roots: [] as string[],
  registry: undefined as unknown,
  legacy: {} as Record<string, Record<string, unknown>>,
  fail: false,
  discard: false,
  afterUpdate: undefined as (() => void) | undefined,
  documents: [] as { isDirty: boolean; uri: { toString(): string } }[],
  updates: [] as { key: string; value: unknown; target: number }[],
}));
vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  Uri: {
    file: (root: string) => ({ toString: () => `test://workspace/${encodeURIComponent(root)}` }),
    joinPath: (uri: { toString(): string }, ...parts: string[]) => ({
      toString: () => `${uri.toString()}/${parts.join("/")}`,
    }),
  },
  workspace: {
    get workspaceFile() {
      return state.workspace ? { toString: () => state.workspace } : undefined;
    },
    get workspaceFolders() {
      return state.roots.map((root) => ({
        uri: { toString: () => `test://workspace/${encodeURIComponent(root)}` },
      }));
    },
    get textDocuments() {
      return state.documents;
    },
    getWorkspaceFolder: (resource: { toString(): string }) => ({ uri: resource }),
    getConfiguration: () => ({
      inspect: (key: string) =>
        key === "machinePaths"
          ? {
              globalValue: state.registry,
              workspaceValue: {
                version: 1,
                patches: { project: { output: "C:/workspace-only", sources: {} } },
              },
            }
          : state.legacy[key],
      update: async (key: string, value: unknown, target: number) => {
        if (state.fail) throw new Error("settings file is read-only");
        state.updates.push({ key, value, target });
        if (!state.discard) {
          if (key === "machinePaths") state.registry = value;
          else if (state.legacy[key])
            state.legacy[key][target === 2 ? "workspaceValue" : "workspaceFolderValue"] = value;
        }
        state.afterUpdate?.();
      },
    }),
  },
}));
import {
  inspectMachineSetting,
  migrateLegacyMachineSettings,
  prepareMachineSettingsMove,
  applyMachineSettingsMove,
  rollbackMachineSettingsMove,
  readMachineSetting,
  writeMachineSetting,
  writeMachineSettings,
  readPatchBindings,
  writePatchBindings,
} from "../src/machineSettings";
import type { MachineSettings, PatchBindings } from "@px-lsp/protocol/machineSettings";
import type { Uri } from "vscode";

beforeEach(() => {
  state.registry = undefined;
  state.workspace = "test://workspace/one";
  state.folder = "test://folder/one";
  state.roots = [];
  state.legacy = {};
  state.fail = false;
  state.discard = false;
  state.afterUpdate = undefined;
  state.documents = [];
  state.updates = [];
});

describe("native User machine paths", () => {
  it("serializes Global patch bindings with settings and rejects stale concurrent previews", async () => {
    state.registry = {
      version: 1,
      extra: true,
      patches: {
        project: { output: "C:/patch", sources: {}, unknown: "keep" },
        other: { output: "C:/other", sources: {} },
      },
    };
    const snapshot = readPatchBindings("project");
    const results = await Promise.allSettled([
      writePatchBindings("project", { output: "C:/new", sources: { mod: "C:/source" } }, snapshot.stamp),
      writePatchBindings("other", { output: "C:/changed", sources: {} }, snapshot.stamp),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(readPatchBindings("project").bindings).toEqual({
      output: "C:/new",
      sources: { mod: "C:/source" },
      unknown: "keep",
    });
    expect(readPatchBindings("other").bindings?.output).toBe("C:/other");
    const beforeSetting = readPatchBindings("project");
    await writeMachineSetting("logsPath", "logs", "ck3", "default");
    await expect(writePatchBindings("project", undefined, beforeSetting.stamp)).rejects.toThrow("changed");
    await writePatchBindings("project", undefined);
    expect(readPatchBindings("project").bindings).toBeUndefined();
    expect((state.registry as MachineSettings).extra).toBe(true);
    expect(state.updates.every(({ key, target }) => key === "machinePaths" && target === 1)).toBe(true);
  });

  it("keeps malformed and future patch registries read-only and reports failed saves", async () => {
    for (const registry of [
      { version: 1, patches: { project: { output: "relative", sources: {} } } },
      { version: 2, patches: { project: { output: "C:/patch", sources: {} } } },
    ]) {
      state.registry = registry;
      expect(readPatchBindings("project").error).toBeDefined();
      await expect(writePatchBindings("project", { output: "C:/patch", sources: {} })).rejects.toThrow();
      expect(state.registry).toBe(registry);
    }
    state.registry = undefined;
    for (const sources of [null, []])
      await expect(
        writePatchBindings("project", { output: "C:/patch", sources } as unknown as PatchBindings)
      ).rejects.toThrow("absolute");
    await expect(writePatchBindings("project", { output: "relative", sources: {} })).rejects.toThrow(
      "absolute"
    );
    state.fail = true;
    await expect(writePatchBindings("project", { output: "C:/patch", sources: {} })).rejects.toThrow(
      "read-only"
    );
    state.fail = false;
    state.discard = true;
    await expect(writePatchBindings("project", { output: "C:/patch", sources: {} })).rejects.toThrow(
      "did not save"
    );
    state.discard = false;
    await writePatchBindings("project", { output: "C:/patch", sources: {} });
    expect(readPatchBindings("project").bindings?.output).toBe("C:/patch");
  });

  it("relocates only contained patch paths and restores them after a failed move", async () => {
    const oldRoot = path.resolve("old-patch-root");
    const newRoot = path.resolve("new-patch-root");
    const bindings = {
      output: path.join(oldRoot, "output"),
      sources: { moved: path.join(oldRoot, "sources", "one"), unrelated: `${oldRoot}-other` },
      unknown: { keep: true },
    };
    await writePatchBindings("project", bindings);
    await writePatchBindings("other", { output: `${oldRoot}-other`, sources: {} });
    const before = state.registry;
    const move = prepareMachineSettingsMove([oldRoot], newRoot, "ck3", oldRoot, newRoot);
    await applyMachineSettingsMove(move);
    expect(readPatchBindings("project").bindings).toEqual({
      ...bindings,
      output: path.join(newRoot, "output"),
      sources: { ...bindings.sources, moved: path.join(newRoot, "sources", "one") },
    });
    expect(readPatchBindings("other").bindings?.output).toBe(`${oldRoot}-other`);
    await rollbackMachineSettingsMove(move);
    expect(state.registry).toEqual(before);
    await applyMachineSettingsMove(move);
    await writePatchBindings("project", { output: path.join(newRoot, "edited"), sources: {} });
    await expect(rollbackMachineSettingsMove(move)).rejects.toThrow("changed after");
    expect(readPatchBindings("project").bindings?.output).toBe(path.join(newRoot, "edited"));
  });

  it("rebinds a moved single-folder workspace and rejects stale or conflicting moves", async () => {
    state.workspace = "test://workspace/one";
    state.roots = ["one"];
    state.registry = {
      version: 1,
      workspaces: {
        "test://workspace/one": {
          ck3: { gamePath: "install", modPath: "one" },
          vic3: { gamePath: "other-game" },
        },
      },
      folders: { "test://workspace/one": { ck3: { logsPath: "logs" } } },
    };
    const before = state.registry;
    const move = prepareMachineSettingsMove(["one"], "two", "ck3", "one", "two/mod");
    await applyMachineSettingsMove(move);
    state.workspace = "test://workspace/two";
    expect(readMachineSetting("gamePath", "ck3")).toBe("install");
    expect(readMachineSetting("modPath", "ck3")).toBe("two/mod");
    expect(readMachineSetting("gamePath", "vic3")).toBe("other-game");
    await rollbackMachineSettingsMove(move);
    expect(state.registry).toEqual(before);
    const stale = prepareMachineSettingsMove(["two"], "three", "ck3", "two/mod", "three/mod");
    await writeMachineSetting("logsPath", "changed", "ck3", "default");
    await expect(applyMachineSettingsMove(stale)).rejects.toThrow("changed");
    (state.registry as MachineSettings).workspaces!["test://workspace/two"] = {
      ck3: { gamePath: "conflict" },
    };
    state.workspace = "test://workspace/one";
    expect(() => prepareMachineSettingsMove(["one"], "two", "ck3", "one", "two/mod")).toThrow("conflict");
  });

  it("keeps two installations for one game and another game's paths independent", async () => {
    await writeMachineSetting("gamePath", "old-game", "ck3", "workspace");
    state.workspace = "test://workspace/two";
    await writeMachineSetting("gamePath", "new-game", "ck3", "workspace");
    await writeMachineSetting("gamePath", "other-game", "vic3", "workspace");
    expect(readMachineSetting("gamePath", "ck3")).toBe("new-game");
    expect(readMachineSetting("gamePath", "vic3")).toBe("other-game");
    state.workspace = "test://workspace/one";
    expect(readMachineSetting("gamePath", "ck3")).toBe("old-game");
    expect(readMachineSetting("gamePath", "vic3")).toBeUndefined();
    expect(state.updates.every(({ key, target }) => key === "machinePaths" && target === 1)).toBe(true);
  });

  it("ranks folder and legacy bindings before defaults and preserves explicit empty overrides", async () => {
    state.legacy.gamePath = {
      defaultValue: "detected-default",
      globalValue: "global",
      workspaceValue: "workspace",
      workspaceFolderValue: "folder",
    };
    await writeMachineSetting("gamePath", "user-default", "ck3", "default");
    expect(readMachineSetting("gamePath", "ck3")).toBe("workspace");
    await writeMachineSetting("gamePath", "personal-workspace", "ck3", "workspace");
    expect(readMachineSetting("gamePath", "ck3")).toBe("personal-workspace");
    const resource = { toString: () => state.folder } as Uri;
    expect(readMachineSetting("gamePath", "ck3", resource)).toBe("folder");
    await writeMachineSetting("gamePath", "", "ck3", "folder", undefined, resource);
    expect(readMachineSetting("gamePath", "ck3", resource)).toBe("");
    expect(inspectMachineSetting("gamePath", "ck3", "folder", resource).source).toBe("folder");
    await writeMachineSetting("parentMods", [], "ck3", "workspace");
    state.legacy.parentMods = { globalValue: ["dependency"] };
    expect(readMachineSetting("parentMods", "ck3")).toEqual([]);
    await writeMachineSetting("gamePath", undefined, "ck3", "folder", undefined, resource);
    expect(readMachineSetting("gamePath", "ck3", resource)).toBe("folder");
  });

  it("preserves unknown values while rejecting future formats and stale edits", async () => {
    state.registry = { version: 1, future: "keep", defaults: { ck3: { extra: "keep" } } };
    const before = inspectMachineSetting("gamePath", "ck3", "workspace");
    await writeMachineSetting("logsPath", "logs", "ck3", "workspace");
    await expect(writeMachineSetting("gamePath", "game", "ck3", "workspace", before.stamp)).rejects.toThrow(
      "changed"
    );
    expect((state.registry as MachineSettings).future).toBe("keep");
    expect((state.registry as MachineSettings).defaults?.ck3.extra).toBe("keep");
    state.registry = { version: 2, keep: true };
    expect(inspectMachineSetting("gamePath", "ck3", "workspace").error).toContain("unsupported version");
    expect(() => readMachineSetting("gamePath", "ck3")).toThrow("unsupported version");
    await expect(writeMachineSetting("gamePath", "game", "ck3", "default")).rejects.toThrow(
      "unsupported version"
    );
    expect(state.registry).toEqual({ version: 2, keep: true });
  });

  it("reports failed saves and readback races, and recovers the write queue", async () => {
    state.fail = true;
    await expect(writeMachineSetting("gamePath", "game", "ck3", "default")).rejects.toThrow("read-only");
    state.fail = false;
    state.discard = true;
    await expect(writeMachineSetting("gamePath", "game", "ck3", "default")).rejects.toThrow("did not save");
    state.discard = false;
    state.afterUpdate = () => {
      state.registry = { version: 1, changedElsewhere: true };
    };
    await expect(writeMachineSetting("gamePath", "game", "ck3", "default")).rejects.toThrow("did not save");
    state.afterUpdate = undefined;
    await writeMachineSetting("gamePath", "game", "ck3", "default");
    expect(readMachineSetting("gamePath", "ck3")).toBe("game");
    expect((state.registry as MachineSettings).changedElsewhere).toBe(true);
  });

  it("rejects workspace writes in an empty window", async () => {
    state.workspace = "";
    await expect(writeMachineSetting("gamePath", "game", "ck3", "workspace")).rejects.toThrow("No workspace");
    expect(state.updates).toEqual([]);
  });

  it("upgrades only explicit workspace paths and keeps conflicting personal bindings", async () => {
    state.legacy.gamePath = { workspaceValue: "workspace-game", globalValue: "global-game" };
    state.legacy.logsPath = { workspaceValue: "workspace-logs" };
    await writeMachineSetting("logsPath", "personal-logs", "ck3", "workspace");
    const result = await migrateLegacyMachineSettings("ck3", []);
    expect(result.imported).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(state.legacy.gamePath).toEqual({ workspaceValue: undefined, globalValue: "global-game" });
    expect(state.legacy.logsPath.workspaceValue).toBe("workspace-logs");
    expect(readMachineSetting("gamePath", "ck3")).toBe("workspace-game");
    state.workspace = "test://workspace/two";
    expect(readMachineSetting("gamePath", "ck3")).toBe("global-game");
  });

  it("retains legacy paths on save failure and completes cleanup on retry", async () => {
    state.legacy.gamePath = { workspaceValue: "workspace-game" };
    state.fail = true;
    expect((await migrateLegacyMachineSettings("ck3", [])).errors).toHaveLength(1);
    expect(state.legacy.gamePath.workspaceValue).toBe("workspace-game");
    state.fail = false;
    expect((await migrateLegacyMachineSettings("ck3", [])).removed).toHaveLength(1);
    expect(readMachineSetting("gamePath", "ck3")).toBe("workspace-game");
  });

  it("moves folder overrides into their own personal slot before removing the scoped key", async () => {
    const resource = { toString: () => state.folder } as Uri;
    state.legacy.gamePath = { workspaceValue: "workspace-game", workspaceFolderValue: "folder-game" };
    const result = await migrateLegacyMachineSettings("ck3", [resource]);
    expect(result.errors).toEqual([]);
    expect(result.imported).toHaveLength(2);
    expect(result.removed).toHaveLength(2);
    expect(readMachineSetting("gamePath", "ck3")).toBe("workspace-game");
    expect(readMachineSetting("gamePath", "ck3", resource)).toBe("folder-game");
  });

  it("does not upgrade from an unsaved workspace settings buffer", async () => {
    state.legacy.gamePath = { workspaceValue: "disk-game" };
    state.documents = [{ isDirty: true, uri: { toString: () => state.workspace } }];
    const result = await migrateLegacyMachineSettings("ck3", []);
    expect(result.errors[0]).toContain("unsaved settings edits");
    expect(state.updates).toEqual([]);
    expect(state.legacy.gamePath.workspaceValue).toBe("disk-game");
  });

  it("keeps the old scoped setting when its buffer becomes dirty before cleanup", async () => {
    state.legacy.gamePath = { workspaceValue: "disk-game" };
    state.afterUpdate = () => {
      state.documents = [{ isDirty: true, uri: { toString: () => state.workspace } }];
    };
    const result = await migrateLegacyMachineSettings("ck3", []);
    expect(result.imported).toHaveLength(1);
    expect(result.removed).toEqual([]);
    expect(result.errors[0]).toContain("unsaved settings edits");
    expect(state.legacy.gamePath.workspaceValue).toBe("disk-game");
  });
});

describe("machine settings batches", () => {
  it("writes two checked paths once and preserves unrelated fields", async () => {
    state.registry = { version: 1, unknown: "keep", defaults: { vic3: { logsPath: "other" } } };
    const changes = ["gamePath", "logsPath"].map((key) => ({
      key: key as "gamePath" | "logsPath",
      gameId: "ck3",
      scope: "default" as const,
      value: key,
      expectedStamp: inspectMachineSetting(key as "gamePath" | "logsPath", "ck3", "default").stamp,
    }));
    await writeMachineSettings(changes);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ key: "machinePaths", target: 1 });
    expect(state.registry).toEqual({
      version: 1,
      unknown: "keep",
      defaults: { ck3: { gamePath: "gamePath", logsPath: "logsPath" }, vic3: { logsPath: "other" } },
    });
  });
  it("rejects an entire batch if any stamp or value is invalid", async () => {
    const game = inspectMachineSetting("gamePath", "ck3", "default");
    const logs = inspectMachineSetting("logsPath", "ck3", "default");
    state.legacy.logsPath = { globalValue: "external" };
    await expect(
      writeMachineSettings([
        { key: "gamePath", gameId: "ck3", scope: "default", value: "game", expectedStamp: game.stamp },
        { key: "logsPath", gameId: "ck3", scope: "default", value: "logs", expectedStamp: logs.stamp },
      ])
    ).rejects.toThrow("changed");
    expect(state.registry).toBeUndefined();
    expect(state.updates).toHaveLength(0);
    await expect(
      writeMachineSettings([
        { key: "gamePath", gameId: "ck3", scope: "default", value: "game" },
        { key: "logsPath", gameId: "ck3", scope: "default", value: [] },
      ])
    ).rejects.toThrow();
    expect(state.updates).toHaveLength(0);
  });
});
