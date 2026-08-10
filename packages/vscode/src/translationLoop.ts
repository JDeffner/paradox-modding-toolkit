/**
 * Translation workflow v2 (rework plan Phase 5): a coverage-driven
 * "translate next" loop — pick a language, then walk its untranslated and
 * missing keys one input box at a time. Esc stops the loop; everything else
 * writes straight to the yml (BOM preserved).
 */
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { locCoverageRequest, type LocCoverage } from "@px-lsp/protocol/protocol";
import type { PxConfig } from "./config";
import { replaceLocLineValue, upsertNewModLoc } from "./locCommands";

/** "french" (the l_french file suffix) shown as "French" in titles. */
function displayLanguage(language: string): string {
  return language.charAt(0).toUpperCase() + language.slice(1);
}

export async function translateNextCommand(
  lc: LanguageClient,
  cfg: PxConfig,
  onLocFileChanged: (file: string) => void
): Promise<void> {
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
    );
    return;
  }
  const coverage = await lc.sendRequest<LocCoverage[]>(locCoverageRequest);
  const candidates = coverage.filter((l) => l.untranslated.length + l.missing.length > 0);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      "Paradox Modding Toolkit: localization coverage is complete — nothing to translate."
    );
    return;
  }

  let lang: LocCoverage | undefined = candidates[0];
  if (candidates.length > 1) {
    const pick = await vscode.window.showQuickPick(
      candidates.map((l) => ({
        label: displayLanguage(l.language),
        description: `${l.untranslated.length} untranslated, ${l.missing.length} missing`,
        l,
      })),
      {
        title: "Translate Missing Keys",
        placeHolder: "Which language do you want to work on?",
      }
    );
    if (!pick) return;
    lang = pick.l;
  }

  let done = 0;
  let written = 0;
  const total = lang.untranslated.length + lang.missing.length;
  const langName = displayLanguage(lang.language);

  for (const item of lang.untranslated) {
    const value = await vscode.window.showInputBox({
      title: `Translate to ${langName} (${done + 1}/${total}) — Esc stops`,
      // Source text shown for reference, never prefilled as the answer.
      prompt: `${item.key}${item.value ? ` — source: ${item.value}` : ""} · leave empty to skip`,
      value: "",
    });
    if (value === undefined) break; // Esc: stop the loop
    if (item.file !== undefined && item.line !== undefined && value !== "" && value !== item.value) {
      try {
        if (replaceLocLineValue(item.file, item.line, value)) onLocFileChanged(item.file);
        written++;
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Paradox Modding Toolkit: failed to write ${item.key}: ${String(err)}`
        );
        break;
      }
    }
    done++;
  }

  for (const item of lang.missing) {
    if (done >= total) break;
    const value = await vscode.window.showInputBox({
      title: `Create in ${langName} (${done + 1}/${total}) — Esc stops`,
      prompt: `${item.key} (missing everywhere) · leave empty to skip`,
      value: "",
    });
    if (value === undefined) break;
    if (value !== "") {
      try {
        const file = upsertNewModLoc(cfg, item.key, value, lang.language);
        onLocFileChanged(file);
        written++;
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Paradox Modding Toolkit: failed to create ${item.key}: ${String(err)}`
        );
        break;
      }
    }
    done++;
  }

  if (done > 0) {
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: ${written} ${langName} entr${written === 1 ? "y" : "ies"} written` +
        `${done > written ? `, ${done - written} skipped` : ""} (${done}/${total} reviewed).`
    );
  }
}
