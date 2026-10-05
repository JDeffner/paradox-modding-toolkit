/**
 * Steam Workshop publishing without the Paradox launcher: create or update the
 * focused mod's Workshop item through the Steam client's own UGC API (the
 * launcher is just another client of the same API). The native Steamworks
 * binding runs in a child process (steam/bridge.ts -> dist/steamBridge.js), so
 * no credentials are involved - the user's running Steam session authorizes
 * the upload - and a native failure cannot crash the extension host.
 *
 * New items are created PRIVATE (Steam's default): nothing goes public until
 * the user flips visibility, on the Workshop page or in the Workshop panel.
 * The published id is persisted where each game's tooling expects it:
 * `remote_file_id` in descriptor.mod for launcher-`.mod` games,
 * `<configDir>/workshop.json` for `.metadata` games (their metadata.json has
 * no field for it). Description and per-language translations live in the
 * workshop folder as files when it exists (steam/workshopFiles.ts), else in
 * `<configDir>/workshop.json`, and ride along on every upload.
 *
 * Publishing happens in the Workshop panel (webviews/workshop/), the single
 * place uploads are reviewed and confirmed; this module carries the shared
 * plumbing plus px.openWorkshopPage.
 */
import * as vscode from "vscode";
import { runBridgeProcess, type BridgeProgress } from "./bridgeRunner";
export { BridgeStartError, BridgeWaitError } from "./bridgeRunner";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { gameDocsSubdir, type PxConfig } from "../config";
import { metaFor } from "../meta";
import { readMachineSetting, writeMachineSetting } from "../machineSettings";
import { prepareProjectConfigWrite, readProjectAuthoringSettings } from "../projectConfigFile";
import { readDocument, writeDocument } from "../documentWrite";
import { getProjectSetting } from "@px-lsp/protocol/projectSettings";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseDescriptor, readDescriptorBlock, upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";
import { readMetadata } from "@px-lsp/protocol/descriptorMetadata";
import { assertConfigPath, canonicalConfigPath, resolveConfigPath } from "@px-lsp/protocol/configDir";
import { readWorkshopMeta, type WorkshopTranslation } from "@px-lsp/protocol/workshopMeta";
import { explainSteamError } from "./steamErrors";
import {
  DEFAULT_LANGUAGE,
  hasListingFiles,
  moveListing,
  readListingFiles,
  resolveChangeNote,
  resolveWorkshopDir,
  SIBLING_WORKSHOP_DIR,
  type ChangeNote,
} from "./workshopFiles";
import { markdownToBBCode } from "./bbcodeMarkdown";
import { type BridgeDone, type BridgeJob, type SubmitSpec } from "./jobs";

export const LEGAL_AGREEMENT_URL = "https://steamcommunity.com/sharedfiles/workshoplegalagreement";
/** Steam rejects preview images of 1 MB or more (k_cchFilenameMax aside). */
export const PREVIEW_MAX_BYTES = 1024 * 1024;

/** Resolved px.workshop.dir for `root`: where the listing lives as files. */
export function workshopDirFor(root: string, meta: GameMeta): string {
  const setting = readMachineSetting<string>("workshop.dir", meta.id, vscode.Uri.file(root));
  if (setting?.trim()) return path.resolve(root, setting.trim());
  return resolveWorkshopDir(root, setting, path.dirname(resolveConfigPath(root, meta, "workshop")));
}

