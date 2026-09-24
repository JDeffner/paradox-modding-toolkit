/**
 * Translation workflow (VS Code side): the `Paradox Localization: Add Language` command
 * scaffolds a new language from an existing one. The overlay of the source
 * language in translated files is served by the language server as inlay
 * hints.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { PxConfig } from "./config";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { readDocument, writeDocument } from "./documentWrite";
import {
  LOC_LANGUAGES,
  buildTranslation,
  detectLocFileLanguage,
  mergeTranslation,
  retargetLocPath,
} from "@px-lsp/protocol/translationCore";

/** Languages that actually occur in the mod's localization folder. */
function languagesInMod(locDir: string): string[] {
  const langs = new Set<string>();
  for (const file of listFiles(locDir, ".yml")) {
    const lang = detectLocFileLanguage(file);
    if (lang) langs.add(lang);
  }
  return [...langs].sort();
}

export async function createTranslationCommand(cfg: PxConfig, log: (msg: string) => void): Promise<void> {
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
    );
    return;
  }
  const locDir = path.join(cfg.modPath, "localization");
  const present = fs.existsSync(locDir) ? languagesInMod(locDir) : [];
  if (present.length === 0) {
    const language = await vscode.window.showQuickPick([...LOC_LANGUAGES], {
      title: `Add language to ${path.basename(cfg.modPath)}`,
      placeHolder: "Choose the first localization language",
    });
    if (!language) return;
    const file = path.join(locDir, language, `mod_l_${language}.yml`);
    try {
      const snapshot = await readDocument(file, true);
      if (!snapshot.created) throw new Error("Localization file already exists");
      await writeDocument(snapshot, `l_${language}:\n`, true);
      await vscode.window.showTextDocument(snapshot.document);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not add localization: ${String(error)}`);
    }
    return;
  }

  // Source: default to the configured reference language when it exists in the mod.
  const sourceDefault = present.includes(cfg.locLanguage) ? cfg.locLanguage : present[0];
  const source =
    present.length === 1
      ? present[0]
      : await vscode.window.showQuickPick(present, {
          title: "Translate from",
          placeHolder: `Source language (structure to mirror), usually ${sourceDefault}`,
        });
  if (!source) return;

  const targetChoices = [...LOC_LANGUAGES.filter((l) => l !== source && !present.includes(l)), "other..."];
  let target = await vscode.window.showQuickPick(targetChoices, {
    title: "Translate to",
    placeHolder: "New language to scaffold",
  });
  if (!target) return;
  if (target === "other...") {
    target = await vscode.window.showInputBox({
      title: "Target language",
      prompt: "Language name as used in yml headers (l_<name>)",
      validateInput: (v) => (/^[a-z_]+$/.test(v) ? null : "lowercase letters and underscores only"),
    });
    if (!target) return;
  }

  const sourceFiles = listFiles(locDir, ".yml").filter((f) => detectLocFileLanguage(f) === source);
  let created = 0;
  let updated = 0;
  let addedKeys = 0;
  let firstFile: string | null = null;
  let failed = 0;

  for (const src of sourceFiles) {
    const dst = retargetLocPath(src, source, target);
    if (!dst) continue;
    try {
      const sourceSnapshot = await readDocument(src);
      const destination = await readDocument(dst, true);
      if (!destination.created) {
        const merged = mergeTranslation(destination.text, sourceSnapshot.text, source);
        if (merged.added > 0) {
          await writeDocument(destination, merged.content, true, [sourceSnapshot]);
          updated++;
          addedKeys += merged.added;
          firstFile = firstFile ?? dst;
        }
      } else {
        await writeDocument(destination, buildTranslation(sourceSnapshot.text, target, source), true, [
          sourceSnapshot,
        ]);
        created++;
        firstFile = firstFile ?? dst;
      }
    } catch (err) {
      log(`translation: failed for ${dst}: ${String(err)}`);
      failed++;
      void vscode.window.showErrorMessage(
        `Could not add translation for ${path.basename(src)}: ${String(err)}`
      );
      break;
    }
  }

  const summary = `Paradox Modding Toolkit: ${target} translation — ${created} file(s) created, ${updated} updated (${addedKeys} entries appended).`;
  log(summary);
  if (!failed) void vscode.window.showInformationMessage(summary);
  if (firstFile) {
    const doc = await vscode.workspace.openTextDocument(firstFile);
    await vscode.window.showTextDocument(doc);
  }
}
