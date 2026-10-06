import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { isDeepStrictEqual } from "util";
import * as vscode from "vscode";
import { assertConfigPath, canonicalConfigPath } from "@px-lsp/protocol/configDir";
import {
  PROJECT_SETTING_KEYS,
  getProjectSetting,
  parseProjectSettings,
  setProjectSetting,
  type ProjectSettingKey,
} from "@px-lsp/protocol/projectSettings";
import { sanitizeCalendar } from "@px-lsp/protocol/calendar";
import type { PxConfig } from "./config";
import { metaFor } from "./meta";
import {
  assertProjectWriteAllowed,
  openConfigDocument,
  projectRoot,
  projectSettingsState,
  writeProjectSettings,
} from "./projectSettings";
import { prepareProjectConfigWrite, readProjectConfigText } from "./projectConfigFile";

export interface StorageUpgradeReport {
  copied: string[];
  imported: string[];
  conflicts: string[];
  errors: string[];
  removed: string[];
  noOp: boolean;
}

interface Artifact {
  relative: string;
  source: string;
  destination: string;
  sourceHash: string;
  destinationHash: string | undefined;
}

function hash(file: string): string | undefined {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function clean(file: string): void {
  if (openConfigDocument(file)?.isDirty)
    throw new Error(`Save ${file} in the editor before upgrading its storage`);
}

function noLinks(root: string, folder: string): void {
  let current = folder;
  while (current !== root) {
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Config links cannot be upgraded: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Config directory is outside the mod");
    current = parent;
  }
}

function artifacts(cfg: PxConfig, report: StorageUpgradeReport): Artifact[] {
  const root = projectRoot(cfg);
  const meta = metaFor(cfg.gameId);
  if (!meta.legacyConfigDirName) return [];
  const folder = path.join(root, meta.legacyConfigDirName);
  noLinks(root, folder);
  if (!fs.existsSync(folder)) return [];
  const out: Artifact[] = [];
  const visit = (directory: string) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(folder, file);
      try {
        if (entry.isSymbolicLink()) throw new Error(`Config links cannot be upgraded: ${file}`);
        if (entry.isDirectory()) {
          visit(file);
          continue;
        }
        if (!entry.isFile()) throw new Error(`Not an ordinary config file: ${file}`);
        const source = assertConfigPath(root, meta, relative, true);
        const destination = canonicalConfigPath(root, meta, relative);
        noLinks(root, path.dirname(destination));
        if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink())
          throw new Error(`Config links cannot be upgraded: ${destination}`);
        clean(source);
        clean(destination);
        if (relative === "project.json")
          parseProjectSettings(
            JSON.parse(fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "")),
            cfg.gameId
          );
        out.push({
          relative,
          source,
          destination,
          sourceHash: hash(source)!,
          destinationHash: hash(destination),
        });
      } catch (error) {
        report.errors.push(`${file}: ${String(error)}`);
      }
    }
  };
  visit(folder);
  return out;
}

function assertArtifactsCurrent(inputs: Artifact[]): void {
  for (const input of inputs) {
    clean(input.source);
    clean(input.destination);
    if (hash(input.source) !== input.sourceHash || hash(input.destination) !== input.destinationHash) {
      throw new Error(`${input.relative} changed during the upgrade. Try again.`);
    }
  }
}

/** Imported fields may be added to a copied declaration; legacy values still must survive. */
function containsLegacyValues(current: unknown, legacy: unknown): boolean {
  if (legacy === null || typeof legacy !== "object" || Array.isArray(legacy))
    return isDeepStrictEqual(current, legacy);
  if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
  return Object.entries(legacy).every(
    ([key, value]) =>
      Object.prototype.hasOwnProperty.call(current, key) &&
      containsLegacyValues((current as Record<string, unknown>)[key], value)
  );
}

