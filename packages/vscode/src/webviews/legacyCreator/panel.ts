/**
 * The Dynasty Legacy Creator's VS Code host (px.createDynastyLegacy).
 *
 * It does the four things the app cannot: ask the language server for the
 * `dynasty_legacy` and `dynasty_perk` forms, decode the legacy icons the game
 * and the mods hold, resolve where a save goes, and turn the app's blocks into
 * one document change per file through `creators/save.ts`.
 *
 * A save touches two files (the track's and the perks'), so it is two
 * `WorkspaceEdit`s and two undo steps. That is what an editor gives for two
 * documents anyway, and the alternative (one op set over a text that is not
 * the file's) would be a lie about the offsets.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type {
  DefinitionEditParams,
  DefinitionEditResult,
  DefinitionForm,
  DefinitionFormParams,
  DefinitionOp,
  ModifierFormatsParams,
  ModifierFormatsResult,
} from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import type { PxConfig } from "../../config";
import type { LocLookup } from "../../locCommands";
import { scaffoldPrefix } from "../../scaffold/command";
import {
  applyDefinitionEdits,
  defaultSaveTarget,
  openSaveTarget,
  pickSaveTargetChoice,
  revealDefinition,
  writeLocValues,
  type SaveTargetChoice,
} from "../../creators/save";
import { importPicture, wireImages } from "../../creators/images";
import { GuiTextureCache, THUMBNAIL_MAX_DIM } from "../guiEditor/textureCache";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { legacyCreatorHtml } from "./html";
import { commonPerkCount, perkLinks, perksOfTrack, type PerkLink } from "./perkIndex";
import type {
  AppToHost,
  ArtKind,
  HostToApp,
  IconEntry,
  LoadedPerk,
  SaveDefinition,
  TargetKind,
} from "./messages";

/** The two kinds this panel edits, as the CK3 schema table spells them. */
const TRACK_KIND = "dynasty_legacy";
const PERK_KIND = "dynasty_perk";

/**
 * The SECOND picture a legacy track reads by name: the wide illustration the
 * legacy window draws behind the row of perks, `[DynastyLegacy.GetTrackIcon]`
 * in gui/window_dynasty_legacy.gui. It resolves to
 * gfx/interface/illustrations/legacy_tracks/<track key>.dds, 21 files of
 * 4216 x 368 for the 21 vanilla tracks (measured 2026-09-04).
 *
 * A schema entry carries one `iconFolder` and that one is the 140 x 140 icon,
 * so this path is named here, beside the frame and mask the same window draws
 * both pictures through. Nothing is written into the block either way: both
 * paths are built from the track's key, which is why a pick is a file copy.
 */
const ILLUSTRATION_FOLDER = "gfx/interface/illustrations/legacy_tracks";

export interface LegacyCreatorActions {
  fetchForm(params: DefinitionFormParams): Promise<DefinitionForm | null>;
  applyEdits(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  /** How the game prints each modifier; null when the profile has no source. */
  fetchModifierFormats(params: ModifierFormatsParams): Promise<ModifierFormatsResult | null>;
  lookupLoc: LocLookup;
}

export interface LegacyCreatorOptions {
  cfg: PxConfig;
  meta: GameMeta;
  actions: LegacyCreatorActions;
}

/** Game first, then dependency mods, then the workspace's own: the load order. */
function roots(cfg: PxConfig): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  if (cfg.gamePath) out.push({ label: "game", path: cfg.gamePath });
  for (const p of [...cfg.parentPaths, ...cfg.workspaceMods, ...(cfg.modPath ? [cfg.modPath] : [])]) {
    if (!out.some((r) => r.path === p)) out.push({ label: path.basename(p), path: p });
  }
  return out;
}

/** `<root>/<stage?>/<folder>` for every load stage the game has. */
function folderDirs(root: string, meta: GameMeta, folder: string): string[] {
  const stages = meta.stageRoots?.length ? meta.stageRoots : [""];
  return stages.map((stage) => path.join(root, stage, ...folder.split("/")));
}

function listFiles(dir: string, ext: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(ext))
      .sort();
  } catch {
    return []; // the folder does not exist in this root
  }
}

export class LegacyCreatorPanel {
  private static instance: LegacyCreatorPanel | undefined;
  private static readonly viewType = "px.legacyCreator";

