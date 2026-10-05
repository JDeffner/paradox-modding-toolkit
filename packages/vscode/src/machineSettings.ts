import * as vscode from "vscode";
import * as path from "node:path";
import {
  getMachineSetting,
  MACHINE_SETTING_KEYS,
  normalizeMachineUri,
  parseMachineSettings,
  relocateMachineSettings,
  setMachineSetting,
  type MachineSettingKey,
  type MachineSettingValue,
  type MachineSettingsIdentity,
  type MachineSettingsScope,
  type PatchBindings,
} from "@px-lsp/protocol/machineSettings";

export type {
  MachineSettingKey,
  MachineSettingValue,
  MachineSettingsScope,
  PatchBindings,
} from "@px-lsp/protocol/machineSettings";
export class MachineSettingsError extends Error {}
export type MachineSettingSource =
  | "folder"
  | "legacyFolder"
  | "workspace"
  | "legacyWorkspace"
  | "default"
  | "legacyGlobal"
  | "legacyDefault"
  | "unset";
export interface MachineSettingInspection<T = MachineSettingValue> {
  value: T | undefined;
  ownValue: T | undefined;
  source: MachineSettingSource;
  stamp: string;
  error?: string;
}

export function getMachineSettingsIdentity(resource?: vscode.Uri): MachineSettingsIdentity {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const workspaceUri = vscode.workspace.workspaceFile ?? (folders.length === 1 ? folders[0].uri : undefined);
  const folderUri = resource ? vscode.workspace.getWorkspaceFolder(resource)?.uri : undefined;
  const normalize = (uri: vscode.Uri | undefined) =>
    uri ? normalizeMachineUri(uri.toString(), process.platform === "win32") : undefined;
  return { workspaceUri: normalize(workspaceUri), folderUri: normalize(folderUri) };
}

function inspect<T>(
  key: MachineSettingKey,
  gameId: string,
  scope: MachineSettingsScope,
  resource?: vscode.Uri
): MachineSettingInspection<T> {
  const config = vscode.workspace.getConfiguration("px", resource);
  // Read only the User value. Workspace JSON is never a canonical machine registry.
  const raw = config.inspect<unknown>("machinePaths")?.globalValue;
  const parsed = parseMachineSettings(raw);
  const legacy = config.inspect<T>(key);
  const identity = getMachineSettingsIdentity(resource);
  const canonical = (candidate: MachineSettingsScope): T | undefined =>
    parsed.ok
      ? (getMachineSetting(parsed.value, key, gameId, candidate, identity) as T | undefined)
      : undefined;
  const candidates: [MachineSettingSource, T | undefined][] = [
    ["folder", canonical("folder")],
    ["legacyFolder", resource ? legacy?.workspaceFolderValue : undefined],
    ["workspace", canonical("workspace")],
    ["legacyWorkspace", legacy?.workspaceValue],
    ["default", canonical("default")],
    ["legacyGlobal", legacy?.globalValue],
    ["legacyDefault", legacy?.defaultValue],
  ];
  const [source, value] = candidates.find(([, candidate]) => candidate !== undefined) ?? ["unset", undefined];
  return {
    value,
    ownValue: canonical(scope),
    source,
    stamp: JSON.stringify({ raw, legacy, identity, key, gameId, scope }),
    ...(!parsed.ok ? { error: parsed.error } : {}),
  };
}

/** Invalid registries are visible to callers; never silently claim their paths were applied. */
export function readMachineSetting<T = MachineSettingValue>(
  key: MachineSettingKey,
  gameId: string,
  resource?: vscode.Uri
): T | undefined {
  const result = inspect<T>(key, gameId, "default", resource);
  if (result.error) throw new MachineSettingsError(result.error);
  return result.value;
}

export function inspectMachineSetting<T = MachineSettingValue>(
  key: MachineSettingKey,
  gameId: string,
  scope: MachineSettingsScope,
  resource?: vscode.Uri
): MachineSettingInspection<T> {
  return inspect<T>(key, gameId, scope, resource);
}

