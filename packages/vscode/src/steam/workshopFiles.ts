/**
 * The Workshop listing as files: a `workshop/` folder next to the mod's
 * content folder, the same layout the shared Workshop CI expects, so the
 * listing edits (and diffs) like code:
 *
 *   <workshopDir>/
 *     item.json                    {"title": "...", "publishedfileid": "..."}
 *     description.bbcode           default-language description
 *     <steamlang>/title.txt        localized title (optional)
 *     <steamlang>/description.bbcode
 *     changelog/                   changenote sources (see resolveChangeNote)
 *
 * The folder's location is `px.workshop.dir`, resolved against the mod root
 * (default `../workshop`: the mod's content lives in `<project>/mod`, the
 * listing next to it in `<project>/workshop`). While the folder exists it is
 * the canonical store for the description and the translations; without it
 * everything stays in `<configDir>/workshop.json` as before.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { STEAM_LANGUAGES, type WorkshopTranslation } from "@px-lsp/protocol/workshopMeta";

export const DEFAULT_WORKSHOP_DIR = "../workshop";
export const DEFAULT_CHANGELOG = "changelog";

/** The workshop folder of `root`, from the `px.workshop.dir` setting. */
export function resolveWorkshopDir(root: string, setting: string | undefined): string {
  return path.resolve(root, (setting ?? "").trim() || DEFAULT_WORKSHOP_DIR);
}

/** True when the mod tracks its listing as files (the folder exists). */
export function hasListingFiles(workshopDir: string): boolean {
  try {
    return fs.statSync(workshopDir).isDirectory();
  } catch {
    return false;
  }
}

export interface ListingFiles {
  /** description.bbcode, or null when the file is absent. */
  description: string | null;
  /** Per Steam language code: what the `<lang>/` folder holds. */
  translations: Record<string, WorkshopTranslation>;
}

const read = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** The listing the workshop folder currently holds. */
export function readListingFiles(workshopDir: string): ListingFiles {
  const translations: Record<string, WorkshopTranslation> = {};
  for (const { api } of STEAM_LANGUAGES) {
    const dir = path.join(workshopDir, api);
    const title = read(path.join(dir, "title.txt"));
    const description = read(path.join(dir, "description.bbcode"));
    if (title === null && description === null) continue;
    translations[api] = {
      ...(title !== null ? { title: title.trim() } : {}),
      ...(description !== null ? { description } : {}),
    };
  }
  return { description: read(path.join(workshopDir, "description.bbcode")), translations };
}

/**
 * Write the listing into the workshop folder. A language whose draft field is
 * empty loses that file (empty = "keep the default text", and CI validates
 * whatever exists); a language folder left with nothing is removed.
 */
export function writeListingFiles(
  workshopDir: string,
  listing: { description: string; translations: Record<string, WorkshopTranslation> }
): void {
  fs.mkdirSync(workshopDir, { recursive: true });
  fs.writeFileSync(path.join(workshopDir, "description.bbcode"), listing.description, "utf8");
  for (const { api } of STEAM_LANGUAGES) {
    const t = listing.translations[api];
    const dir = path.join(workshopDir, api);
    const title = (t?.title ?? "").trim();
    const description = t?.description ?? "";
    if (title === "" && description.trim() === "") {
      // Nothing drafted: remove only the two files this store manages.
      for (const f of ["title.txt", "description.bbcode"]) {
        try {
          fs.rmSync(path.join(dir, f));
        } catch {
          /* absent */
        }
      }
      try {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch {
        /* leave a non-empty or locked folder alone */
      }
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    writeOrRemove(path.join(dir, "title.txt"), title === "" ? null : title + "\n");
    writeOrRemove(path.join(dir, "description.bbcode"), description.trim() === "" ? null : description);
  }
}

function writeOrRemove(file: string, content: string | null): void {
  if (content === null) {
    try {
      fs.rmSync(file);
    } catch {
      /* absent */
    }
    return;
  }
  fs.writeFileSync(file, content, "utf8");
}

export interface ItemJson {
  title?: string;
  publishedfileid?: string;
}

/** `<workshopDir>/item.json`, or null when absent/unreadable. */
export function readItemJson(workshopDir: string): ItemJson | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(workshopDir, "item.json"), "utf8")) as unknown;
    return typeof raw === "object" && raw !== null ? (raw as ItemJson) : null;
  } catch {
    return null;
  }
}

