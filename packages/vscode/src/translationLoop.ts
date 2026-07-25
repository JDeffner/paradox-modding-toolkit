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

export async function translateNextCommand(
  lc: LanguageClient,
  cfg: PxConfig,
  onLocFileChanged: (file: string) => void
): Promise<void> {
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage("Paradox Toolkit: no mod folder (open one or set px.modPath).");
    return;
  }
  const coverage = await lc.sendRequest<LocCoverage[]>(locCoverageRequest);
  const candidates = coverage.filter((l) => l.untranslated.length + l.missing.length > 0);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      "Paradox Toolkit: localization coverage is complete — nothing to translate."
    );
    return;
  }

  let lang: LocCoverage | undefined = candidates[0];
  if (candidates.length > 1) {
    const pick = await vscode.window.showQuickPick(
      candidates.map((l) => ({
        label: l.language,
        description: `${l.untranslated.length} untranslated, ${l.missing.length} missing`,
        l,
      })),
      { title: "Translate which language?" }
    );
    if (!pick) return;
    lang = pick.l;
  }

  let done = 0;
  const total = lang.untranslated.length + lang.missing.length;

  for (const item of lang.untranslated) {
    const value = await vscode.window.showInputBox({
      title: `Translate to ${lang.language} (${done + 1}/${total}) — Esc stops`,
      // Source text shown for reference, never prefilled as the answer.
      prompt: `${item.key}${item.value ? ` — source: ${item.value}` : ""}`,
      value: "",
    });
    if (value === undefined) break; // Esc: stop the loop
    if (item.file !== undefined && item.line !== undefined && value !== "" && value !== item.value) {
      try {
        if (replaceLocLineValue(item.file, item.line, value)) onLocFileChanged(item.file);
      } catch (err) {
        void vscode.window.showErrorMessage(`Paradox Toolkit: failed to write ${item.key}: ${String(err)}`);
        break;
      }
    }
    done++;
  }

  for (const item of lang.missing) {
    if (done >= total) break;
    const value = await vscode.window.showInputBox({
      title: `Create in ${lang.language} (${done + 1}/${total}) — Esc stops`,
      prompt: `${item.key} (missing everywhere)`,
      value: "",
    });
    if (value === undefined) break;
    try {
      const file = upsertNewModLoc(cfg, item.key, value, lang.language);
      onLocFileChanged(file);
    } catch (err) {
      void vscode.window.showErrorMessage(`Paradox Toolkit: failed to create ${item.key}: ${String(err)}`);
      break;
    }
    done++;
  }

  if (done > 0) {
    void vscode.window.showInformationMessage(
      `Paradox Toolkit: ${done}/${total} ${lang.language} entr${done === 1 ? "y" : "ies"} written.`
    );
  }
}
