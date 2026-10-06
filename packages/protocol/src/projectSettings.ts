/** Portable authoring rules. Editor preferences and private paths stay in client settings. */
export interface ProjectSettings {
  version: 1;
  gameId?: string;
  authoring?: {
    characterHistory?: {
      quoteNames?: boolean;
      quoteCultures?: boolean;
      quoteReligions?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  validation?: {
    ignore?: string[];
    ignorePatterns?: string[];
    requireDescriptor?: boolean;
    [key: string]: unknown;
  };
  publishing?: {
    /** Safe path relative to the Workshop listing directory. */
    changelog?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const PROJECT_SETTING_KEYS = [
  "gameId",
  "characterHistory.quoteNames",
  "characterHistory.quoteCultures",
  "characterHistory.quoteReligions",
  "diagnostics.ignore",
  "diagnostics.ignorePatterns",
  "diagnostics.requireDescriptor",
  "workshop.changelog",
] as const;

export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[number];

const settingPaths: Record<ProjectSettingKey, readonly string[]> = {
  gameId: ["gameId"],
  "characterHistory.quoteNames": ["authoring", "characterHistory", "quoteNames"],
  "characterHistory.quoteCultures": ["authoring", "characterHistory", "quoteCultures"],
  "characterHistory.quoteReligions": ["authoring", "characterHistory", "quoteReligions"],
  "diagnostics.ignore": ["validation", "ignore"],
  "diagnostics.ignorePatterns": ["validation", "ignorePatterns"],
  "diagnostics.requireDescriptor": ["validation", "requireDescriptor"],
  "workshop.changelog": ["publishing", "changelog"],
};

function object(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function optionalObject(raw: unknown, label: string): Record<string, unknown> | undefined {
  return raw === undefined ? undefined : object(raw, label);
}

function boolean(raw: unknown, label: string): void {
  if (raw !== undefined && typeof raw !== "boolean") throw new Error(`${label} must be a boolean`);
}

function strings(raw: unknown, label: string): void {
  if (raw !== undefined && (!Array.isArray(raw) || raw.some((value) => typeof value !== "string"))) {
    throw new Error(`${label} must be an array of strings`);
  }
}

/** Validate known fields without dropping extensions to the version-1 model. Throws on invalid input. */
export function parseProjectSettings(raw: unknown, expectedGameId?: string): ProjectSettings {
  const settings = object(raw, "Project settings");
  if (settings.version !== 1) throw new Error("Unsupported project settings version (expected 1)");
  if (settings.gameId !== undefined) {
    if (typeof settings.gameId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(settings.gameId)) {
      throw new Error("gameId must be a non-empty game identifier");
    }
    if (expectedGameId !== undefined && settings.gameId !== expectedGameId) {
      throw new Error(`Project settings belong to ${settings.gameId}, not ${expectedGameId}`);
    }
  }
  const authoring = optionalObject(settings.authoring, "authoring");
  const characterHistory = optionalObject(authoring?.characterHistory, "authoring.characterHistory");
  for (const key of ["quoteNames", "quoteCultures", "quoteReligions"]) {
    boolean(characterHistory?.[key], `authoring.characterHistory.${key}`);
  }
  const validation = optionalObject(settings.validation, "validation");
  strings(validation?.ignore, "validation.ignore");
  strings(validation?.ignorePatterns, "validation.ignorePatterns");
  boolean(validation?.requireDescriptor, "validation.requireDescriptor");
  const publishing = optionalObject(settings.publishing, "publishing");
  if (publishing?.changelog !== undefined) {
    const changelog = publishing.changelog;
    if (
      typeof changelog !== "string" ||
      !changelog ||
      /[<>:"|?*]/.test(changelog) ||
      [...changelog].some((character) => character.charCodeAt(0) < 32) ||
      changelog.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))
    ) {
      throw new Error("publishing.changelog must be a safe relative file path without traversal");
    }
  }
  return settings as ProjectSettings;
}

export function emptyProjectSettings(gameId?: string): ProjectSettings {
  return parseProjectSettings(gameId === undefined ? { version: 1 } : { version: 1, gameId });
}

export function getProjectSetting(settings: ProjectSettings, key: ProjectSettingKey): unknown {
  let value: unknown = settings;
  for (const part of settingPaths[key]) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Change only the selected setting, preserving unknown siblings and the source object. */
export function setProjectSetting(
  settings: ProjectSettings,
  key: ProjectSettingKey,
  value: unknown
): ProjectSettings {
  parseProjectSettings(settings);
  const result = { ...settings };
  let target: Record<string, unknown> = result;
  const parts = settingPaths[key];
  for (const part of parts.slice(0, -1)) {
    const child = { ...optionalObject(target[part], part) };
    target[part] = child;
    target = child;
  }
  const last = parts[parts.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = Array.isArray(value) ? [...value] : value;
  return parseProjectSettings(result);
}
