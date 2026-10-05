import { describe, expect, it } from "vitest";
import {
  getMachineSetting,
  isMachineSetting,
  normalizeMachineUri,
  parseMachineSettings,
  relocateMachineSettings,
  setMachineSetting,
  type MachineSettings,
} from "../src/machineSettings";

describe("personal machine paths model", () => {
  it("validates absolute patch paths and preserves unknown binding fields", () => {
    const patches = {
      project: {
        output: "C:/mods/patch",
        sources: { unix: "/mods/source", windows: "D:\\mods\\source", network: "\\\\host\\share\\mod" },
        future: { keep: true },
      },
    };
    const parsed = parseMachineSettings({ version: 1, patches, extra: true });
    expect(parsed).toEqual({ ok: true, value: { version: 1, patches, extra: true } });
    for (const malformed of [
      [],
      { project: null },
      { project: { output: "relative/mod", sources: {} } },
      { project: { output: "C:mod", sources: {} } },
      { project: { output: "C:/mod", sources: [] } },
      { project: { output: "C:/mod", sources: { source: "relative" } } },
      { project: { output: "C:/mod", sources: { source: 4 } } },
      { project: { output: "C:/mod\0", sources: {} } },
    ])
      expect(parseMachineSettings({ version: 1, patches: malformed }).ok).toBe(false);
    expect(parseMachineSettings({ version: 2, patches }).ok).toBe(false);
  });

  it("relocates explicit identities without losing other games, fields or contexts", () => {
    const registry: MachineSettings = {
      version: 1,
      extension: true,
      folders: {
        "test://folder/old": { ck3: { gamePath: "install", extra: true }, vic3: { gamePath: "other-game" } },
        "test://folder/new": { ck3: { logsPath: "logs" } },
        "test://folder/unrelated": { ck3: { gamePath: "untouched" } },
      },
    };
    const next = relocateMachineSettings(registry, { folders: { "test://folder/old": "test://folder/new" } });
    expect(next.folders?.["test://folder/new"]).toEqual({
      ck3: { gamePath: "install", logsPath: "logs", extra: true },
      vic3: { gamePath: "other-game" },
    });
    expect(next.folders?.["test://folder/old"]).toBeUndefined();
    expect(next.folders?.["test://folder/unrelated"]).toEqual(registry.folders?.["test://folder/unrelated"]);
    expect(next.extension).toBe(true);
    expect(registry.folders?.["test://folder/old"]).toBeDefined();
    registry.folders!["test://folder/new"].ck3.gamePath = "conflicting-install";
    expect(() =>
      relocateMachineSettings(registry, { folders: { "test://folder/old": "test://folder/new" } })
    ).toThrow("conflict");
  });

  it("accepts only version 1 and valid known values, including explicit empty values", () => {
    expect(parseMachineSettings(undefined)).toEqual({ ok: true, value: { version: 1 } });
    for (const input of [
      null,
      [],
      {},
      { version: 2 },
      { version: 1, defaults: [] },
      { version: 1, folders: { bad: null } },
      { version: 1, defaults: { ck3: { gamePath: [] } } },
      { version: 1, defaults: { ck3: { parentMods: [1] } } },
    ]) {
      expect(parseMachineSettings(input).ok).toBe(false);
    }
    expect(parseMachineSettings({ version: 1, defaults: { ck3: { gamePath: "", parentMods: [] } } }).ok).toBe(
      true
    );
    expect(isMachineSetting("workshop.dir")).toBe(true);
    expect(isMachineSetting("gameId")).toBe(false);
  });

  it("preserves unknown fields, other games and each workspace installation", () => {
    const initial: MachineSettings = {
      version: 1,
      extension: { keep: true },
      defaults: { vic3: { gamePath: "vic3-game", future: 4 } },
    };
    const first = { workspaceUri: "test://workspace/one" };
    const second = { workspaceUri: "test://workspace/two" };
    let registry = setMachineSetting(initial, "gamePath", "old-install", "ck3", "workspace", first);
    registry = setMachineSetting(registry, "gamePath", "new-install", "ck3", "workspace", second);
    registry = setMachineSetting(registry, "gamePath", "vic3-install", "vic3", "workspace", first);
    expect(getMachineSetting(registry, "gamePath", "ck3", "workspace", first)).toBe("old-install");
    expect(getMachineSetting(registry, "gamePath", "ck3", "workspace", second)).toBe("new-install");
    expect(getMachineSetting(registry, "gamePath", "vic3", "workspace", first)).toBe("vic3-install");
    expect(registry.extension).toEqual({ keep: true });
    expect(registry.defaults).toEqual(initial.defaults);
    expect(initial.workspaces).toBeUndefined();
    registry = setMachineSetting(registry, "gamePath", undefined, "ck3", "workspace", first);
    expect(getMachineSetting(registry, "gamePath", "ck3", "workspace", first)).toBeUndefined();
    expect(getMachineSetting(registry, "gamePath", "vic3", "workspace", first)).toBe("vic3-install");
  });

  it("rejects a missing identity and normalizes local URI identities consistently", () => {
    expect(() => setMachineSetting({ version: 1 }, "gamePath", "game", "ck3", "workspace")).toThrow(
      "No workspace"
    );
    expect(normalizeMachineUri("TEST://HOST/Workspace/")).toBe("test://host/Workspace");
    expect(normalizeMachineUri("untitled:/workspace/one/")).toBe("untitled:/workspace/one");
    expect(normalizeMachineUri("file:///Drive/Work%2fSpace/", true)).toBe("file:///drive/work%2Fspace");
    expect(() => normalizeMachineUri("relative/path")).toThrow("absolute URI");
  });
});
