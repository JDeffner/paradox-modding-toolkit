/**
 * `Paradox: Insert Date` - type a date the way the mod's custom calendar
 * displays it ("1000 BC", "1000 BC March 15") and insert the script date the
 * game logic needs ("3000.1.1"). The conversion previews live in the input
 * box before anything is committed; existing dates are never rewritten.
 * Mapping logic: @px-lsp/protocol/calendar. Configured via `px.calendar`.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { convertDisplayInput, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { generateCalendarLoc } from "@px-lsp/protocol/calendarLoc";
import type { PxConfig } from "./config";
import { metaFor } from "./meta";

const BOM = "\uFEFF";

export async function insertDateCommand(calendar: CalendarSetting | undefined): Promise<void> {
  if (!calendar) {
    const open = "Open Settings";
    const pick = await vscode.window.showInformationMessage(
      "Insert Date needs the mod's calendar declared in the px.calendar setting " +
        '(e.g. { "epoch": 4000, "after": "AD", "before": "BC" } in the workspace settings.json).',
      open
    );
    if (pick === open) await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const eraExample = calendar.before ?? calendar.after;
  const typed = await vscode.window.showInputBox({
    title: "Insert Date (display calendar)",
    prompt: `Year, era, month, day - e.g. "1000 ${eraExample}" or "1000 ${eraExample} 3 15"`,
    validateInput: (value) => {
      if (value.trim() === "") return null;
      const result = convertDisplayInput(calendar, value);
      return result.ok
        ? {
            message: `${result.display} → inserts \`${result.script}\``,
            severity: vscode.InputBoxValidationSeverity.Info,
          }
        : { message: result.error, severity: vscode.InputBoxValidationSeverity.Error };
    },
  });
  if (typed === undefined) return;
  const result = convertDisplayInput(calendar, typed);
  if (!result.ok) {
    void vscode.window.showWarningMessage(`Insert Date: ${result.error}`);
    return;
  }
  await editor.edit((edit) => {
    for (const selection of editor.selections) edit.replace(selection, result.script);
  });
}

/**
 * `Paradox: Generate Calendar Localization` - write the GAME side of the
 * calendar declared in `px.calendar`: the era-math datafunction keys plus the
 * `localization/replace/` overrides of the engine's date-format (and, with
 * custom months, month-name) keys. Deterministic filenames, so running it
 * again after a `px.calendar` change regenerates in place.
 */
export async function generateCalendarLocCommand(cfg: PxConfig): Promise<void> {
  if (!cfg.calendar) {
    const open = "Open Settings";
    const pick = await vscode.window.showInformationMessage(
      "Generate Calendar Localization needs the mod's calendar declared in the px.calendar setting " +
        '(e.g. { "epoch": 4000, "after": "AD", "before": "BC" } in the workspace settings.json).',
      open
    );
    if (pick === open) await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
    return;
  }
  const meta = metaFor(cfg.gameId);
  if (!meta.calendarLoc) {
    void vscode.window.showInformationMessage(
      `${meta.name}'s date-format localization keys are not verified yet, so generation is not ` +
        "available for it. The editor-side calendar features work regardless."
    );
    return;
  }
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
    );
    return;
  }

  const { files, notes } = generateCalendarLoc(cfg.calendar, meta.calendarLoc, cfg.locLanguage);
  const targets = files.map((f) => path.join(cfg.modPath!, ...f.relPath.split("/")));
  const existing = targets.filter((t) => fs.existsSync(t));
  if (existing.length > 0) {
    const regenerate = "Regenerate";
    const pick = await vscode.window.showWarningMessage(
      `Overwrite the generated calendar files (${existing.map((t) => path.basename(t)).join(", ")})?`,
      { modal: true },
      regenerate
    );
    if (pick !== regenerate) return;
  }
  for (let i = 0; i < files.length; i++) {
    fs.mkdirSync(path.dirname(targets[i]), { recursive: true });
    fs.writeFileSync(targets[i], BOM + files[i].content, "utf8");
  }
  await vscode.window.showTextDocument(vscode.Uri.file(targets[targets.length - 1]));
  void vscode.window.showInformationMessage(
    `Wrote ${files.map((f) => f.relPath).join(" and ")}. ` + notes.join(" ")
  );
}
