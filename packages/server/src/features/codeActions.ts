/**
 * Code actions on loc-key references in script. Gated per command id
 * (initializationOptions.client.commands): where the client registers the
 * command the action carries it, so the file write happens in the client that
 * owns the editor UX. Where it does not, the create-key quick fix carries a
 * real WorkspaceEdit instead and the two editor-command actions are omitted
 * rather than shipped dead.
 */
import {
  CodeActionKind,
  CreateFile,
  TextDocumentEdit,
  type CodeAction,
  type Diagnostic,
  type Range,
  type WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import type { ServerData } from "../serverData";
import { findLocKeyRefs, type LocKeyRef } from "@px-lsp/protocol/locRefs";
import { clientCommands } from "@px-lsp/protocol/protocol";
import { resolveConfigPath } from "@px-lsp/protocol/configDir";
import {
  generatedLocalizationSource,
  parseLocalizationDefaults,
  suggestLocalizationTarget,
  upsertLocalizationText,
} from "@px-lsp/protocol/localizationPolicy";
import { getLineText } from "../documents";
import { activeProfile } from "../games/active";
import { canRunCommand } from "../clientMode";

export function locKeyRefAt(lineText: string, character: number): LocKeyRef | null {
  const refs = findLocKeyRefs(lineText);
  return refs.find((r) => character >= r.start - 1 && character <= r.end + 1) ?? refs[0] ?? null;
}

/** Context for the plain-client WorkspaceEdit fallback. */
export interface LocEditContext {
  locLanguage: string;
  /** Workspace-mod root of a file, or null (vanilla/parent files get no edit). */
  modRootOf: (fsPath: string) => string | null;
  /** Mod-relative localization root(s) from the loc_key schema entries. */
  locRoots: string[];
  /** Current buffers, including localization files not saved to disk yet. */
  openDocuments?: readonly TextDocument[];
}

function readOptional(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function relativeWithin(root: string, file: string): string | undefined {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)
    ? relative
    : undefined;
}

/** Never write through a localization symlink into a reference tree. */
function assertModTarget(root: string, target: string): void {
  const realRoot = fs.realpathSync(root);
  let ancestor = target;
  while (true) {
    try {
      const real = fs.realpathSync(ancestor);
      if (real !== realRoot && !relativeWithin(realRoot, real)) {
        throw new Error("Localization target is outside the editable mod");
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

/** Missing-key edits use mod conventions and version the current target buffer. */
export function locCreateEdit(
  key: string,
  docFsPath: string,
  ctx: LocEditContext,
  relatedKeys: string[] = []
): WorkspaceEdit | null {
  const modRoot = ctx.modRootOf(docFsPath);
  if (!modRoot) return null;
  const normalize = (file: string) => (process.platform === "win32" ? file.toLowerCase() : file);
  const open = new Map((ctx.openDocuments ?? []).map((doc) => [normalize(URI.parse(doc.uri).fsPath), doc]));
  const current = (file: string) => open.get(normalize(file));
  const readCurrent = (file: string) => current(file)?.getText() ?? readOptional(file);
  const configFile = resolveConfigPath(modRoot, activeProfile(), "localization.json");
  const config = readCurrent(configFile);
  const defaults = parseLocalizationDefaults(
    config === undefined ? undefined : JSON.parse(config.replace(/^\uFEFF/, ""))
  );
  const lang = defaults.language || ctx.locLanguage;
  const texts = new Map<string, string>();
  const visited = new Set<string>();
  const realModRoot = fs.realpathSync(modRoot);
  const walk = (directory: string): void => {
    let real: string;
    try {
      real = fs.realpathSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!relativeWithin(realModRoot, real) || visited.has(normalize(real))) return;
    visited.add(normalize(real));
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".yml")) {
        const text = readCurrent(file);
        if (text === undefined) throw new Error(`Localization file changed during the scan: ${file}`);
        texts.set(relativeWithin(modRoot, file)!, text);
      } else if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync(file);
        if (!relativeWithin(realModRoot, resolved)) continue;
        if (fs.statSync(file).isDirectory()) walk(file);
        else if (entry.name.toLowerCase().endsWith(".yml")) {
          const text = readCurrent(file);
          if (text === undefined) throw new Error(`Localization file changed during the scan: ${file}`);
          texts.set(relativeWithin(modRoot, file)!, text);
        }
      }
    }
  };
  for (const root of ctx.locRoots) walk(path.join(modRoot, root));
  for (const doc of open.values()) {
    const relative = relativeWithin(modRoot, URI.parse(doc.uri).fsPath);
    if (relative?.endsWith(".yml") && ctx.locRoots.some((root) => relative.startsWith(`${root}/`))) {
      texts.set(relative, doc.getText());
    }
  }
  const suggestion = suggestLocalizationTarget({
    key,
    language: lang,
    locRoots: ctx.locRoots,
    documents: [...texts].map(([file, text]) => ({ path: file, text })),
    defaults,
    sourcePath: relativeWithin(modRoot, docFsPath),
    relatedKeys,
    subject: path.basename(modRoot),
  });
  if (suggestion.reason === "existing key") return null;
  if (!suggestion.path) {
    throw new Error(
      `Choose a localization file or set localization.json newKeyFile: ${suggestion.candidates?.join(", ")}`
    );
  }
  const target = path.join(modRoot, suggestion.path);
  assertModTarget(modRoot, target);
  const uri = URI.file(target).toString();
  const content = readCurrent(target);
  if (content !== undefined && generatedLocalizationSource(content)) {
    throw new Error(`Localization target is generated: ${suggestion.path}`);
  }
  let updated = upsertLocalizationText(content ?? "", lang, key, "", defaults.entryVersion);
  if (!updated.startsWith("\uFEFF")) updated = "\uFEFF" + updated;
  if (content === undefined) {
    return {
      documentChanges: [
        CreateFile.create(uri),
        TextDocumentEdit.create({ uri, version: null }, [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: updated,
          },
        ]),
      ],
    };
  }
  const targetDoc = current(target) ?? TextDocument.create(uri, "paradox-localization", 0, content);
  let start = 0;
  while (start < content.length && start < updated.length && content[start] === updated[start]) start++;
  let end = content.length;
  let updatedEnd = updated.length;
  while (end > start && updatedEnd > start && content[end - 1] === updated[updatedEnd - 1]) {
    end--;
    updatedEnd--;
  }
  return {
    documentChanges: [
      TextDocumentEdit.create({ uri: targetDoc.uri, version: current(target)?.version ?? null }, [
        {
          range: { start: targetDoc.positionAt(start), end: targetDoc.positionAt(end) },
          newText: updated.slice(start, updatedEnd),
        },
      ]),
    ],
  };
}
export function provideCodeActions(
  data: ServerData,
  document: TextDocument,
  range: Range,
  diagnostics: Diagnostic[],
  locEditContext?: LocEditContext
): CodeAction[] {
  const actions: CodeAction[] = [];
  const canEditLoc = canRunCommand(clientCommands.editLocalization);
  const canOpenSideBySide = canRunCommand(clientCommands.openLocalizationSideBySide);

  // Quick fix on missing-required-loc diagnostics: create the key in place.
  for (const d of diagnostics) {
    if (d.code !== "missing-required-loc") continue;
    const key = (d.data as { key?: string } | undefined)?.key;
    if (!key) continue;
    const title = `${activeProfile().shortName}: Create localization key "${key}"`;
    if (canEditLoc) {
      actions.push({
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [d],
        command: { command: clientCommands.editLocalization, title: "Create localization", arguments: [key] },
      });
    } else if (locEditContext) {
      try {
        const relatedKeys = document
          .getText()
          .split(/\r?\n/)
          .flatMap((line) => findLocKeyRefs(line).map((ref) => ref.key));
        const edit = locCreateEdit(key, URI.parse(document.uri).fsPath, locEditContext, relatedKeys);
        if (edit) actions.push({ title, kind: CodeActionKind.QuickFix, diagnostics: [d], edit });
      } catch (error) {
        actions.push({
          title,
          kind: CodeActionKind.QuickFix,
          diagnostics: [d],
          disabled: { reason: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  // The two editor-command actions exist only for clients that register their
  // command; elsewhere they would render and silently do nothing.
  if (!canEditLoc && !canOpenSideBySide) return actions;

  const ref = locKeyRefAt(getLineText(document, range.start.line), range.start.character);
  if (!ref) return actions;

  if (canEditLoc) {
    actions.push({
      title: `${activeProfile().shortName}: Edit localization for "${ref.key}"`,
      kind: CodeActionKind.QuickFix,
      command: { command: clientCommands.editLocalization, title: "Edit localization", arguments: [ref.key] },
    });
  }

  if (canOpenSideBySide && data.index.lookup(ref.key).some((d) => d.kind === "loc_key")) {
    actions.push({
      title: `${activeProfile().shortName}: Open localization side by side`,
      kind: CodeActionKind.Empty,
      command: {
        command: clientCommands.openLocalizationSideBySide,
        title: "Open localization side by side",
        arguments: [ref.key],
      },
    });
  }
  return actions;
}