/** Merge `patch` into item.json (unknown keys survive) and write it back. */
export function upsertItemJson(workshopDir: string, patch: ItemJson): void {
  const current = (readItemJson(workshopDir) ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) current[key] = value;
  }
  fs.mkdirSync(workshopDir, { recursive: true });
  fs.writeFileSync(path.join(workshopDir, "item.json"), JSON.stringify(current, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Changenotes from the changelog
// ---------------------------------------------------------------------------

export interface ChangeNote {
  text: string;
  /** Where the text came from, for display ("changelog/1.2.md"). */
  source: string;
}

/**
 * The changenote for `version`, from the `px.workshop.changelog` setting
 * (resolved against the workshop folder; default `changelog`):
 *
 * - a FOLDER: the file named after the version (`1.2.md`, `v1.2.bbcode`,
 *   `1.2.txt`), or null when no file matches - never "the newest file",
 *   which would ship the wrong note after a forgotten bump;
 * - a FILE with headlines: the section under the headline containing the
 *   version, or null when no headline matches;
 * - a FILE without headlines: the whole file.
 *
 * Markdown is converted to Steam BBCode; .bbcode/.txt pass through.
 */
export function resolveChangeNote(
  workshopDir: string,
  setting: string | undefined,
  version: string | null
): ChangeNote | null {
  const target = path.resolve(workshopDir, (setting ?? "").trim() || DEFAULT_CHANGELOG);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    if (!version) return null;
    const file = changelogFileForVersion(target, version);
    if (!file) return null;
    const text = read(file);
    if (text === null) return null;
    return { text: finishNote(text, file), source: displaySource(workshopDir, file) };
  }
  const text = read(target);
  if (text === null) return null;
  const section = version ? extractVersionSection(text, version) : null;
  if (section !== null)
    return { text: finishNote(section, target), source: displaySource(workshopDir, target) };
  if (hasHeadlines(text)) return null;
  return { text: finishNote(text, target), source: displaySource(workshopDir, target) };
}

/** `<folder>/<version>.<ext>` with a few spelling liberties, or null. */
function changelogFileForVersion(folder: string, version: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return null;
  }
  const want = version.trim().toLowerCase();
  for (const name of entries) {
    const m = /^(.*)\.(md|bbcode|txt)$/i.exec(name);
    if (!m) continue;
    const base = m[1].toLowerCase();
    if (base === want || base === `v${want}` || base === want.replace(/\./g, "_")) {
      return path.join(folder, name);
    }
  }
  return null;
}

const HEADLINE = /^(?:(#{1,6})\s+(.*)|\[h([1-6])\](.*?)(?:\[\/h\3\])?\s*)$/;

function hasHeadlines(text: string): boolean {
  return text.split(/\r?\n/).some((l) => HEADLINE.test(l.trim()));
}

/**
 * The lines under the first headline containing `version`, up to the next
 * headline of the same or a shallower level (so `### Fixed` stays inside its
 * `## 1.2.0` section). Null when no headline mentions the version.
 */
export function extractVersionSection(text: string, version: string): string | null {
  const lines = text.split(/\r?\n/);
  const level = (m: RegExpExecArray): number => (m[1] ? m[1].length : parseInt(m[3], 10));
  const title = (m: RegExpExecArray): string => (m[1] ? m[2] : m[4]);
  const want = version.trim();
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADLINE.exec(lines[i].trim());
    if (!m) continue;
    if (start < 0) {
      if (title(m).includes(want)) {
        start = i;
        startLevel = level(m);
      }
      continue;
    }
    if (level(m) <= startLevel) return lines.slice(start + 1, i).join("\n");
  }
  return start < 0 ? null : lines.slice(start + 1).join("\n");
}

function finishNote(text: string, file: string): string {
  const note = /\.md$/i.test(file) ? mdToBBCode(text) : text;
  return note.trim();
}

function displaySource(workshopDir: string, file: string): string {
  const rel = path.relative(workshopDir, file);
  return rel.startsWith("..") ? file : rel.replace(/\\/g, "/");
}

/**
 * A modest Markdown -> Steam BBCode conversion for changenotes: headings,
 * emphasis, strikethrough, links, images, lists, hr, fenced code. Inline code
 * loses its backticks (Steam's [code] is a block). Anything else passes
 * through - Steam shows unknown markup as text, never breaks.
 */
export function mdToBBCode(text: string): string {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  let listOpen: "list" | "olist" | null = null;
  let codeOpen = false;
  const closeList = (): void => {
    if (listOpen) out.push(`[/${listOpen}]`);
    listOpen = null;
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      closeList();
      out.push(codeOpen ? "[/code]" : "[code]");
      codeOpen = !codeOpen;
      continue;
    }
    if (codeOpen) {
      out.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = Math.min(h[1].length, 3);
      out.push(`[h${level}]${inlineMd(h[2])}[/h${level}]`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push("[hr][/hr]");
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const kind = li[1] ? "list" : "olist";
      if (listOpen !== kind) {
        closeList();
        out.push(`[${kind}]`);
        listOpen = kind;
      }
      out.push(`[*] ${inlineMd(li[3])}`);
      continue;
    }
    closeList();
    out.push(inlineMd(line));
  }
  closeList();
  if (codeOpen) out.push("[/code]");
  return out.join("\n");
}

function inlineMd(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, "[img]$2[/img]")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "[url=$2]$1[/url]")
    .replace(/\*\*([^*]+)\*\*/g, "[b]$1[/b]")
    .replace(/__([^_]+)__/g, "[b]$1[/b]")
    .replace(/(^|\W)\*([^*\s][^*]*)\*/g, "$1[i]$2[/i]")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1[i]$2[/i]")
    .replace(/~~([^~]+)~~/g, "[strike]$1[/strike]")
    .replace(/`([^`]+)`/g, "$1");
}
