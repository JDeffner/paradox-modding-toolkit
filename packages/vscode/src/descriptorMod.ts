/**
 * descriptor.mod support (language `paradox-mod`): completion + hover for the
 * launcher's key set, structural diagnostics on the file, and the
 * "mod folder has no descriptor.mod" error with a one-click fix.
 * Field knowledge lives in packages/protocol/src/descriptorMod.ts (unit-tested).
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { looksLikeGameDir } from "./config";
import {
  DESCRIPTOR_FIELDS,
  DESCRIPTOR_FIELD_MAP,
  LAUNCHER_TAGS,
  parseDescriptor,
  scaffoldDescriptor,
  validateDescriptor,
  wildcardVersion,
} from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH, scaffoldMetadata } from "@px-lsp/protocol/descriptorMetadata";
import { metaFor } from "./meta";

const MOD_SELECTOR: vscode.DocumentSelector = { language: "paradox-mod", scheme: "file" };
const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
} as const;
/** Content folders that mark a workspace as a mod even without a descriptor. */
const MOD_CONTENT_DIRS = ["common", "events", "localization", "gui", "history", "gfx", "map_data", "music"];

function isDescriptorFile(fsPath: string): boolean {
  return path.basename(fsPath).toLowerCase() === "descriptor.mod";
}

/** The descriptor file the active game reads, as path segments. */
function descriptorRelPath(gameId: string): string[] {
  return metaFor(gameId).descriptor === "metadata" ? METADATA_REL_PATH.split("/") : ["descriptor.mod"];
}

/** Game version from <install>/launcher/launcher-settings.json, e.g. "1.19.0.6". */
export function detectGameVersion(gamePath: string | null): string | null {
  if (!gamePath) return null;
  const root = path.basename(gamePath).toLowerCase() === "game" ? path.dirname(gamePath) : gamePath;
  try {
    const raw = fs.readFileSync(path.join(root, "launcher", "launcher-settings.json"), "utf8");
    const json = JSON.parse(raw) as { rawVersion?: string; version?: string };
    const v = (json.rawVersion ?? json.version ?? "").trim();
    return /^\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Brace depth of the text before `offset`, and the top-level key owning the block. */
function blockContext(text: string, offset: number): { depth: number; blockKey: string | null } {
  let depth = 0;
  let blockKey: string | null = null;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    const ch = text[i];
    if (ch === "\n") lineStart = i + 1;
    else if (ch === "#") {
      while (i < offset && text[i] !== "\n") i++;
      lineStart = i + 1;
    } else if (ch === "{") {
      if (depth === 0) {
        const m = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*$/.exec(text.slice(lineStart, i));
        blockKey = m ? m[1] : null;
      }
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) blockKey = null;
    }
  }
  return { depth, blockKey };
}

function fieldDocs(key: string): vscode.MarkdownString | null {
  const field = DESCRIPTOR_FIELD_MAP.get(key);
  if (!field) return null;
  const badges: string[] = [];
  if (field.required) badges.push("**required**");
  if (field.repeatable) badges.push("repeatable");
  if (field.outerOnly) badges.push("outer `<name>.mod` only");
  const md = new vscode.MarkdownString(
    `**${field.key}** - ${field.summary}${badges.length ? ` _(${badges.join(", ")})_` : ""}\n\n${field.doc}`
  );
  return md;
}

class DescriptorCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getConfig: () => PxConfig) {}

  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const text = doc.getText();
    const { depth, blockKey } = blockContext(text, doc.offsetAt(pos));
    if (depth > 0) {
      return blockKey === "tags" ? this.tagItems(doc, pos) : [];
    }

    const lineBefore = doc.lineAt(pos.line).text.slice(0, pos.character);
    const valueKey = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?[^"]*$/.exec(lineBefore)?.[1];
    if (valueKey) return this.valueItems(doc, valueKey, /"/.test(lineBefore));

    return this.keyItems(doc);
  }

  private keyItems(doc: vscode.TextDocument): vscode.CompletionItem[] {
    const present = new Set(parseDescriptor(doc.getText()).map((e) => e.key));
    const forDescriptor = isDescriptorFile(doc.uri.fsPath);
    const items: vscode.CompletionItem[] = [];
    for (const field of DESCRIPTOR_FIELDS) {
      if (present.has(field.key) && !field.repeatable) continue;
      if (field.outerOnly && forDescriptor) continue;
      const item = new vscode.CompletionItem(field.key, vscode.CompletionItemKind.Property);
      item.detail = (field.required ? "required - " : "") + field.summary;
      item.documentation = fieldDocs(field.key) ?? undefined;
      item.insertText = new vscode.SnippetString(this.withVersion(field.key, field.snippet));
      item.sortText = `${field.required ? "0" : "1"}_${field.key}`;
      items.push(item);
    }
    return items;
  }

  /** Fill the detected game version into the supported_version snippet. */
  private withVersion(key: string, snippet: string): string {
    if (key !== "supported_version") return snippet;
    const detected = detectGameVersion(this.getConfig().gamePath);
    const wild = detected ? wildcardVersion(detected) : null;
    return wild ? `supported_version="\${1:${wild}}"` : snippet;
  }

  private tagItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] {
    const lineBefore = doc.lineAt(pos.line).text.slice(0, pos.character);
    const insideQuotes = (lineBefore.match(/"/g)?.length ?? 0) % 2 === 1;
    return LAUNCHER_TAGS.map((tag, i) => {
      const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.EnumMember);
      item.detail = "launcher category";
      item.insertText = insideQuotes ? tag : `"${tag}"`;
      // Keep the launcher's alphabetical order but float the everyday ones.
      item.sortText = `${["Gameplay", "Events", "Balance", "Fixes"].includes(tag) ? "0" : "1"}_${String(i).padStart(2, "0")}`;
      // The space in "Total Conversion" etc. must not break filtering.
      item.filterText = insideQuotes ? tag : `"${tag}"`;
      return item;
    });
  }

  private valueItems(doc: vscode.TextDocument, key: string, insideQuotes: boolean): vscode.CompletionItem[] {
    const quote = (s: string) => (insideQuotes ? s : `"${s}"`);
    if (key === "supported_version") {
      const detected = detectGameVersion(this.getConfig().gamePath);
      if (!detected) return [];
      const items: vscode.CompletionItem[] = [];
      const wild = wildcardVersion(detected);
      if (wild) {
        const w = new vscode.CompletionItem(wild, vscode.CompletionItemKind.Value);
        w.detail = "installed game, any hotfix (recommended)";
        w.insertText = quote(wild);
        w.sortText = "0";
        items.push(w);
      }
      const exact = new vscode.CompletionItem(detected, vscode.CompletionItemKind.Value);
      exact.detail = "installed game version, exact";
      exact.insertText = quote(detected);
      exact.sortText = "1";
      items.push(exact);
      return items;
    }
    if (key === "picture") {
      const dir = path.dirname(doc.uri.fsPath);
      try {
        return fs
          .readdirSync(dir)
          .filter((f) => /\.(png|jpe?g|dds)$/i.test(f))
          .map((f) => {
            const item = new vscode.CompletionItem(f, vscode.CompletionItemKind.File);
            item.insertText = quote(f);
            return item;
          });
      } catch {
        return [];
      }
    }
    return [];
  }
}

class DescriptorHoverProvider implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | null {
    const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!range) return null;
    const word = doc.getText(range);
    // Only key position (word followed by =), not words inside string values.
    const after = doc.lineAt(pos.line).text.slice(range.end.character);
    if (!/^\s*=/.test(after)) return null;
    const md = fieldDocs(word);
    return md ? new vscode.Hover(md, range) : null;
  }
}

export interface DescriptorModFeature extends vscode.Disposable {
  /** Re-check the missing-descriptor state (config / workspace changes). */
  refresh(): void;
}

