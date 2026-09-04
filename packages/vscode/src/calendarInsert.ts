/**
 * The display-calendar commands. A total-conversion mod declares its calendar
 * once, in `<mod>/.px-toolkit/calendar.json` (committed with the mod, one per
 * mod); the window-scoped `px.calendar` setting is the fallback for a mod
 * without the file.
 *
 * - `Paradox: Declare Calendar` writes that file (an editable example) and
 *   opens it.
 * - `Paradox: Insert Date` - type a date the way the mod displays it ("1000
 *   BC", "1000 BC March 15") and insert the script date the game logic needs
 *   ("3000.1.1"). The conversion previews live in the input box before
 *   anything is committed; existing dates are never rewritten.
 * - `Paradox: Generate Calendar Localization` writes the GAME side of the
 *   calendar into the mod.
 *
 * Mapping logic: @px-lsp/protocol/calendar.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { convertDisplayInput, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { CALENDAR_FILE, readCalendarFile, writeCalendarFile } from "@px-lsp/protocol/calendarFile";
import { generateCalendarLoc } from "@px-lsp/protocol/calendarLoc";
import type { PxConfig } from "./config";
import { metaFor } from "./meta";

const BOM = "\uFEFF";

/** What `Declare Calendar` writes: valid as is, meant to be edited. */
const EXAMPLE_CALENDAR: CalendarSetting = { epoch: 4000, after: "AD", before: "BC" };

/**
 * The calendar in force for `cfg.modPath`: the mod's own file first, the
 * setting second. `problem` carries the reason an existing file gave no
 * calendar, so the commands can say so instead of silently using the fallback.
 */
export function calendarForMod(cfg: PxConfig): { calendar: CalendarSetting | undefined; problem?: string } {
  if (!cfg.modPath) return { calendar: cfg.calendar };
  const read = readCalendarFile(cfg.modPath, metaFor(cfg.gameId));
  if (read?.calendar) return { calendar: read.calendar };
  return {
    calendar: cfg.calendar,
    problem: read ? `${path.relative(cfg.modPath, read.file)} is ${read.error}.` : undefined,
  };
}

/** No calendar for this mod: say where it goes and offer to write it there. */
async function offerToDeclare(cfg: PxConfig, what: string, problem?: string): Promise<void> {
  const declare = "Declare Calendar";
  const dir = metaFor(cfg.gameId).configDirName;
  const where = cfg.modPath
    ? `${path.basename(cfg.modPath)}/${dir}/${CALENDAR_FILE}`
    : `the mod's ${dir}/${CALENDAR_FILE}`;
  const pick = await vscode.window.showInformationMessage(
    `${what} needs the mod's calendar declared in ${where} ` +
      '(e.g. { "epoch": 4000, "after": "AD", "before": "BC" }).' +
      (problem ? ` ${problem}` : ""),
    declare
  );
  if (pick === declare) await declareCalendarCommand(cfg);
}

/** `Paradox: Declare Calendar` - write `.px-toolkit/calendar.json` (or open the existing one). */
export async function declareCalendarCommand(cfg: PxConfig): Promise<void> {
  if (!cfg.modPath) {
    void vscode.window.showWarningMessage(
      "Paradox Modding Toolkit: no mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder."
    );
    return;
  }
  const names = metaFor(cfg.gameId);
  const existing = readCalendarFile(cfg.modPath, names);
  const file = existing?.file ?? writeCalendarFile(cfg.modPath, names, cfg.calendar ?? EXAMPLE_CALENDAR);
  await vscode.window.showTextDocument(vscode.Uri.file(file));
  if (!existing) {
    void vscode.window.showInformationMessage(
      `Wrote ${path.relative(cfg.modPath, file)}. Set "epoch" to the script year that displays as year 1 ` +
        'and name the era labels; leave "before" out for a single-era calendar. Commit the file with the mod.'
    );
  }
}

export async function insertDateCommand(cfg: PxConfig): Promise<void> {
  const { calendar, problem } = calendarForMod(cfg);
  if (!calendar) {
    await offerToDeclare(cfg, "Insert Date", problem);
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
 * mod's calendar: the era-math datafunction keys plus the
 * `localization/replace/` overrides of the engine's date-format (and, with
 * custom months, month-name) keys. Deterministic filenames, so running it
 * again after a calendar change regenerates in place.
 */
export async function generateCalendarLocCommand(cfg: PxConfig): Promise<void> {
  const { calendar, problem } = calendarForMod(cfg);
  if (!calendar) {
    await offerToDeclare(cfg, "Generate Calendar Localization", problem);
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

  const { files, notes } = generateCalendarLoc(calendar, meta.calendarLoc, cfg.locLanguage);
  const targets = files.map((f) => path.join(cfg.modPath!, ...f.relPath.split("/")));
  const existing = targets.filter((t) => fs.existsSync(t));
  if (existing.length > 0) {
    const regenerate = "Regenerate";
    const pick = await vscode.window.showWarningMessage(
      `Overwrite the generated calendar files (${existing.map((t) => path.basename(t)).join(", ")})?`,
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
