/**
 * Detects a px.calendar that the user declared where VS Code will never read
 * it: a mod's (or mod project's) own `.vscode/settings.json` while the OPENED
 * folder is a parent (mod-projects layout). px.calendar is window-scoped, so
 * such a file is silently ignored and every calendar feature does nothing.
 * This module only finds the stray file; the notification lives in
 * extension.ts. No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { sanitizeCalendar, type CalendarSetting } from "@px-lsp/protocol/calendar";
import { readCalendarFile } from "@px-lsp/protocol/calendarFile";
import type { ConfigDirNames } from "@px-lsp/protocol/configDir";

export interface StrayCalendar {
  /** The ignored settings file that declares px.calendar. */
  file: string;
  /** The mod the declaration belongs to: where `.px-toolkit/calendar.json` would go. */
  modRoot: string;
  /** The declared calendar, when it parses and sanitizes; undefined when the
   * declaration is present but not usable (still worth telling the user). */
  calendar: CalendarSetting | undefined;
}

/**
 * settings.json is JSONC: line and block comments plus trailing commas are
 * legal. Reduce to strict JSON. String state is tracked so `//` inside a
 * value (a URL) survives.
 */
export function jsoncToJson(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += ch;
    }
  }
  // Trailing commas before a closing brace/bracket.
  return out.replace(/,\s*([}\]])/g, "$1");
}

/** The px.calendar value of one settings file, or null when absent/unreadable. */
function calendarDeclaredIn(file: string): Omit<StrayCalendar, "modRoot"> | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (!text.includes('"px.calendar"')) return null;
  let raw: unknown;
  try {
    raw = (JSON.parse(jsoncToJson(text)) as Record<string, unknown>)["px.calendar"];
  } catch {
    // Present but the file does not parse: still a stray declaration.
    return { file, calendar: undefined };
  }
  if (raw === undefined || raw === null) return null;
  return { file, calendar: sanitizeCalendar(raw) };
}

/**
 * The first ignored `.vscode/settings.json` declaring px.calendar, looking at
 * each mod root and its parent (the mod-project folder in the projects
 * layout). Files under an effective root (an opened workspace folder, whose
 * settings VS Code does read) are skipped: a calendar there is not stray,
 * just absent or invalid, and other messages own that case. A mod that already
 * declares its calendar in its own `.px-toolkit/calendar.json` is skipped too:
 * that file is read wherever the mod is opened, so nothing is stray there.
 */
export function findStrayCalendar(
  modRoots: string[],
  effectiveRoots: string[],
  names?: ConfigDirNames
): StrayCalendar | null {
  const effective = new Set(effectiveRoots.map((r) => path.resolve(r).toLowerCase()));
  const seen = new Set<string>();
  for (const root of modRoots) {
    const resolved = path.resolve(root);
    if (names && readCalendarFile(resolved, names)?.calendar) continue;
    for (const dir of [resolved, path.dirname(resolved)]) {
      const key = dir.toLowerCase();
      if (seen.has(key) || effective.has(key)) continue;
      seen.add(key);
      const hit = calendarDeclaredIn(path.join(dir, ".vscode", "settings.json"));
      if (hit) return { ...hit, modRoot: resolved };
    }
  }
  return null;
}
