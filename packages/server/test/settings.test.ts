import { describe, expect, it } from "vitest";
import { readSettings, resolveSettings } from "../src/settings";

describe("settings intake", () => {
  it.each([
    ["dark", "dark"],
    ["#ABCDEF", "#abcdef"],
    ["invalid", "checkerboard"],
  ])("preserves the shared texture background contract for %s", (value, expected) => {
    expect(readSettings({ texturePreviewBackground: value })).toEqual({ texturePreviewBackground: expected });
  });

  it("normalizes calendars before comparison and clears them with null", () => {
    const input = readSettings({ calendar: { epoch: 4000, after: " AD ", before: " BC " } });
    expect(resolveSettings(input!, null).calendar).toEqual({ epoch: 4000, after: "AD", before: "BC" });
    const clear = readSettings({ calendar: null });
    expect(clear).toEqual({ calendar: null });
    expect(resolveSettings({ ...input, ...clear }, null).calendar).toBeUndefined();
  });

  it("rejects malformed fields without accepting part of the update", () => {
    for (const raw of [
      null,
      [],
      { modPath: 3 },
      { gameId: null },
      { parentPaths: [null] },
      { indexAssets: "false" },
      { completionMode: "unknown" },
      { calendar: { epoch: 0 } },
    ]) {
      expect(readSettings(raw)).toBeUndefined();
    }
    expect(readSettings({ parentPaths: [], ignored: true })).toEqual({ parentPaths: [] });
  });

  it("resolves a fallback without changing the configured roots", () => {
    const configured = { modPath: null, workspaceMods: [] };
    expect(resolveSettings(configured, "/workspace").modPath).toBe("/workspace");
    expect(configured.modPath).toBeNull();
    expect(resolveSettings({ ...configured, workspaceMods: ["/other"] }, "/workspace").modPath).toBeNull();
    expect(resolveSettings({ modPath: "/explicit", workspaceMods: ["/other"] }, "/workspace").modPath).toBe(
      "/explicit"
    );
  });
});