let writes: Promise<void> = Promise.resolve();

export interface PatchBindingsInspection {
  bindings?: PatchBindings;
  stamp: string;
  error?: string;
}

export function readPatchBindings(projectId: string): PatchBindingsInspection {
  const raw = vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue;
  const parsed = parseMachineSettings(raw);
  return {
    stamp: JSON.stringify(raw) ?? "undefined",
    ...(parsed.ok
      ? parsed.value.patches && Object.hasOwn(parsed.value.patches, projectId)
        ? { bindings: parsed.value.patches[projectId] }
        : {}
      : { error: parsed.error }),
  };
}

/** Patch projects bind only to the User registry, never portable workspace settings. */
export function writePatchBindings(
  projectId: string,
  bindings: PatchBindings | undefined,
  expectedStamp?: string
): Promise<void> {
  const pending = writes.then(async () => {
    const current = readPatchBindings(projectId);
    if (current.error) throw new MachineSettingsError(current.error);
    if (expectedStamp !== undefined && current.stamp !== expectedStamp)
      throw new MachineSettingsError("Personal patch paths changed. Create a fresh patch preview.");
    const config = vscode.workspace.getConfiguration("px");
    const parsed = parseMachineSettings(config.inspect("machinePaths")?.globalValue);
    if (!parsed.ok) throw new MachineSettingsError(parsed.error);
    if (bindings !== undefined) {
      const validated = parseMachineSettings({ version: 1, patches: { [projectId]: bindings } });
      if (!validated.ok) throw new MachineSettingsError(validated.error);
    }
    const patches = {
      ...parsed.value.patches,
      ...(bindings === undefined
        ? {}
        : { [projectId]: { ...current.bindings, ...bindings, sources: { ...bindings.sources } } }),
    };
    if (bindings === undefined) delete patches[projectId];
    const next = { ...parsed.value, patches };
    await config.update("machinePaths", next, vscode.ConfigurationTarget.Global);
    if (
      JSON.stringify(vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue) !==
      JSON.stringify(next)
    )
      throw new MachineSettingsError("VS Code did not save the requested personal patch paths.");
  });
  writes = pending.catch(() => undefined);
  return pending;
}

export interface MachineSettingChange {
  key: MachineSettingKey;
  value: MachineSettingValue | undefined;
  gameId: string;
  scope: MachineSettingsScope;
  expectedStamp?: string;
  resource?: vscode.Uri;
}

/** Serialized native edits preserve JSON comments and VS Code's dirty settings buffers. */
export function writeMachineSetting(
  key: MachineSettingKey,
  value: MachineSettingValue | undefined,
  gameId: string,
  scope: MachineSettingsScope,
  expectedStamp?: string,
  resource?: vscode.Uri
): Promise<void> {
  return writeMachineSettings([{ key, value, gameId, scope, expectedStamp, resource }]);
}

/** Check every draft against the same registry before applying one composed User edit. */
export function writeMachineSettings(changes: readonly MachineSettingChange[]): Promise<void> {
  const pending = writes.then(async () => {
    if (!changes.length) return;
    const config = vscode.workspace.getConfiguration("px");
    const parsed = parseMachineSettings(config.inspect("machinePaths")?.globalValue);
    if (!parsed.ok) throw new MachineSettingsError(parsed.error);
    const slots = new Set<string>();
    let next = parsed.value;
    for (const change of changes) {
      const { key, value, gameId, scope, expectedStamp, resource } = change;
      const current = inspect(key, gameId, scope, resource);
      if (current.error) throw new MachineSettingsError(current.error);
      if (expectedStamp !== undefined && current.stamp !== expectedStamp)
        throw new MachineSettingsError(
          "Personal paths changed. Reload the settings or create a fresh upgrade preview."
        );
      const identity = getMachineSettingsIdentity(resource);
      const slot = JSON.stringify([
        key,
        gameId,
        scope,
        scope === "workspace" ? identity.workspaceUri : scope === "folder" ? identity.folderUri : undefined,
      ]);
      if (slots.has(slot))
        throw new MachineSettingsError(
          "The same personal path destination has more than one draft. Save one value for each destination."
        );
      slots.add(slot);
      next = setMachineSetting(next, key, value, gameId, scope, identity);
    }
    await config.update("machinePaths", next, vscode.ConfigurationTarget.Global);
    const saved = vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue;
    if (JSON.stringify(saved) !== JSON.stringify(next))
      throw new MachineSettingsError(
        "VS Code did not save the requested personal paths. Reload settings and try again."
      );
  });
  writes = pending.catch(() => undefined);
  return pending;
}

