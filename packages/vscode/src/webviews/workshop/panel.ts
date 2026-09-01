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
  upsertWorkshopMeta,
  type WorkshopTranslation,
} from "@px-lsp/protocol/workshopMeta";
import { LOC_LANGUAGES } from "@px-lsp/protocol/translationCore";
import { LAUNCHER_TAGS, upsertDescriptorBlock, upsertDescriptorValue } from "@px-lsp/protocol/descriptorMod";
import { METADATA_REL_PATH } from "@px-lsp/protocol/descriptorMetadata";
import { type SubmitSpec } from "../../steam/jobs";
import {
  hasListingFiles,
  preferListingFiles,
  readItemJson,
  upsertItemJson,
  writeListingFiles,
} from "../../steam/workshopFiles";
import { DEFAULT_CHANGELOG } from "../../steam/workshopFiles";
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
  stageContent,
  translationSubmits,
  workshopDirFor,
  workshopUrl,
} from "../../steam/workshop";
import { gameDocsSubdir } from "../../config";
import { tabIcon } from "../tabIcons";
import { workshopHtml } from "./html";
import type { AppToHost, HostToApp, ModChoice, WorkshopModInfo } from "./messages";

export interface WorkshopPanelOptions {
  meta: GameMeta;
  /** Mods the panel can manage, first = default. */
  mods: ModChoice[];
  /** The mod to open with (the focused one), a path from `mods`. */
  active: string | null;
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

