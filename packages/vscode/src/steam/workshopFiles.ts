/**
 * The Workshop listing as files: a `workshop/` folder next to the mod's
 * content folder, the same layout the shared Workshop CI expects, so the
 * listing edits (and diffs) like code:
 *
 *   <workshopDir>/
 *     item.json                    {"title": "...", "publishedfileid": "..."}
 *     description.md               default-language description
 *     translations/<steamlang>/title.txt        localized title (optional)
 *     translations/<steamlang>/description.md
 *     previews/                    extra preview images, videos.txt, order.txt
 *     dependencies.json            required DLC and items
 *     changelog/                   changenote sources (see resolveChangeNote)
 *
 * Listings written before 0.4.0 keep `<steamlang>/` at the root; reads fall
 * back to it and the next write moves the language into `translations/`.
 * Descriptions are Markdown; a folder that already keeps `description.bbcode`
 * stays on BBCode (see `descriptionFile`). Steam is sent BBCode either way.
 *
 * The folder's location is `px.workshop.dir`, resolved against the mod root.
 * Empty (the default) means `<configDir>/workshop` inside the mod, which a
 * toolkit upload leaves out (see pxignore.ts); a mod-projects layout with a
 * `workshop` folder next to the mod (`<project>/mod` + `<project>/workshop`)
 * keeps using that. The folder is the canonical store for the description
 * and the translations; `workshop.json` keeps only ids and pre-0.4.0 drafts.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { STEAM_LANGUAGES, type WorkshopTranslation } from "@px-lsp/protocol/workshopMeta";
import { markdownToBBCode } from "./bbcodeMarkdown";

export const SIBLING_WORKSHOP_DIR = "../workshop";
export const DEFAULT_CHANGELOG = "changelog";
export const TRANSLATIONS_DIR = "translations";

export const DESCRIPTION_MD = "description.md";
export const DESCRIPTION_BBCODE = "description.bbcode";

/**
 * The description file of one folder, and whether it is Markdown.
 *
 * `.md` wins when both exist; a folder with neither gets `.md`, so new
 * listings are Markdown and a modder who already keeps `.bbcode` is never
 * migrated behind their back. Reads and writes both go through this, so the
 * choice cannot drift between them.
 */
export function descriptionFile(dir: string): { file: string; markdown: boolean } {
  const md = path.join(dir, DESCRIPTION_MD);
  if (fs.existsSync(md)) return { file: md, markdown: true };
  const bb = path.join(dir, DESCRIPTION_BBCODE);
  if (fs.existsSync(bb)) return { file: bb, markdown: false };
  return { file: md, markdown: true };
}

/** Where one language's files live: `translations/<lang>/`. */
export function langDir(workshopDir: string, api: string): string {
  return path.join(workshopDir, TRANSLATIONS_DIR, api);
}

/**
 * The workshop folder of `root`: the `px.workshop.dir` setting when set, else
 * the existing `../workshop` sibling, else `<configDir>/workshop`.
 */
export function resolveWorkshopDir(root: string, setting: string | undefined, configDir: string): string {
  const explicit = (setting ?? "").trim();
  if (explicit) return path.resolve(root, explicit);
  const sibling = path.resolve(root, SIBLING_WORKSHOP_DIR);
  return hasListingFiles(sibling) ? sibling : path.join(configDir, "workshop");
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
  /** The default description, or null when the file is absent. */
  description: string | null;
  /** Per Steam language code: what the `<lang>/` folder holds. */
  translations: Record<string, WorkshopTranslation>;
  /**
   * Which descriptions came from a `.md` file: `""` for the default one,
   * else the Steam language code. They convert to BBCode on upload and in
   * the panel's preview; on disk they stay what the modder edits.
   */
  markdown: string[];
}

/** The `markdown` key of the default description. */
export const DEFAULT_LANGUAGE = "";

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
  const markdown: string[] = [];
  for (const { api } of STEAM_LANGUAGES) {
    let dir = langDir(workshopDir, api);
    let chosen = descriptionFile(dir);
    let title = read(path.join(dir, "title.txt"));
    let description = read(chosen.file);
    if (title === null && description === null) {
      // Pre-0.4.0 layout: the language folder sits at the root.
      dir = path.join(workshopDir, api);
      chosen = descriptionFile(dir);
      title = read(path.join(dir, "title.txt"));
      description = read(chosen.file);
      if (title === null && description === null) continue;
    }
    if (chosen.markdown) markdown.push(api);
    translations[api] = {
      ...(title !== null ? { title: title.trim() } : {}),
      ...(description !== null ? { description } : {}),
    };
  }
  const chosen = descriptionFile(workshopDir);
  const description = read(chosen.file);
  // The format is the folder's, not the file's: an empty folder is already
  // Markdown, because that is what the next write creates.
  if (chosen.markdown) markdown.push(DEFAULT_LANGUAGE);
  return { description, translations, markdown };
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
  fs.writeFileSync(descriptionFile(workshopDir).file, listing.description, "utf8");
  for (const { api } of STEAM_LANGUAGES) {
    const t = listing.translations[api];
    const dir = langDir(workshopDir, api);
    // The pre-0.4.0 root folder is always cleared: its text now lives under translations/.
    removeLangFiles(path.join(workshopDir, api));
    const title = (t?.title ?? "").trim();
    const description = t?.description ?? "";
    if (title === "" && description.trim() === "") {
      removeLangFiles(dir);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    writeOrRemove(path.join(dir, "title.txt"), title === "" ? null : title + "\n");
    writeOrRemove(descriptionFile(dir).file, description.trim() === "" ? null : description);
  }
}

