import type { ParadoxSettings } from "@px-lsp/protocol/protocol";
import { sanitizeCalendar } from "@px-lsp/protocol/calendar";
import { readTexturePreviewBackground } from "@px-lsp/protocol/texturePreview";

export function defaultSettings(): ParadoxSettings {
  return {
    gamePath: null,
    logsPath: null,
    modPath: null,
    parentPaths: [],
    workspaceMods: [],
    locLanguage: "english",
    scopeInlayHints: false,
    indexAssets: true,
    hoverDetail: "standard",
    completionMode: "minimal",
    diagnosticsIgnore: [],
    diagnosticsIgnorePatterns: [],
    diagnosticsVanilla: false,
    tracePerf: false,
  };
}

export function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject malformed known fields as one update; unrelated fields have no effect. */
export function readSettings(value: unknown): Partial<ParadoxSettings> | undefined {
  if (!isSettingsObject(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    let valid: boolean;
    switch (key) {
      case "gamePath":
      case "logsPath":
      case "modPath":
        valid = field === null || typeof field === "string";
        break;
      case "gameId":
      case "locLanguage":
        valid = typeof field === "string";
        break;
      case "parentPaths":
      case "workspaceMods":
      case "diagnosticsIgnore":
      case "diagnosticsIgnorePatterns":
        valid = Array.isArray(field) && field.every((item) => typeof item === "string");
        break;
      case "scopeInlayHints":
      case "indexAssets":
      case "diagnosticsVanilla":
      case "tracePerf":
        valid = typeof field === "boolean";
        break;
      case "hoverDetail":
        valid = field === "compact" || field === "standard" || field === "full";
        break;
      case "completionMode":
        valid = field === "minimal" || field === "examples" || field === "names";
        break;
      case "texturePreviewBackground":
        result.texturePreviewBackground = readTexturePreviewBackground(field);
        continue;
      case "calendar": {
        if (field === null) {
          result.calendar = null;
          continue;
        }
        const calendar = sanitizeCalendar(field);
        if (!calendar) return undefined;
        result.calendar = calendar;
        continue;
      }
      default:
        continue;
    }
    if (!valid) return undefined;
    result[key] = field;
  }
  return result;
}

/** Keep inferred roots out of configured settings so later workspaceMods can replace them. */
export function resolveSettings(
  configured: Partial<ParadoxSettings>,
  workspaceRoot: string | null
): ParadoxSettings {
  const settings = { ...defaultSettings(), ...configured };
  settings.calendar = sanitizeCalendar(settings.calendar);
  if (!settings.modPath) settings.modPath = settings.workspaceMods?.length ? null : workspaceRoot;
  return settings;
}