  private constructor(context: vscode.ExtensionContext, options: WorkshopPanelOptions) {
    this.context = context;
    this.options = options;
    this.active = options.active ?? options.mods[0]?.path ?? null;

    this.panel = vscode.window.createWebviewPanel(
      WorkshopPanel.viewType,
      "Steam Workshop",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          // The preview image lives inside the mod; every manageable mod is a root.
          ...options.mods.map((m) => vscode.Uri.file(m.path)),
        ],
      }
    );
    this.panel.iconPath = tabIcon("workshop");
    const nonce = makeNonce();
    this.panel.webview.html = workshopHtml({
      scriptSrc: this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "workshop.js"))
        .toString(),
      nonce,
      csp: [
        `default-src 'none'`,
        // https: for the item's live preview URL, which Steam's CDN serves.
        `img-src ${this.panel.webview.cspSource} https: data:`,
        `style-src 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
      ].join("; "),
    });
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

  // All user feedback goes through VS Code notifications plus the output
  // channel - never a transient in-panel surface. The message survives
  // closing the panel, and errors leave a trace to re-read.
  private notify(message: string, level: "info" | "warn" | "error" = "info"): void {
    this.options.log(`workshop: ${message}`);
    const full = `Paradox Modding Toolkit: ${message}`;
    if (level === "error") void vscode.window.showErrorMessage(full);
    else if (level === "warn") void vscode.window.showWarningMessage(full);
    else void vscode.window.showInformationMessage(full);
  }

  /** notify() for a caught error: the friendly text out, the raw one logged. */
  private notifyError(friendly: string, e: unknown): void {
    this.options.log(`workshop: ${friendly} [raw: ${e instanceof Error ? e.message : String(e)}]`);
    void vscode.window.showErrorMessage(`Paradox Modding Toolkit: ${friendly}`);
  }

  private async buildInfo(root: string): Promise<WorkshopModInfo> {
    const { meta } = this.options;
    const workshopDir = workshopDirFor(root);
    const info = readPublishInfo(root, meta, workshopDir);
    const previewPath = info?.previewPath ?? findPreview(root, null);
    let previewTooLarge = false;
    let previewStamp = 0;
    try {
      if (previewPath) {
        const stat = fs.statSync(previewPath);
        previewTooLarge = stat.size >= PREVIEW_MAX_BYTES;
        previewStamp = Math.floor(stat.mtimeMs);
      }
    } catch {
      /* unreadable preview = none */
    }
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
      // The mtime query defeats the webview's image cache after a swap.
      previewUri: previewPath
        ? `${this.panel.webview.asWebviewUri(vscode.Uri.file(previewPath)).toString()}?v=${previewStamp}`
        : null,
      previewName: previewPath ? path.basename(previewPath) : null,
      previewTooLarge,
      changeNoteSuggestion: await lastCommitSubject(root),
      changelogNote: changelogNoteFor(root, info?.version ?? null),
      changelogPath: path.resolve(
        workshopDir,
        (vscode.workspace.getConfiguration("px").get<string>("workshop.changelog") ?? "").trim() ||
          DEFAULT_CHANGELOG
      ),
      version: info?.version ?? null,
      supportedVersion: info?.supportedVersion ?? null,
      workshopDir,
      filesPresent: hasListingFiles(workshopDir),
      steamLanguages: [...STEAM_LANGUAGES],
      suggestedLanguages: suggestedLanguages(root, this.options.meta),
    };
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
        const dir = workshopDirFor(root);
        // Existing folder, or a mod-projects layout where the folder is the
        // right default even before it exists: the folder is the canonical
        // store; workshop.json keeps only ids.
        if (preferListingFiles(root, dir)) {
          writeListingFiles(dir, {
            description: message.description,
            translations: message.translations as Record<string, WorkshopTranslation>,
          });
          return;
        }
        upsertWorkshopMeta(root, meta.configDirName, {
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
      case "linkExisting":
        await this.linkExisting();
        return;
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
        await this.pullListing();
        return;
      case "openListingFile":
        await this.openListingFile(message.lang);
        return;
      case "reload":
        await this.postInfo();
        return;
      case "openWorkshopSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "px.workshop");
        return;
      case "notify":
        this.notify(message.message, message.warn ? "warn" : "info");
        return;
    }
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
          `so listings can overwrite each other. Recommended: keep the mod in its own project folder ` +
          `with the listing next to it, or point px.workshop.dir somewhere outside the game's mod folder.`,
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
    const dir = workshopDirFor(root);
    if (!hasListingFiles(dir)) {
      this.notify(
        `No workshop folder at ${dir} yet - the toolbar's download button creates it, or make the folder yourself (px.workshop.dir moves it).`,
        "warn"
      );
      return;
    }
    const file = lang ? path.join(dir, lang, "description.bbcode") : path.join(dir, "description.bbcode");
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
      const dir = workshopDirFor(root);
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
   * Download the live listing into the workshop folder: description.bbcode,
   * one `<lang>/` folder per language whose text differs from the default
   * (Steam serves the default as fallback for everything else), and item.json.
   * The app confirms first - this REPLACES the folder's listing files.
   */
  private async pullListing(): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    if (!root) return;
    const itemId = readPublishInfo(root, meta)?.publishedId;
    if (!itemId) {
      this.notify("The mod has no Workshop item to pull from.", "warn");
      return;
    }
    const dir = workshopDirFor(root);
    if (!hasListingFiles(dir) && !(await this.confirmWorkshopDirPlacement(dir))) return;
    this.post({ type: "uploadState", busy: true, message: "downloading the listing…" });
    try {
      const languages = STEAM_LANGUAGES.map((l) => l.api);
      const done = await runBridge(
        this.context,
        { action: "query", appId: meta.steamAppId, itemId, languages },
        log
      );
      if (done.action !== "query" || !done.item) throw new Error("Steam returned no item details");
      const item = done.item;
      const translations: Record<string, WorkshopTranslation> = {};
      for (const [lang, t] of Object.entries(done.translations)) {
        const title = t.title !== item.title ? t.title : "";
        const description = t.description !== item.description ? t.description : "";
        if (title === "" && description === "") continue;
        translations[lang] = {
          ...(title !== "" ? { title } : {}),
          ...(description !== "" ? { description } : {}),
        };
      }
      writeListingFiles(dir, { description: item.description, translations });
      upsertItemJson(dir, { title: item.title, publishedfileid: item.itemId });
      const n = Object.keys(translations).length;
      this.notify(`Wrote the description${n ? ` and ${n} translation(s)` : ""} to ${dir}.`);
    } catch (e) {
      this.notifyError(`Pulling the listing failed - ${friendlyError(e, meta)}`, e);
    } finally {
      this.post({ type: "uploadState", busy: false });
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

  private async linkExisting(): Promise<void> {
    const { meta, log } = this.options;
    const root = this.active;
    if (!root) return;
    try {
      const done = await runBridge(this.context, { action: "list", appId: meta.steamAppId }, log);
      if (done.action !== "list") throw new Error("unexpected bridge reply");
      if (!done.items.length) {
        this.notify(`You have no published ${meta.name} Workshop items to link.`);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        done.items.map((it) => ({
          label: it.title || `(untitled item)`,
          description: `#${it.itemId}`,
          detail: `last update ${new Date(it.timeUpdated * 1000).toLocaleDateString()}`,
          itemId: it.itemId,
        })),
        {
          title: `Link "${path.basename(root)}" to one of your Workshop items`,
          placeHolder: "The next upload updates the linked item instead of creating a new one",
        }
      );
      if (!picked) return;
      persistPublishedId(root, meta, picked.itemId);
      this.options.log(`workshop: linked ${root} to existing item ${picked.itemId}`);
      await this.postInfo();
    } catch (e) {
      this.notifyError(`Listing your Workshop items failed - ${friendlyError(e, meta)}`, e);
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
    this.post({ type: "uploadState", busy: true, message: "starting…" });
    let staging: string | null = null;
    try {
      let needsAgreement = false;
      if (!itemId) {
        this.post({ type: "uploadState", busy: true, message: "creating the Workshop item…" });
        const created = await runBridge(this.context, { action: "create", appId: meta.steamAppId }, log);
        if (created.action !== "create") throw new Error("unexpected bridge reply");
        itemId = created.itemId;
        needsAgreement = created.needsToAcceptAgreement;
        // Persist BEFORE uploading: a failed upload must not orphan the item,
        // and for .mod games the uploaded descriptor then carries the id.
        persistPublishedId(root, meta, itemId);
        log(`workshop: created item ${itemId} for ${root}`);
      }

      const submits: SubmitSpec[] = [];
      if (message.content || message.details) {
        const main: SubmitSpec = {};
        if (message.details) {
          main.title = info.name ?? undefined;
          main.description = info.description ?? undefined;
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
          this.post({ type: "uploadState", busy: true, message: "preparing files…" });
          staging = makeStagingDir();
          stageContent(root, staging, [workshopDirFor(root)]);
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
          const pct = total > 0 ? ` (${Math.round((uploaded / total) * 100)}%)` : "";
          const step = count > 1 ? ` - step ${submit}/${count}` : "";
          this.post({ type: "uploadState", busy: true, message: `${status.toLowerCase()}${pct}${step}` });
        }
      );
      if (done.action !== "publish") throw new Error("unexpected bridge reply");
      needsAgreement = needsAgreement || done.needsToAcceptAgreement;
      log(`workshop: uploaded ${root} to item ${itemId} (${submits.length} submit(s))`);

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
      this.notify("Upload done.");
      await this.postInfo();
    } catch (e) {
      this.notifyError(`Workshop upload failed - ${friendlyError(e, meta)}`, e);
    } finally {
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
      this.uploading = false;
      this.post({ type: "uploadState", busy: false });
    }
  }
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