/** Before a default listing write, copy missing legacy artifacts without retiring either source. */
export async function prepareWorkshopDirectory(root: string, meta: GameMeta): Promise<string> {
  const selected = workshopDirFor(root, meta);
  if (readMachineSetting<string>("workshop.dir", meta.id, vscode.Uri.file(root))?.trim()) return selected;
  const current = canonicalConfigPath(root, meta, "workshop");
  if (!meta.legacyConfigDirName) return selected;
  const legacy = assertConfigPath(root, meta, "workshop", true);
  const normalize = (file: string) =>
    process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);
  const same = (a: string, b: string) => normalize(a) === normalize(b);
  // Explicit paths and a project's sibling listing keep their authored location.
  if (!same(selected, current) && !same(selected, legacy)) return selected;
  if (!fs.existsSync(legacy)) return current;
  const sourceFiles = new Map<string, Buffer>();
  const directories = new Map<string, string[]>();
  const copies: {
    relative: string;
    target: string;
    bytes: Buffer;
    document?: vscode.TextDocument;
    text?: string;
    version?: number;
  }[] = [];
  const documentFor = (file: string) =>
    vscode.workspace.textDocuments?.find((doc) => doc.uri.scheme === "file" && same(doc.uri.fsPath, file));
  const walk = (relative: string) => {
    const dir = assertConfigPath(root, meta, relative, true);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    directories.set(relative, entries.map((entry) => entry.name).sort());
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      const source = assertConfigPath(root, meta, child, true);
      const target = canonicalConfigPath(root, meta, child);
      if (entry.isSymbolicLink()) throw new Error(`Save a regular Workshop file before upgrading ${source}`);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (fs.existsSync(target)) continue;
      const bytes = fs.readFileSync(source);
      sourceFiles.set(child, bytes);
      if (documentFor(target)) throw new Error(`Save ${target} before upgrading the Workshop listing`);
      const document = documentFor(source);
      if (document?.isDirty) throw new Error(`Save ${source} before upgrading the Workshop listing`);
      copies.push({
        relative: child,
        target,
        bytes,
        document,
        text: document?.getText(),
        version: document?.version,
      });
    }
  };
  walk("workshop");
  const assertCurrent = () => {
    for (const [relative, names] of directories) {
      const source = assertConfigPath(root, meta, relative, true);
      if (fs.readdirSync(source).sort().join("\n") !== names.join("\n"))
        throw new Error("The legacy Workshop listing changed during its upgrade. Try again.");
    }
    for (const [relative, bytes] of sourceFiles) {
      if (!fs.readFileSync(assertConfigPath(root, meta, relative, true)).equals(bytes))
        throw new Error("The legacy Workshop listing changed during its upgrade. Try again.");
    }
    for (const copy of copies) {
      canonicalConfigPath(root, meta, copy.relative);
      if (
        copy.document &&
        (copy.document.isClosed ||
          copy.document.version !== copy.version ||
          copy.document.getText() !== copy.text)
      )
        throw new Error("The legacy Workshop editor changed during its upgrade. Try again.");
      if (documentFor(copy.target))
        throw new Error(`Save ${copy.target} before upgrading the Workshop listing`);
    }
  };
  if (copies.length > 0 && vscode.workspace.isTrusted === false)
    throw new Error("Trust this workspace before upgrading its Workshop listing");
  assertCurrent();
  const created: { file: string; bytes: Buffer }[] = [];
  try {
    for (const copy of copies) {
      assertCurrent();
      const bytes = copy.bytes;
      fs.mkdirSync(path.dirname(copy.target), { recursive: true });
      const descriptor = fs.openSync(copy.target, "wx");
      created.push({ file: copy.target, bytes });
      try {
        fs.writeFileSync(descriptor, bytes);
      } finally {
        fs.closeSync(descriptor);
      }
      if (!fs.readFileSync(copy.target).equals(bytes))
        throw new Error(`Workshop copy did not verify: ${copy.target}`);
    }
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const entry of created.reverse()) {
      try {
        const bytes = fs.readFileSync(entry.file);
        // Remove only bytes written by this attempt, including an incomplete write.
        if (documentFor(entry.file) || !entry.bytes.subarray(0, bytes.length).equals(bytes))
          throw new Error(`Changed destination retained: ${entry.file}`);
        fs.unlinkSync(entry.file);
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length)
      throw new Error(`${String(error)}. Some copied files remain: ${rollbackErrors.join("; ")}`);
    throw error;
  }
  return current;
}

