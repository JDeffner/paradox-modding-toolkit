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

export interface CalendarMonth {
  /** Display name ("March", "Narvinye"). */
  name: string;
  /** Day count; the engine has no leap years, so one number per month. */
  days: number;
}

export interface CalendarSetting {
  /** Script year displayed as year 1 of the `after` era (no year zero). */
  epoch: number;
  /** Era label for script years >= epoch ("AD", "TA"...). */
  after: string;
  /** Era label for script years < epoch ("BC"). Omitted = single-era
   * calendar: years before the epoch get no display form. */
  before?: string;
  /** Custom month names and day counts, first month first. Omitted = the
   * standard 12 months (Feb 28: the engine has no leap years). */
  months?: CalendarMonth[];
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const GREGORIAN_MONTHS: CalendarMonth[] = [
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
].map((name, i) => ({ name, days: DAYS[i] }));

export function monthsOf(cal: CalendarSetting): CalendarMonth[] {
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
  if (Array.isArray(o.months) && o.months.length > 0) {
    const months: CalendarMonth[] = [];
    for (const m of o.months) {
      if (typeof m !== "object" || m === null) return undefined;
      const { name, days } = m as Record<string, unknown>;
      if (typeof name !== "string" || name.trim() === "") return undefined;
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 999) return undefined;
      months.push({ name: name.trim(), days });
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

/** Month/day within the calendar's bounds (year just has to be positive). */
export function isValidScriptDate(cal: CalendarSetting, y: number, m: number, d: number): boolean {
  const months = monthsOf(cal);
  return y >= 1 && m >= 1 && m <= months.length && d >= 1 && d <= months[m - 1].days;
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
  if (!isValidScriptDate(cal, y, m, d)) return null;
  const year = displayYear(cal, y);
  if (!year) return null;
  if (m === 1 && d === 1) return year;
  return `${d} ${monthsOf(cal)[m - 1].name} ${year}`;
}

export type ConvertResult = { ok: true; script: string; display: string } | { ok: false; error: string };

/** Case-insensitive month lookup: exact name, else unique prefix. */
function monthByName(cal: CalendarSetting, text: string): number | null {
  const needle = text.toLowerCase();
  const months = monthsOf(cal);
  const exact = months.findIndex((m) => m.name.toLowerCase() === needle);
  if (exact >= 0) return exact + 1;
  const prefixed = months
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.name.toLowerCase().startsWith(needle));
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
  if (!isValidScriptDate(cal, y, m, d)) {
    const months = monthsOf(cal);
    return m >= 1 && m <= months.length
      ? { ok: false, error: `${months[m - 1].name} has ${months[m - 1].days} days` }
      : { ok: false, error: `this calendar has ${months.length} months` };
  }
  return { ok: true, script: `${y}.${m}.${d}`, display: displayDate(cal, y, m, d)! };
}
