import * as fs from "node:fs";
import * as path from "node:path";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH } from "@px-lsp/protocol/descriptorMetadata";
import type { PublishInfo } from "./workshop";
import { markdownToBBCode } from "./bbcodeMarkdown";
import { readListingFiles, writeListingFiles, type ItemJson } from "./workshopFiles";
import type { LegacyZip } from "./legacyZip";

export const LEGACY_DIR = "legacy_version";
export type LegacyContentState = "new" | "creating" | "ready" | "submitted" | "published";
export interface LegacyItem extends ItemJson {
  legacy: { supportedVersion: string; version: string | null; content: LegacyContentState; archive?: string };
  preview?: string;
}

import { legacyVersion } from "./legacyVersion";
export { legacyVersion } from "./legacyVersion";

export function legacyDirectory(mainDir: string, key: string): string {
  if (legacyVersion(key).key !== key) throw new Error("Invalid legacy version directory.");
  const parent = path.join(mainDir, LEGACY_DIR);
  const dir = path.join(parent, key);
  for (const target of [parent, dir]) {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
      throw new Error("Legacy version directories must not be links.");
  }
  return dir;
}

export function readLegacyItem(dir: string): LegacyItem {
  const file = path.join(dir, "item.json");
  const item = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as LegacyItem;
  validateLegacyItem(dir, item);
  return item;
}

function validateLegacyItem(dir: string, item: LegacyItem): void {
  if (
    !item ||
    !item.legacy ||
    typeof item.legacy.supportedVersion !== "string" ||
    legacyVersion(item.legacy.supportedVersion).key !== path.basename(dir) ||
    !["new", "creating", "ready", "submitted", "published"].includes(item.legacy.content) ||
    (item.legacy.archive !== undefined &&
      (typeof item.legacy.archive !== "string" ||
        !item.legacy.archive ||
        /[\\/]/.test(item.legacy.archive))) ||
    (item.publishedfileid !== undefined &&
      (typeof item.publishedfileid !== "string" || !/^[1-9]\d*$/.test(item.publishedfileid))) ||
    (["ready", "submitted", "published"].includes(item.legacy.content) && !item.publishedfileid)
  )
    throw new Error(
      `Invalid legacy item at ${path.join(dir, "item.json")}. Restore its saved version and Workshop ID before continuing.`
    );
}

/** Replace only the selected item's fields. Never falls back to the main item on read failure. */
export function updateLegacyItem(dir: string, patch: Partial<LegacyItem>): LegacyItem {
  const current = readLegacyItem(dir);
  const next = { ...current, ...patch };
  validateLegacyItem(dir, next);
  if (next.legacy.supportedVersion !== current.legacy.supportedVersion)
    throw new Error("A legacy item's game version cannot change.");
  if (next.legacy.archive !== current.legacy.archive)
    throw new Error("A legacy item's content source cannot change.");
  if (current.publishedfileid && next.publishedfileid !== current.publishedfileid)
    throw new Error("A legacy item's Workshop ID cannot change.");
  const states: LegacyContentState[] = ["new", "creating", "ready", "submitted", "published"];
  if (states.indexOf(next.legacy.content) < states.indexOf(current.legacy.content))
    throw new Error("Legacy content upload state cannot move backwards.");
  fs.writeFileSync(path.join(dir, "item.json"), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/** The host calls this only when the bridge proves that no remote action started. */
export function restoreUnstartedLegacyUpload(dir: string, expected: "creating" | "submitted"): void {
  const current = readLegacyItem(dir);
  if (current.legacy.content !== expected)
    throw new Error("The legacy upload state changed. Reload before trying again.");
  if (expected === "creating" && current.publishedfileid)
    throw new Error("The legacy item already has a Workshop ID.");
  const next: LegacyItem = {
    ...current,
    legacy: { ...current.legacy, content: expected === "creating" ? "new" : "ready" },
  };
  validateLegacyItem(dir, next);
  fs.writeFileSync(path.join(dir, "item.json"), JSON.stringify(next, null, 2) + "\n", "utf8");
}

export function legacyVersions(mainDir: string): { key: string; supportedVersion: string }[] {
  const parent = path.join(mainDir, LEGACY_DIR);
  if (!fs.existsSync(parent)) return [];
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+(?:\.\d+){0,2}$/.test(entry.name))
    .map((entry) => {
      const dir = legacyDirectory(mainDir, entry.name);
      // Keep damaged entries reachable so a missing ID never silently creates a replacement.
      let supportedVersion = entry.name;
      try {
        supportedVersion = readLegacyItem(dir).legacy.supportedVersion;
      } catch {
        /* reported on selection */
      }
      return { key: entry.name, supportedVersion };
    })
    .sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }));
}