/** The changenote resolved from px.workshop.changelog, or null. */
export function changelogNoteFor(root: string, meta: GameMeta, version: string | null): ChangeNote | null {
  const project = readProjectAuthoringSettings(root, meta, meta.id);
  const portable = project && (getProjectSetting(project, "workshop.changelog") as string | undefined);
  const setting =
    portable ?? readMachineSetting<string>("workshop.changelog", meta.id, vscode.Uri.file(root));
  return resolveChangeNote(workshopDirFor(root, meta), setting, version);
}

export interface PublishInfo {
  name: string | null;
  tags: string[];
  /** Workshop item id (decimal string), or null when never published. */
  publishedId: string | null;
  /** The local copy of the item's description (workshop.json, else the metadata short_description). */
  description: string | null;
  /** The local per-language translations (workshop.json), keyed by Steam API language code. */
  translations: Record<string, WorkshopTranslation>;
  /**
   * Which of those descriptions are Markdown (`ListingFiles.markdown`, the
   * empty string being the default one). Steam only takes BBCode, so they
   * convert on the way out; `descriptionBBCode` does that for one of them.
   */
  markdown: string[];
  previewPath: string | null;
  /** The mod's own version (descriptor version= / metadata version). */
  version: string | null;
  /** The game version the mod says it works with. */
  supportedVersion: string | null;
}

const unquote = (v: string): string => v.replace(/^"([^]*)"$/, "$1").trim();

export function findPreview(root: string, preferred: string | null): string | null {
  // `preferred` is the descriptor's raw picture= value, and the hit is what
  // gets UPLOADED as the Workshop preview image. The launcher only accepts a
  // bare file name in the mod root, so anything that could name a file outside
  // it (separators, `..`, an absolute path) is dropped instead of joined.
  const safe = preferred && preferred !== ".." && path.basename(preferred) === preferred ? preferred : null;
  const candidates = [safe, "thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg"].filter(
    (f): f is string => !!f
  );
  for (const f of candidates) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * What the mod's descriptor, workshop.json and the workshop folder tell us
 * about publishing it. Null = no descriptor. When the workshop folder exists
 * its files win over workshop.json, field by field (`workshopDir` defaults to
 * the px.workshop.dir resolution; pass a value to skip re-reading settings).
 */
export function readPublishInfo(
  root: string,
  meta: GameMeta,
  workshopDir: string = workshopDirFor(root, meta)
): PublishInfo | null {
  const store = readWorkshopMeta(path.dirname(resolveConfigPath(root, meta, "workshop.json")));
  const files = hasListingFiles(workshopDir) ? readListingFiles(workshopDir) : null;
  const translations: Record<string, WorkshopTranslation> = { ...(store?.translations ?? {}) };
  for (const [lang, t] of Object.entries(files?.translations ?? {})) {
    translations[lang] = { ...translations[lang], ...t };
  }
  const description = files?.description ?? store?.description ?? null;
  // A description only workshop.json still holds is pre-0.4.0 BBCode,
  // whatever format its folder would write.
  const markdown = (files?.markdown ?? []).filter((lang) =>
    lang === DEFAULT_LANGUAGE ? files?.description != null : files?.translations[lang]?.description != null
  );
  if (meta.descriptor === "mod") {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, "descriptor.mod"), "utf8");
    } catch {
      return null;
    }
    const entries = parseDescriptor(text);
    const value = (key: string) => {
      const e = entries.find((x) => x.key === key && x.value !== "");
      return e ? unquote(e.value) : null;
    };
    const remote = value("remote_file_id");
    return {
      name: value("name"),
      tags: readDescriptorBlock(text, "tags"),
      publishedId: remote && /^\d+$/.test(remote) ? remote : null,
      description,
      translations,
      markdown,
      previewPath: findPreview(root, value("picture")),
      version: value("version"),
      supportedVersion: value("supported_version"),
    };
  }
  const md = readMetadata(root);
  if (!md) return null;
  const storedId = store?.publishedFileId;
  return {
    name: typeof md.name === "string" && md.name.trim() !== "" ? md.name : null,
    tags: Array.isArray(md.tags) ? md.tags.filter((t): t is string => typeof t === "string") : [],
    publishedId: storedId && /^\d+$/.test(storedId) ? storedId : null,
    description: description ?? (typeof md.short_description === "string" ? md.short_description : null),
    translations,
    markdown,
    previewPath: findPreview(root, null),
    version: typeof md.version === "string" ? md.version : null,
    supportedVersion: typeof md.supported_game_version === "string" ? md.supported_game_version : null,
  };
}