export interface MachineSettingsMigrationReport {
  imported: string[];
  conflicts: string[];
  errors: string[];
  removed: string[];
}

export interface MachineSettingsMove {
  stamp: string;
  before: unknown;
  next: unknown;
  source: vscode.Uri;
  legacyStamp: string;
}

/** Preview before copying files; new folder conflicts stop the move before source changes. */
export function prepareMachineSettingsMove(
  oldRoots: string[],
  newRoot: string,
  gameId: string,
  oldContent: string,
  newContent: string
): MachineSettingsMove {
  const before = vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue;
  const parsed = parseMachineSettings(before);
  if (!parsed.ok) throw new MachineSettingsError(parsed.error);
  const key = (root: string) =>
    normalizeMachineUri(vscode.Uri.file(root).toString(), process.platform === "win32");
  const from = oldRoots.map(key);
  const to = key(newRoot);
  const source = vscode.Uri.file(oldContent);
  const current = getMachineSettingsIdentity(source);
  const swapsFolder = (vscode.workspace.workspaceFolders ?? []).some((folder) =>
    from.includes(normalizeMachineUri(folder.uri.toString(), process.platform === "win32"))
  );
  const workspaceMoves =
    current.workspaceUri && from.includes(current.workspaceUri) ? { [current.workspaceUri]: to } : {};
  let next = relocateMachineSettings(parsed.value, {
    workspaces: workspaceMoves,
    folders: Object.fromEntries(from.map((uri) => [uri, to])),
  });
  if (!swapsFolder) {
    next = relocateMachineSettings(next, {
      workspaces: current.workspaceUri ? { [current.workspaceUri]: to } : {},
      folders: current.folderUri ? { [current.folderUri]: to } : {},
      retainSources: true,
    });
  }
  const identity = {
    workspaceUri: !swapsFolder
      ? to
      : current.workspaceUri
        ? (workspaceMoves[current.workspaceUri] ?? current.workspaceUri)
        : undefined,
    folderUri: to,
  };
  for (const machineKey of MACHINE_SETTING_KEYS) {
    const legacy = inspectMachineSetting(machineKey, gameId, "workspace", source);
    const scope =
      legacy.source === "legacyFolder"
        ? "folder"
        : legacy.source === "legacyWorkspace"
          ? "workspace"
          : undefined;
    if (!scope || legacy.value === undefined) continue;
    const existing = getMachineSetting(next, machineKey, gameId, scope, identity);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(legacy.value))
      throw new MachineSettingsError(
        `Personal path bindings conflict for px.${machineKey} at the destination.`
      );
    next = setMachineSetting(next, machineKey, legacy.value, gameId, scope, identity);
  }
  const samePath = (value: unknown) =>
    typeof value === "string" && path.resolve(value).toLowerCase() === path.resolve(oldContent).toLowerCase();
  for (const scope of ["workspace", "folder"] as const) {
    if (samePath(getMachineSetting(next, "modPath", gameId, scope, identity))) {
      next = setMachineSetting(next, "modPath", newContent, gameId, scope, identity);
    }
    if (!swapsFolder && samePath(getMachineSetting(next, "modPath", gameId, scope, current))) {
      next = setMachineSetting(next, "modPath", newContent, gameId, scope, current);
    }
  }
  // A flat or default mod path also needs an explicit binding at the new location.
  const effectiveMod = inspectMachineSetting("modPath", gameId, "workspace", vscode.Uri.file(oldContent));
  if (
    samePath(effectiveMod.value) &&
    getMachineSetting(next, "modPath", gameId, "workspace", identity) === undefined &&
    identity.workspaceUri
  ) {
    next = setMachineSetting(next, "modPath", newContent, gameId, "workspace", identity);
  }
  const relocatePatchPath = (value: string): string => {
    for (const root of oldRoots) {
      const relative = path.relative(path.resolve(root), value);
      if (
        relative === "" ||
        (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
      )
        return path.join(newRoot, relative);
    }
    return value;
  };
  if (next.patches) {
    next = {
      ...next,
      patches: Object.fromEntries(
        Object.entries(next.patches).map(([id, bindings]) => [
          id,
          {
            ...bindings,
            output: relocatePatchPath(bindings.output),
            sources: Object.fromEntries(
              Object.entries(bindings.sources).map(([id, source]) => [id, relocatePatchPath(source)])
            ),
          },
        ])
      ),
    };
  }
  return {
    before,
    next: before === undefined && JSON.stringify(next) === JSON.stringify(parsed.value) ? undefined : next,
    stamp: JSON.stringify(before) ?? "undefined",
    source,
    legacyStamp: JSON.stringify(
      MACHINE_SETTING_KEYS.map((key) => vscode.workspace.getConfiguration("px", source).inspect(key))
    ),
  };
}

