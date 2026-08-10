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
  if (!fs.existsSync(locDir)) {
    void vscode.window.showWarningMessage(
      `Paradox Modding Toolkit: the mod has no localization folder yet (${locDir}).`
    );
    return;
  }

  const present = languagesInMod(locDir);
  if (present.length === 0) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no localization files with a language marker found in the mod."
    );
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

  for (const src of sourceFiles) {
    const dst = retargetLocPath(src, source, target);
    if (!dst) continue;
    let content: string;
    try {
      content = fs.readFileSync(src, "utf8");
    } catch {
      continue;
    }
    try {
      if (fs.existsSync(dst)) {
        const merged = mergeTranslation(fs.readFileSync(dst, "utf8"), content, source);
        if (merged.added > 0) {
          fs.writeFileSync(dst, merged.content, "utf8");
          updated++;
          addedKeys += merged.added;
          firstFile = firstFile ?? dst;
        }
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, buildTranslation(content, target, source), "utf8");
        created++;
        firstFile = firstFile ?? dst;
      }
    } catch (err) {
      log(`translation: failed for ${dst}: ${String(err)}`);
    }
  }

  const summary = `Paradox Modding Toolkit: ${target} translation — ${created} file(s) created, ${updated} updated (${addedKeys} entries appended).`;
  log(summary);
  void vscode.window.showInformationMessage(summary);
  if (firstFile) {
    const doc = await vscode.workspace.openTextDocument(firstFile);
    await vscode.window.showTextDocument(doc);
  }
}
