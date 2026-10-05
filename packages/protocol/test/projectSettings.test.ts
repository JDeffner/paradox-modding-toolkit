import { describe, expect, it } from "vitest";
import {
  emptyProjectSettings,
  getProjectSetting,
  parseProjectSettings,
  PROJECT_SETTING_KEYS,
  setProjectSetting,
} from "../src/projectSettings";

describe("portable project settings", () => {
  it("reads all portable keys and preserves unknown fields on changes", () => {
    const raw = {
      version: 1,
      gameId: "future_game",
      authoring: { custom: "keep", characterHistory: { quoteNames: false, other: 12 } },
      validation: { ignore: ["braces"], ignorePatterns: ["generated/**"], requireDescriptor: true },
      publishing: { changelog: "workshop/changelog.md", other: "keep" },
      future: { keep: [1, 2, 3] },
    };
    const settings = parseProjectSettings(raw, "future_game");
    expect(getProjectSetting(settings, "characterHistory.quoteNames")).toBe(false);
    expect(getProjectSetting(settings, "characterHistory.quoteReligions")).toBeUndefined();
    expect(getProjectSetting(settings, "diagnostics.ignorePatterns")).toEqual(["generated/**"]);
    const changed = setProjectSetting(settings, "characterHistory.quoteCultures", true);
    expect(changed).toEqual({
      ...raw,
      authoring: {
        custom: "keep",
        characterHistory: { quoteNames: false, other: 12, quoteCultures: true },
      },
    });
    expect(settings).toEqual(raw);
    expect(changed.authoring).not.toBe(settings.authoring);
    expect(changed.authoring?.characterHistory).not.toBe(settings.authoring?.characterHistory);
    expect(setProjectSetting(changed, "characterHistory.quoteNames", undefined)).toEqual({
      ...changed,
      authoring: { custom: "keep", characterHistory: { other: 12, quoteCultures: true } },
    });
    expect(parseProjectSettings(JSON.parse(JSON.stringify(changed)))).toEqual(changed);
  });

  it("maps every portable setting to its stable file field", () => {
    expect(PROJECT_SETTING_KEYS).toEqual([
      "gameId",
      "characterHistory.quoteNames",
      "characterHistory.quoteCultures",
      "characterHistory.quoteReligions",
      "diagnostics.ignore",
      "diagnostics.ignorePatterns",
      "diagnostics.requireDescriptor",
      "workshop.changelog",
    ]);
    let settings = emptyProjectSettings();
    for (const key of PROJECT_SETTING_KEYS) {
      const value =
        key === "gameId"
          ? "ck3"
          : key === "workshop.changelog"
            ? "changelog.md"
            : key === "diagnostics.ignore" || key === "diagnostics.ignorePatterns"
              ? ["test"]
              : false;
      settings = setProjectSetting(settings, key, value);
      expect(getProjectSetting(settings, key)).toEqual(value);
    }
    expect(settings).toEqual({
      version: 1,
      gameId: "ck3",
      authoring: { characterHistory: { quoteNames: false, quoteCultures: false, quoteReligions: false } },
      validation: { ignore: ["test"], ignorePatterns: ["test"], requireDescriptor: false },
      publishing: { changelog: "changelog.md" },
    });
  });

  it.each([null, [], {}, { version: 0 }, { version: 2 }, { version: "1" }])(
    "rejects invalid/future versions: %j",
    (raw) => {
      expect(() => parseProjectSettings(raw)).toThrow();
    }
  );

  it.each([
    { gameId: "" },
    { gameId: " ck3" },
    { gameId: 12 },
    { authoring: [] },
    { authoring: { characterHistory: null } },
    { authoring: { characterHistory: { quoteNames: "yes" } } },
    { authoring: { characterHistory: { quoteCultures: 1 } } },
    { authoring: { characterHistory: { quoteReligions: null } } },
    { validation: { ignore: "braces" } },
    { validation: { ignorePatterns: [1] } },
    { validation: { requireDescriptor: "true" } },
    { publishing: false },
  ])("rejects invalid known fields: %j", (fields) => {
    expect(() => parseProjectSettings({ version: 1, ...fields })).toThrow();
  });

  it.each([
    "",
    "/tmp/changelog.md",
    "C:\\changelog.md",
    "C:changelog.md",
    "../changelog.md",
    "workshop/../changelog.md",
    "workshop\\..\\changelog.md",
    "\\\\server\\changelog.md",
    "file:stream",
    "a//b",
    "a/./b",
    "a. /b",
    "a\u0000b",
  ])("rejects unsafe publishing paths: %s", (changelog) => {
    expect(() => parseProjectSettings({ version: 1, publishing: { changelog } })).toThrow();
  });

  it("rejects mismatched game declarations while allowing omitted declarations", () => {
    expect(() => parseProjectSettings({ version: 1, gameId: "vic3" }, "ck3")).toThrow("not ck3");
    expect(parseProjectSettings({ version: 1 }, "ck3")).toEqual({ version: 1 });
    expect(emptyProjectSettings("eu5")).toEqual({ version: 1, gameId: "eu5" });
  });

  it("does not mutate input when a setting write fails validation", () => {
    const settings = emptyProjectSettings("ck3");
    expect(() => setProjectSetting(settings, "diagnostics.ignore", false)).toThrow();
    expect(settings).toEqual({ version: 1, gameId: "ck3" });
  });
});