export function assertMachineSettingsMoveCurrent(move: MachineSettingsMove): void {
  const current = vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue;
  const legacyStamp = JSON.stringify(
    MACHINE_SETTING_KEYS.map((key) => vscode.workspace.getConfiguration("px", move.source).inspect(key))
  );
  if ((JSON.stringify(current) ?? "undefined") !== move.stamp || legacyStamp !== move.legacyStamp) {
    throw new MachineSettingsError("Personal path bindings changed. Run Move Mod again.");
  }
}

/** Apply after verified copying, before workspace replacement and source retirement. */
export function applyMachineSettingsMove(move: MachineSettingsMove): Promise<void> {
  const pending = writes.then(async () => {
    assertMachineSettingsMoveCurrent(move);
    if (JSON.stringify(move.before) === JSON.stringify(move.next)) return;
    await vscode.workspace
      .getConfiguration("px")
      .update("machinePaths", move.next, vscode.ConfigurationTarget.Global);
    if (
      JSON.stringify(vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue) !==
      JSON.stringify(move.next)
    ) {
      throw new MachineSettingsError(
        "VS Code did not save the moved personal path bindings. The source mod was kept."
      );
    }
  });
  writes = pending.catch(() => undefined);
  return pending;
}

/** Only restore our exact write; a concurrent personal edit must survive a failed move. */
export function rollbackMachineSettingsMove(move: MachineSettingsMove): Promise<void> {
  const pending = writes.then(async () => {
    const current = vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue;
    if (JSON.stringify(current) !== JSON.stringify(move.next))
      throw new MachineSettingsError(
        "Personal paths changed after the move attempt. Existing settings were kept."
      );
    await vscode.workspace
      .getConfiguration("px")
      .update("machinePaths", move.before, vscode.ConfigurationTarget.Global);
    if (
      JSON.stringify(vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue) !==
      JSON.stringify(move.before)
    )
      throw new MachineSettingsError("VS Code could not restore the original personal path bindings.");
  });
  writes = pending.catch(() => undefined);
  return pending;
}

function assertCleanLegacySettings(scope: "workspace" | "folder", resource?: vscode.Uri): void {
  const folder =
    scope === "folder" && resource
      ? vscode.workspace.getWorkspaceFolder(resource)?.uri
      : vscode.workspace.workspaceFolders?.[0]?.uri;
  const file =
    scope === "workspace" && vscode.workspace.workspaceFile
      ? vscode.workspace.workspaceFile
      : folder
        ? vscode.Uri.joinPath(folder, ".vscode", "settings.json")
        : undefined;
  if (!file) return;
  const key = normalizeMachineUri(file.toString(), process.platform === "win32");
  if (
    (vscode.workspace.textDocuments ?? []).some(
      (document) =>
        document.isDirty && normalizeMachineUri(document.uri.toString(), process.platform === "win32") === key
    )
  ) {
    throw new MachineSettingsError(
      `Save or discard the unsaved settings edits in ${file.toString()} before upgrading personal paths.`
    );
  }
}

