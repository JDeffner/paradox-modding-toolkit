import { describe, expect, it } from "vitest";
import manifest from "../package.json";
import {
  settingsCatalog,
  scopedValue,
  unsupportedSetting,
  validateSetting,
} from "../src/webviews/settings/model";
import type { SettingSchema } from "../src/webviews/settings/messages";
import { ck3Meta } from "@px-lsp/server/games/ck3/meta";
import { vic3Meta } from "@px-lsp/server/games/vic3/meta";
import { eu5Meta } from "@px-lsp/server/games/eu5/meta";

const catalog = settingsCatalog(
  manifest.contributes.configuration as unknown as { properties: Record<string, SettingSchema> }[]
);
const schema = (key: string) => catalog.find((r) => r.key === key)!.schema;

describe("toolkit settings", () => {
  it("exposes editable settings and keeps the internal path registry behind its scoped controls", () => {
    expect(catalog.length).toBe(
      Object.keys(Object.assign({}, ...manifest.contributes.configuration.map((s) => s.properties))).filter(
        (key) => key !== "px.machinePaths"
      ).length
    );
    expect(catalog.some((row) => row.key === "machinePaths")).toBe(false);
    expect(catalog.every((r) => r.label !== r.key && r.schema.markdownDescription)).toBe(true);
    for (const row of catalog)
      expect(() => validateSetting(row.key, row.schema, row.schema.default)).not.toThrow();
  });
  it("shows the chosen scope's value and the narrower override", () => {
    const values = {
      defaultValue: false,
      globalValue: true,
      workspaceValue: false,
      workspaceFolderValue: true,
    };
    expect(scopedValue(values, "user", false)).toMatchObject({
      value: true,
      source: "User",
      explicit: true,
      override: "Overridden by folder: true",
      effectiveValue: true,
      effectiveSource: "Folder",
      resetLabel: "Remove personal default",
      resetValue: true,
    });
    expect(scopedValue(values, "workspace", false)).toMatchObject({
      value: false,
      source: "Workspace",
      stamp: "false",
      effectiveValue: true,
      effectiveSource: "Folder",
      resetValue: true,
    });
    expect(scopedValue(values, "folder:test", false)).toMatchObject({
      value: true,
      source: "Folder",
      override: undefined,
    });
    expect(scopedValue({ globalValue: false }, "workspace", true)).toMatchObject({
      value: false,
      source: "User",
      explicit: false,
      stamp: "undefined",
    });
    expect(scopedValue({ defaultValue: null }, "user", null).value).toBeNull();
  });
  it("validates enums, booleans, arrays and texture colors", () => {
    for (const [key, value] of [
      ["hover.detail", "huge"],
      ["scopeInlayHints", "true"],
      ["parentMods", [1]],
      ["texturePreview.background", "red"],
    ])
      expect(() => validateSetting(key as string, schema(key as string), value)).toThrow();
    expect(() =>
      validateSetting("texturePreview.background", schema("texturePreview.background"), "#123456")
    ).not.toThrow();
  });
  it("validates the calendar against the actual consumer", () => {
    for (const value of [
      { epoch: 0, after: "AD" },
      { epoch: 1, after: "AD", before: "ad" },
      { epoch: 1, after: "AD", months: [] },
      { epoch: 1, after: "AD", months: "January" },
    ])
      expect(() => validateSetting("calendar", schema("calendar"), value)).toThrow();
    expect(() =>
      validateSetting("calendar", schema("calendar"), { epoch: 4000, after: "AD", before: "BC" })
    ).not.toThrow();
    expect(() => validateSetting("calendar", schema("calendar"), null)).not.toThrow();
  });
  it("uses each game's capabilities for unsupported features", () => {
    expect(unsupportedSetting("tigerRunOn", ck3Meta)).toBeUndefined();
    expect(unsupportedSetting("tigerRunOn", vic3Meta)).toBeUndefined();
    expect(unsupportedSetting("tigerRunOn", eu5Meta)).toContain("not available");
    expect(unsupportedSetting("characterHistory.quoteNames", ck3Meta)).toBeUndefined();
    for (const meta of [vic3Meta, eu5Meta])
      expect(unsupportedSetting("characterHistory.quoteNames", meta)).toContain("not available");
  });
});
