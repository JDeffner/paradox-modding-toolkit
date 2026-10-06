import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import * as vscode from "vscode";
import { canonicalConfigPath, resolveConfigPath } from "@px-lsp/protocol/configDir";
import {
  emptyProjectSettings,
  getProjectSetting,
  parseProjectSettings,
  setProjectSetting,
  type ProjectSettingKey,
  type ProjectSettings,
} from "@px-lsp/protocol/projectSettings";
import type { PxConfig } from "./config";
import { metaFor } from "./meta";
import { GAME_METAS } from "./gameDetect";
import { assertDocumentCurrent, readDocument, writeDocument } from "./documentWrite";

export interface ProjectSettingInspection {
  ownValue: unknown;
  value: unknown;
  source: "project" | "folder" | "workspace" | "user" | "default";
  stamp: string;
  path: string;
  legacy: boolean;
  error?: string;
}

/** Only selected editable roots are accepted; reference inputs remain read-only. */
export function projectRoot(cfg: PxConfig): string {
  if (!cfg.modPath) throw new Error("Select an editable mod first");
  const root = path.resolve(cfg.modPath);
  const physicalRoot = fs.realpathSync(root);
  const contains = (parent: string) => {
    const contained = (base: string, candidate: string) => {
      const relative = path.relative(base, candidate);
      return (
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
      );
    };
    return (
      contained(path.resolve(parent), root) ||
      (fs.existsSync(parent) && contained(fs.realpathSync(parent), physicalRoot))
    );
  };
  if (cfg.gamePath && contains(cfg.gamePath)) throw new Error("Game files are read-only");
  if (
    (cfg.parentPaths ?? []).some(
      (parent) =>
        contains(parent) && !(cfg.workspaceMods ?? []).some((mod) => pathKey(mod) === pathKey(parent))
    )
  ) {
    throw new Error("Reference mods are read-only");
  }
  return root;
}

export function assertProjectWriteAllowed(cfg: PxConfig): string {
  if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before changing mod settings");
  return projectRoot(cfg);
}

export function openConfigDocument(file: string): vscode.TextDocument | undefined {
  const key = pathKey(file);
  return vscode.workspace.textDocuments.find(
    (document) => document.uri.scheme === "file" && !document.isClosed && pathKey(document.uri.fsPath) === key
  );
}

