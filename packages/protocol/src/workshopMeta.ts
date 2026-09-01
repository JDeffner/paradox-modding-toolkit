/**
 * The mod's local Workshop record: `<mod>/<configDir>/workshop.json`. It holds
 * what the game's own descriptor has no field for - the item's description and
 * its per-language translations (title + description shown to Workshop
 * visitors browsing Steam in that language), plus the published id for the
 * `.metadata` games (launcher-`.mod` games keep the id in `remote_file_id`).
 *
 * The local file is the canonical copy once the user manages the item from the
 * toolkit: uploads read from here, and "fetch" pulls the live values down into
 * it. Reads and writes are merge-preserving: keys this version does not know
 * survive a round trip.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";

/** Title/description pair of one Workshop language. Absent field = not translated. */
export interface WorkshopTranslation {
  title?: string;
  description?: string;
}

/** The fields of `workshop.json` this toolkit reads or writes. */
export interface WorkshopMeta {
  /** Workshop item id (decimal string), for the games whose descriptor has no field for it. */
  publishedFileId?: string;
  /** The item's description in the default language, BBCode as Steam renders it. */
  description?: string;
  /** Keyed by Steam API language code (`german`, `schinese`, ...), never the default language. */
  translations?: Record<string, WorkshopTranslation>;
}

/** Mod-root-relative path of the record, forward slashes. */
export function workshopMetaRelPath(configDirName: string): string {
  return `${configDirName}/workshop.json`;
}

/** The parsed `<dir>/<configDir>/workshop.json`, or null when absent/unreadable. */
export function readWorkshopMeta(dir: string, configDirName: string): WorkshopMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, configDirName, "workshop.json"), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof raw !== "object" || raw === null) return null;
    return raw as WorkshopMeta;
  } catch {
    return null;
  }
}

/**
 * Merge `patch` into the record and write it back. Unknown keys of the file
 * survive; a patch key set to `undefined` is left as it was. `translations`
 * replaces as a whole (the caller edits the full map).
 */
export function upsertWorkshopMeta(dir: string, configDirName: string, patch: WorkshopMeta): void {
  const file = path.join(dir, configDirName, "workshop.json");
  const current = (readWorkshopMeta(dir, configDirName) ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) current[key] = value;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + "\n", "utf8");
}

/**
 * The languages the Workshop accepts item text in: Steam's API language codes
 * with their English names, in Steam's documented order.
 * https://partner.steamgames.com/doc/store/localization/languages
 */
export const STEAM_LANGUAGES: readonly { api: string; label: string }[] = [
  { api: "arabic", label: "Arabic" },
  { api: "bulgarian", label: "Bulgarian" },
  { api: "schinese", label: "Chinese (Simplified)" },
  { api: "tchinese", label: "Chinese (Traditional)" },
  { api: "czech", label: "Czech" },
  { api: "danish", label: "Danish" },
  { api: "dutch", label: "Dutch" },
  { api: "english", label: "English" },
  { api: "finnish", label: "Finnish" },
  { api: "french", label: "French" },
  { api: "german", label: "German" },
  { api: "greek", label: "Greek" },
  { api: "hungarian", label: "Hungarian" },
  { api: "indonesian", label: "Indonesian" },
  { api: "italian", label: "Italian" },
  { api: "japanese", label: "Japanese" },
  { api: "koreana", label: "Korean" },
  { api: "norwegian", label: "Norwegian" },
  { api: "polish", label: "Polish" },
  { api: "portuguese", label: "Portuguese" },
  { api: "brazilian", label: "Portuguese (Brazil)" },
  { api: "romanian", label: "Romanian" },
  { api: "russian", label: "Russian" },
  { api: "spanish", label: "Spanish (Spain)" },
  { api: "latam", label: "Spanish (Latin America)" },
  { api: "swedish", label: "Swedish" },
  { api: "thai", label: "Thai" },
  { api: "turkish", label: "Turkish" },
  { api: "ukrainian", label: "Ukrainian" },
  { api: "vietnamese", label: "Vietnamese" },
];

/** English name of a Steam API language code; the code itself when unknown. */
export function steamLanguageLabel(api: string): string {
  return STEAM_LANGUAGES.find((l) => l.api === api)?.label ?? api;
}

/**
 * Steam API language code for a Paradox localization folder language
 * (`translationCore.ts` LOC_LANGUAGES), or null when Steam has no counterpart.
 * The two vocabularies differ where Steam's codes predate its own store pages
 * (`koreana`, `schinese`).
 */
export function steamLanguageForLoc(locLanguage: string): string | null {
  const map: Record<string, string> = {
    english: "english",
    french: "french",
    german: "german",
    spanish: "spanish",
    russian: "russian",
    korean: "koreana",
    simp_chinese: "schinese",
    japanese: "japanese",
    polish: "polish",
    braz_por: "brazilian",
    turkish: "turkish",
  };
  return map[locLanguage] ?? null;
}
