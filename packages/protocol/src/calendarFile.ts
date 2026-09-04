/**
 * The per-mod calendar declaration: `<mod>/.px-toolkit/calendar.json`, the
 * JSON form of calendar.ts `CalendarSetting`. A display calendar is a fact
 * about the mod, so it travels with the mod (committed, one per mod, read by
 * every client and by the server itself) instead of living in one editor's
 * window-scoped `px.calendar` setting. The setting stays as the fallback for
 * a mod without the file.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { sanitizeCalendar, type CalendarSetting } from "./calendar";
import { migrateConfigDir, resolveConfigDir, type ConfigDirNames } from "./configDir";

export const CALENDAR_FILE = "calendar.json";

export interface CalendarFile {
  /** Where the declaration was read from (or would be written to). */
  file: string;
  /** The declared calendar, when the file parses and sanitizes. */
  calendar?: CalendarSetting;
  /** Why an existing file yields no calendar: unparsable JSON or an unusable shape. */
  error?: string;
}

/** The path the file is read from: the mod's config dir (legacy name included). */
export function calendarFilePath(modRoot: string, names: ConfigDirNames): string {
  return path.join(resolveConfigDir(modRoot, names), CALENDAR_FILE);
}

/**
 * Read `<mod>/.px-toolkit/calendar.json`. Null when the file does not exist;
 * a `CalendarFile` without `calendar` when it exists but is not usable, so a
 * client can say so instead of silently showing no dates.
 */
export function readCalendarFile(modRoot: string, names: ConfigDirNames): CalendarFile | null {
  const file = calendarFilePath(modRoot, names);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    return { file, error: `not valid JSON (${(err as Error).message})` };
  }
  const calendar = sanitizeCalendar(raw);
  if (!calendar) {
    return {
      file,
      error:
        'not a usable calendar: needs a whole-number "epoch" (1 or more), a non-empty "after" era label, ' +
        'a "before" label different from "after" when present, and distinct "months" with 1 to 999 days each',
    };
  }
  return { file, calendar };
}

/**
 * Write the declaration into the mod (renaming a legacy config dir first,
 * like every other config-dir write). Returns the file path.
 */
export function writeCalendarFile(modRoot: string, names: ConfigDirNames, cal: CalendarSetting): string {
  const dir = migrateConfigDir(modRoot, names);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CALENDAR_FILE);
  fs.writeFileSync(file, JSON.stringify(cal, null, 2) + "\n", "utf8");
  return file;
}

/** True when `fsPath` is a calendar declaration file (any config dir name). */
export function isCalendarFile(fsPath: string, names: ConfigDirNames): boolean {
  const parts = fsPath.split(/[\\/]/);
  if (parts.length < 2 || parts[parts.length - 1].toLowerCase() !== CALENDAR_FILE) return false;
  const dir = parts[parts.length - 2].toLowerCase();
  return dir === names.configDirName.toLowerCase() || dir === names.legacyConfigDirName?.toLowerCase();
}
