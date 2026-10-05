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
import { convertDisplayInput, sanitizeCalendar, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { CALENDAR_FILE, calendarFilePath } from "@px-lsp/protocol/calendarFile";
import { CAL_YEAR_KEY, CAL_ERA_KEY, generateCalendarLoc } from "@px-lsp/protocol/calendarLoc";
import { upsertLocalizationText, type LocalizationDefaults } from "@px-lsp/protocol/localizationPolicy";
import type { PxConfig } from "./config";
import { metaFor } from "./meta";
import { prepareProjectConfigWrite, readProjectConfigText } from "./projectConfigFile";
import {
  assertLocalizationPath,
  effectiveLocConfig,
  localizationDefaultsFile,
  readLocalizationDefaults,
} from "./localizationProject";
import { assertDocumentCurrent, readDocument, writeDocument, type DocumentSnapshot } from "./documentWrite";

/** What `Declare Calendar` writes: valid as is, meant to be edited. */
const EXAMPLE_CALENDAR: CalendarSetting = { epoch: 4000, after: "AD", before: "BC" };

/**
 * The calendar in force for `cfg.modPath`: the mod's own file first, the
 * setting second. `problem` carries the reason an existing file gave no
 * calendar, so the commands can say so instead of silently using the fallback.
 */
export function calendarForMod(cfg: PxConfig): { calendar: CalendarSetting | undefined; problem?: string } {
  if (!cfg.modPath) return { calendar: cfg.calendar };
  let file = path.join(cfg.modPath, metaFor(cfg.gameId).configDirName, CALENDAR_FILE);
  try {
    file = calendarFilePath(cfg.modPath, metaFor(cfg.gameId));
    const text = readProjectConfigText(cfg.modPath, metaFor(cfg.gameId), CALENDAR_FILE);
    if (text === undefined) return { calendar: cfg.calendar };
    const calendar = sanitizeCalendar(JSON.parse(text.replace(/^\uFEFF/, "")));
    if (!calendar) throw new Error("not a usable calendar");
    return { calendar };
  } catch (error) {
    return { calendar: undefined, problem: `${path.relative(cfg.modPath, file)}: ${String(error)}` };
  }
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
  try {
    const names = metaFor(cfg.gameId);
    const prepared = await prepareProjectConfigWrite(cfg.modPath, names, CALENDAR_FILE);
    const file = prepared.text === undefined ? prepared.target : prepared.source;
    if (prepared.text === undefined) {
      await prepared.write(JSON.stringify(cfg.calendar ?? EXAMPLE_CALENDAR, null, 2) + "\n");
      void vscode.window.showInformationMessage(
        `Wrote ${path.relative(cfg.modPath, file)}. Set "epoch" to the script year that displays as year 1 ` +
          'and name the era labels; leave "before" out for a single-era calendar. Commit the file with the mod.'
      );
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not declare calendar: ${String(error)}`);
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
  try {
    cfg = effectiveLocConfig(cfg);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not generate calendar localization: ${String(error)}`);
    return;
  }
  const declared = calendarForMod(cfg);
  let calendar = declared.calendar;
  const problem = declared.problem;
  const sources: DocumentSnapshot[] = [];
  if (cfg.modPath) {
    const declaration = calendarFilePath(cfg.modPath, metaFor(cfg.gameId));
    if (fs.existsSync(declaration)) {
      try {
        const snapshot = await readDocument(declaration);
        sources.push(snapshot);
        calendar = sanitizeCalendar(JSON.parse(snapshot.text.replace(/^\uFEFF/, "")));
        if (!calendar) throw new Error("The calendar declaration is not a usable calendar");
      } catch (error) {
        void vscode.window.showErrorMessage(`Could not generate calendar localization: ${String(error)}`);
        return;
      }
    }
  }
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

  try {
    const defaultsFile = localizationDefaultsFile(cfg);
    if (fs.existsSync(defaultsFile)) sources.push(await readDocument(defaultsFile));
    const { files, notes } = generateCalendarLoc(calendar, meta.calendarLoc, cfg.locLanguage);
    const defaults = readLocalizationDefaults(cfg);
    const stage = meta.stageRoots?.[0];
    const targets = files.map((file) =>
      path.join(cfg.modPath!, ...(stage ? [stage] : []), ...file.relPath.split("/"))
    );
    const targetsBefore: {
      snapshot?: DocumentSnapshot;
      document?: vscode.TextDocument;
      text: string;
      version?: number;
    }[] = [];
    for (const target of targets) {
      assertLocalizationPath(cfg, target, cfg.locLanguage);
      if (fs.existsSync(target)) {
        const snapshot = await readDocument(target);
        targetsBefore.push({ snapshot, text: snapshot.text });
      } else {
        const document = vscode.workspace.textDocuments?.find((doc) => doc.uri.fsPath === target);
        targetsBefore.push({ document, text: document?.getText() ?? "", version: document?.version });
      }
    }
    const existing = targets.filter(
      (_target, index) => targetsBefore[index].snapshot || targetsBefore[index].text
    );
    if (existing.length > 0) {
      const pick = await vscode.window.showWarningMessage(
        `Update the generated calendar entries (${existing.map((target) => path.basename(target)).join(", ")})?`,
        "Regenerate"
      );
      if (pick !== "Regenerate") return;
    }
    // A prompt is an edit boundary: reject every stale input before updating
    // the first file, including the calendar declaration when it exists.
    const assertTargetCurrent = (index: number) => {
      const before = targetsBefore[index];
      if (before.snapshot) assertDocumentCurrent(before.snapshot);
      else if (
        fs.existsSync(targets[index]) ||
        (before.document &&
          (before.document.isClosed ||
            before.document.version !== before.version ||
            before.document.getText() !== before.text))
      ) {
        throw new Error(`${path.basename(targets[index])} changed during the operation. Try again.`);
      }
    };
    for (let i = 0; i < targets.length; i++) assertTargetCurrent(i);
    for (const source of sources) assertDocumentCurrent(source);
    const owned = new Set([
      CAL_YEAR_KEY,
      CAL_ERA_KEY,
      ...Object.keys(meta.calendarLoc.dateFormats),
      ...(meta.calendarLoc.monthKeys ?? []).flat(),
    ]);
    const bodies = files.map((file, index) => {
      const generated = file.content.replace(
        /^([ \t]*[A-Za-z0-9_.\-']+:)0(?=[ \t]*")/gm,
        `$1${defaults.entryVersion === "none" ? "" : "0"}`
      );
      return !targetsBefore[index].snapshot && !targetsBefore[index].text.replace(/^\uFEFF/, "")
        ? generated
        : mergeCalendarEntries(
            targetsBefore[index].text,
            generated,
            owned,
            cfg.locLanguage,
            defaults.entryVersion
          );
    });
    for (let i = 0; i < files.length; i++) {
      assertTargetCurrent(i);
      const snapshot = targetsBefore[i].snapshot ?? (await readDocument(targets[i], true));
      if (
        !targetsBefore[i].snapshot &&
        (snapshot.text !== targetsBefore[i].text || (!snapshot.created && !targetsBefore[i].document))
      ) {
        throw new Error(`${path.basename(targets[i])} changed during the operation. Try again.`);
      }
      await writeDocument(snapshot, bodies[i], true, sources);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(targets[targets.length - 1]));
    void vscode.window.showInformationMessage(
      `Wrote ${targets.map((target) => path.relative(cfg.modPath!, target)).join(" and ")}. ` +
        notes.join(" ")
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not generate calendar localization: ${String(error)}`);
  }
}

/** Replace generated entries while preserving surrounding editor content. */
function mergeCalendarEntries(
  text: string,
  generated: string,
  owned: Set<string>,
  language: string,
  version?: LocalizationDefaults["entryVersion"]
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = lines.find((line) => line.trim() && !line.trimStart().startsWith("#"));
  if (!new RegExp(`^[ \\t]*l_${language}:[ \\t]*(?:#.*)?$`).test(header ?? "")) {
    throw new Error(`Calendar localization needs an l_${language}: header`);
  }
  const entry = /^([ \t]*)([A-Za-z0-9_.\-']+):(\d*)[ \t]*"(.*)"([ \t]*(?:#.*)?)$/;
  const replacements = new Map<string, RegExpExecArray>();
  for (const line of generated.split("\n")) {
    const match = entry.exec(line);
    if (match) replacements.set(match[2], match);
  }
  let merged = lines
    .filter((line) => {
      const match = entry.exec(line);
      return !match || !owned.has(match[2]) || replacements.has(match[2]);
    })
    .join(eol);
  for (const [key, match] of replacements)
    merged = upsertLocalizationText(merged, language, key, match[4], version);
  return merged;
}