/** Remove only the two files this store manages, and the folder once it is empty. */
function removeLangFiles(dir: string): void {
  for (const f of ["title.txt", DESCRIPTION_BBCODE, DESCRIPTION_MD]) {
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
  tags?: string[];
  visibility?: number;
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

/**
 * Move the listing folder from one location to the other (project layout
 * `<project>/workshop` <-> in-mod `<configDir>/workshop`). A missing source
 * folder is not an error: the listing then gets created at the target from
 * `drafts` (what workshop.json still holds), so nothing is lost either way.
 * Refuses to overwrite an existing target.
 */
export function moveListing(
  from: string,
  to: string,
  drafts: { description: string; translations: Record<string, WorkshopTranslation> }
): void {
  if (hasListingFiles(to)) throw new Error(`a listing folder already exists at ${to}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!hasListingFiles(from)) {
    writeListingFiles(to, drafts);
    return;
  }
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Extra previews and dependencies
// ---------------------------------------------------------------------------

export const PREVIEWS_DIR = "previews";
export const VIDEOS_FILE = "videos.txt";
/** One file name per line: the gallery order. Files not listed follow, by name. */
export const ORDER_FILE = "order.txt";
export const DEPENDENCIES_FILE = "dependencies.json";
const PREVIEW_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif"]);

export interface Previews {
  /** Absolute image paths, in file-name order: the order of Steam's gallery. */
  images: string[];
  /** YouTube video ids, one per line of videos.txt. */
  videos: string[];
}

/**
 * `<workshopDir>/previews/`: the item's extra preview images plus
 * `videos.txt`. Null when the folder does not exist, which means the toolkit
 * leaves the item's gallery on Steam alone.
 */
export function readPreviews(workshopDir: string): Previews | null {
  const dir = path.join(workshopDir, PREVIEWS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const byName = names
    .filter((n) => PREVIEW_EXTS.has(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const order = readLines(path.join(dir, ORDER_FILE)).filter((n) => byName.includes(n));
  const images = [...order, ...byName.filter((n) => !order.includes(n))].map((n) => path.join(dir, n));
  return { images, videos: readLines(path.join(dir, VIDEOS_FILE)) };
}

/** Non-empty, non-comment lines of a text file; none when it is absent. */
function readLines(file: string): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function writePreviewOrder(workshopDir: string, names: string[]): void {
  const dir = path.join(workshopDir, PREVIEWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ORDER_FILE), names.join("\n") + "\n", "utf8");
}

export function writeVideos(workshopDir: string, ids: string[]): void {
  const dir = path.join(workshopDir, PREVIEWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, VIDEOS_FILE);
  if (ids.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.writeFileSync(file, ids.join("\n") + "\n", "utf8");
}

export interface Dependencies {
  /** Required DLC, as Steam app ids. */
  apps: number[];
  /** Required Workshop items, as decimal id strings. */
  items: string[];
}

/** `<workshopDir>/dependencies.json`, or null when absent (Steam's are then left alone). */
export function readDependencies(workshopDir: string): Dependencies | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(workshopDir, DEPENDENCIES_FILE), "utf8")) as {
      apps?: unknown;
      items?: unknown;
    };
    return {
      apps: Array.isArray(raw.apps) ? raw.apps.filter((a): a is number => Number.isInteger(a)) : [],
      items: Array.isArray(raw.items)
        ? raw.items.filter((i): i is string => typeof i === "string" && /^\d+$/.test(i))
        : [],
    };
  } catch {
    return null;
  }
}

export function writeDependencies(workshopDir: string, deps: Dependencies): void {
  fs.mkdirSync(workshopDir, { recursive: true });
  fs.writeFileSync(path.join(workshopDir, DEPENDENCIES_FILE), JSON.stringify(deps, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Changenotes from the changelog
// ---------------------------------------------------------------------------

/** A changelog the mod already has, offered as the `px.workshop.changelog` source. */
export interface ChangelogCandidate {
  /** Absolute path of the file or folder. */
  path: string;
  kind: "file" | "folder";
  /** True when `px.workshop.changelog` already resolves to it. */
  current: boolean;
}

/** The names a hand-kept changelog goes by, in the order they are preferred. */
const CHANGELOG_NAMES = ["changelog", "changelogs", "CHANGELOG.md", "CHANGELOG.txt"];

/**
 * Changelogs the mod already has: most mods keep none, and the ones that do
 * keep it at the mod root (`CHANGELOG.md`) rather than where the default
 * setting looks. Searched in the workshop folder first, then the mod root;
 * name matching is case-insensitive, since `changelog.md` and `CHANGELOG.md`
 * are the same file on Windows and different ones on Linux.
 */
export function changelogCandidates(
  modRoot: string,
  workshopDir: string,
  resolved: string
): ChangelogCandidate[] {
  const key = (p: string): string => path.resolve(p).toLowerCase();
  const resolvedKey = key(resolved);
  const out: ChangelogCandidate[] = [];
  const seen = new Set<string>();
  for (const dir of [workshopDir, modRoot]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const want of CHANGELOG_NAMES) {
      for (const e of entries) {
        if (e.name.toLowerCase() !== want.toLowerCase()) continue;
        const full = path.join(dir, e.name);
        if (seen.has(key(full))) continue;
        seen.add(key(full));
        out.push({
          path: full,
          kind: e.isDirectory() ? "folder" : "file",
          current: key(full) === resolvedKey,
        });
      }
    }
  }
  return out;
}

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
  const note = /\.md$/i.test(file) ? markdownToBBCode(text) : text;
  return note.trim();
}

function displaySource(workshopDir: string, file: string): string {
  const rel = path.relative(workshopDir, file);
  return rel.startsWith("..") ? file : rel.replace(/\\/g, "/");
}