/** Move only the current workspace's explicit paths, after each destination was verified. */
export async function migrateLegacyMachineSettings(
  gameId: string,
  resources = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri)
): Promise<MachineSettingsMigrationReport> {
  const report: MachineSettingsMigrationReport = { imported: [], conflicts: [], errors: [], removed: [] };
  const registry = parseMachineSettings(
    vscode.workspace.getConfiguration("px").inspect("machinePaths")?.globalValue
  );
  if (!registry.ok) {
    report.errors.push(registry.error);
    return report;
  }
  const candidates: {
    key: MachineSettingKey;
    value: MachineSettingValue;
    scope: "workspace" | "folder";
    resource?: vscode.Uri;
    inspection: MachineSettingInspection;
  }[] = [];
  const scopes: { scope: "workspace" | "folder"; resource?: vscode.Uri }[] = [
    { scope: "workspace" },
    ...resources.map((resource) => ({ scope: "folder" as const, resource })),
  ];
  for (const { scope, resource } of scopes) {
    const config = vscode.workspace.getConfiguration("px", resource);
    for (const key of MACHINE_SETTING_KEYS) {
      const legacy = config.inspect<MachineSettingValue>(key);
      const value = scope === "workspace" ? legacy?.workspaceValue : legacy?.workspaceFolderValue;
      if (value !== undefined)
        candidates.push({ key, value, scope, resource, inspection: inspect(key, gameId, scope, resource) });
    }
  }
  // Reject an invalid registry or changed preview before the first mutation.
  for (const candidate of candidates) {
    try {
      assertCleanLegacySettings(candidate.scope, candidate.resource);
    } catch (error) {
      report.errors.push((error as Error).message);
      return report;
    }
    const fresh = inspect(candidate.key, gameId, candidate.scope, candidate.resource);
    if (fresh.error || fresh.stamp !== candidate.inspection.stamp) {
      report.errors.push(fresh.error ?? "Personal paths changed before the upgrade started. Run it again.");
      return report;
    }
  }
  for (const { key, value, scope, resource, inspection } of candidates) {
    const label = `px.${key} (${scope}${resource ? `: ${resource.toString()}` : ""})`;
    try {
      assertCleanLegacySettings(scope, resource);
      const config = vscode.workspace.getConfiguration("px", resource);
      const oldValue = () => {
        const old = config.inspect<MachineSettingValue>(key);
        return scope === "workspace" ? old?.workspaceValue : old?.workspaceFolderValue;
      };
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      let current = inspect(key, gameId, scope, resource);
      if (current.error) throw new MachineSettingsError(current.error);
      if (!same(oldValue(), value) || !same(current.ownValue, inspection.ownValue)) {
        report.errors.push(`${label} changed during the upgrade. Run it again.`);
        continue;
      }
      if (current.ownValue !== undefined && !same(current.ownValue, value)) {
        report.conflicts.push(`${label} differs from its personal binding. Both values were kept.`);
        continue;
      }
      if (current.ownValue === undefined) {
        await writeMachineSetting(key, value, gameId, scope, current.stamp, resource);
        report.imported.push(label);
      }
      current = inspect(key, gameId, scope, resource);
      assertCleanLegacySettings(scope, resource);
      if (current.error || !same(current.ownValue, value) || !same(oldValue(), value)) {
        report.errors.push(`${label} changed before cleanup. Its old value was kept.`);
        continue;
      }
      await config.update(
        key,
        undefined,
        scope === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.WorkspaceFolder
      );
      if (oldValue() !== undefined)
        throw new MachineSettingsError(`${label} was copied, but VS Code did not remove its old setting.`);
      report.removed.push(label);
    } catch (error) {
      report.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
