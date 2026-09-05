/**
 * Custom calendar display: total-conversion mods (AGoT, LotR, Hegemonia...)
 * keep script dates on the engine's single increasing year axis but *display*
 * them on their own era system, e.g. epoch 4000 means script year 3000 shows
 * as "1000 BC" and 4000 as "1 AD". The mapping cannot be detected from mod
 * files, so the mod declares it once in `px.calendar` (workspace settings,
 * committed with the mod).
 *
 * Pure logic, no `vscode` imports: shared by the language server (inlay hints,
 * hover) and the extension (the Insert Date command), unit-tested in plain
 * Node.
 */

export interface CalendarSetting {
  /** Script year displayed as year 1 of the `after` era (no year zero). */
  epoch: number;
  /** Era label for script years >= epoch ("AD", "TA"...). */
  after: string;
  /** Era label for script years < epoch ("BC"). Omitted = single-era
   * calendar: years before the epoch get no display form. */
  before?: string;
  /**
   * The engine's twelve months under the mod's own names, first month first.
   * Omitted = January to December. Only the NAMES are the mod's: the game has
   * twelve months of fixed length (31 28 31 30 31 30 31 31 30 31 30 31, no
   * leap years) and no script can change that, so a date's month and day are
   * always the engine's and only read differently.
   */
  months?: string[];
}

/** Days per engine month; what a script date's day is bounded by. */
export const ENGINE_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const GREGORIAN_MONTHS: string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The month names a date reads with: the mod's twelve, or the engine's. */
export function monthNames(cal: CalendarSetting): string[] {
  return cal.months ?? GREGORIAN_MONTHS;
}

/**
 * Validate a calendar straight out of JSON settings (any client, any hand-
 * edited settings file). Returns a clean copy, or undefined when the value is
 * not a usable calendar - features then behave as if none was configured.
 */
export function sanitizeCalendar(raw: unknown): CalendarSetting | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const epoch = o.epoch;
  const after = o.after;
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 1) return undefined;
  if (typeof after !== "string" || after.trim() === "") return undefined;
  const cal: CalendarSetting = { epoch, after: after.trim() };
  if (typeof o.before === "string" && o.before.trim() !== "") cal.before = o.before.trim();
  // Typed input picks the era by its label and the month by its name, so a
  // collision would resolve silently to the wrong one: not a usable calendar.
  if (cal.before && cal.before.toLowerCase() === cal.after.toLowerCase()) return undefined;
  if (Array.isArray(o.months) && o.months.length > 0) {
    // Exactly the engine's twelve. A name may still arrive as the older
    // `{ name, days }` object; its day count never meant anything to the
    // game and is dropped.
    if (o.months.length !== GREGORIAN_MONTHS.length) return undefined;
    const months: string[] = [];
    const seen = new Set<string>();
    for (const m of o.months) {
      const name = typeof m === "string" ? m : ((m as Record<string, unknown> | null)?.name ?? null);
      if (typeof name !== "string" || name.trim() === "") return undefined;
      const key = name.trim().toLowerCase();
      if (seen.has(key)) return undefined;
      seen.add(key);
      months.push(name.trim());
    }
    cal.months = months;
  }
  return cal;
}

/** A script-file date token (`3000.1.1`), or null when the text is not one. */
export function parseScriptDate(text: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{1,5})\.(\d{1,2})\.(\d{1,2})$/.exec(text);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** A date the engine reads: a positive year, one of its twelve months, a day that month has. */
export function isValidScriptDate(y: number, m: number, d: number): boolean {
  return y >= 1 && m >= 1 && m <= ENGINE_MONTH_DAYS.length && d >= 1 && d <= ENGINE_MONTH_DAYS[m - 1];
}

/** Era-mapped year: "1000 BC". Null for pre-epoch years of a single-era calendar. */
export function displayYear(cal: CalendarSetting, y: number): string | null {
  if (y >= cal.epoch) return `${y - cal.epoch + 1} ${cal.after}`;
  return cal.before ? `${cal.epoch - y} ${cal.before}` : null;
}

/**
 * Full display form of a script date: "1000 BC" for the year's first day
 * (how start dates read in game), "15 March 1000 BC" otherwise. Null when the
 * date does not fit the calendar.
 */
export function displayDate(cal: CalendarSetting, y: number, m: number, d: number): string | null {
  if (!isValidScriptDate(y, m, d)) return null;
  const year = displayYear(cal, y);
  if (!year) return null;
  if (m === 1 && d === 1) return year;
  return `${d} ${monthNames(cal)[m - 1]} ${year}`;
}

export type ConvertResult = { ok: true; script: string; display: string } | { ok: false; error: string };

/** Case-insensitive month lookup: exact name, else unique prefix. */
function monthByName(cal: CalendarSetting, text: string): number | null {
  const needle = text.toLowerCase();
  const months = monthNames(cal);
  const exact = months.findIndex((m) => m.toLowerCase() === needle);
  if (exact >= 0) return exact + 1;
  const prefixed = months.map((m, i) => ({ m, i })).filter(({ m }) => m.toLowerCase().startsWith(needle));
  return prefixed.length === 1 ? prefixed[0].i + 1 : null;
}

/**
 * A display-calendar date typed by the user -> the script date the file needs.
 * Grammar: `YEAR [ERA] [MONTH [DAY]]`, e.g. "1000 BC", "1000 BC March 15",
 * "1000 BC 3 15", "1 AD", "500" (era defaults to `after`). MONTH is a number
 * or a month name (unique prefix is enough).
 */
export function convertDisplayInput(cal: CalendarSetting, input: string): ConvertResult {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { ok: false, error: "type a year, e.g. 1000 " + (cal.before ?? cal.after) };
  if (!/^\d{1,5}$/.test(words[0])) return { ok: false, error: `"${words[0]}" is not a year` };
  const year = Number(words[0]);
  let rest = words.slice(1);

  let era = cal.after;
  if (rest.length > 0) {
    const w = rest[0].toLowerCase();
    if (w === cal.after.toLowerCase()) {
      rest = rest.slice(1);
    } else if (cal.before && w === cal.before.toLowerCase()) {
      era = cal.before;
      rest = rest.slice(1);
    }
  }

  let m = 1;
  let d = 1;
  if (rest.length > 0) {
    const month = /^\d{1,2}$/.test(rest[0]) ? Number(rest[0]) : monthByName(cal, rest[0]);
    if (month === null) return { ok: false, error: `"${rest[0]}" is not a month of this calendar` };
    m = month;
    rest = rest.slice(1);
  }
  if (rest.length > 0) {
    if (!/^\d{1,3}$/.test(rest[0])) return { ok: false, error: `"${rest[0]}" is not a day` };
    d = Number(rest[0]);
    rest = rest.slice(1);
  }
  if (rest.length > 0) return { ok: false, error: `unexpected "${rest.join(" ")}"` };

  if (year < 1) return { ok: false, error: "years start at 1 (no year zero)" };
  const y = era === cal.after ? year + cal.epoch - 1 : cal.epoch - year;
  if (y < 1) return { ok: false, error: `${year} ${era} is before script year 1 (epoch ${cal.epoch})` };
  if (!isValidScriptDate(y, m, d)) {
    return m >= 1 && m <= ENGINE_MONTH_DAYS.length
      ? { ok: false, error: `${monthNames(cal)[m - 1]} has ${ENGINE_MONTH_DAYS[m - 1]} days` }
      : { ok: false, error: `the game has ${ENGINE_MONTH_DAYS.length} months` };
  }
  return { ok: true, script: `${y}.${m}.${d}`, display: displayDate(cal, y, m, d)! };
}
