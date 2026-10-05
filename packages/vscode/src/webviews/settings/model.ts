import { sanitizeCalendar } from "@px-lsp/protocol/calendar";
import type { GameMeta } from "@px-lsp/server/games/profile";
import type { SettingRow, SettingSchema, SettingsTarget } from "./messages";

/** Presentation only. Types, defaults and help remain in contributes.configuration. */
const PRESENTATION: Record<string, [string, string, ("folder" | "file")?]> = {
  gameId: ["Game & paths", "Game"],
  gamePath: ["Game & paths", "Game data folder", "folder"],
  logsPath: ["Game & paths", "Game documentation folder", "folder"],
  "notifications.startup": ["Game & paths", "Startup notices"],
  modPath: ["Mods", "Main mod folder", "folder"],
  modProjectsDir: ["Mods", "Mod projects folder", "folder"],
  parentMods: ["Mods", "Dependency mods", "folder"],
  excludedMods: ["Mods", "Excluded mods", "folder"],
  locLanguage: ["Mods", "Localization language"],
  "workshop.dir": ["Mods", "Workshop listing folder", "folder"],
  "workshop.changelog": ["Mods", "Workshop changelog"],
  "completion.mode": ["Editor", "Suggestion verbosity"],
  "hover.detail": ["Editor", "Hover detail"],
  scopeInlayHints: ["Editor", "Scope hints"],
  "texturePreview.background": ["Editor", "Texture preview background"],
  "characterHistory.quoteNames": ["Editor", "Quote character names"],
  "characterHistory.quoteCultures": ["Editor", "Quote character cultures"],
  "characterHistory.quoteReligions": ["Editor", "Quote character religions"],
  coaLibraryDir: ["Editor", "Coat of arms library", "folder"],
  tigerPath: ["Validation", "Tiger executable", "file"],
  tigerRunOn: ["Validation", "Run Tiger"],
  "diagnostics.ignore": ["Validation", "Ignored diagnostic codes"],
  "diagnostics.ignorePatterns": ["Validation", "Ignored file patterns"],
  "diagnostics.vanilla": ["Validation", "Validate vanilla files"],
  "diagnostics.requireDescriptor": ["Validation", "Require a mod descriptor"],
  indexAssets: ["Advanced", "Index graphics assets"],
  experimentalFeatures: ["Advanced", "Experimental features"],
  calendar: ["Advanced", "Fallback calendar"],
  enableForWorkspace: ["Advanced", "Enable Paradox language modes"],
  "sidebar.hidden": ["Advanced", "Hidden Project actions"],
  "trace.server": ["Advanced", "Language server trace"],
  "trace.perf": ["Advanced", "Performance logging"],
  "dev.webviewSource": ["Advanced", "Webview development folder", "folder"],
};

export function settingsCatalog(sections: { properties: Record<string, SettingSchema> }[]) {
  return sections
    .flatMap(({ properties }) => Object.entries(properties))
    .filter(([id]) => id !== "px.machinePaths")
    .map(([id, schema]) => {
      const key = id.replace(/^px\./, "");
      const [group, label, browse] = PRESENTATION[key] ?? ["Advanced", key];
      return { key, group, label, browse, schema };
    });
}

export function unsupportedSetting(key: string, meta: GameMeta): string | undefined {
  if ((key === "tigerPath" || key === "tigerRunOn") && !meta.tiger)
    return `Tiger is not available for ${meta.name}. Structural checks still run.`;
  if (key.startsWith("characterHistory.") && !meta.creators?.some((c) => c.kind === "dynasty_tree"))
    return `Character history editing is not available for ${meta.name}.`;
  if (key === "coaLibraryDir" && !meta.coaDesigner)
    return `The Coat of Arms Designer is not available for ${meta.name}.`;
  return undefined;
}

export interface InspectedSetting {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

export const valueStamp = (value: unknown): string => JSON.stringify(value) ?? "undefined";

/** A scope displays its own value, even when a narrower scope overrides it. */
export function scopedValue(inspected: InspectedSetting, target: SettingsTarget, fallback: unknown) {
  const levels = [
    { value: inspected.defaultValue ?? fallback, name: "Default" },
    { value: inspected.globalValue, name: "User" },
    { value: inspected.workspaceValue, name: "Workspace" },
    { value: inspected.workspaceFolderValue, name: "Folder" },
  ];
  const index = target === "user" ? 1 : target === "workspace" ? 2 : 3;
  const own = levels[index].value;
  const inherited = levels
    .slice(0, index + 1)
    .reverse()
    .find((level) => level.value !== undefined)!;
  const override = levels
    .slice(index + 1)
    .reverse()
    .find((level) => level.value !== undefined);
  const effective = override ?? inherited;
  const reset = levels
    .slice(0, index)
    .reverse()
    .find((level) => level.value !== undefined)!;
  return {
    value: inherited.value as SettingRow["value"],
    explicit: own !== undefined,
    source: inherited.name,
    stamp: valueStamp(own),
    effectiveValue: effective.value as SettingRow["value"],
    effectiveSource: effective.name,
    resetLabel:
      target === "user"
        ? "Remove personal default"
        : target === "workspace"
          ? "Remove workspace override"
          : "Remove folder override",
    resetValue: (override ?? reset).value as SettingRow["value"],
    override: override
      ? `Overridden by ${override.name.toLowerCase()}: ${valueStamp(override.value)}`
      : undefined,
  };
}

export function validateSetting(key: string, schema: SettingSchema, value: unknown): void {
  if (key === "calendar") {
    if (value === null) return;
    const calendar = value as Record<string, unknown> | null;
    if (
      !sanitizeCalendar(value) ||
      !calendar ||
      (calendar.before !== undefined && typeof calendar.before !== "string") ||
      (calendar.months !== undefined && (!Array.isArray(calendar.months) || calendar.months.length !== 12))
    )
      throw new Error(
        "Use a positive integer epoch, a nonempty later era, distinct era labels, and exactly 12 distinct month names when supplied."
      );
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
      throw new Error("Enter a list of text values.");
  } else if (typeof value !== schema.type) throw new Error(`Expected ${schema.type}.`);
  if (schema.enum && !schema.enum.includes(value as string))
    throw new Error("Choose one of the listed options.");
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value))
    throw new Error(schema.patternErrorMessage ?? "This value has an invalid format.");
}
