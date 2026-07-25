/**
 * Pure logic for the translation scaffolding workflow: mirror the structure of
 * an existing localization (usually english) into a new language so a
 * translator only has to replace values.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import * as path from "path";

export const LOC_LANGUAGES = [
  "english",
  "french",
  "german",
  "spanish",
  "russian",
  "korean",
  "simp_chinese",
  "japanese",
  "polish",
];

const BOM = "﻿";
const HEADER = /^(\s*)l_([a-z_]+):/m;
const ENTRY = /^\s*([A-Za-z0-9_.\-']+):\d*\s*"/;

/** Language of a loc file, from its `_l_<lang>.yml` suffix or a path segment. */
export function detectLocFileLanguage(filePath: string): string | null {
  const m = /_l_([a-z_]+)\.ya?ml$/i.exec(filePath);
  if (m) return m[1].toLowerCase();
  const segments = filePath.toLowerCase().split(/[\\/]/);
  for (const lang of LOC_LANGUAGES) {
    if (segments.includes(lang)) return lang;
  }
  return null;
}

/**
 * Where the translated counterpart of `srcFile` lives: language path segments
 * and the `_l_<lang>` filename marker are retargeted. Returns null when the
 * path carries no language marker at all.
 */
export function retargetLocPath(srcFile: string, sourceLang: string, targetLang: string): string | null {
  const parts = srcFile.split(/([\\/])/); // keep separators
  let changed = false;
  const out = parts.map((p) => {
    if (p.toLowerCase() === sourceLang) {
      changed = true;
      return targetLang;
    }
    return p;
  });
  let result = out.join("");
  const marker = new RegExp(`_l_${sourceLang}(\\.ya?ml)$`, "i");
  if (marker.test(path.basename(result))) {
    result = result.replace(marker, `_l_${targetLang}$1`);
    changed = true;
  }
  return changed ? result : null;
}

const ENTRY_LINE = /^(\s*[A-Za-z0-9_.\-']+:\d*\s*)"(.*)"\s*$/;

/** Blank an entry's value, keeping the source text visible as a comment. */
function blankEntry(line: string, sourceLang: string): string {
  const m = ENTRY_LINE.exec(line);
  if (!m || m[2] === "") return line;
  return `${m[1]}"" # ${sourceLang}: ${m[2]}`;
}

/**
 * A translation skeleton: the source file's structure (comments and blank
 * lines preserved — they are context for the translator) with the language
 * header switched and every value BLANKED; the source text stays visible as
 * an inline `# english: …` comment so the translator sees it right there
 * without it leaking into the game as a fake translation.
 */
export function buildTranslation(sourceContent: string, targetLang: string, sourceLang = "english"): string {
  const hadBom = sourceContent.startsWith(BOM);
  let body = hadBom ? sourceContent.slice(1) : sourceContent;
  if (HEADER.test(body)) {
    body = body.replace(HEADER, `$1l_${targetLang}:`);
  } else {
    body = `l_${targetLang}:\n` + body;
  }
  body = body
    .split(/\r?\n/)
    .map((l) => blankEntry(l, sourceLang))
    .join("\n");
  return BOM + body;
}

export interface MergeResult {
  content: string;
  added: number;
}

/**
 * Add entries that exist in the source but not yet in the target, appended at
 * the end under a marker comment. Existing target lines are never touched.
 */
export function mergeTranslation(
  targetContent: string,
  sourceContent: string,
  sourceLang: string
): MergeResult {
  const hadBom = targetContent.startsWith(BOM);
  const target = hadBom ? targetContent.slice(1) : targetContent;
  const eol = target.includes("\r\n") ? "\r\n" : "\n";

  const existing = new Set<string>();
  for (const line of target.split(/\r?\n/)) {
    const m = ENTRY.exec(line);
    if (m) existing.add(m[1]);
  }

  const missing: string[] = [];
  for (const line of sourceContent.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = ENTRY.exec(line);
    if (m && !existing.has(m[1])) {
      missing.push(blankEntry(line.replace(/\r$/, ""), sourceLang));
      existing.add(m[1]);
    }
  }
  if (missing.length === 0) return { content: targetContent, added: 0 };

  const lines = target.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push(
    "",
    ` # --- entries missing from this language; ${sourceLang} text in the comments ---`,
    ...missing,
    ""
  );
  return { content: (hadBom ? BOM : "") + lines.join(eol), added: missing.length };
}
