/** Personal paths, keyed by game and local workspace identity. No filesystem access. */
export const MACHINE_SETTING_KEYS = [
  "gamePath",
  "logsPath",
  "tigerPath",
  "modPath",
  "modProjectsDir",
  "parentMods",
  "excludedMods",
  "coaLibraryDir",
  "workshop.dir",
  "workshop.changelog",
  "dev.webviewSource",
] as const;

export type MachineSettingKey = (typeof MACHINE_SETTING_KEYS)[number];
export type MachineSettingValue = string | string[];
export type MachineSettingsScope = "default" | "workspace" | "folder";
export type MachinePathValues = Partial<Record<MachineSettingKey, MachineSettingValue>> &
  Record<string, unknown>;
export type MachineGameValues = Record<string, MachinePathValues>;
export interface PatchBindings {
  output: string;
  sources: Record<string, string>;
  [key: string]: unknown;
}
export interface MachineSettings {
  version: 1;
  defaults?: MachineGameValues;
  workspaces?: Record<string, MachineGameValues>;
  folders?: Record<string, MachineGameValues>;
  patches?: Record<string, PatchBindings>;
  [key: string]: unknown;
}
export interface MachineSettingsIdentity {
  workspaceUri?: string;
  folderUri?: string;
}

export function isMachineSetting(key: string): key is MachineSettingKey {
  return (MACHINE_SETTING_KEYS as readonly string[]).includes(key);
}