export async function persistPublishedId(root: string, meta: GameMeta, itemId: string): Promise<void> {
  if (meta.descriptor === "mod") {
    const snapshot = await readDocument(path.join(root, "descriptor.mod"));
    await writeDocument(snapshot, upsertDescriptorValue(snapshot.text, "remote_file_id", itemId), false);
    return;
  }
  const prepared = await prepareProjectConfigWrite(root, meta, "workshop.json");
  const current: unknown =
    prepared.text === undefined ? {} : JSON.parse(prepared.text.replace(/^\uFEFF/, ""));
  if (typeof current !== "object" || !current || Array.isArray(current))
    throw new Error("Workshop metadata must be an object");
  await prepared.write(JSON.stringify({ ...current, publishedFileId: itemId }, null, 2) + "\n");
}

/**
 * A fresh staging folder for one upload. Private per upload on purpose: two
 * windows publishing mods whose folder name matches would otherwise stage into
 * the same place and one would overwrite what the other is uploading. The
 * caller removes it when the upload ends.
 */
export function makeStagingDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "px-toolkit-workshop-"));
}

export { lastCommitSubject, latestRelease } from "./gitNotes";

/** One description as Steam takes it: BBCode, converted when the file is Markdown. */
export function descriptionBBCode(info: PublishInfo, language: string, text: string): string {
  return info.markdown.includes(language) ? markdownToBBCode(text) : text;
}

/**
 * The translation submits of an upload: one per language that has any text.
 * No changenote on them - one upload should read as one change on the item's
 * Change Notes tab, not one entry per language.
 */
export function translationSubmits(info: PublishInfo): SubmitSpec[] {
  return Object.entries(info.translations)
    .filter(([, t]) => (t.title ?? "").trim() !== "" || (t.description ?? "").trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, t]) => ({
      language,
      title: (t.title ?? "").trim() !== "" ? t.title : undefined,
      description:
        (t.description ?? "").trim() !== ""
          ? descriptionBBCode(info, language, t.description as string)
          : undefined,
    }));
}

export function runBridge(
  context: vscode.ExtensionContext,
  job: BridgeJob,
  log: (msg: string) => void,
  onProgress?: BridgeProgress,
  signal?: AbortSignal
): Promise<BridgeDone> {
  return runBridgeProcess(
    context.asAbsolutePath(path.join("dist", "steamBridge.js")),
    context.asAbsolutePath(path.join("dist", "steamwand")),
    job,
    log,
    onProgress,
    signal
  );
}

export function workshopUrl(itemId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${itemId}`;
}

/** The same page inside the Steam client (Steam browser protocol). */
export function workshopSteamUrl(itemId: string): string {
  return `steam://url/CommunityFilePage/${itemId}`;
}

export function friendlyError(e: unknown, meta: GameMeta): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Steam init failed")) {
    return (
      `could not connect to Steam (${msg}). ` +
      `Steam must be running and logged in to an account that owns ${meta.name}.`
    );
  }
  // steamwand names the raw code ("SubmitItemUpdate failed:
  // k_EResultAccessDenied"); say what it means, code kept for support.
  return explainSteamError(msg) ?? msg;
}

