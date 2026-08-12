/**
 * Scoped language registration: instead of claiming every *.txt on the system
 * through package.json, switch documents to the per-game script language
 * (`paradox-ck3` and friends) or `paradox-loc` only when they live under the
 * configured mod or game paths.
 */
import * as vscode from "vscode";
import type { PxConfig } from "./config";
import { isUnder } from "./config";
import { isScriptLang, scriptLangFor, shouldRewriteAssociation } from "./langIds";

/**
 * The explorer resolves file icons from static language associations only, so
 * dynamically-detected documents get their icon when opened but never in the
 * tree. In workspaces that are actually mods, persist the associations at
 * workspace scope: same reach as the dynamic detection, but visible to the
 * explorer, and other workspaces stay untouched. Existing associations (any
 * scope) win; we only fill gaps, once.
 *
 * The one exception is `*.txt`, which now names a per-game script id: a value
 * we ourselves wrote for another game is rewritten once (see
 * `shouldRewriteAssociation`), or a workspace set up by an older version would
 * keep showing the wrong icon forever.
 */
export async function ensureFileAssociations(cfg: PxConfig): Promise<void> {
  if (!cfg.isCk3Workspace) return;
  if (!vscode.workspace.workspaceFolders?.length) return;
  const script = scriptLangFor(cfg.gameId);
  const wanted: Record<string, string> = {
    "*.txt": script,
    "*.gui": "paradox-gui",
    "*.mod": "paradox-mod",
    "**/localization/**/*.yml": "paradox-loc",
  };
  const files = vscode.workspace.getConfiguration("files");
  const existing = files.get<Record<string, string>>("associations") ?? {};
  const missing = Object.entries(wanted).filter(([glob]) => !(glob in existing));
  const workspaceValue = files.inspect<Record<string, string>>("associations")?.workspaceValue ?? {};
  const stale = shouldRewriteAssociation(workspaceValue["*.txt"], script) ? { "*.txt": script } : {};
  if (missing.length === 0 && Object.keys(stale).length === 0) return;
  try {
    await files.update(
      "associations",
      { ...workspaceValue, ...Object.fromEntries(missing), ...stale },
      vscode.ConfigurationTarget.Workspace
    );
  } catch {
    // Settings not writable (e.g. virtual workspace); dynamic detection still works.
  }
}

export function wireLanguageDetection(
  context: vscode.ExtensionContext,
  getConfig: () => PxConfig
): () => void {
  const apply = async (doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== "file") return;
    const cfg = getConfig();
    if (!cfg.enableForWorkspace) return;
    const file = doc.uri.fsPath;
    if (
      !isUnder(cfg.modPath, file) &&
      !isUnder(cfg.gamePath, file) &&
      !cfg.parentPaths.some((p) => isUnder(p, file))
    )
      return;

    const lower = file.toLowerCase();
    const script = scriptLangFor(cfg.gameId);
    try {
      // Also retargets a document already on ANOTHER script id: that is what a
      // persisted association from an older version (or from a workspace for a
      // different game) leaves behind on the open editors.
      if (
        lower.endsWith(".txt") &&
        (doc.languageId === "plaintext" || (isScriptLang(doc.languageId) && doc.languageId !== script))
      ) {
        await vscode.languages.setTextDocumentLanguage(doc, script);
      } else if (lower.endsWith(".mod") && doc.languageId === "plaintext") {
        // descriptor.mod is matched by filename in package.json; this catches
        // the outer <name>.mod files when a mod-collection folder is opened.
        await vscode.languages.setTextDocumentLanguage(doc, "paradox-mod");
      } else if (lower.endsWith(".gui") && doc.languageId === "plaintext") {
        // PdxGui shares the jomini syntax; highlighting via the same grammar,
        // but a distinct language id keeps the script LSP out of .gui files.
        await vscode.languages.setTextDocumentLanguage(doc, "paradox-gui");
      } else if (
        lower.endsWith(".yml") &&
        /[\\/]localization[\\/]/.test(lower) &&
        (doc.languageId === "yaml" || doc.languageId === "plaintext")
      ) {
        await vscode.languages.setTextDocumentLanguage(doc, "paradox-loc");
      }
    } catch {
      // Document may have been closed in the meantime; harmless.
    }
  };

  const applyAll = () => {
    for (const doc of vscode.workspace.textDocuments) void apply(doc);
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(apply));
  applyAll();
  // Returned so the caller can re-run detection after the root set changes
  // (workspace folders added/removed, px.parentMods edited).
  return applyAll;
}
