import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { resolveConfigPath } from "@px-lsp/protocol/configDir";
import {
  parseLocalizationDefaults,
  type LocalizationDefaults,
  type LocalizationDocument,
} from "@px-lsp/protocol/localizationPolicy";
import type { PxConfig } from "./config";
import { containsPath, samePath } from "./commandTargets";
import { metaFor } from "./meta";

export function localizationDefaultsFile(cfg: PxConfig): string {
  if (!cfg.modPath) throw new Error("Choose a mod before configuring localization");
  return resolveConfigPath(cfg.modPath, metaFor(cfg.gameId), "localization.json");
}

function openDocument(file: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments?.find(
    (doc) => doc.uri.scheme === "file" && samePath(doc.uri.fsPath, file)
  );
}

export function readLocalizationDefaults(cfg: PxConfig): LocalizationDefaults {
  if (!cfg.modPath) return {};
  const file = localizationDefaultsFile(cfg);
  try {
    const text = openDocument(file)?.getText() ?? fs.readFileSync(file, "utf8");
    return parseLocalizationDefaults(JSON.parse(text.replace(/^\uFEFF/, "")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read localization defaults: ${String(error)}`);
  }
}

export function effectiveLocConfig(cfg: PxConfig): PxConfig {
  return { ...cfg, locLanguage: readLocalizationDefaults(cfg).language ?? cfg.locLanguage };
}

/** Stage names come from the active profile; legacy root layouts remain discoverable. */
export function localizationRoots(cfg: PxConfig): string[] {
  return [...(metaFor(cfg.gameId).stageRoots ?? []).map((stage) => `${stage}/localization`), "localization"];
}

function physicalPath(file: string): string {
  let ancestor = path.resolve(file);
  const missing: string[] = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`Cannot resolve ${file}`);
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...missing);
}

/** Check existing ancestors too, so a junction cannot redirect a mod write. */
export function assertLocalizationPath(cfg: PxConfig, file: string, language: string): void {
  if (
    !cfg.modPath ||
    !containsPath(cfg.modPath, file) ||
    !containsPath(physicalPath(cfg.modPath), physicalPath(file))
  )
    throw new Error("Localization destination must stay inside the selected mod");
  if (cfg.gamePath && containsPath(physicalPath(cfg.gamePath), physicalPath(file)))
    throw new Error("Vanilla localization is read-only");
  if (!localizationRoots(cfg).some((root) => containsPath(path.join(cfg.modPath!, root), file)))
    throw new Error("Choose a file in one of the mod's localization folders");
  if (!file.toLowerCase().endsWith(`_l_${language}.yml`))
    throw new Error(`Localization file must end in _l_${language}.yml`);
}

interface ReadState {
  file: string;
  disk?: Buffer;
  document?: vscode.TextDocument;
  text?: string;
  version?: number;
}

/** A routing decision and its inputs stay valid until its edit is applied. */
export class LocalizationProject {
  readonly documents: LocalizationDocument[] = [];
  readonly defaults: LocalizationDefaults;
  private readonly reads = new Map<string, ReadState>();
  private readonly files: string[];

  constructor(readonly cfg: PxConfig) {
    if (!cfg.modPath) throw new Error("Choose a mod before writing localization");
    this.capture(localizationDefaultsFile(cfg));
    this.defaults = readLocalizationDefaults(cfg);
    this.files = this.listFiles();
    for (const file of this.files) {
      const state = this.capture(file);
      this.documents.push({
        path: path.relative(cfg.modPath, file).replace(/\\/g, "/"),
        text: state.text ?? state.disk!.toString("utf8"),
      });
    }
  }

  private listFiles(): string[] {
    const files = new Map<string, string>();
    const add = (file: string) => {
      const resolved = path.resolve(file);
      const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
      if (!files.has(key)) files.set(key, file);
    };
    const visit = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) visit(file);
        else if (/_l_[a-z_]+\.yml$/i.test(entry.name)) add(file);
      }
    };
    for (const root of localizationRoots(this.cfg)) {
      const dir = path.join(this.cfg.modPath!, root);
      if (fs.existsSync(dir) && !containsPath(physicalPath(this.cfg.modPath!), physicalPath(dir)))
        throw new Error("A localization folder points outside the selected mod");
      visit(dir);
    }
    for (const doc of vscode.workspace.textDocuments ?? []) {
      if (doc.uri.scheme !== "file" || !/_l_[a-z_]+\.yml$/i.test(doc.uri.fsPath)) continue;
      if (
        localizationRoots(this.cfg).some((root) =>
          containsPath(path.join(this.cfg.modPath!, root), doc.uri.fsPath)
        )
      )
        add(doc.uri.fsPath);
    }
    return [...files.values()].sort();
  }

  capture(file: string): ReadState {
    const existing = this.reads.get(file);
    if (existing) return existing;
    let disk: Buffer | undefined;
    try {
      disk = fs.readFileSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const document = openDocument(file);
    const state = { file, disk, document, text: document?.getText(), version: document?.version };
    this.reads.set(file, state);
    return state;
  }

  assertCurrent(createdFile?: string): void {
    const files = this.listFiles().filter((file) => file !== createdFile || this.files.includes(file));
    if (files.join("\n") !== this.files.join("\n"))
      throw new Error("The mod's localization files changed. Try again.");
    for (const state of this.reads.values()) {
      if (state.file === createdFile && !state.disk) continue;
      let disk: Buffer | undefined;
      try {
        disk = fs.readFileSync(state.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const doc = openDocument(state.file) ?? state.document;
      if (
        (state.disk ? !disk?.equals(state.disk) : disk !== undefined) ||
        (state.document &&
          (state.document.isClosed ||
            state.document.version !== state.version ||
            state.document.getText() !== state.text)) ||
        (!state.document &&
          doc &&
          doc.getText().replace(/^\uFEFF/, "") !==
            (state.disk?.toString("utf8") ?? "").replace(/^\uFEFF/, ""))
      )
        throw new Error(`${path.basename(state.file)} changed during the operation. Try again.`);
    }
  }
}