export function registerWorkshop(
  context: vscode.ExtensionContext,
  deps: { cfg: () => PxConfig; focusRoot: () => string | null; log: (msg: string) => void }
): void {
  const activeRoot = () => deps.focusRoot() ?? deps.cfg().modPath;
  context.subscriptions.push(
    vscode.commands.registerCommand("px.openWorkshopPage", async () => {
      const cfg = deps.cfg();
      const meta = metaFor(cfg.gameId);
      const root = activeRoot();
      let info: PublishInfo | null = null;
      try {
        if (root) info = readPublishInfo(root, meta, await prepareWorkshopDirectory(root, meta));
      } catch (error) {
        void vscode.window.showErrorMessage(`Could not read Workshop settings: ${String(error)}`);
        return;
      }
      if (!info?.publishedId) {
        void vscode.window
          .showInformationMessage(
            "Paradox Modding Toolkit: this mod has no Workshop item yet - publish it from the Workshop panel first.",
            "Open Workshop Panel"
          )
          .then((choice) => {
            if (choice) void vscode.commands.executeCommand("px.openWorkshopManager");
          });
        return;
      }
      void vscode.env.openExternal(vscode.Uri.parse(workshopUrl(info.publishedId)));
    }),
    vscode.commands.registerCommand("px.moveWorkshopListing", async () => {
      const cfg = deps.cfg();
      const meta = metaFor(cfg.gameId);
      const root = activeRoot();
      if (!root) {
        void vscode.window.showWarningMessage("Paradox Modding Toolkit: no mod is focused.");
        return;
      }
      let current: string;
      try {
        current = await prepareWorkshopDirectory(root, meta);
      } catch (error) {
        void vscode.window.showErrorMessage(`Could not upgrade Workshop listing: ${String(error)}`);
        return;
      }
      const inMod = canonicalConfigPath(root, meta, "workshop");
      const sibling = path.resolve(root, SIBLING_WORKSHOP_DIR);
      const isInMod = path.resolve(current).toLowerCase() === inMod.toLowerCase();
      // A mod directly in the game's mod folder has no sibling of its own:
      // "../workshop" would be one folder shared by every installed mod.
      const gameModDir = gameDocsSubdir(meta, "mod");
      const inGameModFolder =
        gameModDir !== null &&
        path.resolve(path.dirname(root)).toLowerCase() === path.resolve(gameModDir).toLowerCase();
      type Item = vscode.QuickPickItem & { to: string };
      const items: Item[] = [
        {
          label: `Into the mod: ${meta.configDirName}/workshop`,
          description: isInMod ? "already there" : undefined,
          detail: "Everything in one folder; toolkit uploads leave it out.",
          to: inMod,
        },
        {
          label: "Next to the mod: ../workshop",
          description: inGameModFolder
            ? "not in the game's mod folder"
            : !isInMod && path.resolve(current) === sibling
              ? "already there"
              : undefined,
          detail: `The mod-projects layout: ${sibling}`,
          to: sibling,
        },
      ].filter((i) => i.description === undefined);
      if (items.length === 0) {
        void vscode.window.showInformationMessage(
          `Paradox Modding Toolkit: the listing is at ${current}, the one place for a mod in the game's mod folder. ` +
            "Paradox: Move Mod moves the whole mod to the projects layout."
        );
        return;
      }
      const pick = await vscode.window.showQuickPick<Item>(items, {
        title: "Move Workshop Listing",
        placeHolder: `Now at ${current}`,
      });
      if (!pick) return;
      const info = readPublishInfo(root, meta, current);
      try {
        moveListing(current, pick.to, {
          description: info?.description ?? "",
          translations: info?.translations ?? {},
        });
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Paradox Modding Toolkit: ${e instanceof Error ? e.message : String(e)}`
        );
        return;
      }
      // Keep an existing personal override bound to the selected new location.
      if ((readMachineSetting<string>("workshop.dir", meta.id, vscode.Uri.file(root)) ?? "").trim() !== "") {
        await writeMachineSetting(
          "workshop.dir",
          path.relative(root, pick.to),
          meta.id,
          "folder",
          undefined,
          vscode.Uri.file(root)
        );
      }
      deps.log(`workshop: listing moved ${current} -> ${pick.to}`);
      void vscode.window.showInformationMessage(
        `Paradox Modding Toolkit: Workshop listing moved to ${pick.to}.`
      );
    })
  );
}
