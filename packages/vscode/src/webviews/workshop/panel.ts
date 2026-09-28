/**
 * The Workshop panel's VS Code host (px.openWorkshopManager).
 *
 * It does what the app cannot: read the descriptor and workshop.json, write
 * drafts back, talk to Steam through the bridge child process (query, create,
 * multi-submit publish), stage the mod's files, and persist a linked or newly
 * created item id. Rendering and editing live in app/; the wire is
 * messages.ts. All Steam-facing plumbing is shared with the quick command
 * (steam/workshop.ts).
 */
import { makeNonce } from "../nonce";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import type { GameMeta } from "@px-lsp/server/games/profile";
import {
  STEAM_LANGUAGES,
  steamLanguageForLoc,
  type WorkshopTranslation,
} from "@px-lsp/protocol/workshopMeta";
import { LOC_LANGUAGES } from "@px-lsp/protocol/translationCore";
import {
  LAUNCHER_TAGS,
  parseDescriptor,
  readDescriptorBlock,
  upsertDescriptorBlock,
  upsertDescriptorValue,
} from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH } from "@px-lsp/protocol/descriptorMetadata";
import { type ItemDetails, type SubmitSpec } from "../../steam/jobs";
import {
  DESCRIPTION_BBCODE,
  descriptionFile,
  hasListingFiles,
  langDir,
  migrateMarkdownListing,
  PREVIEWS_DIR,
  readDependencies,
  readItemJson,
  readPreviews,
  resolveChangeNote,
  upsertItemJson,
  writeDependencies,
  writeListingFiles,
  writePreviewOrder,
  writeSteamDescription,
  writeVideos,
} from "../../steam/workshopFiles";
import { preflight } from "../../steam/preflight";
import { readGameDlc } from "../../steam/gameDlc";
import { createDescriptorFile, detectGameVersion } from "../../descriptorMod";
import { readModName } from "@px-lsp/protocol/modName";
import { findSteamLibraries } from "../../steamDetect";
import { declaredDependencies, dependencyCandidates } from "../../dependencyScan";
import { changelogCandidates, DEFAULT_CHANGELOG } from "../../steam/workshopFiles";
import { ensurePxIgnore, PXIGNORE_FILE, stageContent } from "../../steam/pxignore";
import {
  BridgeWaitError,
  BridgeStartError,
  descriptionBBCode,
  findPreview,
  friendlyError,
  lastCommitSubject,
  latestRelease,
  LEGAL_AGREEMENT_URL,
  makeStagingDir,
  persistPublishedId,
  PREVIEW_MAX_BYTES,
  readPublishInfo,
  runBridge,
  translationSubmits,
  workshopDirFor,
  workshopSteamUrl,
  workshopUrl,
} from "../../steam/workshop";
import {
  createLegacyVersion,
  legacyDirectory,
  legacyPublishInfo,
  legacyVersion,
  legacyVersions,
  lockLegacyUpload,
  prepareLegacyContent,
  readLegacyItem,
  restoreUnstartedLegacyUpload,
  updateLegacyItem,
} from "../../steam/legacyWorkshop";
import type { PublishInfo } from "../../steam/workshop";
import { bbcodeToMarkdown, markdownToBBCode } from "../../steam/bbcodeMarkdown";
import { gameDocsSubdir } from "../../config";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { decodeDds, downscale, encodePng } from "@px-lsp/server/dds";
import { workshopHtml } from "./html";
import type {
  AppToHost,
  DlcChoice,
  HostToApp,
  ModChoice,
  ProgressJob,
  PullParts,
  WorkshopModInfo,
} from "./messages";

export interface WorkshopPanelOptions {
  meta: GameMeta;
  /** Mods the panel can manage, first = default. */
  mods: ModChoice[];
  /** The mod to open with (the focused one), a path from `mods`. */
  active: string | null;
  /** The game install, for the version the supported-version check compares against. */
  gamePath: string | null;
  log: (msg: string) => void;
}

/** How long the listing files may keep changing before the panel re-reads them. */
const LISTING_RELOAD_MS = 300;

/** The latest GitHub release as the panel shows it: notes already in BBCode. */
async function releaseNoteFor(root: string): Promise<{ tag: string; name: string; text: string } | null> {
  const release = await latestRelease(root);
  if (!release) return null;
  return {
    tag: release.tag,
    name: release.name,
    text: release.body.trim() ? markdownToBBCode(release.body) : "",
  };
}

export class WorkshopPanel {
  private static instance: WorkshopPanel | undefined;
  private static readonly viewType = "px.workshop";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private options: WorkshopPanelOptions;
  private active: string | null;
  private legacyKey: string | null = null;
  private messages = Promise.resolve();
  private uploadAbort: AbortController | undefined;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  private uploading = false;
  /** Folders the webview may load files from; grows when one turns up outside them. */
  private resourceRoots: vscode.Uri[];
  /** Titles of required items looked up on Steam, so a re-render never re-asks. */
  private readonly itemTitles = new Map<string, string | null>();
  /** Watches the active mod's listing text and changelog; the panel only previews both. */
  private listingWatchers: vscode.FileSystemWatcher[] = [];
  private listingReload: ReturnType<typeof setTimeout> | undefined;