  private readonly panel: vscode.WebviewPanel;
  private readonly textures: GuiTextureCache;
  private options: LegacyCreatorOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private legacyForm: DefinitionForm | null = null;
  private perkForm: DefinitionForm | null = null;
  /** Icon key -> the file it was found in, latest root wins (the game's order). */
  private iconFiles = new Map<string, string>();
  /** The same for the window's illustration, which is its own folder. */
  private illustrationFiles = new Map<string, string>();
  /** The track the panel should open on, until the app is ready for it. */
  private pending: string | undefined;
  /** The perks of the loaded track: where a perk save writes back by default. */
  private loadedPerks: LoadedPerk[] = [];
  /** The targets the modder picked, which outrank the defaults until a load. */
  private chosen: Record<TargetKind, SaveTargetChoice | null> = { track: null, perks: null };

  private constructor(context: vscode.ExtensionContext, options: LegacyCreatorOptions, name?: string) {
    this.options = options;
    this.pending = name;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, { gamePath: null, modPath: null });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      LegacyCreatorPanel.viewType,
      "Dynasty Legacy Creator",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );
    this.panel.iconPath = tabIcon("legacy-creator");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = legacyCreatorHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "legacyCreator"),
        nonce,
        csp: [
          `default-src 'none'`,
          `img-src ${this.panel.webview.cspSource} data:`,
          `style-src 'unsafe-inline'`,
          `script-src 'nonce-${nonce}'`,
        ].join("; "),
      });
    };
    render();
    // The rebooted app sends "ready" and the init answers it; nothing else.
    this.disposables.push(watchBundle(source, "legacyCreator", render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /** Open the creator, on `name`'s track when a caller named one. */
  static show(context: vscode.ExtensionContext, options: LegacyCreatorOptions, name?: string): void {
    const existing = LegacyCreatorPanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal(vscode.ViewColumn.Active);
      // A reveal is not a reset. `postInit` posts a fresh `init`, and the app
      // answers one by rebuilding the form from empty slots while the track's
      // key stays in the box: the next save then wrote those empty blocks over
      // the modder's file. Only a caller that NAMED a track asks for a load.
      if (name) void existing.load(name);
      return;
    }
    LegacyCreatorPanel.instance = new LegacyCreatorPanel(context, options, name);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    LegacyCreatorPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  private async postInit(name?: string): Promise<void> {
    const { cfg, actions } = this.options;
    const modRoot = cfg.modPath;
    const [legacy, perk, formats] = await Promise.all([
      actions.fetchForm({ kind: TRACK_KIND, modRoot }),
      actions.fetchForm({ kind: PERK_KIND, modRoot }),
      actions.fetchModifierFormats({ modRoot }),
    ]);
    if (!legacy || !perk) {
      void vscode.window.showInformationMessage(
        `Paradox Modding Toolkit: ${this.options.meta.name} has no dynasty legacies, so the creator has nothing to write.`
      );
      this.dispose();
      return;
    }
    this.legacyForm = legacy;
    this.perkForm = perk;
    const icons = this.resolveIcons(legacy.iconFolder, this.iconFiles);
    this.post({
      type: "init",
      init: {
        legacy,
        perk,
        formats: formats?.formats ?? null,
        refIconFolders: await this.refIconFolders(perk, modRoot),
        locLanguage: cfg.locLanguage,
        prefix: scaffoldPrefix(cfg),
        perksPerTrack: cfg.gamePath ? commonPerkCount(this.perkLinksIn(cfg.gamePath, perk.folder)) : null,
        icons,
        illustrations: this.resolveIcons(ILLUSTRATION_FOLDER, this.illustrationFiles),
        illustrationFolder: ILLUSTRATION_FOLDER,
        // Any mod of the workspace can be written into (writableMods in
        // creators/save.ts), not only a focus mod.
        problem:
          cfg.modPath || cfg.workspaceMods.length > 0
            ? null
            : "No mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder.",
      },
    });
    this.postTargets();
    const target = name ?? this.pending;
    this.pending = undefined;
    if (target) await this.load(target);
  }

  // -------------------------------------------------------------------------
  // Where a save goes: resolved up front, shown, and changeable before saving
  // -------------------------------------------------------------------------

  /**
   * Where one of the two files lands: what the modder picked, else the default
   * the rules give (the mod file the definition was loaded from, else the mod
   * of record under the kind's own file name). A definition that came from the
   * game or a parent has no writable source, so it falls to the default.
   */
  private targetChoice(which: TargetKind): SaveTargetChoice | null {
    if (this.chosen[which]) return this.chosen[which];
    const source =
      which === "track"
        ? this.legacyForm?.current?.source === "mod"
          ? this.legacyForm.current.file
          : undefined
        : this.loadedPerks.find((perk) => perk.source === "mod")?.file;
    return defaultSaveTarget(this.options.cfg, {
      kind: which === "track" ? TRACK_KIND : PERK_KIND,
      ...(source ? { sourcePath: source } : {}),
    });
  }

  /** Tell the app where each file goes, so its top bar can say so. */
  private postTargets(): void {
    const line = (which: TargetKind, folder: string | undefined) => {
      const choice = this.targetChoice(which);
      return choice && folder ? { modLabel: choice.modLabel, path: `${folder}/${choice.file}` } : null;
    };
    this.post({
      type: "targets",
      track: line("track", this.legacyForm?.folder),
      perks: line("perks", this.perkForm?.folder),
    });
  }

  /** A target line was clicked: the same picker the save used to open. */
  private async changeTarget(which: TargetKind): Promise<void> {
    const form = which === "track" ? this.legacyForm : this.perkForm;
    if (!form) return;
    const current = this.targetChoice(which);
    const picked = await pickSaveTargetChoice(this.options.cfg, form.folder, {
      kind: which === "track" ? TRACK_KIND : PERK_KIND,
      ...(current ? { sourceFile: current.file } : {}),
    });
    if (!picked) return;
    this.chosen[which] = picked;
    this.postTargets();
  }

  /**
   * Where the icon of every kind a perk key REFERS to lives (`traits` names
   * `trait`, whose form carries `gfx/interface/icons/traits`). Asked of that
   * kind's own form rather than written here, so a picture in the trait picker
   * costs no game knowledge in this panel and a game without the kind simply
   * gets no entry.
   */
  private async refIconFolders(
    perk: DefinitionForm,
    modRoot: string | null
  ): Promise<Record<string, string>> {
    const kinds = [...new Set(perk.keys.flatMap((key) => key.refKinds ?? []))];
    const folders: Record<string, string> = {};
    for (const kind of kinds) {
      const form = await this.options.actions.fetchForm({ kind, modRoot });
      if (form?.iconFolder) folders[kind] = form.iconFolder;
    }
    return folders;
  }

  /** The `name -> legacy` links of every perk file under one root. */
  private perkLinksIn(root: string, folder: string): PerkLink[] {
    const links: PerkLink[] = [];
    for (const dir of folderDirs(root, this.options.meta, folder)) {
      for (const file of listFiles(dir, ".txt")) {
        try {
          links.push(...perkLinks(fs.readFileSync(path.join(dir, file), "utf8")));
        } catch {
          /* unreadable file: the index and tiger both report it already */
        }
      }
    }
    return links;
  }

  /**
   * The pictures of the kind's icon folder across game and mods, decoded to
   * thumbnails. The key is the file's base name, which is exactly what the
   * game derives the path from, so the grid shows what a track key would find.
   */
  private resolveIcons(folder: string | undefined, into: Map<string, string>): IconEntry[] {
    into.clear();
    if (!folder) return [];
    const found = new Map<string, IconEntry>();
    for (const root of roots(this.options.cfg)) {
      for (const dir of folderDirs(root.path, this.options.meta, folder)) {
        for (const file of listFiles(dir, ".dds")) {
          const abs = path.join(dir, file);
          const png = this.textures.resolveFile(abs, THUMBNAIL_MAX_DIM);
          if (!png) continue;
          const key = file.slice(0, -4);
          into.set(key, abs);
          found.set(key, {
            key,
            url: this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString(),
            source: root.label,
          });
        }
      }
    }
    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  // -------------------------------------------------------------------------
  // Loading an existing track
  // -------------------------------------------------------------------------

  private async load(name: string): Promise<void> {
    const { actions, cfg } = this.options;
    const perkForm = this.perkForm;
    if (!perkForm) return;
    const track = await actions.fetchForm({ kind: TRACK_KIND, name, modRoot: cfg.modPath });
    if (!track) return;
    this.legacyForm = track;

    // Candidates come from the perk files themselves, because the answer is the
    // `legacy` key and not a naming convention: three of the 21 vanilla tracks
    // name their perks off a different stem (tgp_china_legacy_track ->
    // tgp_chinese_legacy_1). The block of each then comes from the server, which
    // is the authority on which copy of a name wins.
    const names = new Set<string>();
    for (const root of roots(cfg)) {
      for (const perk of perksOfTrack(this.perkLinksIn(root.path, perkForm.folder), name)) names.add(perk);
    }
    const perks: LoadedPerk[] = [];
    for (const perkName of [...names].sort(compareNames)) {
      const form = await actions.fetchForm({ kind: PERK_KIND, name: perkName, modRoot: cfg.modPath });
      if (form?.current) {
        perks.push({
          name: perkName,
          file: form.current.file,
          source: form.current.source,
          text: form.current.text,
        });
      }
    }
    const keys = [
      ...track.locPatterns.map((p) => p.replace(/\$/g, name)),
      ...perks.flatMap((perk) => perkForm.locPatterns.map((p) => p.replace(/\$/g, perk.name))),
    ];
    const loc: Record<string, string> = {};
    for (const key of keys) {
      const value = (await actions.lookupLoc(key)).find((entry) => entry.value !== undefined)?.value;
      if (value !== undefined) loc[key] = value;
    }
    // The track that was opened decides where a save goes, so a target the
    // modder picked for the previous one does not carry over.
    this.loadedPerks = perks;
    this.chosen = { track: null, perks: null };
    this.post({ type: "loaded", track, perks, loc });
    this.postTargets();
  }

  /**
   * One perk's block, for the app's "start from a game perk's effect" picker.
   * Read through the form request like everything else, so the copy is the
   * definition the game really loads and not the first file of that name; the
   * app takes the key it wants out of it.
   */
  private async perkTemplate(name: string): Promise<void> {
    const form = await this.options.actions.fetchForm({
      kind: PERK_KIND,
      name,
      modRoot: this.options.cfg.modPath,
    });
    this.post({ type: "perkEffect", name, block: form?.current?.text ?? null });
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postInit();
        return;
      case "load":
        await this.load(message.name);
        return;
      case "openExamples":
        await vscode.commands.executeCommand("px.showExamplesWiki", {
          name: message.name,
          kind: "modifier",
        });
        return;
      case "customIcon":
        await this.importArt(message.track, message.which);
        return;
      case "openFile":
        await this.openDefinition(message.name, message.which === "perks" ? "perks" : "track");
        return;
      case "images":
        wireImages(this.panel, roots(this.options.cfg), this.textures, message);
        return;
      case "loc": {
        const values: Record<string, string> = {};
        for (const key of message.keys) {
          const value = (await this.options.actions.lookupLoc(key)).find(
            (entry) => entry.value !== undefined
          )?.value;
          if (value !== undefined) values[key] = value;
        }
        this.post({ type: "locValues", values });
        return;
      }
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: "toast", message: "Script copied to the clipboard." });
        return;
      case "changeTarget":
        await this.changeTarget(message.which);
        return;
      case "perkEffect":
        await this.perkTemplate(message.name);
        return;
      case "save":
        await this.save(message);
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  private static opFor(def: SaveDefinition, file: string): DefinitionOp {
    // setProperties only makes sense against the file the block already lives
    // in; anywhere else the whole block has to be written.
    return def.mode === "edit" && def.changed && def.sourceFile === file
      ? { op: "setProperties", name: def.name, properties: def.changed }
      : { op: "upsertBlock", name: def.name, text: def.block };
  }

  private async write(abs: string, text: string, ops: DefinitionOp[]): Promise<string[]> {
    const result = await this.options.actions.applyEdits({
      uri: vscode.Uri.file(abs).toString(),
      text,
      ops,
    });
    if (!(await applyDefinitionEdits(abs, text, result.edits))) return ["the file changed while it was open"];
    return result.ops.map((verdict) => verdict.refused).filter((r): r is string => r !== undefined);
  }

  private async save(message: Extract<AppToHost, { type: "save" }>): Promise<void> {
    const { cfg, actions } = this.options;
    const legacyForm = this.legacyForm;
    const perkForm = this.perkForm;
    if (!legacyForm || !perkForm) return;

    // No question here: both targets have been on screen since the form
    // loaded. Both are opened before either write, so a refused file name
    // cannot leave the track written and its perks missing.
    const trackChoice = this.targetChoice("track");
    const perkChoice = message.perks.length > 0 ? this.targetChoice("perks") : null;
    if (!trackChoice || (message.perks.length > 0 && !perkChoice)) {
      this.post({ type: "toast", message: "No mod folder to save into.", variant: "destructive" });
      return;
    }
    const trackTarget = await openSaveTarget(cfg, legacyForm.folder, trackChoice);
    if (!trackTarget) return;
    const perkTarget = perkChoice ? await openSaveTarget(cfg, perkForm.folder, perkChoice) : null;
    if (perkChoice && !perkTarget) return;

    const refused: string[] = [];
    if (perkTarget) {
      // One request, one op per perk, one WorkspaceEdit: every offset is into
      // the same text, so five new perks land as one change in one undo step.
      refused.push(
        ...(await this.write(
          perkTarget.abs,
          perkTarget.text,
          message.perks.map((perk) => LegacyCreatorPanel.opFor(perk, perkTarget.file))
        ))
      );
    }
    refused.push(
      ...(await this.write(trackTarget.abs, trackTarget.text, [
        LegacyCreatorPanel.opFor(message.track, trackTarget.file),
      ]))
    );

    // A refusal means those bytes were NOT written, so it is reported before
    // anything claims a save happened.
    for (const reason of refused) {
      void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${reason}`);
    }
    if (refused.length > 0) {
      this.post({
        type: "toast",
        message: `${refused.length} of the blocks ${refused.length === 1 ? "was" : "were"} refused and nothing else was written. See the warning.`,
        variant: "destructive",
      });
      return;
    }

    const done: HostToApp = {
      type: "saved",
      trackFile: trackTarget.file,
      perksFile: perkTarget?.file ?? null,
    };
    // A NEW loc key lands beside the definition that needs it: the track's
    // words in the track file's own loc file, a perk's in the perks' one.
    // Without the target they went to whichever mod file held their siblings,
    // which for a first legacy is any file at all.
    let locFiles: string[];
    try {
      locFiles = [
        ...(await writeLocValues(cfg, actions.lookupLoc, message.track.loc, trackTarget)),
        ...(perkTarget
          ? await writeLocValues(
              cfg,
              actions.lookupLoc,
              message.perks.flatMap((perk) => perk.loc),
              perkTarget
            )
          : []),
      ];
    } catch (err) {
      // The blocks are written; only the loc failed. The app still gets its
      // reply, so the panel does not sit on a half-reported save.
      this.post(done);
      this.post({
        type: "toast",
        message: `${message.track.name} was written, but its localization was not: ${err instanceof Error ? err.message : String(err)}`,
        variant: "destructive",
      });
      return;
    }

    let iconNote = "";
    if (message.icon) iconNote += this.copyArt("icon", message.icon, message.track.name, trackTarget.modPath);
    if (message.illustration) {
      iconNote += this.copyArt("illustration", message.illustration, message.track.name, trackTarget.modPath);
    }

    this.post(done);
    // The loc files are NAMED, not counted: a modder who has to find the
    // sentence they just typed should not have to guess which file took it.
    const locNames = [...new Set(locFiles)].map((file) => path.basename(file));
    const written = [
      `${message.track.name} and ${message.perks.length} perk${message.perks.length === 1 ? "" : "s"}`,
      locNames.length > 0 ? `loc into ${locNames.join(" and ")}` : "no localization",
    ].join(", ");
    this.post({ type: "toast", message: `Saved ${written}.${iconNote}` });

    // Where the code went, with the way there: a modder who saved a track and
    // then looked for it in the wrong folder is the case this answers. A
    // notification with buttons, never a modal.
    const rel = (target: { modPath: string; abs: string }): string =>
      path.relative(target.modPath, target.abs).split(path.sep).join("/");
    const OPEN_TRACK = "Open track file";
    const OPEN_PERKS = "Open perks file";
    const where = [
      `the track in ${rel(trackTarget)}`,
      ...(perkTarget ? [`the perks in ${rel(perkTarget)}`] : []),
      ...(locNames.length > 0 ? [`the names in ${locNames.join(" and ")}`] : []),
    ].join(", ");
    void vscode.window
      .showInformationMessage(
        `Paradox Modding Toolkit: saved ${message.track.name}: ${where}.`,
        OPEN_TRACK,
        ...(perkTarget ? [OPEN_PERKS] : [])
      )
      .then((choice) => {
        if (choice === OPEN_TRACK) return revealDefinition(trackTarget.abs, message.track.name);
        if (choice === OPEN_PERKS && perkTarget) {
          return revealDefinition(perkTarget.abs, message.perks[0]?.name ?? "");
        }
        return undefined;
      });
  }

  /** Which folder and which cache one of the two pictures lives in. */
  private artOf(which: ArtKind): { folder: string | undefined; files: Map<string, string> } {
    return which === "illustration"
      ? { folder: ILLUSTRATION_FOLDER, files: this.illustrationFiles }
      : { folder: this.legacyForm?.iconFolder, files: this.iconFiles };
  }

  /**
   * Put the picked picture under the track's own key, which is the only way to
   * choose a picture for a name-derived path. Returns the sentence for the toast.
   */
  private copyArt(which: ArtKind, key: string, track: string, modPath: string): string {
    const { folder, files } = this.artOf(which);
    const from = files.get(key);
    const word = which === "illustration" ? "Illustration" : "Icon";
    if (!folder || !from) return "";
    const dir = path.join(modPath, ...folder.split("/"));
    const to = path.join(dir, `${track}.dds`);
    if (path.resolve(from) === path.resolve(to)) return "";
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(from, to);
    } catch (err) {
      return ` The ${word.toLowerCase()} could not be copied: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.post({ type: "icons", icons: this.resolveIcons(folder, files), select: track, which });
    return ` ${word} copied to ${folder}/${track}.dds.`;
  }

  /**
   * A picture of the modder's own, in whatever format they have it, into the
   * mod the track is being saved to (`creators/images.ts` importPicture): any
   * format Chromium decodes plus TGA and DDS, converted on the way in, and the
   * modder is asked where it goes so a mod with its own art tree is not forced
   * into the game's folder.
   */
  private async importArt(track: string, which: ArtKind): Promise<void> {
    const { folder, files } = this.artOf(which);
    // The picture goes into the mod the definition goes into, so the two never
    // land in different mods.
    const modPath = this.targetChoice("track")?.modPath;
    if (!folder || !modPath) return;
    if (!/^[a-z][a-z0-9_]*$/.test(track)) {
      this.post({ type: "toast", message: "Give the track its key first: the picture is saved under it." });
      return;
    }
    let written;
    try {
      written = await importPicture({
        modPath,
        folder,
        name: track,
        title: `Picture for ${track}`,
        textures: this.textures,
      });
    } catch (err) {
      this.post({
        type: "toast",
        message: `The picture could not be written: ${err instanceof Error ? err.message : String(err)}`,
        variant: "destructive",
      });
      return;
    }
    if (!written) return;
    this.post({ type: "icons", icons: this.resolveIcons(folder, files), select: track, which });
    this.post({
      type: "toast",
      message: written.inPlace
        ? `Picture written to ${written.rel}.`
        : `Picture written to ${written.rel}. The game looks for it under ${folder}/${track}.dds, so reference it yourself.`,
    });
  }

  /**
   * Open one of the two files at a definition's block. The app saves before it
   * asks, which is what the script areas' "Edit in the file" promises, so the
   * block is in the file by the time the editor shows it.
   */
  private async openDefinition(name: string, which: TargetKind): Promise<void> {
    const form = which === "track" ? this.legacyForm : this.perkForm;
    const choice = this.targetChoice(which);
    if (!form || !choice) return;
    const target = await openSaveTarget(this.options.cfg, form.folder, choice);
    if (!target) return;
    await revealDefinition(target.abs, name);
  }
}

/** `blood_legacy_2` before `blood_legacy_10`: the perks are a numbered track. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