function preservesLegacyProject(cfg: PxConfig, input: Artifact): boolean {
  if (input.relative !== "project.json") return false;
  const read = (file: string) =>
    parseProjectSettings(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")), cfg.gameId);
  return containsLegacyValues(read(input.destination), read(input.source));
}

function copyLegacy(cfg: PxConfig, report: StorageUpgradeReport): void {
  const inputs = artifacts(cfg, report);
  for (const input of inputs) {
    try {
      assertArtifactsCurrent(inputs);
      if (input.destinationHash !== undefined) {
        if (input.destinationHash !== input.sourceHash && !preservesLegacyProject(cfg, input))
          report.conflicts.push(`${input.relative}: current file wins; legacy source retained`);
        continue;
      }
      const root = assertProjectWriteAllowed(cfg);
      canonicalConfigPath(root, metaFor(cfg.gameId), input.relative);
      noLinks(root, path.dirname(input.destination));
      fs.mkdirSync(path.dirname(input.destination), { recursive: true });
      fs.copyFileSync(input.source, input.destination, fs.constants.COPYFILE_EXCL);
      input.destinationHash = hash(input.destination);
      if (input.destinationHash !== input.sourceHash || hash(input.source) !== input.sourceHash)
        throw new Error(`${input.relative} could not be verified after copying`);
      report.copied.push(input.destination);
    } catch (error) {
      report.errors.push(`${input.relative}: ${String(error)}`);
    }
  }
}

interface NativeInput {
  cfg: PxConfig;
  key: ProjectSettingKey | "calendar";
  value: unknown;
  workspace: unknown;
  folder: unknown;
  folderPath: string | undefined;
  successful: boolean;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function nativeInputs(cfg: PxConfig): NativeInput[] {
  const uri = vscode.Uri.file(projectRoot(cfg));
  const native = vscode.workspace.getConfiguration("px", uri);
  const folderPath = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
  return ([...PROJECT_SETTING_KEYS, "calendar"] as const).flatMap((key) => {
    const inspected = native.inspect(key);
    const workspace = inspected?.workspaceValue;
    const folder = inspected?.workspaceFolderValue;
    const value = folder !== undefined ? folder : workspace;
    if (value === undefined || (key === "gameId" && value === "auto")) return [];
    return [{ cfg, key, value, workspace, folder, folderPath, successful: false }];
  });
}

function assertNativeCurrent(input: NativeInput): void {
  const native = vscode.workspace
    .getConfiguration("px", vscode.Uri.file(projectRoot(input.cfg)))
    .inspect(input.key);
  if (!equal(native?.workspaceValue, input.workspace) || !equal(native?.workspaceFolderValue, input.folder))
    throw new Error(`px.${input.key} changed during the upgrade. Try again.`);
  if (input.workspace !== undefined && vscode.workspace.workspaceFile?.scheme === "file")
    clean(vscode.workspace.workspaceFile.fsPath);
  // In a single-folder window Workspace settings also live in this file.
  if (input.folderPath) clean(path.join(input.folderPath, ".vscode", "settings.json"));
}

async function importSettings(
  cfg: PxConfig,
  inputs: NativeInput[],
  report: StorageUpgradeReport
): Promise<void> {
  const root = projectRoot(cfg);
  const state = projectSettingsState(cfg);
  clean(state.path);
  clean(state.canonical);
  let settings = state.settings;
  const applicable: (NativeInput & { key: ProjectSettingKey })[] = [];
  for (const input of inputs) {
    if (input.key === "calendar") continue;
    try {
      assertNativeCurrent(input);
      const own = getProjectSetting(settings, input.key);
      if (own !== undefined && !equal(own, input.value)) {
        report.conflicts.push(
          `${root}: px.${input.key} differs; current project value wins and native source retained`
        );
        continue;
      }
      settings = parseProjectSettings(setProjectSetting(settings, input.key, input.value), cfg.gameId);
      applicable.push(input as NativeInput & { key: ProjectSettingKey });
    } catch (error) {
      const message = `${root}: px.${input.key}: ${String(error)}`;
      if (input.key === "workshop.changelog" && String(error).includes("safe relative"))
        report.conflicts.push(`${message}; retained for personal settings upgrade`);
      else report.errors.push(message);
    }
  }
  if (!applicable.length) return;
  for (const input of applicable) assertNativeCurrent(input);
  assertProjectWriteAllowed(cfg);
  if (!equal(settings, state.settings)) {
    await writeProjectSettings(cfg, settings, state.stamp, cfg.gameId, () => {
      for (const input of applicable) assertNativeCurrent(input);
    });
    report.imported.push(
      ...applicable
        .filter((input) => getProjectSetting(state.settings, input.key) === undefined)
        .map((input) => `${root}: px.${input.key}`)
    );
  }
  const persisted = projectSettingsState(cfg);
  if (persisted.legacy) throw new Error("Project settings are still in legacy storage");
  for (const input of applicable) {
    assertNativeCurrent(input);
    if (!equal(getProjectSetting(persisted.settings, input.key), input.value))
      throw new Error(`px.${input.key} could not be verified after upgrading`);
    input.successful = true;
  }
}

function portableCalendar(cfg: PxConfig): ReturnType<typeof sanitizeCalendar> {
  const root = projectRoot(cfg);
  const text = readProjectConfigText(root, metaFor(cfg.gameId), "calendar.json");
  if (text === undefined) return undefined;
  const calendar = sanitizeCalendar(JSON.parse(text.replace(/^\uFEFF/, "")));
  if (!calendar) throw new Error("calendar.json is not a valid calendar");
  return calendar;
}

async function importCalendar(
  cfg: PxConfig,
  inputs: NativeInput[],
  report: StorageUpgradeReport
): Promise<void> {
  const input = inputs.find((candidate) => candidate.key === "calendar");
  if (!input) return;
  const root = projectRoot(cfg);
  const calendar = sanitizeCalendar(input.value);
  if (!calendar) throw new Error("px.calendar is not a valid calendar");
  assertNativeCurrent(input);
  const prepared = await prepareProjectConfigWrite(root, metaFor(cfg.gameId), "calendar.json");
  clean(prepared.source);
  clean(prepared.target);
  prepared.assertCurrent();
  const own = portableCalendar(cfg);
  if (own && !equal(own, calendar)) {
    report.conflicts.push(
      root + ": px.calendar differs; current project calendar wins and native source retained"
    );
    return;
  }
  if (!own) {
    assertNativeCurrent(input);
    assertProjectWriteAllowed(cfg);
    await prepared.write(JSON.stringify(calendar, null, 2) + "\n");
    const persisted = sanitizeCalendar(
      JSON.parse(fs.readFileSync(prepared.target, "utf8").replace(/^\uFEFF/, ""))
    );
    if (!equal(persisted, calendar)) throw new Error("Calendar could not be verified after upgrading");
    report.imported.push(root + ": px.calendar");
  }
  assertNativeCurrent(input);
  if (!equal(portableCalendar(cfg), calendar)) throw new Error("Calendar changed during the upgrade");
  input.successful = true;
}

function destinationMatches(input: NativeInput): boolean {
  if (input.key === "calendar") {
    const file = canonicalConfigPath(projectRoot(input.cfg), metaFor(input.cfg.gameId), "calendar.json");
    clean(file);
    return fs.existsSync(file) && equal(portableCalendar(input.cfg), sanitizeCalendar(input.value));
  }
  const current = projectSettingsState(input.cfg);
  return !current.legacy && equal(getProjectSetting(current.settings, input.key), input.value);
}

/** Trusted activation and the explicit Upgrade Storage command share this resumable operation. */
export async function migrateProjectStorage(configs: PxConfig[]): Promise<StorageUpgradeReport> {
  const report: StorageUpgradeReport = {
    copied: [],
    imported: [],
    conflicts: [],
    errors: [],
    removed: [],
    noOp: true,
  };
  const roots = new Set<string>();
  const selected = configs.filter((cfg) => {
    if (!cfg.modPath) return false;
    const root = path.resolve(cfg.modPath);
    if (roots.has(root)) return false;
    roots.add(root);
    return true;
  });
  const inputs: NativeInput[] = [];
  for (const cfg of selected) {
    try {
      assertProjectWriteAllowed(cfg);
      const native = nativeInputs(cfg);
      inputs.push(...native);
      // Artifact copies are independent. A bad declaration blocks its settings import.
      copyLegacy(cfg, report);
      try {
        await importCalendar(cfg, native, report);
      } catch (error) {
        report.errors.push(cfg.modPath + ": px.calendar: " + String(error));
      }
      await importSettings(cfg, native, report);
    } catch (error) {
      report.errors.push(`${cfg.modPath}: ${String(error)}`);
    }
  }
  // A Workspace value applies to every editable mod, including children of a container.
  const complete = selected.every((cfg) =>
    (cfg.workspaceMods ?? []).every((root) => roots.has(path.resolve(root)))
  );
  const groups = new Map<
    string,
    { target: vscode.ConfigurationTarget; records: NativeInput[]; expected: unknown }
  >();
  for (const input of inputs) {
    for (const scope of ["workspace", "folder"] as const) {
      const expected = input[scope];
      if (expected === undefined || (scope === "folder" && !input.folderPath)) continue;
      const owner = scope === "folder" ? input.folderPath : "workspace";
      const id = `${scope}:${owner}:${input.key}`;
      const group = groups.get(id) ?? {
        target:
          scope === "folder"
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : vscode.ConfigurationTarget.Workspace,
        records: [],
        expected,
      };
      group.records.push(input);
      groups.set(id, group);
    }
  }
  for (const group of groups.values()) {
    const first = group.records[0];
    if (!complete || !group.records.every((input) => input.successful)) continue;
    // Mods without this explicit setting still count when a Workspace key is removed.
    if (group.target === vscode.ConfigurationTarget.Workspace && group.records.length !== selected.length)
      continue;
    try {
      for (const input of group.records) {
        assertNativeCurrent(input);
        if (!destinationMatches(input)) throw new Error(`px.${input.key} destination changed before cleanup`);
      }
      const native = vscode.workspace.getConfiguration("px", vscode.Uri.file(projectRoot(first.cfg)));
      await native.update(first.key, undefined, group.target);
      const inspected = native.inspect(first.key);
      const remaining =
        group.target === vscode.ConfigurationTarget.Workspace
          ? inspected?.workspaceValue
          : inspected?.workspaceFolderValue;
      if (remaining !== undefined) throw new Error(`px.${first.key} source removal could not be verified`);
      // Subsequent cleanup checks must expect the successful removal, not the old snapshot.
      for (const input of inputs) {
        if (input.key !== first.key) continue;
        if (group.target === vscode.ConfigurationTarget.Workspace) input.workspace = undefined;
        else if (input.folderPath === first.folderPath) input.folder = undefined;
      }
      report.removed.push(
        `px.${first.key} (${group.target === vscode.ConfigurationTarget.Workspace ? "Workspace" : first.folderPath})`
      );
    } catch (error) {
      report.errors.push(`${first.cfg.modPath}: ${String(error)}`);
    }
  }
  report.noOp = report.copied.length + report.imported.length + report.removed.length === 0;
  return report;
}