  private constructor(context: vscode.ExtensionContext, options: WorkshopPanelOptions) {
    this.context = context;
    this.options = options;
    this.active = options.active ?? options.mods[0]?.path ?? null;

    const source = webviewSource(context);
    // Every folder a webview <img> may point at. The mod holds the preview
    // image; the listing folder (previews/) can sit OUTSIDE the mod when
    // px.workshop.dir is a sibling or an absolute path, and globalStorage
    // holds the decoded DLC icons.
    this.resourceRoots = [
      source.root,
      context.globalStorageUri,
      ...options.mods.map((m) => vscode.Uri.file(m.path)),
      ...options.mods.map((m) => vscode.Uri.file(workshopDirFor(m.path, options.meta))),
    ];
    this.panel = vscode.window.createWebviewPanel(
      WorkshopPanel.viewType,
      "Steam Workshop",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: this.resourceRoots,
      }
    );
    this.panel.iconPath = tabIcon("workshop");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = workshopHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "workshop"),
        nonce,
        csp: [
          `default-src 'none'`,
          // https: for the item's live preview URL, which Steam's CDN serves.
          `img-src ${this.panel.webview.cspSource} https: data:`,
          `style-src 'unsafe-inline'`,
          `script-src 'nonce-${nonce}'`,
        ].join("; "),
      });
    };
    render();
    // The rebooted app sends "ready" and postInit answers it; nothing else.
    this.disposables.push(watchBundle(source, "workshop", this.panel, render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => {
        if (message.type === "stopWaiting") {
          this.uploadAbort?.abort();
          return;
        }
        if (message.type === "refresh") {
          if (this.matchesTarget(message)) void this.queryLive(message.languages);
          return;
        }
        this.messages = this.messages
          .then(() => this.onMessage(message))
          .catch((error: unknown) => {
            this.notifyError(friendlyError(error, this.options.meta), error);
          });
      },
      undefined,
      this.disposables
    );
    // The descriptor or workshop.json may change while the tab is hidden
    // (editor edits, a quick publish); re-read whenever it comes back.
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible && !this.uploading) void this.postInfo();
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.watchListing();
  }

  private listingDirectory(root: string): string {
    const main = workshopDirFor(root, this.options.meta);
    return this.legacyKey === null ? main : legacyDirectory(main, this.legacyKey);
  }

  private target(): { root: string; legacyKey: string | null } | undefined {
    return this.active ? { root: this.active, legacyKey: this.legacyKey } : undefined;
  }

  private matchesTarget(message: Pick<AppToHost, "target">): boolean {
    return message.target?.root === this.active && message.target.legacyKey === this.legacyKey;
  }

  private currentText(file: string): string {
    const document = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.scheme === "file" && samePath(doc.uri.fsPath, file)
    );
    return document ? document.getText() : fs.readFileSync(file, "utf8");
  }

  /** A file edited in VS Code is the current source, including unsaved text. */
  private publishInfo(root: string, main = false): PublishInfo | null {
    const dir = main ? workshopDirFor(root, this.options.meta) : this.listingDirectory(root);
    const legacy = !main && this.legacyKey !== null;
    const info = legacy ? legacyPublishInfo(dir) : readPublishInfo(root, this.options.meta, dir);
    if (!info) return null;
    if (!legacy) {
      if (this.options.meta.descriptor === "mod") {
        const text = this.currentText(path.join(root, "descriptor.mod"));
        const entries = parseDescriptor(text);
        const value = (key: string) =>
          entries.find((e) => e.key === key)?.value.replace(/^"([\s\S]*)"$/, "$1") ?? null;
        info.name = value("name");
        info.version = value("version");
        info.supportedVersion = value("supported_version");
        info.tags = readDescriptorBlock(text, "tags");
      } else {
        const data = JSON.parse(
          this.currentText(path.join(root, METADATA_REL_PATH)).replace(/^\uFEFF/, "")
        ) as Record<string, unknown>;
        if (typeof data.name === "string") info.name = data.name;
        if (typeof data.version === "string") info.version = data.version;
        if (typeof data.supported_game_version === "string")
          info.supportedVersion = data.supported_game_version;
        if (Array.isArray(data.tags)) info.tags = data.tags.filter((t): t is string => typeof t === "string");
      }
    }
    const description = descriptionFile(dir);
    if (fs.existsSync(description.file)) info.description = this.currentText(description.file);
    for (const { api } of STEAM_LANGUAGES) {
      const folder = langDir(dir, api);
      const title = path.join(folder, "title.txt");
      const desc = descriptionFile(folder).file;
      if (fs.existsSync(title)) (info.translations[api] ??= {}).title = this.currentText(title).trim();
      if (fs.existsSync(desc)) (info.translations[api] ??= {}).description = this.currentText(desc);
    }
    return info;
  }

  private assertSaved(...folders: string[]): void {
    const dirty = vscode.workspace.textDocuments.find(
      (doc) =>
        doc.isDirty &&
        doc.uri.scheme === "file" &&
        folders.some((folder) => samePath(folder, doc.uri.fsPath) || isInsideDir(folder, doc.uri.fsPath))
    );
    if (dirty)
      throw new Error(
        `Save or close the unsaved edits in ${dirty.uri.fsPath} before this operation. No files were replaced.`
      );
  }

  private changelogNote(root: string, version: string | null) {
    return resolveChangeNote(
      this.listingDirectory(root),
      this.legacyKey
        ? DEFAULT_CHANGELOG
        : vscode.workspace.getConfiguration("px").get<string>("workshop.changelog"),
      version
    );
  }

  private async createLegacy(): Promise<void> {
    if (!this.active || this.uploading) return;
    const root = this.active;
    const target = this.target();
    const info = this.publishInfo(root, true);
    if (!info) throw new Error("Create a mod descriptor before creating a legacy version.");
    const seed = info.supportedVersion ?? detectGameVersion(this.options.gamePath) ?? "";
    const value = /^\d+\.\d+/.exec(seed)?.[0];
    const input = await vscode.window.showInputBox({
      title: "Create legacy Workshop version",
      prompt:
        "Game version. Two components cover all patches, for example 1.19.*. An exact patch version is optional.",
      value: value ? `${value}.*` : "",
      validateInput: (v) => {
        try {
          legacyVersion(v);
          return null;
        } catch (e) {
          return String((e as Error).message);
        }
      },
    });
    if (input === undefined) return;
    if (!this.matchesTarget({ target }))
      throw new Error("The selected item changed. Create the legacy version from the current item.");
    // Re-read after the prompt, so current editor edits are the copied source.
    const current = this.publishInfo(root, true)!;
    const mainDir = workshopDirFor(root, this.options.meta);
    const destination = legacyDirectory(mainDir, legacyVersion(input).key);
    if (fs.existsSync(destination))
      throw new Error(
        `A legacy version already exists at ${destination}. Delete that local directory before creating a replacement. Its Steam item is not deleted.`
      );
    const readSource = (file: string): Uint8Array => {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.scheme === "file" && samePath(d.uri.fsPath, file)
      );
      return doc ? Buffer.from(doc.getText(), "utf8") : fs.readFileSync(file);
    };
    let requirements: { apps: number[]; items: string[] } | undefined;
    let gallery: { images: { name: string; bytes: Buffer }[]; videos: string[] } | undefined;
    let thumbnail: { name: string; bytes: Buffer } | undefined;
    if (current.publishedId) {
      // Main can display Steam-only fields. Copy those too, without modifying its local drafts.
      const sourcePreview = current.previewPath ?? path.join(root, "thumbnail.png");
      const snapshot = listingSnapshot(mainDir, sourcePreview);
      const infoSnapshot = JSON.stringify(current);
      const editorSnapshot = () =>
        JSON.stringify(
          vscode.workspace.textDocuments
            .filter((d) => d.uri.scheme === "file" && isInsideDir(mainDir, d.uri.fsPath))
            .map((d) => [d.uri.fsPath, d.getText()])
        );
      const beforeEditors = editorSnapshot();
      this.uploading = true;
      this.uploadAbort = new AbortController();
      this.post({ type: "uploadState", busy: true });
      this.progress("download", "Copying main Workshop information", 0, 1);
      try {
        const done = await runBridge(
          this.context,
          {
            action: "query",
            appId: this.options.meta.steamAppId,
            itemId: current.publishedId,
            languages: STEAM_LANGUAGES.map((l) => l.api),
          },
          this.options.log,
          undefined,
          this.uploadAbort.signal
        );
        if (done.action !== "query" || !done.item)
          throw new Error("Steam returned no main item. Refresh it before creating a legacy version.");
        const remote = done.item;
        current.description ??= remote.description;
        for (const [lang, translation] of Object.entries(done.translations)) {
          if (!STEAM_LANGUAGES.some((l) => l.api === lang)) continue;
          const local = { ...current.translations[lang] };
          if (local.title === undefined && translation.title !== remote.title)
            local.title = translation.title;
          if (local.description === undefined && translation.description !== remote.description)
            local.description = translation.description;
          if (Object.keys(local).length) current.translations[lang] = local;
        }
        if (!fs.existsSync(path.join(mainDir, "dependencies.json")))
          requirements = { apps: remote.appDependencies, items: remote.children };
        if (!fs.existsSync(path.join(mainDir, PREVIEWS_DIR))) {
          gallery = {
            images: [],
            videos: remote.additionalPreviews.filter((p) => p.type === 1).map((p) => p.urlOrVideoId),
          };
          for (const [index, preview] of remote.additionalPreviews.filter((p) => p.type === 0).entries()) {
            const extension = path
              .extname(preview.originalFileName || new URL(preview.urlOrVideoId).pathname)
              .toLowerCase();
            const name = `preview-${index + 1}${[".png", ".jpg", ".jpeg", ".gif"].includes(extension) ? extension : ".png"}`;
            gallery.images.push({
              name,
              bytes: await download(preview.urlOrVideoId, this.uploadAbort.signal),
            });
          }
        }
        if (!current.previewPath && remote.previewUrl) {
          const bytes = await download(remote.previewUrl, this.uploadAbort.signal);
          const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? ".jpg" : ".png";
          thumbnail = { name: `thumbnail${extension}`, bytes };
        }
        if (
          listingSnapshot(mainDir, sourcePreview) !== snapshot ||
          JSON.stringify(this.publishInfo(root, true)) !== infoSnapshot ||
          editorSnapshot() !== beforeEditors
        )
          throw new ListingChangedError(
            "The main listing changed while copying Workshop information. Create the legacy version again to use the current files."
          );
      } finally {
        this.uploading = false;
        this.uploadAbort = undefined;
        this.endProgress("download");
      }
    }
    const key = createLegacyVersion(mainDir, input, current, readSource);
    if (requirements) writeDependencies(destination, requirements);
    if (gallery) {
      const previewsDir = path.join(destination, PREVIEWS_DIR);
      fs.mkdirSync(previewsDir, { recursive: true });
      for (const { name, bytes } of gallery.images) fs.writeFileSync(path.join(previewsDir, name), bytes);
      writePreviewOrder(
        destination,
        gallery.images.map((p) => p.name)
      );
      writeVideos(destination, gallery.videos);
    }
    if (thumbnail) {
      fs.writeFileSync(path.join(destination, thumbnail.name), thumbnail.bytes);
      updateLegacyItem(destination, { preview: thumbnail.name });
    }
    this.legacyKey = key;
    this.watchListing();
    await this.postInfo();
    this.notify(
      `Created legacy ${legacyVersion(input).supportedVersion}. Its first upload uses this project's current mod files. Later uploads can change Workshop information only.`
    );
  }

  /**
   * The description, translation and changelog files are edited in the editor,
   * not here, so the panel follows them: a change to one of them re-posts
   * info, which is the path Reload takes. Re-created whenever the active mod
   * or the changelog setting changes, and once more when the folder is
   * materialised (a watcher on a folder that did not exist yet reports
   * nothing).
   */
  private watchListing(): void {
    for (const w of this.listingWatchers.splice(0)) w.dispose();
    const root = this.active;
    if (this.disposed || !root) return;
    const dir = this.listingDirectory(root);
    const changed = (): void => {
      clearTimeout(this.listingReload);
      this.listingReload = setTimeout(() => {
        if (!this.uploading) void this.postInfo();
      }, LISTING_RELOAD_MS);
    };
    // The changelog may sit outside the workshop folder (px.workshop.changelog
    // takes any path), so it is watched from ITS parent, as both a file and a
    // folder of entries.
    const changelog = this.changelogPath(root);
    const base = path.basename(changelog);
    for (const pattern of [
      new vscode.RelativePattern(
        vscode.Uri.file(dir),
        "{item.json,dependencies.json,description.*,translations/*/*,previews/*}"
      ),
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(changelog)), `{${base},${base}/*}`),
    ]) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(changed);
      watcher.onDidCreate(changed);
      watcher.onDidDelete(changed);
      this.listingWatchers.push(watcher);
    }
  }

  /** Where the changenote lookup points: px.workshop.changelog, resolved. */
  private changelogPath(root: string): string {
    return path.resolve(
      this.listingDirectory(root),
      (this.legacyKey
        ? DEFAULT_CHANGELOG
        : (vscode.workspace.getConfiguration("px").get<string>("workshop.changelog") ?? "")
      ).trim() || DEFAULT_CHANGELOG
    );
  }

  static show(context: vscode.ExtensionContext, options: WorkshopPanelOptions): void {
    const existing = WorkshopPanel.instance;
    if (existing) {
      if (existing.uploading) {
        existing.panel.reveal();
        return;
      }
      existing.options = options;
      if (options.active && options.active !== existing.active) {
        existing.active = options.active;
        existing.legacyKey = null;
        existing.watchListing();
      }
      existing.panel.reveal();
      void existing.postInfo();
      return;
    }
    WorkshopPanel.instance = new WorkshopPanel(context, options);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.uploadAbort?.abort();
    WorkshopPanel.instance = undefined;
    clearTimeout(this.listingReload);
    for (const w of this.listingWatchers.splice(0)) w.dispose();
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage({ target: this.target(), ...message });
  }

  /**
   * A webview URI for a local file, with the file's mtime as the query so a
   * replaced image is not served from the webview's cache. `Uri.with` rather
   * than string concatenation: `asWebviewUri` may already carry a query, and
   * appending a second `?` produced a URI the webview could not resolve.
   *
   * Also makes sure the file's folder is a localResourceRoot. Without one the
   * webview blocks the request and the image silently stays blank, which is
   * what happened to `previews/` for every mod whose px.workshop.dir points
   * outside the mod folder.
   */
  private fileUri(file: string): string {
    this.ensureResourceRoot(path.dirname(file));
    const stamp = (() => {
      try {
        return Math.floor(fs.statSync(file).mtimeMs);
      } catch {
        return 0;
      }
    })();
    return this.panel.webview
      .asWebviewUri(vscode.Uri.file(file))
      .with({ query: `v=${stamp}` })
      .toString();
  }

  private ensureResourceRoot(dir: string): void {
    if (this.disposed) return;
    if (this.resourceRoots.some((r) => isInsideDir(r.fsPath, dir))) return;
    this.resourceRoots = [...this.resourceRoots, vscode.Uri.file(dir)];
    this.panel.webview.options = { ...this.panel.webview.options, localResourceRoots: this.resourceRoots };
  }

  // All user feedback goes through VS Code notifications plus the output
  // channel - never a transient in-panel surface. The message survives
  // closing the panel, and errors leave a trace to re-read.
  /**
   * Shown once per mod, when the first toolkit upload creates `.pxignore`:
   * the exclusions exist only on this path, and a later launcher upload of
   * the same folder would ship everything.
   */
  private explainPxIgnore(root: string): void {
    void vscode.window
      .showInformationMessage(
        `Created ${PXIGNORE_FILE} in the mod: git, editor and toolkit files stay out of this upload. ` +
          "That only holds for uploads made through the toolkit; the Paradox launcher uploads the whole folder.",
        "Open .pxignore"
      )
      .then((choice) => {
        if (choice) void vscode.window.showTextDocument(vscode.Uri.file(path.join(root, PXIGNORE_FILE)));
      });
  }

  private notify(message: string, level: "info" | "warn" | "error" = "info"): void {
    this.options.log(`workshop: ${message}`);
    const full = `Paradox Modding Toolkit: ${message}`;
    if (level === "error") void vscode.window.showErrorMessage(full);
    else if (level === "warn") void vscode.window.showWarningMessage(full);
    else void vscode.window.showInformationMessage(full);
  }

  /**
   * A caught error as a dialog: a toast folds long advice behind a chevron,
   * and the Steam advice is the part that matters. The raw error is logged.
   */
  private notifyError(friendly: string, e: unknown): void {
    this.options.log(`workshop: ${friendly} [raw: ${e instanceof Error ? e.message : String(e)}]`);
    void vscode.window.showErrorMessage(`Workshop: ${friendly}`);
  }

  /**
   * The upload result as a toast with the item page one click away, in the
   * Steam client first. It names the mod and the parts that went, since the
   * panel that said what would go may be behind the editor by now. One line:
   * a VS Code notification renders no line breaks.
   */
  private notifyUploaded(itemId: string, name: string, createdNow: boolean, parts: string[]): void {
    void vscode.window
      .showInformationMessage(
        `Upload complete: ${name} ${createdNow ? "uploaded" : "updated"}. ` +
          (parts.length ? `Sent: ${parts.join(", ")}. ` : "") +
          "Subscribers get it within minutes.",
        "Open in Steam",
        "Open in Browser"
      )
      .then((choice) => {
        if (choice === "Open in Steam")
          void vscode.env.openExternal(vscode.Uri.parse(workshopSteamUrl(itemId)));
        else if (choice === "Open in Browser")
          void vscode.env.openExternal(vscode.Uri.parse(workshopUrl(itemId)));
      });
  }

  private async buildInfo(root: string): Promise<WorkshopModInfo> {
    const { meta } = this.options;
    const workshopDir = this.listingDirectory(root);
    // A listing kept as Markdown is moved to BBCode the first time it is read:
    // the panel previews BBCode only, and a .md preview never looked like Steam.
    const hasDirtyListing = vscode.workspace.textDocuments.some(
      (doc) => doc.isDirty && doc.uri.scheme === "file" && isInsideDir(workshopDir, doc.uri.fsPath)
    );
    const migrated =
      hasListingFiles(workshopDir) && !hasDirtyListing ? migrateMarkdownListing(workshopDir) : [];
    if (migrated.length) {
      this.notify(
        `Converted description.md to description.bbcode in ${migrated.length === 1 && migrated[0] === "." ? "the listing folder" : migrated.join(", ")}: the listing keeps the format Steam takes.`
      );
    }
    const info = this.publishInfo(root);
    const previewPath = info?.previewPath ?? (this.legacyKey ? null : findPreview(root, null));
    let previewTooLarge = false;
    try {
      if (previewPath) previewTooLarge = fs.statSync(previewPath).size >= PREVIEW_MAX_BYTES;
    } catch {
      /* unreadable preview = none */
    }
    const changelogPath = this.changelogPath(root);
    const changelogRel = path.relative(workshopDir, changelogPath);
    return {
      root,
      legacyKey: this.legacyKey,
      legacyVersions: legacyVersions(workshopDirFor(root, meta)),
      legacyContent: this.legacyKey ? readLegacyItem(workshopDir).legacy.content : null,
      visibility: (readItemJson(workshopDir)?.visibility as WorkshopModInfo["visibility"]) ?? null,
      gameName: meta.name,
      descriptorMissing: info === null,
      name: info?.name ?? null,
      tags: info?.tags ?? [],
      knownTags: meta.descriptor === "mod" ? [...LAUNCHER_TAGS] : [],
      publishedId: info?.publishedId ?? null,
      description: info?.description ?? "",
      translations: info?.translations ?? {},
      markdown: info?.markdown ?? [],
      previewUri: previewPath ? this.fileUri(previewPath) : null,
      previewName: previewPath ? path.basename(previewPath) : null,
      previewTooLarge,
      changeNoteSuggestion: await lastCommitSubject(root),
      releaseNote: await releaseNoteFor(root),
      changelogNote: this.changelogNote(root, info?.version ?? null),
      changelogDisplay:
        changelogRel === "" || changelogRel.startsWith("..")
          ? changelogPath
          : changelogRel.replace(/\\/g, "/"),
      workshopDirCustom:
        (vscode.workspace.getConfiguration("px").get<string>("workshop.dir") ?? "").trim() !== "",
      changelogKind: changelogKindOf(changelogPath),
      changelogCandidates: changelogCandidates(root, workshopDir, changelogPath),
      version: info?.version ?? null,
      supportedVersion: info?.supportedVersion ?? null,
      workshopDir,
      filesPresent: hasListingFiles(workshopDir),
      steamLanguages: [...STEAM_LANGUAGES],
      suggestedLanguages: suggestedLanguages(root, this.options.meta),
      gameLanguages: gameLanguages(),
      checks: info
        ? preflight({
            name: info.name,
            // Steam's 8000-byte cap is on the BBCode, not on the Markdown source.
            description: descriptionBBCode(info, "", info.description ?? ""),
            tags: info.tags,
            previewPath,
            previewBytes: previewPath ? (fs.statSync(previewPath).size ?? null) : null,
            supportedVersion: info.supportedVersion,
            gameVersion: this.legacyKey ? null : detectGameVersion(this.options.gamePath),
          })
        : [],
      previews: this.previewsInfo(workshopDir),
      dependencies: readDependencies(workshopDir),
      dependencyCandidates: this.dependencyCandidates(root),
    };
  }

  /** One step of a running job. `step: null` (see `endProgress`) ends it. */
  private progress(job: ProgressJob, step: string, done: number, total: number): void {
    this.post({ type: "progress", job, step, done, total });
  }

  private endProgress(job: ProgressJob): void {
    this.post({ type: "progress", job, step: null, done: 0, total: 0 });
    this.post({ type: "uploadState", busy: false });
  }

  private previewsInfo(workshopDir: string): WorkshopModInfo["previews"] {
    const previews = readPreviews(workshopDir);
    if (!previews) return null;
    return {
      dir: path.join(workshopDir, PREVIEWS_DIR),
      images: previews.images.map((p) => ({ name: path.basename(p), uri: this.fileUri(p) })),
      videos: previews.videos,
    };
  }

  /** Installed Workshop mods of this game, the declared dependencies first. */
  private dependencyCandidates(root: string): WorkshopModInfo["dependencyCandidates"] {
    const { meta } = this.options;
    const workshopRoots = findSteamLibraries()
      .map((lib) => path.join(lib, "steamapps", "workshop", "content", String(meta.steamAppId)))
      .filter((p) => fs.existsSync(p));
    return dependencyCandidates({ declared: declaredDependencies(root), workshopRoots, exclude: [root] })
      .filter((c) => /^\d+$/.test(c.itemId))
      .map((c) => ({ itemId: c.itemId, label: c.label, declared: c.declared }));
  }

  /** Missing items return null. Failed reads retain their cause and block reconciliation. */
  private async queryItem(itemId: string): Promise<ItemDetails | null> {
    const done = await runBridge(
      this.context,
      { action: "query", appId: this.options.meta.steamAppId, itemId },
      this.options.log,
      undefined,
      this.uploadAbort?.signal
    );
    return done.action === "query" ? done.item : null;
  }

  private async postInit(): Promise<void> {
    const target = this.target();
    const active = this.active;
    const info = active ? await this.buildInfo(active) : null;
    if (active !== this.active || target?.legacyKey !== this.legacyKey) return;
    this.post({
      type: "init",
      mods: this.options.mods,
      active: this.active,
      info,
    });
  }

  private async postInfo(): Promise<void> {
    if (!this.active) return;
    const target = this.target();
    try {
      const info = await this.buildInfo(this.active);
      if (this.matchesTarget({ target })) this.post({ type: "info", active: this.active, info });
    } catch (e) {
      if (this.matchesTarget({ target }))
        this.notifyError(`Reading the Workshop listing failed: ${friendlyError(e, this.options.meta)}`, e);
    }
  }

  private async onMessage(message: AppToHost): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    if (message.type !== "ready" && !this.matchesTarget(message)) {
      this.notify("The selected Workshop item changed. Review the current item and try again.", "warn");
      return;
    }
    if (this.uploading && message.type !== "ready") return;
    switch (message.type) {
      case "ready":
        await this.postInit();
        return;
      case "selectMod":
        // The app only offers paths the host listed, but the message is still text from a webview.
        if (!this.options.mods.some((m) => m.path === message.path)) return;
        this.active = message.path;
        this.legacyKey = null;
        this.watchListing();
        await this.postInfo();
        return;
      case "selectListing":
        if (!root) return;
        if (message.key !== null) {
          if (!legacyVersions(workshopDirFor(root, meta)).some((v) => v.key === message.key))
            throw new Error("That legacy version no longer exists. Reload the Workshop panel.");
          readLegacyItem(legacyDirectory(workshopDirFor(root, meta), message.key));
        }
        this.legacyKey = message.key;
        this.watchListing();
        await this.postInfo();
        return;
      case "createLegacy":
        await this.createLegacy();
        return;
      case "stopWaiting":
        this.uploadAbort?.abort();
        return;
      case "setVisibility":
        if (!root || ![0, 1, 2, 3].includes(message.value)) return;
        this.assertSaved(path.join(this.listingDirectory(root), "item.json"));
        if (this.legacyKey) updateLegacyItem(this.listingDirectory(root), { visibility: message.value });
        else upsertItemJson(this.listingDirectory(root), { visibility: message.value });
        await this.postInfo();
        return;
      case "browseMod": {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: "Pick a mod folder outside the workspace to upload",
          openLabel: "Upload This Mod",
        });
        const dir = picked?.[0]?.fsPath;
        if (!dir) return;
        // A folder with no descriptor is taken too: the panel then offers to create one.
        if (!this.options.mods.some((m) => m.path === dir)) {
          this.options.mods.push({ label: readModName(dir), path: dir, hint: "outside the workspace" });
        }
        this.active = dir;
        this.legacyKey = null;
        this.watchListing();
        await this.postInit();
        return;
      }
      case "saveLocal": {
        if (!root) return;
        // The folder is the canonical store; workshop.json keeps only ids.
        this.assertSaved(this.listingDirectory(root));
        writeListingFiles(this.listingDirectory(root), {
          description: message.description,
          translations: message.translations as Record<string, WorkshopTranslation>,
        });
        return;
      }
      case "refresh":
        await this.queryLive(message.languages);
        return;
      case "upload":
        await this.upload(message);
        return;
      case "openPage": {
        const id = root ? this.publishInfo(root)?.publishedId : null;
        if (!id) return;
        // The client's own page beats the browser's when Steam is installed:
        // it is where subscribing, rating and the change notes already live.
        const url = findSteamLibraries().length ? workshopSteamUrl(id) : workshopUrl(id);
        void vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
      case "createDescriptor": {
        // For the mod this panel is on, which need not be the focused one or in the workspace at all.
        if (!root || this.legacyKey) return;
        const file = createDescriptorFile(root, meta.id, this.options.gamePath, log);
        await this.postInfo();
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
        return;
      }
      case "setField":
        await this.setField(message.field, message.value);
        return;
      case "setTags":
        await this.setTags(message.tags);
        return;
      case "pickPreview":
        await this.pickPreview();
        return;
      case "pullListing":
        await this.pullListing(message.parts);
        return;
      case "reorderPreviews": {
        if (!root) return;
        this.assertSaved(path.join(this.listingDirectory(root), PREVIEWS_DIR));
        writePreviewOrder(
          this.listingDirectory(root),
          message.names.filter((n) => path.basename(n) === n)
        );
        await this.postInfo();
        return;
      }
      case "openListingFile":
        await this.openListingFile(message.lang);
        return;
      case "reload":
        await this.postInfo();
        return;
      case "notify":
        this.notify(message.message, message.warn ? "warn" : "info");
        return;
      case "loadDlc":
        await this.loadDlc(message.allowSteam);
        return;
      case "resolveItems":
        await this.resolveItems(message.ids);
        return;
      case "setChangelogSource":
        await this.setChangelogSource(message.path);
        return;
      case "createChangelog":
        await this.createChangelog();
        return;
      case "openChangelogEntry":
        await this.openChangelogEntry();
        return;
      case "openVideo":
        // The app parses ids out of links; this is still text from a webview.
        if (/^[\w-]{6,20}$/.test(message.id)) {
          void vscode.env.openExternal(vscode.Uri.parse(`https://www.youtube.com/watch?v=${message.id}`));
        }
        return;
      case "setDependencies": {
        if (!root) return;
        this.assertSaved(path.join(this.listingDirectory(root), "dependencies.json"));
        writeDependencies(this.listingDirectory(root), {
          apps: message.apps.filter((a) => Number.isInteger(a) && a > 0),
          items: message.items.filter((i) => /^\d+$/.test(i)),
        });
        await this.postInfo();
        return;
      }
      case "addPreviews": {
        if (!root) return;
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { Images: ["png", "jpg", "jpeg", "gif"] },
          title: "Add preview images",
        });
        if (!picked?.length) return;
        const dir = path.join(this.listingDirectory(root), PREVIEWS_DIR);
        fs.mkdirSync(dir, { recursive: true });
        for (const uri of picked) fs.copyFileSync(uri.fsPath, path.join(dir, path.basename(uri.fsPath)));
        await this.postInfo();
        return;
      }
      case "removePreview": {
        if (!root || path.basename(message.name) !== message.name) return;
        fs.rmSync(path.join(this.listingDirectory(root), PREVIEWS_DIR, message.name), { force: true });
        await this.postInfo();
        return;
      }
      case "setVideos": {
        if (!root) return;
        this.assertSaved(path.join(this.listingDirectory(root), PREVIEWS_DIR, "videos.txt"));
        writeVideos(
          this.listingDirectory(root),
          message.ids.filter((id) => /^[\w-]{6,20}$/.test(id))
        );
        await this.postInfo();
        return;
      }
      case "openPreviewsFolder": {
        if (!root) return;
        const dir = path.join(this.listingDirectory(root), PREVIEWS_DIR);
        fs.mkdirSync(dir, { recursive: true });
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(dir));
        return;
      }
      case "bbcodeHelp":
        await vscode.commands.executeCommand("px.openBBCodeHelp");
        return;
    }
  }

  /**
   * The DLC the requirement grid offers. Read from the install, which lists
   * exactly the DLC a mod can require: Steam's list for the same app also
   * carries Chapter bundles and the Subscription, and those have no folder in
   * the game. Steam is the fallback for when the game path is unknown.
   */
  private async loadDlc(allowSteam: boolean): Promise<void> {
    const { meta, gamePath } = this.options;
    if (gamePath) {
      const list = readGameDlc(gamePath, meta.dlcIconDir).map<DlcChoice>((d) => ({
        steamId: d.steamId,
        name: d.name,
        iconUri: d.iconPath ? this.dlcIconUri(d.iconPath) : null,
      }));
      if (list.length) {
        this.post({ type: "dlc", list, source: "game", error: null });
        return;
      }
    }
    if (!allowSteam) {
      this.post({ type: "dlc", list: [], source: "none", error: null });
      return;
    }
    try {
      const done = await runBridge(this.context, { action: "dlc", appId: meta.steamAppId }, this.options.log);
      const dlc = done.action === "dlc" ? done.dlc : [];
      this.post({
        type: "dlc",
        list: dlc.map<DlcChoice>((d) => ({ steamId: d.appId, name: d.name, iconUri: null })),
        source: "steam",
        error: null,
      });
    } catch (e) {
      this.post({ type: "dlc", list: [], source: "none", error: friendlyError(e, meta) });
    }
  }

  /**
   * One DLC icon as a data URI. The game ships them as .dds, which no browser
   * decodes, so they are decoded to PNG once and cached under globalStorage;
   * the source file's mtime is in the cache file's name, so a game patch
   * invalidates the entry without a staleness check. Inline rather than a
   * webview file URI: 16 icons at 96 px are ~350 KB, and a data URI needs no
   * resource root, which is what silently blocked them as files.
   */
  private dlcIconUri(iconPath: string): string | null {
    try {
      const stamp = Math.floor(fs.statSync(iconPath).mtimeMs);
      if (path.extname(iconPath).toLowerCase() !== ".dds") return this.fileUri(iconPath);
      const dir = path.join(this.context.globalStorageUri.fsPath, "dlcIcons");
      const cached = path.join(
        dir,
        `${this.options.meta.id}-${path.basename(iconPath, ".dds")}-${stamp}.png`
      );
      if (!fs.existsSync(cached)) {
        const img = downscale(decodeDds(fs.readFileSync(iconPath)), DLC_ICON_MAX_DIM);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(cached, encodePng(img.width, img.height, img.pixels));
      }
      return `data:image/png;base64,${fs.readFileSync(cached).toString("base64")}`;
    } catch (e) {
      this.options.log(`workshop: DLC icon ${iconPath} could not be decoded: ${String(e)}`);
      return null;
    }
  }

  /**
   * Titles of required Workshop items that are not installed mods, so the list
   * reads as names rather than bare ids. Answers with null for an id Steam
   * does not know, which is the state worth showing.
   */
  private async resolveItems(ids: string[]): Promise<void> {
    const wanted = ids.filter((id) => /^\d+$/.test(id) && !this.itemTitles.has(id)).slice(0, 20);
    if (!wanted.length) return;
    for (const id of wanted) {
      const item = await this.queryItem(id);
      this.itemTitles.set(id, item?.title || null);
    }
    this.post({
      type: "itemTitles",
      titles: Object.fromEntries(wanted.map((id) => [id, this.itemTitles.get(id) ?? null])),
    });
  }

  /** Point px.workshop.changelog at a changelog the mod already has. */
  private async setChangelogSource(target: string): Promise<void> {
    const root = this.active;
    if (!root || this.legacyKey || !path.isAbsolute(target) || !fs.existsSync(target)) return;
    const workshopDir = this.listingDirectory(root);
    // A relative value travels with the repo; an absolute one only works here.
    const rel = path.relative(workshopDir, target).split(path.sep).join("/");
    const value = rel !== "" && !rel.startsWith("..") ? rel : target;
    try {
      await vscode.workspace
        .getConfiguration("px", vscode.Uri.file(root))
        .update("workshop.changelog", value, vscode.ConfigurationTarget.WorkspaceFolder);
      this.notify(`Changenotes now come from ${target}.`);
    } catch (e) {
      this.notifyError(`Setting px.workshop.changelog failed - ${String(e)}`, e);
    }
    this.watchListing();
    await this.postInfo();
  }

  /**
   * Open the changelog entry the changenote comes from. It resolves the same
   * way the card's preview did (setting + mod version) and creates nothing:
   * the button only shows while an entry exists.
   */
  private async openChangelogEntry(): Promise<void> {
    const root = this.active;
    if (!root) return;
    const note = this.changelogNote(root, this.publishInfo(root)?.version ?? null);
    if (!note) return;
    // `source` is the entry relative to the workshop folder, or absolute when
    // the changelog lives outside it; resolve covers both.
    const file = path.resolve(this.listingDirectory(root), note.source);
    if (!fs.existsSync(file)) return;
    await vscode.window.showTextDocument(vscode.Uri.file(file), {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
    });
  }

  /**
   * Create the entry for the current version and open it. The folder is made
   * on demand (nothing is written on a plain panel open), and the file is
   * seeded with a heading plus the last commit subject so it is not empty.
   */
  private async createChangelog(): Promise<void> {
    const root = this.active;
    if (!root) return;
    const version = this.publishInfo(root)?.version;
    if (!version) {
      this.notify("The mod has no version yet; set one before creating a changelog entry.", "warn");
      return;
    }
    const dir = this.changelogPath(root);
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
      await vscode.window.showTextDocument(vscode.Uri.file(dir), { preview: false });
      return;
    }
    if (!fs.existsSync(dir) && !(await this.confirmWorkshopDirPlacement(dir))) return;
    const file = path.join(dir, `${version}.md`);
    try {
      if (!fs.existsSync(file)) {
        const commit = await lastCommitSubject(root);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, `# ${version}\n\n${commit ? `- ${commit}\n` : ""}`, "utf8");
      }
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
    } catch (e) {
      this.notifyError(`Creating the changelog entry failed - ${String(e)}`, e);
    }
    await this.postInfo();
  }

  /**
   * Modal warning before CREATING a workshop folder inside the game's
   * Documents mod folder. Every installed mod lives there, and the default
   * `px.workshop.dir` (`../workshop`) of any mod in that folder resolves to
   * the same `<mod folder>/workshop` for all of them, so listings would
   * overwrite each other. Returns true when creating is fine (or confirmed).
   */
  private async confirmWorkshopDirPlacement(dir: string): Promise<boolean> {
    const gameModDir = gameDocsSubdir(this.options.meta, "mod");
    if (!gameModDir || !isInsideDir(gameModDir, dir)) return true;
    const choice = await vscode.window.showWarningMessage(
      `Create the workshop folder inside the game's mod folder (${dir})? Every installed mod lives there ` +
        `and resolves its default workshop location to the same place, so listings can overwrite each other. ` +
        `Clear px.workshop.dir so the listing lives inside the mod (.px-toolkit/workshop), or point it outside.`,
      "Create Anyway"
    );
    return choice === "Create Anyway";
  }

  /**
   * Open (creating if needed) a listing file of the workshop folder. The
   * panel only previews this text, so the file has to be reachable even
   * before the folder exists: it is then written from whatever store is
   * canonical right now (readPublishInfo = the folder if it exists, else the
   * pre-0.4.0 workshop.json drafts), item.json included, so nothing drafted
   * is left behind in the old store.
   */
  private async openListingFile(lang: string | null): Promise<void> {
    const root = this.active;
    if (!root) return;
    // The webview (and workshop.json) name the language; only the fixed Steam
    // table may become a path segment.
    if (lang !== null && !STEAM_LANGUAGES.some((l) => l.api === lang)) return;
    const dir = this.listingDirectory(root);
    if (!hasListingFiles(dir)) {
      if (!(await this.confirmWorkshopDirPlacement(dir))) return;
      const drafts = this.publishInfo(root);
      try {
        writeListingFiles(dir, {
          description: drafts?.description ?? "",
          translations: drafts?.translations ?? {},
        });
        upsertItemJson(dir, {
          ...(drafts?.name ? { title: drafts.name } : {}),
          ...(drafts?.publishedId ? { publishedfileid: drafts.publishedId } : {}),
          ...(drafts?.tags.length ? { tags: drafts.tags } : {}),
        });
      } catch (e) {
        this.notifyError(`Creating the workshop folder failed - ${String(e)}`, e);
        return;
      }
      this.notify(`Created the listing folder at ${dir}.`);
      this.watchListing();
      await this.postInfo();
    }
    const chosen = descriptionFile(lang ? langDir(dir, lang) : dir);
    if (!fs.existsSync(chosen.file)) {
      // Seed a missing file with the draft the store holds, so nothing is lost.
      const info = this.publishInfo(root);
      let seed = (lang ? info?.translations[lang]?.description : info?.description) ?? "";
      // That draft can still be the BBCode workshop.json kept before 0.4.0.
      if (chosen.markdown && seed !== "" && !info?.markdown.includes(lang ?? "")) {
        seed = bbcodeToMarkdown(seed);
      }
      fs.mkdirSync(path.dirname(chosen.file), { recursive: true });
      fs.writeFileSync(chosen.file, seed, "utf8");
    }
    // Beside, not in this column: the panel stays visible, so its watcher-fed
    // preview updates as the file is saved.
    await vscode.window.showTextDocument(vscode.Uri.file(chosen.file), {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
    });
  }

  /** Write one descriptor/metadata scalar; empty input leaves the file alone. */
  private async setField(field: "title" | "version" | "supportedVersion", value: string): Promise<void> {
    const { meta } = this.options;
    const root = this.active;
    const v = value.trim();
    if (!root || v === "") {
      await this.postInfo();
      return;
    }
    try {
      if (this.legacyKey) {
        if (field !== "title")
          throw new Error("Legacy versions are fixed. Create a separate project to change the mod files.");
        const dir = this.listingDirectory(root);
        this.assertSaved(path.join(dir, "item.json"));
        updateLegacyItem(dir, { title: v });
      } else if (meta.descriptor === "mod") {
        const file = path.join(root, "descriptor.mod");
        this.assertSaved(file);
        const key = field === "title" ? "name" : field === "version" ? "version" : "supported_version";
        fs.writeFileSync(file, upsertDescriptorValue(fs.readFileSync(file, "utf8"), key, v), "utf8");
      } else {
        const file = path.join(root, METADATA_REL_PATH);
        this.assertSaved(file);
        const md = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        const key = field === "title" ? "name" : field === "version" ? "version" : "supported_game_version";
        md[key] = v;
        fs.writeFileSync(file, JSON.stringify(md, null, 2) + "\n", "utf8");
      }
      // Keep item.json's title in step with the descriptor once files track it.
      const dir = this.listingDirectory(root);
      if (field === "title" && hasListingFiles(dir) && readItemJson(dir)) {
        upsertItemJson(dir, { title: v });
      }
    } catch (e) {
      this.notifyError(`Writing the descriptor failed - ${e instanceof Error ? e.message : String(e)}`, e);
    }
    await this.postInfo();
  }

  private async setTags(tags: string[]): Promise<void> {
    const { meta } = this.options;
    const root = this.active;
    if (!root) return;
    const clean = tags.map((t) => t.trim()).filter((t, i, all) => t !== "" && all.indexOf(t) === i);
    try {
      if (this.legacyKey) {
        const dir = this.listingDirectory(root);
        this.assertSaved(path.join(dir, "item.json"));
        updateLegacyItem(dir, { tags: clean });
      } else if (meta.descriptor === "mod") {
        const file = path.join(root, "descriptor.mod");
        this.assertSaved(file);
        fs.writeFileSync(file, upsertDescriptorBlock(fs.readFileSync(file, "utf8"), "tags", clean), "utf8");
      } else {
        const file = path.join(root, METADATA_REL_PATH);
        this.assertSaved(file);
        const md = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        md.tags = clean;
        fs.writeFileSync(file, JSON.stringify(md, null, 2) + "\n", "utf8");
      }
    } catch (e) {
      this.notifyError(`Writing the tags failed - ${e instanceof Error ? e.message : String(e)}`, e);
    }
    await this.postInfo();
  }

  /** File dialog -> copy into the mod as thumbnail.<ext> (the name findPreview knows). */
  private async pickPreview(): Promise<void> {
    const { meta } = this.options;
    const root = this.active;
    if (!root) return;
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: { Images: ["png", "jpg", "jpeg"] },
      title: "Pick the Workshop preview image",
    });
    const src = picked?.[0]?.fsPath;
    if (!src) return;
    try {
      const dir = this.legacyKey ? this.listingDirectory(root) : root;
      this.assertSaved(this.legacyKey ? path.join(dir, "item.json") : path.join(root, "descriptor.mod"));
      const ext = path.extname(src).toLowerCase() || ".png";
      const dest = path.join(dir, `thumbnail${ext}`);
      if (path.resolve(src).toLowerCase() !== path.resolve(dest).toLowerCase()) {
        fs.copyFileSync(src, dest);
      }
      if (this.legacyKey) updateLegacyItem(dir, { preview: path.basename(dest) });
      else if (meta.descriptor === "mod") {
        const file = path.join(root, "descriptor.mod");
        fs.writeFileSync(
          file,
          upsertDescriptorValue(fs.readFileSync(file, "utf8"), "picture", path.basename(dest)),
          "utf8"
        );
      }
      if (fs.statSync(dest).size >= PREVIEW_MAX_BYTES) {
        this.notify(
          "The image is 1 MB or larger; Steam rejects it, uploads keep the current preview.",
          "warn"
        );
      }
    } catch (e) {
      this.notifyError(`Setting the preview failed - ${e instanceof Error ? e.message : String(e)}`, e);
    }
    await this.postInfo();
  }

  /**
   * Download the chosen parts of the live listing into the workshop folder.
   * Translations are written for every language whose text differs from the
   * default (Steam serves the default as fallback for everything else). The
   * app confirms first - this REPLACES the matching local files.
   */
  private async pullListing(parts: PullParts): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    if (!root) return;
    const info = this.publishInfo(root);
    const itemId = info?.publishedId;
    if (!itemId) {
      this.notify("The mod has no Workshop item to pull from.", "warn");
      return;
    }
    const dir = this.listingDirectory(root);
    if (!hasListingFiles(dir) && !(await this.confirmWorkshopDirPlacement(dir))) return;
    const steps = ["Ask Steam"];
    if (parts.details || parts.description || parts.translations) steps.push("Text");
    if (parts.previews || parts.thumbnail) steps.push("Images");
    if (parts.requirements) steps.push("Requirements");
    const step = (name: string, detail: string): void =>
      this.progress("download", `${name}: ${detail}`, Math.max(0, steps.indexOf(name)), steps.length);
    this.assertSaved(dir);
    const thumbnail = info?.previewPath ?? path.join(this.legacyKey ? dir : root, "thumbnail.png");
    let snapshot = listingSnapshot(dir, thumbnail);
    const assertUnchanged = (): void => {
      this.assertSaved(dir, thumbnail);
      if (listingSnapshot(dir, thumbnail) !== snapshot)
        throw new ListingChangedError(
          "The local Workshop files changed during the download. Reload and download again; the newer files were kept."
        );
    };
    this.uploading = true;
    this.uploadAbort = new AbortController();
    this.post({ type: "uploadState", busy: true });
    step("Ask Steam", "asking Steam…");
    try {
      const languages = parts.translations ? STEAM_LANGUAGES.map((l) => l.api) : [];
      const done = await runBridge(
        this.context,
        { action: "query", appId: meta.steamAppId, itemId, languages },
        log,
        undefined,
        this.uploadAbort.signal
      );
      if (done.action !== "query" || !done.item) throw new Error("Steam returned no item details");
      assertUnchanged();
      const item = done.item;
      const wrote: string[] = [];
      const skipped: string[] = [];

      if (parts.details || parts.description || parts.translations) {
        step("Text", "writing text…");
      }
      if (parts.details) {
        const patch = {
          title: item.title,
          publishedfileid: item.itemId,
          tags: item.tags,
          visibility: item.visibility,
        };
        if (this.legacyKey) updateLegacyItem(dir, patch);
        else upsertItemJson(dir, patch);
        wrote.push("item.json");
      }
      if (parts.description || parts.translations) {
        const current = this.publishInfo(root);
        const translations: Record<string, WorkshopTranslation> = parts.translations
          ? {}
          : { ...(current?.translations ?? {}) };
        if (parts.translations) {
          for (const [lang, t] of Object.entries(done.translations)) {
            const title = t.title !== item.title ? t.title : "";
            const description = t.description !== item.description ? t.description : "";
            if (title === "" && description === "") continue;
            translations[lang] = {
              ...(title !== "" ? { title } : {}),
              ...(description !== "" ? { description } : {}),
            };
          }
          wrote.push(`${Object.keys(translations).length} translation(s)`);
        }
        let description = current?.description ?? "";
        if (parts.description) {
          description = item.description;
          wrote.push(DESCRIPTION_BBCODE);
        }
        writeListingFiles(dir, { description, translations });
        // What Steam served is BBCode, so it lands as .bbcode whatever the
        // folder held before; a legacy description.md would shadow it on read.
        if (parts.description) writeSteamDescription(dir, description);
        if (parts.translations) {
          for (const [lang, t] of Object.entries(translations)) {
            if ((t.description ?? "").trim() !== "")
              writeSteamDescription(langDir(dir, lang), t.description as string);
          }
        }
      }

      if (parts.previews || parts.thumbnail) step("Images", "downloading images…");
      snapshot = listingSnapshot(dir, thumbnail);
      if (parts.previews) {
        const previewsDir = path.join(dir, PREVIEWS_DIR);
        fs.mkdirSync(previewsDir, { recursive: true });
        snapshot = listingSnapshot(dir, thumbnail);
        const images = item.additionalPreviews.filter((p) => p.type === 0);
        const names: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const p = images[i];
          const ext = path.extname(p.originalFileName || new URL(p.urlOrVideoId).pathname) || ".png";
          const base =
            path.basename(p.originalFileName || "", ext) || `steam-${String(i + 1).padStart(2, "0")}`;
          const name = `${base}${ext}`;
          step("Images", `downloading ${name} (${i + 1}/${images.length})…`);
          // One dead CDN link (Steam answers 404 for a gallery image for a
          // while after it is replaced) must not cost the parts after it.
          try {
            const bytes = await download(p.urlOrVideoId, this.uploadAbort.signal);
            assertUnchanged();
            fs.writeFileSync(path.join(previewsDir, name), bytes);
            snapshot = listingSnapshot(dir, thumbnail);
            names.push(name);
          } catch (e) {
            if (e instanceof ListingChangedError || this.uploadAbort.signal.aborted) throw e;
            skipped.push(`${name} (${e instanceof Error ? e.message : String(e)})`);
          }
        }
        if (names.length) writePreviewOrder(dir, names);
        writeVideos(
          dir,
          item.additionalPreviews.filter((p) => p.type === 1).map((p) => p.urlOrVideoId)
        );
        snapshot = listingSnapshot(dir, thumbnail);
        wrote.push(`${names.length} preview image(s)`);
      }
      if (parts.thumbnail && item.previewUrl) {
        const target = thumbnail;
        try {
          const bytes = await download(item.previewUrl, this.uploadAbort.signal);
          assertUnchanged();
          fs.writeFileSync(target, bytes);
          if (this.legacyKey) updateLegacyItem(dir, { preview: path.basename(target) });
          snapshot = listingSnapshot(dir, thumbnail);
          wrote.push(path.basename(target));
        } catch (e) {
          if (e instanceof ListingChangedError || this.uploadAbort.signal.aborted) throw e;
          skipped.push(`${path.basename(target)} (${e instanceof Error ? e.message : String(e)})`);
        }
      }

      if (parts.requirements) {
        step("Requirements", "writing requirements…");
        writeDependencies(dir, { apps: item.appDependencies, items: item.children });
        wrote.push("dependencies.json");
      }
      const summary = wrote.length
        ? `Wrote ${wrote.join(", ")} to ${dir}.`
        : "Nothing was selected to download.";
      if (skipped.length)
        this.notifyError(`${summary} Not downloaded: ${skipped.join("; ")}`, new Error(skipped.join("; ")));
      else this.notify(summary);
    } catch (e) {
      this.notifyError(`Pulling the listing failed - ${friendlyError(e, meta)}`, e);
    } finally {
      this.uploading = false;
      this.uploadAbort = undefined;
      this.endProgress("download");
    }
    await this.postInfo();
  }

  private async queryLive(languages: string[]): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    const target = this.target();
    try {
      const itemId = root ? this.publishInfo(root)?.publishedId : null;
      if (!itemId) {
        this.post({ type: "live", item: null, translations: {}, error: null });
        return;
      }
      this.post({ type: "liveBegin" });
      const done = await runBridge(
        this.context,
        { action: "query", appId: meta.steamAppId, itemId, languages: languages.slice(0, 40) },
        log
      );
      if (done.action !== "query") throw new Error("unexpected bridge reply");
      if (this.matchesTarget({ target }))
        this.post({ type: "live", item: done.item, translations: done.translations, error: null, target });
    } catch (e) {
      log(`workshop: live query failed: ${e instanceof Error ? e.message : String(e)}`);
      if (this.matchesTarget({ target }))
        this.post({ type: "live", item: null, translations: {}, error: friendlyError(e, meta), target });
    }
  }

  private async upload(message: Extract<AppToHost, { type: "upload" }>): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    if (!root || this.uploading) return;
    const wsDir = this.listingDirectory(root);
    const legacy = this.legacyKey !== null;
    this.assertSaved(path.join(wsDir, "item.json"));
    const info = this.publishInfo(root);
    if (!info) {
      this.notify("The mod has no descriptor; nothing can upload.", "error");
      return;
    }
    if (legacy) {
      const item = readLegacyItem(wsDir);
      if (item.legacy.content === "creating")
        throw new Error(
          "Steam item creation has an unknown result. Check your Workshop items before recovering the saved legacy ID. No second item will be created."
        );
      const initial = item.legacy.content === "new" || item.legacy.content === "ready";
      if (initial && (!message.content || !message.details))
        throw new Error("The first legacy upload must include mod files and item details.");
      if (!initial && message.content)
        throw new Error(
          "This legacy item's mod files are locked. Use a separate project to update legacy mod files."
        );
      if (info.publishedId && info.publishedId === this.publishInfo(root, true)?.publishedId)
        throw new Error("A legacy item cannot use the main item's Workshop ID.");
    }
    if (message.details && !info.name) {
      this.notify("The descriptor has no name= - the Workshop needs a title.", "error");
      return;
    }

    // The app's upload modal already confirmed (incl. the new-item case).
    let itemId = info.publishedId;
    this.uploading = true;
    this.uploadAbort = new AbortController();
    const steps: string[] = [];
    if (!itemId) steps.push("Create item");
    if (message.content) steps.push("Mod files");
    if (message.details || message.description) steps.push("Details");
    if (message.previews) steps.push("Previews");
    if (message.languages.length) steps.push("Translations");
    const stepOf = (name: string): number => Math.max(0, steps.indexOf(name));
    const step = (name: string, detail: string): void =>
      this.progress("upload", `${name}: ${detail}`, stepOf(name), steps.length);
    this.post({ type: "uploadState", busy: true });
    step(steps[0] ?? "Upload", "starting…");
    let staging: string | null = null;
    let unlock: (() => void) | undefined;
    let refreshAfterFailure = false;
    let pendingLegacyStage: "creating" | "submitted" | undefined;
    try {
      if (legacy) unlock = lockLegacyUpload(wsDir);
      let needsAgreement = false;
      const createdNow = !itemId;
      if (!itemId) {
        if (legacy) {
          const current = readLegacyItem(wsDir);
          if (current.legacy.content !== "new" || current.publishedfileid)
            throw new Error("The legacy item changed. Reload before uploading.");
          updateLegacyItem(wsDir, { legacy: { ...current.legacy, content: "creating" } });
          pendingLegacyStage = "creating";
        }
        step("Create item", "creating the Workshop item…");
        const created = await runBridge(
          this.context,
          { action: "create", appId: meta.steamAppId },
          log,
          undefined,
          this.uploadAbort.signal
        );
        if (created.action !== "create") throw new Error("unexpected bridge reply");
        itemId = created.itemId;
        log(`workshop: Steam created item ${itemId}; saving its local ID`);
        needsAgreement = created.needsToAcceptAgreement;
        // Persist BEFORE uploading: a failed upload must not orphan the item,
        // and for .mod games the uploaded descriptor then carries the id.
        if (legacy) {
          this.assertSaved(path.join(wsDir, "item.json"));
          const current = readLegacyItem(wsDir);
          updateLegacyItem(wsDir, {
            publishedfileid: itemId,
            legacy: { ...current.legacy, content: "ready" },
          });
          pendingLegacyStage = undefined;
        } else {
          this.assertSaved(
            meta.descriptor === "mod"
              ? path.join(root, "descriptor.mod")
              : path.join(root, ".px-toolkit", "workshop.json")
          );
          persistPublishedId(root, meta, itemId);
        }
        log(`workshop: created item ${itemId} for ${root}`);
      }

      // One query serves the preview replacement and the requirement diff;
      // a just-created item has nothing on Steam yet.
      const previews = message.previews ? readPreviews(wsDir) : null;
      const deps = message.requirements ? readDependencies(wsDir) : null;
      if (deps) steps.push("Requirements");
      const liveItem = !createdNow && (previews || deps) ? await this.queryItem(itemId) : null;
      if (!createdNow && (previews || deps) && !liveItem)
        throw new Error("Steam returned no item details. Refresh before uploading previews or requirements.");

      const submits: SubmitSpec[] = [];
      if (message.content || message.details || message.description || message.previews) {
        const main: SubmitSpec = {};
        if (message.previews && previews) {
          step("Previews", "listing the gallery…");
          const small = previews.images.filter((p) => fs.statSync(p).size < PREVIEW_MAX_BYTES);
          if (small.length < previews.images.length)
            this.notify(
              `${previews.images.length - small.length} preview image(s) of 1 MB or more were skipped; Steam rejects them.`,
              "warn"
            );
          main.previewImages = small;
          main.previewVideos = previews.videos;
          const count = liveItem?.additionalPreviews.length ?? 0;
          main.removePreviewIndexes = Array.from({ length: count }, (_, i) => i);
        }
        if (message.details) {
          // Version stamps on the item, for tools that compare listings without downloading.
          main.keyValueTags = Object.fromEntries(
            Object.entries({
              px_version: info.version ?? "",
              px_supported_version: info.supportedVersion ?? "",
              px_game: meta.id,
            }).filter(([, v]) => v !== "")
          );
          main.metadata = JSON.stringify({
            version: info.version,
            supportedVersion: info.supportedVersion,
            game: meta.id,
            tool: "px-toolkit",
          });
          main.title = info.name ?? undefined;
          main.tags = info.tags;
          const visibility = message.visibility ?? (legacy ? readLegacyItem(wsDir).visibility : null);
          if (visibility !== null && visibility !== undefined && [0, 1, 2, 3].includes(visibility))
            main.visibility = visibility as 0 | 1 | 2 | 3;
          const preview = info.previewPath;
          if (preview && fs.statSync(preview).size < PREVIEW_MAX_BYTES) {
            main.previewPath = preview;
          } else if (preview) {
            this.notify(
              "The preview image is 1 MB or larger; Steam rejects it, so this upload keeps " +
                "the item's current preview.",
              "warn"
            );
          }
        }
        // Its own switch: a text tweak can go without touching the details,
        // and a details pass can leave a description edited on Steam alone.
        if (message.description) main.description = descriptionBBCode(info, "", info.description ?? "");
        if (message.content) {
          step("Mod files", "preparing files…");
          if (ensurePxIgnore(root)) this.explainPxIgnore(root);
          staging = makeStagingDir();
          stageContent(root, staging, [workshopDirFor(root, meta)]);
          // Preserve unsaved source edits in the staged copy, leaving the editor and disk untouched.
          for (const document of vscode.workspace.textDocuments) {
            if (
              !document.isDirty ||
              document.uri.scheme !== "file" ||
              !isInsideDir(root, document.uri.fsPath)
            )
              continue;
            const dest = path.join(staging, path.relative(root, document.uri.fsPath));
            if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) continue;
            const original = fs.readFileSync(dest);
            const bom = original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? "\uFEFF" : "";
            fs.writeFileSync(dest, bom + document.getText().replace(/^\uFEFF/, ""), "utf8");
          }
          if (legacy) prepareLegacyContent(staging, meta, info, itemId);
          main.contentPath = staging;
        }
        submits.push(main);
      }
      submits.push(
        ...translationSubmits(info).filter((s) => s.language && message.languages.includes(s.language))
      );
      if (!submits.length && !deps) {
        this.notify("Nothing to upload.", "warn");
        return;
      }
      // The note rides on the LAST submit: Steam's "Update:" entry shows the
      // newest submit's note, so a note on the main submit vanished behind
      // the translation submits that followed it.
      if (message.changeNote.trim() && submits.length)
        submits[submits.length - 1].changeNote = message.changeNote.trim();

      if (legacy && message.content) {
        this.assertSaved(path.join(wsDir, "item.json"));
        const current = readLegacyItem(wsDir);
        if (current.legacy.content !== "ready" || current.publishedfileid !== itemId)
          throw new Error("The legacy item changed. Reload before uploading.");
        updateLegacyItem(wsDir, { legacy: { ...current.legacy, content: "submitted" } });
        pendingLegacyStage = "submitted";
      }
      if (submits.length) {
        const done = await runBridge(
          this.context,
          { action: "publish", appId: meta.steamAppId, itemId, submits },
          log,
          (status, uploaded, total, submit, count) => {
            // Submit 1 carries files and details; the rest are one language each.
            const onFiles = submit === 1 && message.content && /content/i.test(status);
            const name =
              submit > 1 ? "Translations" : onFiles ? "Mod files" : message.details ? "Details" : "Mod files";
            const pct = total > 0 ? Math.round((uploaded / total) * 100) : null;
            const which = count > 1 && submit > 1 ? ` (${submit - 1}/${count - 1})` : "";
            step(name, `${status.toLowerCase()}${which}${pct === null ? "" : ` ${pct}%`}`);
          },
          this.uploadAbort.signal
        );
        if (done.action !== "publish") throw new Error("unexpected bridge reply");
        pendingLegacyStage = undefined;
        needsAgreement = needsAgreement || done.needsToAcceptAgreement;
        log(`workshop: uploaded ${root} to item ${itemId} (${submits.length} submit(s))`);
        if (legacy && message.content) {
          this.assertSaved(path.join(wsDir, "item.json"));
          const current = readLegacyItem(wsDir);
          updateLegacyItem(wsDir, { legacy: { ...current.legacy, content: "published" } });
        }
      }

      if (deps && !createdNow && !liveItem) {
        this.notify(
          "Steam did not answer the requirements query, so the item's requirements were left as they are.",
          "warn"
        );
      } else if (deps) {
        const liveApps = liveItem?.appDependencies ?? [];
        const liveItems = liveItem?.children ?? [];
        const job = {
          action: "setDependencies" as const,
          appId: meta.steamAppId,
          itemId,
          addApps: deps.apps.filter((a) => !liveApps.includes(a)),
          removeApps: liveApps.filter((a) => !deps.apps.includes(a)),
          addItems: deps.items.filter((i) => !liveItems.includes(i)),
          removeItems: liveItems.filter((i) => !deps.items.includes(i)),
        };
        if (job.addApps.length || job.removeApps.length || job.addItems.length || job.removeItems.length) {
          step("Requirements", "updating requirements…");
          await runBridge(this.context, job, log, undefined, this.uploadAbort.signal);
          log(`workshop: requirements of ${itemId} updated`);
        }
      }

      if (needsAgreement) {
        void vscode.window
          .showWarningMessage(
            "Steam says you have not accepted the Workshop legal agreement yet; the item stays " +
              "hidden until you do.",
            "Open Agreement"
          )
          .then((choice) => {
            if (choice) void vscode.env.openExternal(vscode.Uri.parse(LEGAL_AGREEMENT_URL));
          });
      }
      const sent: string[] = [];
      if (message.content) sent.push("mod files");
      if (message.details) sent.push("details");
      if (message.description) sent.push("description");
      if (message.previews) sent.push("previews");
      if (deps) sent.push("requirements");
      if (message.languages.length)
        sent.push(`${message.languages.length} translation${message.languages.length === 1 ? "" : "s"}`);
      if (message.changeNote.trim()) sent.push("changenote");
      this.notifyUploaded(itemId, info.name ?? path.basename(root), createdNow, sent);
      await this.postInfo();
    } catch (e) {
      if (
        legacy &&
        pendingLegacyStage &&
        (e instanceof BridgeStartError || (e instanceof BridgeWaitError && !e.remoteMayHaveChanged))
      ) {
        this.assertSaved(path.join(wsDir, "item.json"));
        restoreUnstartedLegacyUpload(wsDir, pendingLegacyStage);
      }
      refreshAfterFailure = e instanceof BridgeWaitError && e.remoteMayHaveChanged && !!itemId;
      this.notifyError(`Workshop upload did not complete - ${friendlyError(e, meta)}`, e);
    } finally {
      this.uploading = false;
      this.uploadAbort = undefined;
      this.endProgress("upload");
      try {
        if (staging) fs.rmSync(staging, { recursive: true, force: true });
        unlock?.();
      } catch (e) {
        this.notifyError(`Upload cleanup failed: ${String(e)}`, e);
      }
      await this.postInfo();
      if (refreshAfterFailure) void this.queryLive(message.languages);
    }
  }
}