/** Reserve the final directory first: another window cannot replace or merge into it. */
export function createLegacyVersion(
  mainDir: string,
  input: string,
  info: PublishInfo,
  readSource: (file: string) => Uint8Array = fs.readFileSync,
  archive?: LegacyZip
): string {
  const version = legacyVersion(input);
  const dir = legacyDirectory(mainDir, version.key);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `A legacy version already exists at ${dir}. Delete that local directory before creating a replacement. Its Steam item is not deleted.`
      );
    throw error;
  }
  // A failed copy leaves the reserved directory for inspection, never a second implicit attempt.
  const translations = Object.fromEntries(
    Object.entries(info.translations).map(([lang, t]) => [
      lang,
      {
        ...t,
        ...(t.description && info.markdown.includes(lang)
          ? { description: markdownToBBCode(t.description) }
          : {}),
      },
    ])
  );
  writeListingFiles(dir, {
    description: info.markdown.includes("")
      ? markdownToBBCode(info.description ?? "")
      : (info.description ?? ""),
    translations,
  });
  const copy = (source: string, target: string): void => {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error("A preview directory cannot be a link.");
      fs.mkdirSync(target);
      for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name));
    } else fs.writeFileSync(target, readSource(source));
  };
  for (const name of ["previews", "dependencies.json"]) {
    const source = path.join(mainDir, name);
    if (fs.existsSync(source)) copy(source, path.join(dir, name));
  }
  let preview: string | undefined;
  if (info.previewPath) {
    preview = `thumbnail${path.extname(info.previewPath)}`;
    fs.writeFileSync(path.join(dir, preview), readSource(info.previewPath));
  }
  if (archive)
    fs.cpSync(archive.root, path.join(dir, "content"), { recursive: true, errorOnExist: true, force: false });
  const item: LegacyItem = {
    title: info.name ?? "",
    tags: [...info.tags],
    visibility: 2,
    ...(preview ? { preview } : {}),
    legacy: {
      supportedVersion: version.supportedVersion,
      version: archive ? archive.version : info.version,
      content: "new",
      ...(archive ? { archive: archive.name } : {}),
    },
  };
  fs.writeFileSync(path.join(dir, "item.json"), JSON.stringify(item, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
  return version.key;
}

export function legacyPublishInfo(dir: string): PublishInfo {
  const item = readLegacyItem(dir);
  const files = readListingFiles(dir);
  if (item.preview && (path.basename(item.preview) !== item.preview || item.preview === ".."))
    throw new Error("The legacy preview must be a file inside its version directory.");
  return {
    name: typeof item.title === "string" ? item.title : null,
    tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
    publishedId: item.publishedfileid ?? null,
    description: files.description,
    translations: files.translations,
    markdown: files.markdown,
    previewPath: item.preview ? path.join(dir, item.preview) : null,
    version: item.legacy.version,
    supportedVersion: item.legacy.supportedVersion,
  };
}

/** Guard the entire create/publish operation across editor windows. A crash leaves a visible lock. */
export function lockLegacyUpload(dir: string): () => void {
  const file = path.join(dir, ".upload-lock");
  let fd: number;
  try {
    fd = fs.openSync(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "This legacy item has an upload lock. Stop the other upload first. After an editor crash, check the item on Steam before removing its local .upload-lock file."
      );
    throw error;
  }
  fs.closeSync(fd);
  return () => fs.unlinkSync(file);
}

/** Only the staged descriptor changes. The project's version, name and main ID remain intact. */
export function prepareLegacyContent(
  staging: string,
  meta: GameMeta,
  info: PublishInfo,
  itemId: string
): void {
  if (meta.descriptor === "mod") {
    const file = path.join(staging, "descriptor.mod");
    let text = fs.readFileSync(file, "utf8");
    for (const [key, value] of [
      ["supported_version", info.supportedVersion],
      ["remote_file_id", itemId],
      ["name", info.name],
      ["version", info.version],
    ] as const)
      if (value) text = upsertDescriptorValue(text, key, value);
    fs.writeFileSync(file, text, "utf8");
  } else {
    const file = path.join(staging, METADATA_REL_PATH);
    const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
    data.supported_game_version = info.supportedVersion;
    if (info.version) data.version = info.version;
    if (info.name) data.name = info.name;
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
}
