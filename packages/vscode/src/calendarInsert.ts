/**
 * `Paradox: Insert Date` - type a date the way the mod's custom calendar
 * displays it ("1000 BC", "1000 BC March 15") and insert the script date the
 * game logic needs ("3000.1.1"). The conversion previews live in the input
 * box before anything is committed; existing dates are never rewritten.
 * Mapping logic: @px-lsp/protocol/calendar. Configured via `px.calendar`.
 */
import * as vscode from "vscode";
import { convertDisplayInput, type CalendarSetting } from "@px-lsp/protocol/calendar";

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