/** What stands at the changelog path: a folder of entries, one file, or nothing. */
function changelogKindOf(target: string): WorkshopModInfo["changelogKind"] {
  try {
    return fs.statSync(target).isDirectory() ? "folder" : "file";
  } catch {
    return null;
  }
}

/** DLC icons render as a small grid tile; the game ships them far bigger. */
const DLC_ICON_MAX_DIM = 96;

/** One http(s) resource as bytes; Steam serves preview images from its CDN. */
async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download of ${url} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Steam codes of the languages the mod's localization folders carry, minus
 * english (the item's default text IS the english one). What the panel offers
 * first when adding a translation.
 */
/** The game's own localization languages as Steam names, english excluded. */
function gameLanguages(): string[] {
  const langs = new Set<string>();
  for (const loc of LOC_LANGUAGES) {
    const steam = steamLanguageForLoc(loc);
    if (steam && steam !== "english") langs.add(steam);
  }
  return [...langs];
}

function suggestedLanguages(root: string, meta: GameMeta): string[] {
  const dirs = [
    path.join(root, "localization"),
    ...(meta.stageRoots ?? []).map((s) => path.join(root, s, "localization")),
  ];
  const langs = new Set<string>();
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || !LOC_LANGUAGES.includes(e.name)) continue;
      const steam = steamLanguageForLoc(e.name);
      if (steam && steam !== "english") langs.add(steam);
    }
  }
  return [...langs].sort();
}

/** True when `child` is `parent` or lives under it (case-insensitive: the
 * paths are Windows-born on the platform where this matters). */
function isInsideDir(parent: string, child: string): boolean {
  const canonical = (p: string) =>
    process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);
  const rel = path.relative(canonical(parent), canonical(child));
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
}

class ListingChangedError extends Error {}

/** Hash only the managed listing inputs. A legacy directory is never part of the main item's snapshot. */
function listingSnapshot(dir: string, thumbnail: string): string {
  const hash = createHash("sha256");
  const add = (file: string): void => {
    hash.update(file);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) add(path.join(file, name));
      else hash.update(fs.readFileSync(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      hash.update("absent");
    }
  };
  for (const name of [
    "item.json",
    "dependencies.json",
    "description.md",
    "description.bbcode",
    "translations",
    "previews",
  ])
    add(path.join(dir, name));
  add(thumbnail);
  return hash.digest("hex");
}