export function isMachineSettingValue(key: MachineSettingKey, value: unknown): value is MachineSettingValue {
  return key === "parentMods" || key === "excludedMods"
    ? Array.isArray(value) && value.every((entry) => typeof entry === "string")
    : typeof value === "string";
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type ParsedMachineSettings = { ok: true; value: MachineSettings } | { ok: false; error: string };

/** Unknown fields survive edits, but malformed known fields and future versions are read-only. */
export function parseMachineSettings(input: unknown): ParsedMachineSettings {
  if (input === undefined) return { ok: true, value: { version: 1 } };
  if (!object(input)) return { ok: false, error: "px.machinePaths must be an object." };
  if (input.version !== 1)
    return { ok: false, error: "px.machinePaths has an unsupported version. Expected version 1." };
  const validateGames = (games: unknown): boolean =>
    object(games) &&
    Object.values(games).every(
      (values) =>
        object(values) &&
        MACHINE_SETTING_KEYS.every(
          (key) => !Object.hasOwn(values, key) || isMachineSettingValue(key, values[key])
        )
    );
  if (input.defaults !== undefined && !validateGames(input.defaults)) {
    return { ok: false, error: "px.machinePaths.defaults contains invalid game paths." };
  }
  for (const scope of ["workspaces", "folders"] as const) {
    if (
      input[scope] !== undefined &&
      (!object(input[scope]) || !Object.values(input[scope]).every(validateGames))
    ) {
      return { ok: false, error: `px.machinePaths.${scope} contains invalid game paths.` };
    }
  }
  const absolutePath = (value: unknown): value is string =>
    typeof value === "string" &&
    !value.includes("\0") &&
    (/^\//.test(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value));
  if (
    input.patches !== undefined &&
    (!object(input.patches) ||
      !Object.values(input.patches).every(
        (bindings) =>
          object(bindings) &&
          absolutePath(bindings.output) &&
          object(bindings.sources) &&
          Object.values(bindings.sources).every(absolutePath)
      ))
  ) {
    return { ok: false, error: "px.machinePaths.patches contains invalid absolute patch paths." };
  }
  return { ok: true, value: input as MachineSettings };
}

/** URI keys are stable on this machine, not portable project identifiers. */
export function normalizeMachineUri(uri: string, caseInsensitiveFile = false): string {
  const match = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(uri);
  if (!match) throw new Error("A machine settings identity must be an absolute URI.");
  const scheme = match[1].toLowerCase();
  const authority = /^\/\/([^/]*)(.*)$/.exec(match[2]);
  let suffix = (authority ? authority[2] : match[2]).replace(/\/+$/, "");
  if (scheme === "file" && caseInsensitiveFile) suffix = suffix.toLowerCase();
  suffix = suffix.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
  return `${scheme}:${authority ? `//${authority[1].toLowerCase()}` : ""}${suffix}`;
}

function gamesAt(
  settings: MachineSettings,
  scope: MachineSettingsScope,
  identity: MachineSettingsIdentity
): MachineGameValues | undefined {
  if (scope === "default") return settings.defaults;
  const uri = scope === "workspace" ? identity.workspaceUri : identity.folderUri;
  if (!uri) return undefined;
  const slots = scope === "workspace" ? settings.workspaces : settings.folders;
  return slots && Object.hasOwn(slots, uri) ? slots[uri] : undefined;
}

export function getMachineSetting(
  settings: MachineSettings,
  key: MachineSettingKey,
  gameId: string,
  scope: MachineSettingsScope,
  identity: MachineSettingsIdentity = {}
): MachineSettingValue | undefined {
  const games = gamesAt(settings, scope, identity);
  const values = games && Object.hasOwn(games, gameId) ? games[gameId] : undefined;
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

/** Returns a new registry, preserving every unrelated slot and unknown field. */
export function setMachineSetting(
  settings: MachineSettings,
  key: MachineSettingKey,
  value: MachineSettingValue | undefined,
  gameId: string,
  scope: MachineSettingsScope,
  identity: MachineSettingsIdentity = {}
): MachineSettings {
  if (value !== undefined && !isMachineSettingValue(key, value))
    throw new Error(`Invalid value for px.${key}.`);
  const games = gamesAt(settings, scope, identity) ?? {};
  const values = { ...(Object.hasOwn(games, gameId) ? games[gameId] : {}) };
  if (value === undefined) delete values[key];
  else values[key] = Array.isArray(value) ? [...value] : value;
  const nextGames = { ...games, [gameId]: values };
  if (scope === "default") return { ...settings, defaults: nextGames };
  const uri = scope === "workspace" ? identity.workspaceUri : identity.folderUri;
  if (!uri) throw new Error(`No ${scope} is available for personal paths.`);
  const name = scope === "workspace" ? "workspaces" : "folders";
  return { ...settings, [name]: { ...settings[name], [uri]: nextGames } };
}

export interface MachineSettingsRelocation {
  workspaces?: Record<string, string>;
  folders?: Record<string, string>;
  retainSources?: boolean;
}

/** Explicit identity changes merge compatible slots and refuse conflicting user choices. */
export function relocateMachineSettings(
  settings: MachineSettings,
  moves: MachineSettingsRelocation
): MachineSettings {
  const merge = (
    source: Record<string, unknown>,
    destination: Record<string, unknown>,
    location: string
  ): Record<string, unknown> => {
    let result = { ...destination };
    for (const [key, value] of Object.entries(source)) {
      if (!Object.hasOwn(destination, key)) result = { ...result, [key]: value };
      else if (object(value) && object(destination[key]))
        result = { ...result, [key]: merge(value, destination[key], `${location}.${key}`) };
      else if (JSON.stringify(value) !== JSON.stringify(destination[key]))
        throw new Error(`Personal path bindings conflict at ${location}.${key}. Both identities were kept.`);
    }
    return result;
  };
  const next = { ...settings };
  for (const scope of ["workspaces", "folders"] as const) {
    const slots = settings[scope];
    if (!slots) continue;
    const relocated = { ...slots };
    for (const [from, to] of Object.entries(moves[scope] ?? {})) {
      if (from === to || !Object.hasOwn(slots, from)) continue;
      relocated[to] = merge(
        slots[from],
        Object.hasOwn(relocated, to) ? relocated[to] : {},
        `${scope}.${to}`
      ) as MachineGameValues;
      if (!moves.retainSources) delete relocated[from];
    }
    next[scope] = relocated;
  }
  return next;
}
