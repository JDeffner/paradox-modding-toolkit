/**
 * The Dynasty Tree panel's VS Code host (px.openDynastyTree).
 *
 * It does the things the app cannot: ask the language server for the dynasty
 * model, decode the trait pictures and build the trait tooltips, turn a filled
 * form into script and write it into the mod, and open the file it wrote.
 * Drawing, panning and every form lives in app/.
 *
 * Writing is the other creators' flow (creators/save.ts): a character's target
 * is resolved WITHOUT a prompt (`defaultSaveTarget`) and shown in the app's top
 * bar from the moment it opens, the server answers offsets into the text
 * `openSaveTarget` handed back, and `applyDefinitionEdits` applies them as ONE
 * WorkspaceEdit against a document that has not moved since. Nothing here reads
 * or writes a file itself, so unsaved editor changes are never overwritten.
 */
import * as fs from "fs";
import * as vscode from "vscode";
import * as path from "path";
import type {
  DefinitionEditParams,
  DefinitionEditResult,
  DefinitionForm,
  DefinitionFormParams,
  DynastyTreeParams,
  DynastyTreeResult,
  EventValueOptionsParams,
  EventValueOptionsResult,
  EventVocabularyItem,
  FormatPart,
  ModifierFormat,
  ModifierFormatsParams,
  ModifierFormatsResult,
} from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { parseScript } from "@px-lsp/server/parser";
import { readModName } from "@px-lsp/protocol/modName";
import type { PxConfig } from "../../config";
import {
  applyDefinitionEdits,
  defaultSaveTarget,
  openSaveTarget,
  pickSaveTarget,
  pickSaveTargetChoice,
  samePath,
  type SaveTargetChoice,
} from "../../creators/save";
import { resolveImage, type ImageRoot } from "../../creators/images";
import type { LocLookup } from "../../locCommands";
import { characterBlock, dynastyBlock, houseBlock, unquotableValue } from "./blocks";
import { dynastyTreeHtml } from "./html";
import type { AppToHost, HostToApp, ModTarget, OptionSets, TraitTip } from "./messages";
import { frameTexture, plainLoc, type PreviewModifier } from "../traitCreator/app/preview";
import { GuiTextureCache } from "../guiEditor/textureCache";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { bundleUri, watchBundle, webviewSource } from "../devReload";

/**
 * Schema folder and definition kind, one pair per kind this panel writes
 * (games/ck3/schema.ts). The folder is root-relative with `/` separators,
 * which is what `pickSaveTarget` splits on.
 */
const TARGETS = {
  character: { folder: "history/characters", kind: "character" },
  dynasty: { folder: "common/dynasties", kind: "dynasty" },
  house: { folder: "common/dynasty_houses", kind: "dynasty_house" },
};
/**
 * The server re-indexes a written file through the client's watcher, which is
 * debounced. A panel has no readier signal, so the reload waits this long
 * before asking for the tree again; the Refresh control covers the rest.
 */
const REINDEX_GRACE_MS = 800;

/** Trait pictures are menu-row sized, so a list of them is a cheap decode. */
const TRAIT_THUMB_DIM = 48;
/** The picture inside a hovered trait's tooltip, at the size preview.ts draws. */
const TRAIT_TIP_DIM = 128;

export interface DynastyTreeActions {
  fetchTree(params: DynastyTreeParams): Promise<DynastyTreeResult>;
  fetchOptions(params: EventValueOptionsParams): Promise<EventValueOptionsResult | null>;
  /** paradox/definitionEdit: the offsets a block's write lands at. */
  editDefinition(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  /** writeLocSmart: the one entry point for a loc value (locCommands.ts). */
  writeLoc(key: string, value: string): Promise<string>;
  /**
   * paradox/definitionForm. Optional so a client whose server predates it
   * still gets a working panel: the trait pictures and tooltips are then
   * simply absent, and the picker keeps showing names and ids.
   */
  fetchForm?(params: DefinitionFormParams): Promise<DefinitionForm | null>;
  /** paradox/modifierFormats, fetched once: how the game prints each modifier. */
  fetchModifierFormats?(params: ModifierFormatsParams): Promise<ModifierFormatsResult | null>;
  /** The player's word for a loc key, for the trait tooltips. */
  lookupLoc?: LocLookup;
}

export interface DynastyTreeOptions {
  cfg: PxConfig;
  meta: GameMeta;
  /** Mods the panel may write into, `modPath` first (the default target). */
  mods: ModTarget[];
  /** Focus mod for the server request, or null for every workspace mod. */
  modRoot: string | null;
  /** Set when the workspace is not ready to be written to (no mod, no game). */
  setupProblem?: string;
}

export class DynastyTreePanel {
  private static instance: DynastyTreePanel | undefined;
  private static readonly viewType = "px.dynastyTree";

