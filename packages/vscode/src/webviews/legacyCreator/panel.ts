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
import { convertImageToDds } from "../../ddsConvert";
import type { LocLookup } from "../../locCommands";
import { scaffoldPrefix } from "../../scaffold/command";
import { applyDefinitionEdits, pickSaveTarget, writeLocValues } from "../../creators/save";
import { wireImages } from "../../creators/images";
import { GuiTextureCache, THUMBNAIL_MAX_DIM } from "../guiEditor/textureCache";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { legacyCreatorHtml } from "./html";
import { commonPerkCount, perkLinks, perksOfTrack, type PerkLink } from "./perkIndex";
import type { AppToHost, HostToApp, IconEntry, LoadedPerk, SaveDefinition } from "./messages";

/** The two kinds this panel edits, as the CK3 schema table spells them. */
const TRACK_KIND = "dynasty_legacy";
const PERK_KIND = "dynasty_perk";

/** Images the DDS converter reads, plus the format the game itself wants. */
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "dds"];

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
  /** The track the panel should open on, until the app is ready for it. */
  private pending: string | undefined;

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
      void existing.postInit(name);
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
    const icons = this.resolveIcons(legacy.iconFolder);
    this.post({
      type: "init",
      init: {
        legacy,
        perk,
        formats: formats?.formats ?? null,
        refIconFolders: await this.refIconFolders(perk, modRoot),
        modLabel: cfg.modPath ? path.basename(cfg.modPath) : null,
        locLanguage: cfg.locLanguage,
        prefix: scaffoldPrefix(cfg),
        perksPerTrack: cfg.gamePath ? commonPerkCount(this.perkLinksIn(cfg.gamePath, perk.folder)) : null,
        icons,
        // Any mod of the workspace can be written into (writableMods in
        // creators/save.ts), not only a focus mod.
        problem:
          cfg.modPath || cfg.workspaceMods.length > 0
            ? null
            : "No mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder.",
      },
    });
    const target = name ?? this.pending;
    this.pending = undefined;
    if (target) await this.load(target);
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
  private resolveIcons(folder: string | undefined): IconEntry[] {
    this.iconFiles.clear();
    if (!folder) return [];
    const found = new Map<string, IconEntry>();
    for (const root of roots(this.options.cfg)) {
      for (const dir of folderDirs(root.path, this.options.meta, folder)) {
        for (const file of listFiles(dir, ".dds")) {
          const abs = path.join(dir, file);
          const png = this.textures.resolveFile(abs, THUMBNAIL_MAX_DIM);
          if (!png) continue;
          const key = file.slice(0, -4);
          this.iconFiles.set(key, abs);
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
    this.post({ type: "loaded", track, perks, loc });
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
        await this.convertIcon(message.track);
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

    // Both targets before either write: a cancelled second question must not
    // leave the track written and its perks missing.
    const trackTarget = await pickSaveTarget(cfg, legacyForm.folder, {
      kind: TRACK_KIND,
      ...(message.track.sourceFile ? { sourceFile: message.track.sourceFile } : {}),
    });
    if (!trackTarget) return;
    const perkSource = message.perks.find((perk) => perk.sourceFile)?.sourceFile;
    const perkTarget =
      message.perks.length > 0
        ? await pickSaveTarget(cfg, perkForm.folder, {
            kind: PERK_KIND,
            ...(perkSource ? { sourceFile: perkSource } : {}),
          })
        : null;
    if (message.perks.length > 0 && !perkTarget) return;

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

    const pairs = [...message.track.loc, ...message.perks.flatMap((perk) => perk.loc)];
    let locFiles: string[];
    try {
      locFiles = await writeLocValues(cfg, actions.lookupLoc, pairs);
    } catch (err) {
      // The blocks are written; only the loc failed. The app still gets its
      // reply, so the panel does not sit on a half-reported save.
      this.post({ type: "saved" });
      this.post({
        type: "toast",
        message: `${message.track.name} was written, but its localization was not: ${err instanceof Error ? err.message : String(err)}`,
        variant: "destructive",
      });
      return;
    }

    let iconNote = "";
    if (message.icon) iconNote = this.copyIcon(message.icon, message.track.name, trackTarget.modPath);

    this.post({ type: "saved" });
    const written = [
      `${message.track.name} and ${message.perks.length} perk${message.perks.length === 1 ? "" : "s"}`,
      `${new Set(locFiles).size} loc file${new Set(locFiles).size === 1 ? "" : "s"}`,
    ].join(", ");
    this.post({ type: "toast", message: `Saved ${written}.${iconNote}` });
    if (message.dropped.length > 0) {
      const files = [...new Set(message.dropped.map((perk) => path.basename(perk.file)))].join(", ");
      void vscode.window.showInformationMessage(
        `Paradox Modding Toolkit: ${message.dropped.map((perk) => perk.name).join(", ")} ` +
          `left the track but ${message.dropped.length === 1 ? "its block is" : "their blocks are"} still in ${files}. ` +
          `Delete ${message.dropped.length === 1 ? "it" : "them"} there to remove ${message.dropped.length === 1 ? "it" : "them"} from the game.`
      );
    }
  }

  /**
   * Put the picked picture under the track's own key, which is the only way to
   * choose an icon for a name-derived path. Returns the sentence for the toast.
   */
  private copyIcon(key: string, track: string, modPath: string): string {
    const folder = this.legacyForm?.iconFolder;
    const from = this.iconFiles.get(key);
    if (!folder || !from) return "";
    const dir = path.join(modPath, ...folder.split("/"));
    const to = path.join(dir, `${track}.dds`);
    if (path.resolve(from) === path.resolve(to)) return "";
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(from, to);
    } catch (err) {
      return ` The icon could not be copied: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.post({ type: "icons", icons: this.resolveIcons(folder), select: track });
    return ` Icon copied to ${folder}/${track}.dds.`;
  }

  /**
   * A picture of the modder's own, converted by the toolkit's own encoder
   * (convertImageToDds, the non-interactive half of the DDS command): the
   * creator already knows the format question's answer and the target path,
   * so nothing is asked and nothing is announced twice.
   */
  private async convertIcon(track: string): Promise<void> {
    const { cfg } = this.options;
    const folder = this.legacyForm?.iconFolder;
    const modPath = cfg.modPath ?? cfg.workspaceMods[0];
    if (!folder || !modPath) return;
    if (!/^[a-z][a-z0-9_]*$/.test(track)) {
      this.post({ type: "toast", message: "Give the track its key first: the picture is saved under it." });
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Images: IMAGE_EXT },
      title: `Picture for ${track}`,
    });
    const source = picked?.[0]?.fsPath;
    if (!source) return;
    const dir = path.join(modPath, ...folder.split("/"));
    const target = path.join(dir, `${track}.dds`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (source.toLowerCase().endsWith(".dds")) {
        fs.copyFileSync(source, target);
      } else {
        await convertImageToDds(vscode.Uri.file(source), vscode.Uri.file(target));
      }
    } catch (err) {
      this.post({
        type: "toast",
        message: `The picture could not be written: ${err instanceof Error ? err.message : String(err)}`,
        variant: "destructive",
      });
      return;
    }
    if (!fs.existsSync(target)) {
      this.post({ type: "toast", message: "No picture was written." });
      return;
    }
    this.post({ type: "icons", icons: this.resolveIcons(folder), select: track });
    this.post({ type: "toast", message: `Icon written to ${folder}/${track}.dds.` });
  }
}

/** `blood_legacy_2` before `blood_legacy_10`: the perks are a numbered track. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}