function disk(file: string): Buffer | undefined {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function pathKey(file: string): string {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function fileState(file: string): unknown {
  const document = openConfigDocument(file);
  const bytes = disk(file);
  return {
    file,
    disk: bytes?.toString("base64"),
    text: (document?.getText() ?? bytes?.toString("utf8"))?.replace(/^\uFEFF/, ""),
  };
}

export function projectSettingsState(cfg: PxConfig): {
  path: string;
  canonical: string;
  settings: ProjectSettings;
  legacy: boolean;
  stamp: string;
} {
  const root = projectRoot(cfg);
  const meta = metaFor(cfg.gameId);
  const canonical = canonicalConfigPath(root, meta, "project.json");
  const resolved = resolveConfigPath(root, meta, "project.json");
  // A surviving editor buffer also owns an externally deleted canonical file.
  const file = openConfigDocument(canonical) ? canonical : resolved;
  const bytes = disk(file);
  const text = openConfigDocument(file)?.getText() ?? bytes?.toString("utf8");
  const settings =
    text === undefined
      ? emptyProjectSettings()
      : parseProjectSettings(JSON.parse(text.replace(/^\uFEFF/, "")), cfg.gameId);
  const files = [canonical, resolved];
  const stamp = createHash("sha256")
    .update(JSON.stringify({ root: fs.realpathSync(root), files: [...new Set(files)].map(fileState) }))
    .digest("hex");
  return { path: file, canonical, settings, legacy: file !== canonical, stamp };
}

function inspectSetting(cfg: PxConfig, key: ProjectSettingKey): ProjectSettingInspection {
  let state: ReturnType<typeof projectSettingsState>;
  try {
    state = projectSettingsState(cfg);
  } catch (error) {
    return {
      ownValue: undefined,
      value: undefined,
      source: "default",
      stamp: "",
      path: "",
      legacy: false,
      error: String(error),
    };
  }
  const native = vscode.workspace.getConfiguration("px", vscode.Uri.file(projectRoot(cfg)));
  const inspected = native.inspect(key);
  const ownValue = getProjectSetting(state.settings, key);
  const source =
    ownValue !== undefined
      ? "project"
      : inspected?.workspaceFolderValue !== undefined
        ? "folder"
        : inspected?.workspaceValue !== undefined
          ? "workspace"
          : inspected?.globalValue !== undefined
            ? "user"
            : "default";
  let value = ownValue ?? native.get(key);
  if (key === "gameId" && (value === undefined || value === "auto")) value = cfg.gameId;
  const stamp = createHash("sha256")
    .update(JSON.stringify({ project: state.stamp, inspected, value }))
    .digest("hex");
  return { ownValue, value, source, stamp, path: state.path, legacy: state.legacy };
}

export async function inspectProjectSetting(
  cfg: PxConfig,
  key: ProjectSettingKey
): Promise<ProjectSettingInspection> {
  return inspectSetting(cfg, key);
}

/** Shared by the settings UI and upgrade. The expected project snapshot is mandatory. */
export async function writeProjectSettings(
  cfg: PxConfig,
  settings: ProjectSettings,
  expectedStamp: string,
  outputGameId = cfg.gameId,
  assertInputsCurrent: () => void = () => {}
): Promise<void> {
  assertProjectWriteAllowed(cfg);
  const state = projectSettingsState(cfg);
  if (state.stamp !== expectedStamp)
    throw new Error("Mod settings changed. Refresh the settings and try again.");
  parseProjectSettings(settings, outputGameId);
  const body = JSON.stringify(settings, null, 2) + "\n";
  const sources = state.legacy && fs.existsSync(state.path) ? [await readDocument(state.path)] : [];
  const existing = fs.existsSync(state.canonical) ? await readDocument(state.canonical) : undefined;
  if (projectSettingsState(cfg).stamp !== expectedStamp)
    throw new Error("Mod settings changed. Refresh the settings and try again.");
  assertInputsCurrent();
  if (existing) {
    await writeDocument(existing, body, false, sources);
  } else {
    // Missing targets are created with their complete contents, never an invalid empty declaration.
    if (openConfigDocument(state.canonical))
      throw new Error("Save project.json in the editor before trying again");
    for (const source of sources) assertDocumentCurrent(source);
    canonicalConfigPath(projectRoot(cfg), metaFor(cfg.gameId), "project.json");
    fs.mkdirSync(path.dirname(state.canonical), { recursive: true });
    fs.writeFileSync(state.canonical, body, { encoding: "utf8", flag: "wx" });
  }
  // A save can return true without persisting the expected bytes (providers or external edits).
  const saved = parseProjectSettings(
    JSON.parse(fs.readFileSync(state.canonical, "utf8").replace(/^\uFEFF/, "")),
    outputGameId
  );
  if (JSON.stringify(saved) !== JSON.stringify(settings))
    throw new Error("Mod settings could not be verified after saving");
}

export interface ProjectSettingChange {
  key: ProjectSettingKey;
  value: unknown;
  expectedStamp: string;
}

export async function saveProjectSetting(
  cfg: PxConfig,
  key: ProjectSettingKey,
  value: unknown,
  expectedStamp: string
): Promise<void> {
  await saveProjectSettings(cfg, [{ key, value, expectedStamp }]);
}

/** All drafts retain their original inspections until the composed document edit is applied. */
export async function saveProjectSettings(
  cfg: PxConfig,
  changes: readonly ProjectSettingChange[]
): Promise<void> {
  if (!changes.length) return;
  assertProjectWriteAllowed(cfg);
  const assertCurrent = () => {
    for (const { key, expectedStamp } of changes) {
      const inspected = inspectSetting(cfg, key);
      if (inspected.error) throw new Error(inspected.error);
      if (inspected.stamp !== expectedStamp)
        throw new Error("Mod settings changed. Refresh the settings and try again.");
    }
  };
  assertCurrent();
  const state = projectSettingsState(cfg);
  const keys = new Set<ProjectSettingKey>();
  let settings = state.settings;
  let outputGameId = cfg.gameId;
  for (const { key, value } of changes) {
    if (keys.has(key))
      throw new Error(
        "The same shared mod setting has more than one draft. Save one value for each setting."
      );
    keys.add(key);
    if (key === "gameId" && value !== undefined) {
      if (typeof value !== "string" || !GAME_METAS[value])
        throw new Error("Choose a supported game for this mod");
      outputGameId = value;
    }
    settings = setProjectSetting(settings, key, value);
  }
  await writeProjectSettings(cfg, settings, state.stamp, outputGameId, assertCurrent);
}