export function registerDescriptorMod(
  context: vscode.ExtensionContext,
  getConfig: () => PxConfig,
  log: (msg: string) => void
): DescriptorModFeature {
  const diagnostics = vscode.languages.createDiagnosticCollection("px-descriptor");
  let missingNotified = false;
  let watcher: vscode.FileSystemWatcher | null = null;
  let watchedRoot: string | null = null;

  const validateText = (uri: vscode.Uri, text: string) => {
    const issues = validateDescriptor(text, { isDescriptorFile: isDescriptorFile(uri.fsPath) });
    diagnostics.set(
      uri,
      issues.map((i) => {
        const d = new vscode.Diagnostic(
          new vscode.Range(i.line, i.startCol, i.line, i.endCol),
          i.message,
          SEVERITY[i.severity]
        );
        d.source = "px-descriptor";
        d.code = i.code;
        return d;
      })
    );
  };

  const validateDoc = (doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== "file" || !doc.uri.fsPath.toLowerCase().endsWith(".mod")) return;
    validateText(doc.uri, doc.getText());
  };

  /** The workspace clearly holds mod content (so a missing descriptor is a real error). */
  const looksLikeModContent = (dir: string): boolean =>
    MOD_CONTENT_DIRS.some((d) => {
      try {
        return fs.statSync(path.join(dir, d)).isDirectory();
      } catch {
        return false;
      }
    });

  const refresh = () => {
    const cfg = getConfig();
    const modPath = cfg.enableForWorkspace ? cfg.modPath : null;

    // (Re)wire the descriptor watcher when the mod root changes.
    if (watchedRoot !== modPath) {
      watcher?.dispose();
      watcher = null;
      watchedRoot = modPath;
      if (modPath) {
        watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(modPath), "*.mod")
        );
        watcher.onDidCreate(() => refresh());
        watcher.onDidDelete(() => refresh());
        watcher.onDidChange((uri) => {
          try {
            validateText(uri, fs.readFileSync(uri.fsPath, "utf8"));
          } catch {
            diagnostics.delete(uri);
          }
        });
      }
    }

    if (!modPath) return;
    // Each game wants exactly one of the two descriptor conventions, and a mod
    // without the one its game reads does not load at all.
    const isMetadata = metaFor(cfg.gameId).descriptor === "metadata";
    const descriptorPath = path.join(modPath, ...descriptorRelPath(cfg.gameId));
    const descriptorUri = vscode.Uri.file(descriptorPath);

    // A game install shares the mod content dirs but is not a mod: never demand
    // a descriptor for it, even if it slipped through as modPath.
    if (looksLikeGameDir(modPath)) {
      diagnostics.delete(descriptorUri);
      return;
    }

    if (fs.existsSync(descriptorPath)) {
      missingNotified = false;
      // Only the .mod format has structural checks of ours; metadata.json is
      // JSON, validated by VS Code's own JSON support against the contributed
      // schema. Validate from disk unless the file is open (open docs validate
      // live).
      if (isMetadata) return;
      const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === descriptorPath);
      if (!open) {
        try {
          validateText(descriptorUri, fs.readFileSync(descriptorPath, "utf8"));
        } catch {
          diagnostics.delete(descriptorUri);
        }
      }
      return;
    }

    if (!cfg.requireDescriptor || !looksLikeModContent(modPath)) {
      // Opt-in check (px.diagnostics.requireDescriptor), and only for folders
      // that clearly hold mod content: otherwise stay silent.
      diagnostics.delete(descriptorUri);
      return;
    }

    const name = descriptorRelPath(cfg.gameId).join("/");
    log(`${name} missing in ${modPath}`);
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      `${name} is missing from the mod root. Every mod needs one: the launcher, ` +
        `Steam Workshop uploads${metaFor(cfg.gameId).tiger ? ` and ${metaFor(cfg.gameId).tiger?.binaryName}` : ""} all read it.`,
      vscode.DiagnosticSeverity.Error
    );
    d.source = "px-descriptor";
    d.code = "descriptor-missing";
    diagnostics.set(descriptorUri, [d]);
    if (!missingNotified) {
      missingNotified = true;
      void vscode.window
        .showErrorMessage(`Paradox Modding Toolkit: this mod has no ${name} (${modPath}).`, `Create ${name}`)
        .then((choice) => {
          if (choice) void vscode.commands.executeCommand("px.createDescriptor");
        });
    }
  };

  const createDescriptor = async () => {
    const cfg = getConfig();
    if (!cfg.modPath) {
      void vscode.window.showWarningMessage(
        "Paradox Modding Toolkit: open the folder that should become the mod as a workspace folder first."
      );
      return;
    }
    const meta = metaFor(cfg.gameId);
    const file = path.join(cfg.modPath, ...descriptorRelPath(cfg.gameId));
    if (!fs.existsSync(file)) {
      const folderName = path.basename(cfg.modPath);
      const modName = folderName.replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
      const detected = detectGameVersion(cfg.gamePath);
      const version = (detected && wildcardVersion(detected)) ?? "1.*";
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        meta.descriptor === "metadata"
          ? scaffoldMetadata({ name: modName, id: folderName, supportedGameVersion: version })
          : scaffoldDescriptor(modName, version),
        "utf8"
      );
      log(`created ${file}`);
      // A metadata mod also needs a square thumbnail.png in its root: the
      // launcher lists the mod without one, the Workshop upload refuses. We do
      // not fabricate an image, so say it once, here.
      if (meta.descriptor === "metadata" && !fs.existsSync(path.join(cfg.modPath, "thumbnail.png"))) {
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: ${descriptorRelPath(cfg.gameId).join("/")} created. ` +
            `Add a square thumbnail.png to the mod root as well: ${meta.name} needs one for the Workshop upload.`
        );
      }
    }
    refresh();
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc);
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      MOD_SELECTOR,
      new DescriptorCompletionProvider(getConfig),
      '"',
      "{"
    ),
    vscode.languages.registerHoverProvider(MOD_SELECTOR, new DescriptorHoverProvider()),
    vscode.commands.registerCommand("px.createDescriptor", createDescriptor),
    vscode.workspace.onDidOpenTextDocument(validateDoc),
    vscode.workspace.onDidChangeTextDocument((e) => validateDoc(e.document))
  );
  for (const doc of vscode.workspace.textDocuments) validateDoc(doc);
  refresh();

  return {
    refresh,
    dispose() {
      watcher?.dispose();
      diagnostics.dispose();
    },
  };
}
