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
import { canonicalConfigPath, resolveConfigPath, type ConfigDirNames } from "./configDir";

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
  return resolveConfigPath(modRoot, names, CALENDAR_FILE);
}

/**
 * Read `<mod>/.px-toolkit/calendar.json`. Null when the file does not exist;
 * a `CalendarFile` without `calendar` when it exists but is not usable, so a
 * client can say so instead of silently showing no dates.
 */
export function readCalendarFile(modRoot: string, names: ConfigDirNames): CalendarFile | null {
  let file: string;
  try {
    file = calendarFilePath(modRoot, names);
  } catch (error) {
    return {
      file: path.join(modRoot, names.configDirName, CALENDAR_FILE),
      error: `not readable (${(error as Error).message})`,
    };
  }
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { file, error: `not readable (${(error as Error).message})` };
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
        'a "before" label different from "after" when present, and, when "months" is given, exactly twelve distinct names',
    };
  }
  return { file, calendar };
}

/** Write the current artifact, preserving extensions and leaving the legacy source in place. */
export function writeCalendarFile(modRoot: string, names: ConfigDirNames, cal: CalendarSetting): string {
  if (!sanitizeCalendar(cal)) throw new Error("Not a usable calendar");
  const source = calendarFilePath(modRoot, names);
  const file = canonicalConfigPath(modRoot, names, CALENDAR_FILE);
  let current: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(source, "utf8").replace(/^\uFEFF/, ""));
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !sanitizeCalendar(raw))
      throw new Error("Existing calendar declaration is not usable");
    current = raw as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const key of ["epoch", "after", "before", "months"] as const) delete current[key];
  const content = JSON.stringify({ ...current, ...cal }, null, 2) + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, {
    encoding: "utf8",
    flag: source === file && fs.existsSync(file) ? "w" : "wx",
  });
  return file;
}

/** True when `fsPath` is a calendar declaration file (any config dir name). */
export function isCalendarFile(fsPath: string, names: ConfigDirNames): boolean {
  const parts = fsPath.split(/[\\/]/);
  if (parts.length < 2 || parts[parts.length - 1].toLowerCase() !== CALENDAR_FILE) return false;
  const dir = parts[parts.length - 2].toLowerCase();
  return dir === names.configDirName.toLowerCase() || dir === names.legacyConfigDirName?.toLowerCase();
}
