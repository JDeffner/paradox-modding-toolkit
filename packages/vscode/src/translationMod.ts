/**
 * `Paradox Localization: New Translation Mod` — pick any indexed mod (workspace
 * mod or read-only parent), pick a target language, and scaffold a standalone
 * translation mod next to it: descriptor with a dependency on the source,
 * blanked loc files under localization/<lang>/replace/, and a TRANSLATE.md
 * with the workflow + AI prompt. Generation logic is pure and lives in
 * ./translationBuild.ts.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { parseDescriptor } from "@px-lsp/protocol/descriptorMod";
import { readMetadata } from "@px-lsp/protocol/descriptorMetadata";
import { readModName } from "@px-lsp/protocol/modName";
import { LOC_LANGUAGES, detectLocFileLanguage } from "@px-lsp/protocol/translationCore";
import { buildTranslationMod, type SourceLocFile } from "./translationBuild";
import { metaFor } from "./meta";
import { assertLocalizationPath, effectiveLocConfig, localizationRoots } from "./localizationProject";
import { assertDocumentCurrent, readDocument, writeDocument, type DocumentSnapshot } from "./documentWrite";

function uniqueRoots(cfg: PxConfig): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of [cfg.modPath, ...cfg.workspaceMods, ...cfg.parentPaths]) {
    if (!r) continue;
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** The source mod's game version, from whichever descriptor it carries. */
function supportedVersionOf(root: string): string | null {
  const fromMetadata = readMetadata(root)?.supported_game_version?.trim();
  if (fromMetadata) return fromMetadata;
  try {
    const text = fs.readFileSync(path.join(root, "descriptor.mod"), "utf8");
    const entry = parseDescriptor(text).find((e) => e.key === "supported_version");
    const v = entry?.value.replace(/^"([^]*)"$/, "$1").trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

export async function createTranslationModCommand(cfg: PxConfig, log: (msg: string) => void): Promise<void> {
  // 1. Source mod: any indexed root with localization files.
  const candidates = uniqueRoots(cfg).filter((modPath) =>
    localizationRoots({ ...cfg, modPath }).some((root) => fs.existsSync(path.join(modPath, root)))
  );
  if (candidates.length === 0) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod with a localization folder found (open the mod to translate as a workspace folder or list it in px.parentMods)."
    );
    return;
  }
  type RootItem = vscode.QuickPickItem & { root: string };
  const sourcePick = await vscode.window.showQuickPick<RootItem>(
    candidates.map((r) => ({
      label: readModName(r),
      description: r,
      root: r,
    })),
    { title: "Translate which mod?", placeHolder: "The mod whose localization the new mod will translate" }
  );
  if (!sourcePick) return;
  const sourceRoot = sourcePick.root;
  const sourceName = sourcePick.label;
  cfg = effectiveLocConfig({ ...cfg, modPath: sourceRoot });

  // 2. Languages: source from what the mod actually ships, target from the rest.
  const locFiles = localizationRoots(cfg).flatMap((root) => listFiles(path.join(sourceRoot, root), ".yml"));
  const present = [
    ...new Set(locFiles.map(detectLocFileLanguage).filter((l): l is string => l !== null)),
  ].sort();
  if (present.length === 0) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no localization files with a language marker in that mod."
    );
    return;
  }
  const sourceDefault = present.includes(cfg.locLanguage) ? cfg.locLanguage : present[0];
  const sourceLang =
    present.length === 1
      ? present[0]
      : await vscode.window.showQuickPick(present, {
          title: "Translate from",
          placeHolder: `Source language, usually ${sourceDefault}`,
        });
  if (!sourceLang) return;
  let targetLang = await vscode.window.showQuickPick(
    [...LOC_LANGUAGES.filter((l) => l !== sourceLang), "other..."],
    { title: "Translate to", placeHolder: "Language the new mod provides" }
  );
  if (!targetLang) return;
  if (targetLang === "other...") {
    targetLang = await vscode.window.showInputBox({
      title: "Target language",
      prompt: "Language name as used in yml headers (l_<name>)",
      validateInput: (v) => (/^[a-z_]+$/.test(v) ? null : "lowercase letters and underscores only"),
    });
    if (!targetLang) return;
  }

  // 3. Destination folder (default: sibling of the source mod).
  const destDefault = path.join(path.dirname(sourceRoot), `${path.basename(sourceRoot)}_${targetLang}`);
  const dest = await vscode.window.showInputBox({
    title: "Folder for the new translation mod",
    value: destDefault,
    valueSelection: [destDefault.length, destDefault.length],
    validateInput: (v) => {
      if (v.trim() === "") return "enter a folder path";
      try {
        if (fs.existsSync(v) && fs.readdirSync(v).length > 0) return "folder exists and is not empty";
      } catch {
        // unreadable → let mkdir report it
      }
      return null;
    },
  });
  if (!dest) return;

  // 4. Generate and write.
  let result: ReturnType<typeof buildTranslationMod>;
  try {
    const files: SourceLocFile[] = [];
    const sources: DocumentSnapshot[] = [];
    for (const f of locFiles) {
      if (detectLocFileLanguage(f) !== sourceLang) continue;
      const snapshot = await readDocument(f);
      sources.push(snapshot);
      files.push({ relPath: path.relative(sourceRoot, f), content: snapshot.text });
    }
    const meta = metaFor(cfg.gameId);
    result = buildTranslationMod({
      gameName: meta.name,
      gameShortName: meta.shortName,
      tigerName: meta.tiger?.binaryName ?? null,
      configDirName: meta.configDirName,
      descriptorKind: meta.descriptor,
      sourceName,
      // The metadata convention links mods by id, not by display name.
      sourceId: readMetadata(sourceRoot)?.id?.trim() || null,
      supportedVersion: supportedVersionOf(sourceRoot),
      sourceLang,
      targetLang,
      stageRoot: meta.stageRoots?.[0],
      stageRoots: meta.stageRoots,
      sourceRootRelative: path.relative(dest, sourceRoot) || null,
      files,
    });
    // Recheck the destination after the input flow. An external write must not
    // turn a new-mod scaffold into an overwrite of someone else's content.
    if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
      throw new Error("Destination folder is no longer empty. Choose an empty folder and try again.");
    }
    for (const file of result.files) {
      if (/_l_[a-z_]+\.yml$/i.test(file.relPath)) {
        assertLocalizationPath({ ...cfg, modPath: dest }, path.join(dest, file.relPath), targetLang);
      }
    }
    for (const source of sources) assertDocumentCurrent(source);
    const destinations: DocumentSnapshot[] = [];
    for (const g of result.files) {
      const snapshot = await readDocument(path.join(dest, ...g.relPath.split("/")), true);
      if (!snapshot.created) throw new Error(`${g.relPath} already has content. Choose an empty folder.`);
      destinations.push(snapshot);
    }
    for (const source of sources) assertDocumentCurrent(source);
    for (const destination of destinations) assertDocumentCurrent(destination);
    for (let i = 0; i < result.files.length; i++) {
      const file = result.files[i];
      await writeDocument(destinations[i], file.content, /_l_[a-z_]+\.yml$/i.test(file.relPath), sources);
    }
  } catch (error) {
    const message = `Could not create translation mod: ${String(error)}`;
    log(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  const summary =
    `Paradox Modding Toolkit: translation mod created at ${dest} — ${result.locFiles} loc file(s), ` +
    `${result.entries} entries to translate. TRANSLATE.md has the workflow and AI prompt.`;
  log(summary);

  const choice = await vscode.window.showInformationMessage(summary, "Add to Workspace", "Open TRANSLATE.md");
  if (choice === "Add to Workspace") {
    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, {
      uri: vscode.Uri.file(dest),
    });
  }
  if (choice === "Open TRANSLATE.md" || choice === "Add to Workspace") {
    const doc = await vscode.workspace.openTextDocument(path.join(dest, "TRANSLATE.md"));
    await vscode.window.showTextDocument(doc);
  }
}
