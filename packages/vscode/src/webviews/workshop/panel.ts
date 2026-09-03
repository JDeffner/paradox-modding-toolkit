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
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GameMeta } from "@px-lsp/server/games/profile";
import {
  STEAM_LANGUAGES,
  steamLanguageForLoc,
  type WorkshopTranslation,
} from "@px-lsp/protocol/workshopMeta";
import { LOC_LANGUAGES } from "@px-lsp/protocol/translationCore";
import { LAUNCHER_TAGS, upsertDescriptorBlock, upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH } from "@px-lsp/protocol/descriptorMetadata";
import { type ItemDetails, type SubmitSpec } from "../../steam/jobs";
import {
  hasListingFiles,
  langDir,
  PREVIEWS_DIR,
  readDependencies,
  readItemJson,
  readPreviews,
  upsertItemJson,
  writeDependencies,
  writeListingFiles,
  writePreviewOrder,
  writeVideos,
} from "../../steam/workshopFiles";
import { preflight } from "../../steam/preflight";
import { readGameDlc } from "../../steam/gameDlc";
import { detectGameVersion } from "../../descriptorMod";
import { findSteamLibraries } from "../../steamDetect";
import { declaredDependencies, dependencyCandidates } from "../../dependencyScan";
import { changelogCandidates, DEFAULT_CHANGELOG } from "../../steam/workshopFiles";
import { ensurePxIgnore, PXIGNORE_FILE, stageContent } from "../../steam/pxignore";
import {
  changelogNoteFor,
  findPreview,
  friendlyError,
  lastCommitSubject,
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

export class WorkshopPanel {
  private static instance: WorkshopPanel | undefined;
  private static readonly viewType = "px.workshop";

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private options: WorkshopPanelOptions;
  private active: string | null;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  private uploading = false;
  /** Folders the webview may load files from; grows when one turns up outside them. */
  private resourceRoots: vscode.Uri[];
  /** Titles of required items looked up on Steam, so a re-render never re-asks. */
  private readonly itemTitles = new Map<string, string | null>();

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
    this.disposables.push(watchBundle(source, "workshop", render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
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
  }

  static show(context: vscode.ExtensionContext, options: WorkshopPanelOptions): void {
    const existing = WorkshopPanel.instance;
    if (existing) {
      existing.options = options;
      if (options.active) existing.active = options.active;
      existing.panel.reveal();
      void existing.postInfo();
      return;
    }
    WorkshopPanel.instance = new WorkshopPanel(context, options);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    WorkshopPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
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
    const cut = friendly.indexOf(" - ");
    const title = cut > 0 ? friendly.slice(0, cut) : "Workshop error";
    const detail = cut > 0 ? friendly.slice(cut + 3) : friendly;
    void vscode.window.showErrorMessage(title, { modal: true, detail });
  }

  /** The upload result as a dialog with the item page one click away, in the Steam client first. */
  private notifyUploaded(itemId: string, submits: number): void {
    void vscode.window
      .showInformationMessage(
        "Upload done.",
        {
          modal: true,
          detail: `Item #${itemId} updated (${submits} submit${submits === 1 ? "" : "s"}). Subscribers get it within minutes.`,
        },
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
    const workshopDir = workshopDirFor(root, meta);
    const info = readPublishInfo(root, meta, workshopDir);
    const previewPath = info?.previewPath ?? findPreview(root, null);
    let previewTooLarge = false;
    try {
      if (previewPath) previewTooLarge = fs.statSync(previewPath).size >= PREVIEW_MAX_BYTES;
    } catch {
      /* unreadable preview = none */
    }
    const changelogPath = path.resolve(
      workshopDir,
      (vscode.workspace.getConfiguration("px").get<string>("workshop.changelog") ?? "").trim() ||
        DEFAULT_CHANGELOG
    );
    return {
      root,
      gameName: meta.name,
      descriptorMissing: info === null,
      name: info?.name ?? null,
      tags: info?.tags ?? [],
      knownTags: meta.descriptor === "mod" ? [...LAUNCHER_TAGS] : [],
      publishedId: info?.publishedId ?? null,
      description: info?.description ?? "",
      translations: info?.translations ?? {},
      previewUri: previewPath ? this.fileUri(previewPath) : null,
      previewName: previewPath ? path.basename(previewPath) : null,
      previewTooLarge,
      changeNoteSuggestion: await lastCommitSubject(root),
      changelogNote: changelogNoteFor(root, meta, info?.version ?? null),
      changelogPath,
      changelogPresent: fs.existsSync(changelogPath),
      changelogCandidates: changelogCandidates(root, workshopDir, changelogPath),
      version: info?.version ?? null,
      supportedVersion: info?.supportedVersion ?? null,
      workshopDir,
      filesPresent: hasListingFiles(workshopDir),
      steamLanguages: [...STEAM_LANGUAGES],
      suggestedLanguages: suggestedLanguages(root, this.options.meta),
      checks: info
        ? preflight({
            name: info.name,
            description: info.description ?? "",
            tags: info.tags,
            previewPath,
            previewBytes: previewPath ? (fs.statSync(previewPath).size ?? null) : null,
            supportedVersion: info.supportedVersion,
            gameVersion: detectGameVersion(this.options.gamePath),
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

  /** The item's live details, or null when Steam cannot answer (the caller then leaves Steam's state alone). */
  private async queryItem(itemId: string): Promise<ItemDetails | null> {
    try {
      const done = await runBridge(
        this.context,
        { action: "query", appId: this.options.meta.steamAppId, itemId },
        this.options.log
      );
      return done.action === "query" ? done.item : null;
    } catch {
      return null;
    }
  }

  private async postInit(): Promise<void> {
    this.post({
      type: "init",
      mods: this.options.mods,
      active: this.active,
      info: this.active ? await this.buildInfo(this.active) : null,
    });
  }

  private async postInfo(): Promise<void> {
    if (!this.active) return;
    this.post({ type: "info", active: this.active, info: await this.buildInfo(this.active) });
  }

  private async onMessage(message: AppToHost): Promise<void> {
    const { meta } = this.options;
    const root = this.active;
    switch (message.type) {
      case "ready":
        await this.postInit();
        return;
      case "selectMod":
        // The app only offers paths the host listed, but the message is still text from a webview.
        if (!this.options.mods.some((m) => m.path === message.path)) return;
        this.active = message.path;
        await this.postInfo();
        return;
      case "saveLocal": {
        if (!root) return;
        // The folder is the canonical store; workshop.json keeps only ids.
        writeListingFiles(workshopDirFor(root, meta), {
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
        const id = root ? readPublishInfo(root, meta)?.publishedId : null;
        if (id) void vscode.env.openExternal(vscode.Uri.parse(workshopUrl(id)));
        return;
      }
      case "createDescriptor":
        await vscode.commands.executeCommand("px.createDescriptor");
        await this.postInfo();
        return;
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
        writePreviewOrder(
          workshopDirFor(root, meta),
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
      case "setDependencies": {
        if (!root) return;
        writeDependencies(workshopDirFor(root, meta), {
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
        const dir = path.join(workshopDirFor(root, meta), PREVIEWS_DIR);
        fs.mkdirSync(dir, { recursive: true });
        for (const uri of picked) fs.copyFileSync(uri.fsPath, path.join(dir, path.basename(uri.fsPath)));
        await this.postInfo();
        return;
      }
      case "removePreview": {
        if (!root || path.basename(message.name) !== message.name) return;
        fs.rmSync(path.join(workshopDirFor(root, meta), PREVIEWS_DIR, message.name), { force: true });
        await this.postInfo();
        return;
      }
      case "setVideos": {
        if (!root) return;
        writeVideos(
          workshopDirFor(root, meta),
          message.ids.filter((id) => /^[\w-]{6,20}$/.test(id))
        );
        await this.postInfo();
        return;
      }
      case "openPreviewsFolder": {
        if (!root) return;
        const dir = path.join(workshopDirFor(root, meta), PREVIEWS_DIR);
        fs.mkdirSync(dir, { recursive: true });
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(dir));
        return;
      }
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
    if (!root || !path.isAbsolute(target) || !fs.existsSync(target)) return;
    const workshopDir = workshopDirFor(root, this.options.meta);
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
    await this.postInfo();
  }

  /**
   * Create the entry for the current version and open it. The folder is made
   * on demand (nothing is written on a plain panel open), and the file is
   * seeded with a heading plus the last commit subject so it is not empty.
   */
  private async createChangelog(): Promise<void> {
    const { meta } = this.options;
    const root = this.active;
    if (!root) return;
    const version = readPublishInfo(root, meta)?.version;
    if (!version) {
      this.notify("The mod has no version yet; set one before creating a changelog entry.", "warn");
      return;
    }
    const workshopDir = workshopDirFor(root, meta);
    const dir = path.resolve(
      workshopDir,
      (vscode.workspace.getConfiguration("px").get<string>("workshop.changelog") ?? "").trim() ||
        DEFAULT_CHANGELOG
    );
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
      "Create the workshop folder inside the game's mod folder?",
      {
        modal: true,
        detail:
          `It would land at ${dir}, in the folder where every installed mod lives. ` +
          `Any other mod in that folder resolves its default workshop location to the same place, ` +
          `so listings can overwrite each other. Clear px.workshop.dir so the listing lives inside the mod ` +
          `(.px-toolkit/workshop), or point it somewhere outside the game's mod folder.`,
      },
      "Create Anyway"
    );
    return choice === "Create Anyway";
  }

  /** Open (creating if needed) a listing file of the workshop folder. */
  private async openListingFile(lang: string | null): Promise<void> {
    const { meta } = this.options;
    const root = this.active;
    if (!root) return;
    // The webview (and workshop.json) name the language; only the fixed Steam
    // table may become a path segment.
    if (lang !== null && !STEAM_LANGUAGES.some((l) => l.api === lang)) return;
    const dir = workshopDirFor(root, meta);
    if (!hasListingFiles(dir)) {
      this.notify(
        `No workshop folder at ${dir} yet - the toolbar's download button creates it, or make the folder yourself (px.workshop.dir moves it).`,
        "warn"
      );
      return;
    }
    const file = lang
      ? path.join(langDir(dir, lang), "description.bbcode")
      : path.join(dir, "description.bbcode");
    if (!fs.existsSync(file)) {
      // Seed a missing file with the draft the store holds, so nothing is lost.
      const info = readPublishInfo(root, meta, dir);
      const seed = (lang ? info?.translations[lang]?.description : info?.description) ?? "";
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, seed, "utf8");
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
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
      if (meta.descriptor === "mod") {
        const file = path.join(root, "descriptor.mod");
        const key = field === "title" ? "name" : field === "version" ? "version" : "supported_version";
        fs.writeFileSync(file, upsertDescriptorValue(fs.readFileSync(file, "utf8"), key, v), "utf8");
      } else {
        const file = path.join(root, METADATA_REL_PATH);
        const md = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        const key = field === "title" ? "name" : field === "version" ? "version" : "supported_game_version";
        md[key] = v;
        fs.writeFileSync(file, JSON.stringify(md, null, 2) + "\n", "utf8");
      }
      // Keep item.json's title in step with the descriptor once files track it.
      const dir = workshopDirFor(root, meta);
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
      if (meta.descriptor === "mod") {
        const file = path.join(root, "descriptor.mod");
        fs.writeFileSync(file, upsertDescriptorBlock(fs.readFileSync(file, "utf8"), "tags", clean), "utf8");
      } else {
        const file = path.join(root, METADATA_REL_PATH);
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
      const ext = path.extname(src).toLowerCase() || ".png";
      const dest = path.join(root, `thumbnail${ext}`);
      if (path.resolve(src).toLowerCase() !== path.resolve(dest).toLowerCase()) {
        fs.copyFileSync(src, dest);
      }
      if (meta.descriptor === "mod") {
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
    const info = readPublishInfo(root, meta);
    const itemId = info?.publishedId;
    if (!itemId) {
      this.notify("The mod has no Workshop item to pull from.", "warn");
      return;
    }
    const dir = workshopDirFor(root, meta);
    if (!hasListingFiles(dir) && !(await this.confirmWorkshopDirPlacement(dir))) return;
    const steps = ["Ask Steam"];
    if (parts.details || parts.description || parts.translations) steps.push("Text");
    if (parts.previews || parts.thumbnail) steps.push("Images");
    if (parts.requirements) steps.push("Requirements");
    const step = (name: string, detail: string): void =>
      this.progress("download", `${name}: ${detail}`, Math.max(0, steps.indexOf(name)), steps.length);
    this.post({ type: "uploadState", busy: true });
    step("Ask Steam", "asking Steam…");
    try {
      const languages = parts.translations ? STEAM_LANGUAGES.map((l) => l.api) : [];
      const done = await runBridge(
        this.context,
        { action: "query", appId: meta.steamAppId, itemId, languages },
        log
      );
      if (done.action !== "query" || !done.item) throw new Error("Steam returned no item details");
      const item = done.item;
      const wrote: string[] = [];

      if (parts.details || parts.description || parts.translations) {
        step("Text", "writing text…");
      }
      if (parts.details) {
        upsertItemJson(dir, {
          title: item.title,
          publishedfileid: item.itemId,
          tags: item.tags,
          visibility: item.visibility,
        });
        wrote.push("item.json");
      }
      if (parts.description || parts.translations) {
        const current = readPublishInfo(root, meta, dir);
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
          wrote.push("description.bbcode");
        }
        writeListingFiles(dir, { description, translations });
      }

      if (parts.previews || parts.thumbnail) step("Images", "downloading images…");
      if (parts.previews) {
        const previewsDir = path.join(dir, PREVIEWS_DIR);
        fs.mkdirSync(previewsDir, { recursive: true });
        const images = item.additionalPreviews.filter((p) => p.type === 0);
        const names: string[] = [];
        for (let i = 0; i < images.length; i++) {
          const p = images[i];
          const ext = path.extname(p.originalFileName || new URL(p.urlOrVideoId).pathname) || ".png";
          const base =
            path.basename(p.originalFileName || "", ext) || `steam-${String(i + 1).padStart(2, "0")}`;
          const name = `${base}${ext}`;
          step("Images", `downloading ${name} (${i + 1}/${images.length})…`);
          fs.writeFileSync(path.join(previewsDir, name), await download(p.urlOrVideoId));
          names.push(name);
        }
        if (names.length) writePreviewOrder(dir, names);
        writeVideos(
          dir,
          item.additionalPreviews.filter((p) => p.type === 1).map((p) => p.urlOrVideoId)
        );
        wrote.push(`${names.length} preview image(s)`);
      }
      if (parts.thumbnail && item.previewUrl) {
        const target = info?.previewPath ?? path.join(root, "thumbnail.png");
        fs.writeFileSync(target, await download(item.previewUrl));
        wrote.push(path.basename(target));
      }

      if (parts.requirements) {
        step("Requirements", "writing requirements…");
        writeDependencies(dir, { apps: item.appDependencies, items: item.children });
        wrote.push("dependencies.json");
      }
      this.notify(
        wrote.length ? `Wrote ${wrote.join(", ")} to ${dir}.` : "Nothing was selected to download."
      );
    } catch (e) {
      this.notifyError(`Pulling the listing failed - ${friendlyError(e, meta)}`, e);
    } finally {
      this.endProgress("download");
    }
    await this.postInfo();
  }

  private async queryLive(languages: string[]): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    const itemId = root ? readPublishInfo(root, meta)?.publishedId : null;
    if (!itemId) {
      this.post({ type: "live", item: null, translations: {}, error: null });
      return;
    }
    this.post({ type: "liveBegin" });
    try {
      const done = await runBridge(
        this.context,
        { action: "query", appId: meta.steamAppId, itemId, languages: languages.slice(0, 40) },
        log
      );
      if (done.action !== "query") throw new Error("unexpected bridge reply");
      this.post({ type: "live", item: done.item, translations: done.translations, error: null });
    } catch (e) {
      log(`workshop: live query failed: ${e instanceof Error ? e.message : String(e)}`);
      this.post({ type: "live", item: null, translations: {}, error: friendlyError(e, meta) });
    }
  }

  private async upload(message: Extract<AppToHost, { type: "upload" }>): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    if (!root || this.uploading) return;
    const info = readPublishInfo(root, meta);
    if (!info) {
      this.notify("The mod has no descriptor; nothing can upload.", "error");
      return;
    }
    if (message.details && !info.name) {
      this.notify("The descriptor has no name= - the Workshop needs a title.", "error");
      return;
    }

    // The app's upload modal already confirmed (incl. the new-item case).
    let itemId = info.publishedId;
    this.uploading = true;
    const steps: string[] = [];
    if (!itemId) steps.push("Create item");
    if (message.content) steps.push("Mod files");
    if (message.details) steps.push("Details");
    if (message.languages.length) steps.push("Translations");
    const stepOf = (name: string): number => Math.max(0, steps.indexOf(name));
    const step = (name: string, detail: string): void =>
      this.progress("upload", `${name}: ${detail}`, stepOf(name), steps.length);
    this.post({ type: "uploadState", busy: true });
    step(steps[0] ?? "Upload", "starting…");
    let staging: string | null = null;
    try {
      let needsAgreement = false;
      const createdNow = !itemId;
      if (!itemId) {
        step("Create item", "creating the Workshop item…");
        const created = await runBridge(this.context, { action: "create", appId: meta.steamAppId }, log);
        if (created.action !== "create") throw new Error("unexpected bridge reply");
        itemId = created.itemId;
        needsAgreement = created.needsToAcceptAgreement;
        // Persist BEFORE uploading: a failed upload must not orphan the item,
        // and for .mod games the uploaded descriptor then carries the id.
        persistPublishedId(root, meta, itemId);
        log(`workshop: created item ${itemId} for ${root}`);
      }

      // One query serves the preview replacement and the requirement diff;
      // a just-created item has nothing on Steam yet.
      const wsDir = workshopDirFor(root, meta);
      const previews = message.details ? readPreviews(wsDir) : null;
      const deps = message.details ? readDependencies(wsDir) : null;
      if (deps) steps.push("Requirements");
      const liveItem = !createdNow && (previews || deps) ? await this.queryItem(itemId) : null;

      const submits: SubmitSpec[] = [];
      if (message.content || message.details) {
        const main: SubmitSpec = {};
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
          if (previews) {
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
          main.title = info.name ?? undefined;
          main.description = info.description ?? "";
          if (info.tags.length) main.tags = info.tags;
          if (message.visibility !== null) main.visibility = message.visibility;
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
        if (message.content) {
          step("Mod files", "preparing files…");
          if (ensurePxIgnore(root)) this.explainPxIgnore(root);
          staging = makeStagingDir();
          stageContent(root, staging, [workshopDirFor(root, meta)]);
          main.contentPath = staging;
        }
        if (message.changeNote.trim()) main.changeNote = message.changeNote.trim();
        submits.push(main);
      }
      submits.push(
        ...translationSubmits(info.translations).filter(
          (s) => s.language && message.languages.includes(s.language)
        )
      );
      if (!submits.length) {
        this.notify("Nothing to upload.", "warn");
        return;
      }

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
        }
      );
      if (done.action !== "publish") throw new Error("unexpected bridge reply");
      needsAgreement = needsAgreement || done.needsToAcceptAgreement;
      log(`workshop: uploaded ${root} to item ${itemId} (${submits.length} submit(s))`);

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
          await runBridge(this.context, job, log);
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
      this.notifyUploaded(itemId, submits.length);
      await this.postInfo();
    } catch (e) {
      this.notifyError(`Workshop upload failed - ${friendlyError(e, meta)}`, e);
    } finally {
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
      this.uploading = false;
      this.endProgress("upload");
    }
  }
}

/** DLC icons render as a small grid tile; the game ships them far bigger. */
const DLC_ICON_MAX_DIM = 96;

/** One http(s) resource as bytes; Steam serves preview images from its CDN. */
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download of ${url} failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Steam codes of the languages the mod's localization folders carry, minus
 * english (the item's default text IS the english one). What the panel offers
 * first when adding a translation.
 */
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
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