  private readonly panel: vscode.WebviewPanel;
  private readonly actions: DynastyTreeActions;
  private readonly textures: GuiTextureCache;
  private options: DynastyTreeOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  /** A deep-linked dynasty, replayed once the app has booted. */
  private pending: string | undefined;
  /** The file the character being edited lives in; it decides the default target. */
  private draftFile: string | undefined;
  /** The dynasty currently drawn, so a save can reload the same tree. */
  private current: string | undefined;
  /** The target the modder picked, which outranks the default until reset. */
  private chosen: SaveTargetChoice | null = null;
  /** The trait kind's form (its icon folder and modifier vocabulary), once. */
  private traitForm: Promise<DefinitionForm | null> | undefined;
  /** paradox/modifierFormats, once: the rules do not change while a panel is open. */
  private formats: Promise<Record<string, ModifierFormat>> | undefined;
  /** Both caches live for the panel's life; a decode is never paid twice. */
  private readonly traitIcons = new Map<string, string | null>();
  private readonly traitTips = new Map<string, TraitTip | null>();

  private constructor(
    context: vscode.ExtensionContext,
    actions: DynastyTreeActions,
    options: DynastyTreeOptions,
    dynasty?: string
  ) {
    this.actions = actions;
    this.options = options;
    this.pending = dynasty;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, { gamePath: null, modPath: null });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      DynastyTreePanel.viewType,
      "Dynasty Tree",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );
    this.panel.iconPath = tabIcon("dynasty-tree");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = dynastyTreeHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "dynastyTree"),
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
    // The rebooted app sends "ready" and gets the same answer it got the first
    // time, so a bundle reload does not lose the panel's state.
    this.disposables.push(watchBundle(source, "dynastyTree", render));
    this.panel.webview.onDidReceiveMessage(
      (msg: AppToHost) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(
    context: vscode.ExtensionContext,
    actions: DynastyTreeActions,
    options: DynastyTreeOptions,
    dynasty?: string
  ): void {
    const existing = DynastyTreePanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal(vscode.ViewColumn.Active);
      if (dynasty) void existing.loadTree(dynasty);
      return;
    }
    DynastyTreePanel.instance = new DynastyTreePanel(context, actions, options, dynasty);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    DynastyTreePanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(msg: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({
          type: "init",
          gameName: this.options.meta.name,
          mods: this.options.mods,
          ...(this.options.cfg.calendar ? { calendar: this.options.cfg.calendar } : {}),
          setupProblem: this.options.setupProblem,
        });
        this.postTarget();
        await this.loadList();
        if (this.pending) {
          const dynasty = this.pending;
          this.pending = undefined;
          await this.loadTree(dynasty);
        }
        return;
      case "list":
        await this.loadList();
        return;
      case "open":
        await this.loadTree(msg.dynasty);
        return;
      case "reveal":
        await this.openDocument(msg.file, msg.line);
        return;
      case "coa":
        await vscode.commands.executeCommand("px.openFlagBuilder", { name: msg.name });
        return;
      case "traitIcons":
        await this.sendTraitIcons(msg.names);
        return;
      case "traitTip":
        await this.sendTraitTip(msg.name);
        return;
      case "target":
        // A different character is being edited, so the file it already lives
        // in decides the default again: an old pick must not follow it.
        this.chosen = null;
        this.draftFile = msg.file;
        this.postTarget();
        return;
      case "changeTarget":
        await this.changeTarget();
        return;
      case "copy":
        await vscode.env.clipboard.writeText(msg.text);
        this.post({ type: "toast", message: "Copied to the clipboard." });
        return;
      case "paste":
        this.post({ type: "pasted", field: msg.field, text: (await vscode.env.clipboard.readText()).trim() });
        return;
      case "saveCharacter": {
        if (this.refuseQuote(msg.form)) return;
        const block = characterBlock(msg.form, await this.previousBlock(msg.file, msg.form.id));
        for (const note of block.notes) this.post({ type: "toast", message: note });
        // No question at save time: the target has been in the top bar since
        // the form opened, and it is what the write uses.
        await this.write(TARGETS.character, msg.form.id, block.text, msg.file, this.targetChoice());
        return;
      }
      case "saveDynasty": {
        if (this.refuseQuote(msg.form)) return;
        const written = await this.write(TARGETS.dynasty, msg.form.id, dynastyBlock(msg.form), msg.file);
        if (written) await this.writeName(msg.form.nameKey, msg.name);
        if (written && msg.openTree) await this.loadTree(msg.form.id);
        return;
      }
      case "saveHouse": {
        if (this.refuseQuote(msg.form)) return;
        const written = await this.write(TARGETS.house, msg.form.id, houseBlock(msg.form), msg.file);
        if (written) await this.writeName(msg.form.nameKey, msg.name);
        return;
      }
    }
  }

  // ---- server ---------------------------------------------------------------

  private async loadList(): Promise<void> {
    this.post({ type: "loading", what: "dynasties" });
    const started = Date.now();
    try {
      const result = await this.actions.fetchTree({ modRoot: this.options.modRoot });
      this.post({
        type: "list",
        supported: result.supported,
        dynasties: result.dynasties,
        nextDynastyId: result.nextDynastyId ?? "1",
        nextCharacterId: result.nextCharacterId ?? "1",
        ms: Date.now() - started,
      });
      if (!result.supported) return;
      await this.loadOptions([...result.dynasties.slice(0, 200)].find((d) => d.culture)?.culture);
    } catch (err) {
      this.post({ type: "error", message: message(err) });
    }
  }

  private async loadTree(dynasty: string): Promise<void> {
    this.post({ type: "loading", what: "the tree" });
    const started = Date.now();
    try {
      const result = await this.actions.fetchTree({ modRoot: this.options.modRoot, dynasty });
      if (!result.dynasty) {
        this.post({ type: "error", message: `No dynasty ${dynasty} in this workspace.` });
        return;
      }
      this.current = dynasty;
      this.post({
        type: "tree",
        tree: {
          dynasty: result.dynasty,
          houses: result.houses ?? [],
          characters: result.characters ?? [],
          nextCharacterId: result.nextCharacterId ?? "1",
        },
        ms: Date.now() - started,
      });
      const chars = result.characters ?? [];
      await this.loadOptions(
        result.dynasty.culture ?? chars.find((c) => c.culture)?.culture,
        chars.find((c) => c.religion)?.religion,
        chars.find((c) => c.traits.length > 0)?.traits[0]
      );
    } catch (err) {
      this.post({ type: "error", message: message(err) });
    }
  }

  /**
   * The picker value sets. `paradox/eventValueOptions` answers the set a VALUE
   * belongs to, so each field is seeded with a value the tree already carries;
   * a field with no seed keeps a plain text input rather than a wrong list.
   */
  private async loadOptions(culture?: string, religion?: string, trait?: string): Promise<void> {
    const sets: OptionSets = { culture: [], religion: [], trait: [] };
    const seeds: Array<[keyof OptionSets, string | undefined]> = [
      ["culture", culture],
      ["religion", religion],
      ["trait", trait],
    ];
    for (const [field, seed] of seeds) {
      if (!seed) continue;
      try {
        const result = await this.actions.fetchOptions({ value: seed, modRoot: this.options.modRoot });
        if (result) sets[field] = result.items;
      } catch {
        /* a field without options is a plain input, not an error */
      }
    }
    await this.labelTraits(sets.trait);
    this.post({ type: "options", sets });
  }

  /**
   * The player's word for every trait the picker offers. `eventValueOptions`
   * answers keys only (`label` is set by `definitionForm` alone), and the trait
   * form is asked for anyway, so its loc-resolved names are folded in here and
   * the picker reads "Brave" with `brave` as its dimmer hint. A trait no loc
   * key resolves keeps its key, which is the honest answer.
   */
  private async labelTraits(items: EventVocabularyItem[]): Promise<void> {
    if (items.length === 0) return;
    const form = await this.traitDefinitionForm();
    if (!form) return;
    const labels = new Map<string, string>();
    for (const item of form.options.trait ?? []) if (item.label) labels.set(item.value, item.label);
    for (const def of form.existing) if (def.label) labels.set(def.name, def.label);
    for (const item of items) {
      const label = labels.get(item.value);
      if (label) item.label = label;
    }
  }

  // ---- trait pictures and tooltips ------------------------------------------

  /**
   * Where a texture path is looked up: the load order, game first, so a mod's
   * own picture of the same path wins the way it does in the game.
   */
  private imageRoots(): ImageRoot[] {
    const { cfg } = this.options;
    const roots: ImageRoot[] = [];
    if (cfg.gamePath) roots.push({ label: "game", path: cfg.gamePath });
    for (const p of [...cfg.parentPaths, ...cfg.workspaceMods, ...(cfg.modPath ? [cfg.modPath] : [])]) {
      if (!roots.some((r) => r.path === p)) roots.push({ label: readModName(p), path: p });
    }
    return roots;
  }

  /**
   * The decoded picture for a game asset, tried under every load stage the
   * game has (EU5 writes `in_game/gfx/…`, the others write `gfx/…`).
   */
  private textureUrl(rel: string, maxDim: number): string | null {
    for (const stage of this.options.meta.stageRoots ?? [""]) {
      const png = resolveImage(this.imageRoots(), stage ? `${stage}/${rel}` : rel, maxDim, this.textures);
      if (png) return this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString();
    }
    return null;
  }

  /**
   * The trait kind's own form, asked ONCE. It carries the icon folder and the
   * modifier vocabulary, so no folder and no modifier name is written here.
   *
   * The PROMISE is what is remembered, not its answer: several icon batches
   * arrive in the same frame, and a second one must wait for the first request
   * rather than see a half-filled field and give up on pictures.
   */
  private traitDefinitionForm(): Promise<DefinitionForm | null> {
    this.traitForm ??= (async () => {
      if (!this.actions.fetchForm) return null;
      try {
        return await this.actions.fetchForm({ kind: "trait", modRoot: this.options.cfg.modPath });
      } catch {
        // A game with no trait database, or a server that cannot answer: the
        // panel keeps its picker, without pictures.
        return null;
      }
    })();
    return this.traitForm;
  }

  /**
   * The trait's own picture: the file the game derives from the trait's name.
   * A trait whose block names another `icon` is resolved by that name instead
   * (the tooltip path passes it in).
   */
  private traitIconUrl(file: string, folder: string, maxDim: number): string | null {
    // Only names the index produced ever come back, but a message is still
    // text from a webview: no path may leave the icon folder.
    if (!/^[\w.() -]+$/.test(file)) return null;
    for (const ext of [".dds", ".tga", ".png"]) {
      const url = this.textureUrl(`${folder}/${file}${file.includes(".") ? "" : ext}`, maxDim);
      if (url) return url;
      if (file.includes(".")) break;
    }
    return null;
  }

  /** The pictures for the rows the app has on screen; cached for the panel's life. */
  private async sendTraitIcons(names: string[]): Promise<void> {
    const form = await this.traitDefinitionForm();
    const folder = form?.iconFolder;
    const urls: Record<string, string | null> = {};
    for (const name of names) {
      let url = this.traitIcons.get(name);
      if (url === undefined) {
        url = folder ? this.traitIconUrl(name, folder, TRAIT_THUMB_DIM) : null;
        this.traitIcons.set(name, url);
      }
      urls[name] = url;
    }
    if (!this.disposed) this.post({ type: "traitIcons", urls });
  }

  /** The game's print rules, fetched once and kept: they cannot move mid-panel. */
  private modifierFormats(): Promise<Record<string, ModifierFormat>> {
    this.formats ??= (async () => {
      if (!this.actions.fetchModifierFormats) return {};
      try {
        const result = await this.actions.fetchModifierFormats({ modRoot: this.options.cfg.modPath });
        return result?.formats ?? {};
      } catch {
        // An unformatted tooltip is a smaller failure than none at all.
        return {};
      }
    })();
    return this.formats;
  }

  /** The player's word for a loc key, mod first, or "" when nothing has one. */
  private async loc(key: string): Promise<string> {
    if (!this.actions.lookupLoc) return "";
    try {
      const entries = await this.actions.lookupLoc(key);
      return (entries.find((e) => e.source === "mod") ?? entries[0])?.value ?? "";
    } catch {
      return "";
    }
  }

  /**
   * One trait as the game's own tooltip: the name and description the player
   * reads, the picture, and every `name = number` the trait's block carries
   * that the modifier vocabulary knows (`_traits.info`: an unknown property IS
   * a modifier). Answered once per name and kept, so hovering a list twice
   * costs one round trip per trait and no decode at all.
   */
  private async sendTraitTip(name: string): Promise<void> {
    const cached = this.traitTips.get(name);
    if (cached !== undefined) {
      this.post({ type: "traitTip", name, tip: cached });
      return;
    }
    const tip = await this.buildTraitTip(name);
    this.traitTips.set(name, tip);
    if (!this.disposed) this.post({ type: "traitTip", name, tip });
  }

  private async buildTraitTip(name: string): Promise<TraitTip | null> {
    const form = await this.traitDefinitionForm();
    if (!form || !this.actions.fetchForm) return null;
    let one: DefinitionForm | null = null;
    try {
      one = await this.actions.fetchForm({ kind: "trait", name, modRoot: this.options.cfg.modPath });
    } catch {
      return null;
    }
    const known = new Set(form.modifiers.map((m) => m.name));
    const read = one?.current ? readTraitBlock(one.current.text, known) : null;
    const formats = await this.modifierFormats();

    const nameKey = form.locPatterns.find((p) => !p.includes("desc"));
    const descKey = form.locPatterns.find((p) => p.endsWith("_desc"));
    const [label, desc] = await Promise.all([
      nameKey ? this.loc(nameKey.replace(/\$/g, name)) : Promise.resolve(""),
      descKey ? this.loc(descKey.replace(/\$/g, name)) : Promise.resolve(""),
    ]);

    const folder = form.iconFolder;
    const frame = read?.category ? frameTexture(read.category) : null;
    const modifiers = read?.modifiers ?? [];
    return {
      tip: {
        key: name,
        name: label ? plainLoc(label) : name,
        desc: desc ? plainLoc(desc) : "",
        iconUrl: folder ? this.traitIconUrl(read?.icon || name, folder, TRAIT_TIP_DIM) : null,
        frameUrl: folder && frame ? this.traitIconUrl(frame, folder, TRAIT_TIP_DIM) : null,
        modifiers,
        opposites: [],
        flags: [],
      },
      formats: Object.fromEntries(
        modifiers.map((row) => [row.name, formats[row.name]]).filter(([, f]) => f !== undefined)
      ) as Record<string, ModifierFormat>,
      images: this.texticonUrls(modifiers.map((row) => formats[row.name])),
    };
  }

  /** Every texticon the tooltip's own lines name, decoded once per tooltip. */
  private texticonUrls(formats: (ModifierFormat | undefined)[]): Record<string, string | null> {
    const urls: Record<string, string | null> = {};
    for (const format of formats) {
      const parts: FormatPart[] = [
        ...(format?.prefix ?? []),
        ...(format?.suffix ?? []),
        ...(format?.negativeSuffix ?? []),
      ];
      for (const part of parts) {
        if (!("icon" in part) || part.icon.texture in urls) continue;
        urls[part.icon.texture] = this.textureUrl(part.icon.texture, 0);
      }
    }
    return urls;
  }

  // ---- where a character saves ----------------------------------------------

  /**
   * Where the next character save goes: what the modder picked, else the file
   * the character already lives in, else the mod of record's default name.
   */
  private targetChoice(): SaveTargetChoice | null {
    if (this.chosen) return this.chosen;
    const inMod = this.draftFile && this.options.mods.some((m) => isInside(m.path, this.draftFile!));
    return defaultSaveTarget(this.options.cfg, {
      kind: TARGETS.character.kind,
      ...(inMod ? { sourcePath: this.draftFile } : {}),
    });
  }

  /** The folder characters go into, with the game's load stage where it has one. */
  private characterFolder(): string {
    const stage = this.options.meta.stageRoots?.[0];
    return stage ? `${stage}/${TARGETS.character.folder}` : TARGETS.character.folder;
  }

  /** Tell the app where a character saves, so its top bar can say so. */
  private postTarget(): void {
    const choice = this.targetChoice();
    this.post({
      type: "target",
      target: choice ? { modLabel: choice.modLabel, path: `${this.characterFolder()}/${choice.file}` } : null,
    });
  }

  /** The target line was clicked: the same picker a save would have opened. */
  private async changeTarget(): Promise<void> {
    const picked = await pickSaveTargetChoice(this.options.cfg, this.characterFolder(), {
      kind: TARGETS.character.kind,
      ...(this.draftFile ? { sourceFile: path.basename(this.draftFile) } : {}),
    });
    if (!picked) return;
    this.chosen = picked;
    this.postTarget();
  }

  // ---- writing --------------------------------------------------------------

  /**
   * The exact source of the block being edited, for a faithful round trip.
   * Read through the editor, so the text is the one on screen (unsaved edits
   * included) and the encoding is VS Code's, not an assumed UTF-8.
   */
  private async previousBlock(file: string | undefined, name: string): Promise<string | undefined> {
    if (!file) return undefined;
    let text: string;
    try {
      text = (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
    } catch {
      return undefined;
    }
    // The block runs from its key to the matching close brace; the writer only
    // needs the text, and the tolerant parser inside blocks.ts does the rest.
    const start = new RegExp(`^${escapeRegExp(name)}[ \\t]*=[ \\t]*\\{`, "m").exec(text);
    if (!start) return undefined;
    let depth = 0;
    for (let i = start.index; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start.index, i + 1);
      }
    }
    return undefined;
  }

  /**
   * Write one block into a `.txt` of the mod's folder. Returns true when
   * something was written.
   *
   * The target, the offsets and the application are the shared creator flow:
   * `pickSaveTarget` opens the file and hands back the text the server must
   * answer against, `paradox/definitionEdit` computes the upsert, and
   * `applyDefinitionEdits` refuses to write a document that moved meanwhile.
   */
  private async write(
    target: { folder: string; kind: string },
    name: string,
    script: string,
    previousFile?: string,
    choice?: SaveTargetChoice | null
  ): Promise<boolean> {
    const stage = this.options.meta.stageRoots?.[0];
    const folder = stage ? `${stage}/${target.folder}` : target.folder;
    const where = await this.saveTarget(folder, target.kind, previousFile, choice);
    if (!where) return false;
    const { abs, text } = where;

    let result: DefinitionEditResult;
    try {
      result = await this.actions.editDefinition({
        uri: vscode.Uri.file(abs).toString(),
        text,
        ops: [{ op: "upsertBlock", name, text: script }],
      });
    } catch (err) {
      this.post({ type: "toast", message: message(err), variant: "destructive" });
      return false;
    }
    const refused = result.ops.find((op) => op.refused)?.refused;
    if (refused) {
      this.post({ type: "toast", message: refused, variant: "destructive" });
      return false;
    }
    if (!(await applyDefinitionEdits(abs, text, result.edits))) return false;

    await this.openDocument(abs, await this.blockLine(abs, name));
    this.post({ type: "toast", message: `Saved ${name} to ${path.basename(abs)}.` });
    // The written file reaches the index through the client's watcher.
    setTimeout(() => {
      if (this.current) void this.loadTree(this.current);
      else void this.loadList();
    }, REINDEX_GRACE_MS);
    return true;
  }

  /**
   * The file the block goes into, with the text its offsets are into.
   *
   * A `choice` is a target already shown in the top bar, so it is used without
   * asking; writing back into the file the block came from opens that file
   * directly, because the vanilla-name refusal in `openSaveTarget` is about
   * CREATING a mod file that shadows a game one, not about a file that is
   * already there. Without a choice (a dynasty, a house) the picker asks, which
   * is where the mod pick, the file list and that refusal live.
   */
  private async saveTarget(
    folder: string,
    kind: string,
    previousFile?: string,
    choice?: SaveTargetChoice | null
  ): Promise<{ abs: string; text: string } | null> {
    const inMod = previousFile && this.options.mods.some((m) => isInside(m.path, previousFile));
    const wanted = choice ? path.join(choice.modPath, ...folder.split("/"), choice.file) : null;
    if (inMod && (!wanted || samePath(wanted, previousFile!))) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(previousFile!));
        return { abs: previousFile!, text: doc.getText() };
      } catch (err) {
        this.post({ type: "toast", message: message(err), variant: "destructive" });
        return null;
      }
    }
    if (choice) {
      const opened = await openSaveTarget(this.options.cfg, folder, choice);
      return opened ? { abs: opened.abs, text: opened.text } : null;
    }
    const picked = await pickSaveTarget(this.options.cfg, folder, { kind });
    return picked ? { abs: picked.abs, text: picked.text } : null;
  }

  /** The line the block ended up on, so the file opens where it was written. */
  private async blockLine(abs: string, name: string): Promise<number> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      const at = new RegExp(`^${escapeRegExp(name)}[ \t]*=`, "m").exec(doc.getText());
      return at ? doc.positionAt(at.index).line : 0;
    } catch {
      return 0;
    }
  }

  /**
   * A `"` inside a value the block writer quotes cannot be written: the script
   * has no escape for it and dropping it would rename what is saved. Returns
   * true when the save was refused, with the value named in the toast.
   */
  private refuseQuote(form: { id: string }): boolean {
    const bad = unquotableValue(form);
    if (bad === null) return false;
    this.post({
      type: "toast",
      message: `${form.id} was not saved: remove the " from ${bad}. Paradox script cannot escape a quote inside a value.`,
      variant: "destructive",
    });
    return true;
  }

  /** The display name of a dynasty or house: a loc key, written through writeLocSmart. */
  private async writeName(key: string, value: string): Promise<void> {
    if (!key || !value) return;
    try {
      const file = await this.actions.writeLoc(key, value);
      this.post({ type: "toast", message: `Wrote ${key} to ${path.basename(file)}.` });
    } catch (err) {
      this.post({
        type: "toast",
        message: `Could not write ${key}: ${message(err)}`,
        variant: "destructive",
      });
    }
  }

  private async openDocument(file: string, line: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const zero = Math.min(Math.max(0, line), Math.max(0, doc.lineCount - 1));
      const position = new vscode.Position(zero, 0);
      const textGroup = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.scheme === "file"
      )?.viewColumn;
      await vscode.window.showTextDocument(doc, {
        viewColumn: textGroup ?? vscode.ViewColumn.Beside,
        preserveFocus: true,
        selection: new vscode.Range(position, position),
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`Dynasty Tree: cannot open ${file}: ${message(err)}`);
    }
  }
}

/**
 * What a hovered trait's tooltip needs out of its own block: the picture it
 * names, the category that decides its frame, and every statement the modifier
 * vocabulary knows (`_traits.info`: "any other unknown property is read in as a
 * modifier applied to anyone who holds the trait").
 */
function readTraitBlock(
  text: string,
  modifierNames: ReadonlySet<string>
): { icon?: string; category?: string; modifiers: PreviewModifier[] } {
  const out: { icon?: string; category?: string; modifiers: PreviewModifier[] } = { modifiers: [] };
  const { root } = parseScript(text);
  const first = root.statements[0];
  const block = first?.kind === "assignment" && first.value?.kind === "block" ? first.value : null;
  if (!block) return out;
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment" || stmt.value?.kind !== "scalar") continue;
    const key = stmt.key.text;
    const value = stmt.value.text;
    if (key === "icon") out.icon = value;
    else if (key === "category") out.category = value;
    else if (modifierNames.has(key) && Number.isFinite(Number(value))) {
      out.modifiers.push({ name: key, value: Number(value) });
    }
  }
  return out;
}

function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
