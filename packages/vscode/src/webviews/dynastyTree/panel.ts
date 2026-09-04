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
import { WriteJournal } from "./journal";
import { dnaPasteBlock, parseDnaPaste, scanBlocks, uniqueKey, type ScriptBlock } from "./scan";
import type { AppToHost, HostToApp, ModTarget, OptionSets, TraitStats, TraitTip } from "./messages";
import { plainLoc, type PreviewModifier } from "../traitCreator/app/preview";
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
/** How many of a trait's lines a picker ROW carries; the tooltip carries all. */
const TRAIT_ROW_LINES = 3;
/** Where CK3 keeps portrait DNA. Not indexed, and deliberately so: read on demand. */
const DNA_FOLDER = "common/dna_data";

export interface DynastyTreeActions {
  fetchTree(params: DynastyTreeParams): Promise<DynastyTreeResult>;
  fetchOptions(params: EventValueOptionsParams): Promise<EventValueOptionsResult | null>;
  /** paradox/definitionEdit: the offsets a block's write lands at. */
  editDefinition(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  /** writeLocSmart: the one entry point for a loc value (locCommands.ts). */
  writeLoc(key: string, value: string): Promise<string>;
  /**
   * Where `writeLoc` WOULD write a key, resolved without writing, so the
   * panel can keep the file's pre-image for undo. Optional: a client that
   * cannot answer it simply has no undo for loc writes.
   */
  locTarget?(key: string): Promise<string | null>;
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
  /** Script files read for their blocks, keyed by path, kept while the mtime holds. */
  private readonly files = new Map<string, { mtimeMs: number; blocks: Map<string, ScriptBlock> }>();
  /** Every write this panel made, newest last: what undo puts back. */
  private readonly journal = new WriteJournal({
    read: (file) => this.docText(file),
    write: (file, text) => this.replaceDocument(file, text),
    refuse: (message) => this.post({ type: "toast", message, variant: "destructive" }),
  });

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
        this.postJournal();
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
      case "traitStats":
        await this.sendTraitStats(msg.names);
        return;
      case "undo":
      case "redo":
        await this.stepJournal(msg.type);
        return;
      case "dnaOpen":
        await this.openDna(msg.key);
        return;
      case "dnaCopy":
        await this.copyDna(msg.key);
        return;
      case "dnaPaste":
        await this.pasteDna(msg.character);
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
   * The trait kind's own form, asked ONCE. It carries the icon folder, the
   * documented trait keys and the modifier vocabulary, so no folder and no key
   * name is written here.
   *
   * `modRoot` is the panel's own focus (the same one the tree request uses),
   * NOT `cfg.modPath`: with no focus mod that is null, which is the server's
   * "every workspace mod", so a trait defined by any mod in the workspace gets
   * its name and its stats rather than only the mod of record's.
   *
   * The PROMISE is what is remembered, not its answer: several icon batches
   * arrive in the same frame, and a second one must wait for the first request
   * rather than see a half-filled field and give up on pictures.
   */
  private traitDefinitionForm(): Promise<DefinitionForm | null> {
    this.traitForm ??= (async () => {
      if (!this.actions.fetchForm) return null;
      try {
        return await this.actions.fetchForm({ kind: "trait", modRoot: this.options.modRoot });
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
        const result = await this.actions.fetchModifierFormats({ modRoot: this.options.modRoot });
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

  /**
   * The blocks of one script file, parsed once and kept while its mtime holds.
   * Every trait of a vanilla file comes out of ONE read, which is why a picker
   * row can show what a trait does without a request per row.
   */
  private fileBlocks(file: string): Map<string, ScriptBlock> {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      return new Map();
    }
    const seen = this.files.get(file);
    if (seen && seen.mtimeMs === mtimeMs) return seen.blocks;
    let blocks = new Map<string, ScriptBlock>();
    try {
      blocks = scanBlocks(fs.readFileSync(file, "utf8"));
    } catch {
      /* an unreadable file has no blocks, which is what the caller draws */
    }
    this.files.set(file, { mtimeMs, blocks });
    return blocks;
  }

  /**
   * One trait's block, verbatim. The file the form already named is read
   * first (one read serves every trait in it); a trait the form's capped
   * `existing` list does not carry falls back to asking the server for that
   * one definition.
   */
  private async traitBlock(name: string): Promise<{ text: string; source: string } | null> {
    const form = await this.traitDefinitionForm();
    const def = form?.existing.find((d) => d.name === name);
    if (def) {
      const block = this.fileBlocks(def.file).get(name);
      if (block) return { text: block.text, source: def.source ?? "" };
    }
    if (!this.actions.fetchForm) return null;
    try {
      const one = await this.actions.fetchForm({ kind: "trait", name, modRoot: this.options.modRoot });
      return one?.current ? { text: one.current.text, source: one.current.source } : null;
    } catch {
      return null;
    }
  }

  /**
   * Which `key = number` rows of a trait block are modifiers. `_traits.info`
   * says an undocumented property IS one, but the harvested key list is not
   * only rules: it carries the modifiers the doc uses as EXAMPLES (`diplomacy`,
   * `martial`, `attraction_opinion` and six more are in it, measured against
   * data/ck3/structures.json), so "not documented" alone would drop the lines
   * a trait most often carries. A key the game itself prints a modifier for
   * therefore counts as one whatever the doc says.
   */
  private async modifierTest(): Promise<(key: string) => boolean> {
    const form = await this.traitDefinitionForm();
    const formats = await this.modifierFormats();
    const vocabulary = new Set(form?.modifiers.map((m) => m.name) ?? []);
    const documented = new Set(form?.keys.map((k) => k.key) ?? []);
    // hasOwnProperty, not `in`: `formats` is parsed JSON, and `in` would call
    // every trait's `constructor` a modifier.
    const printed = (key: string): boolean => Object.prototype.hasOwnProperty.call(formats, key);
    return (key) => printed(key) || vocabulary.has(key) || !documented.has(key);
  }

  /** What the rows on screen do, read out of the traits' own blocks. */
  private async sendTraitStats(names: string[]): Promise<void> {
    const isModifier = await this.modifierTest();
    const formats = await this.modifierFormats();
    const rows: Record<string, TraitStats | null> = {};
    for (const name of names) {
      const block = await this.traitBlock(name);
      if (!block) {
        rows[name] = null;
        continue;
      }
      const modifiers = readTraitBlock(block.text, isModifier).modifiers.slice(0, TRAIT_ROW_LINES);
      rows[name] = {
        modifiers,
        formats: Object.fromEntries(
          modifiers.map((row) => [row.name, formats[row.name]]).filter(([, f]) => f !== undefined)
        ) as Record<string, ModifierFormat>,
        images: this.texticonUrls(modifiers.map((row) => formats[row.name])),
        mod: block.source === "mod",
      };
    }
    if (!this.disposed) this.post({ type: "traitStats", rows });
  }

  private async buildTraitTip(name: string): Promise<TraitTip | null> {
    const form = await this.traitDefinitionForm();
    if (!form) return null;
    const isModifier = await this.modifierTest();
    const block = await this.traitBlock(name);
    const read = block ? readTraitBlock(block.text, isModifier) : null;
    const formats = await this.modifierFormats();

    const nameKey = form.locPatterns.find((p) => !p.includes("desc"));
    const descKey = form.locPatterns.find((p) => p.endsWith("_desc"));
    const [label, desc] = await Promise.all([
      nameKey ? this.loc(nameKey.replace(/\$/g, name)) : Promise.resolve(""),
      descKey ? this.loc(descKey.replace(/\$/g, name)) : Promise.resolve(""),
    ]);

    const folder = form.iconFolder;
    const modifiers = read?.modifiers ?? [];
    return {
      tip: {
        key: name,
        name: label ? plainLoc(label) : name,
        desc: desc ? plainLoc(desc) : "",
        iconUrl: folder ? this.traitIconUrl(read?.icon || name, folder, TRAIT_TIP_DIM) : null,
        // No frame. The game's own trait tooltip draws the trait's picture at
        // 52px and nothing behind it; the category frame belongs to the
        // character sheet, and over a tooltip it only made the picture smaller.
        frameUrl: null,
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

  // ---- portrait DNA ----------------------------------------------------------

  /**
   * Where portrait DNA lives, with the game's load stage where it has one.
   * The folder is NOT indexed (games/ck3/schema.ts leaves it out on purpose:
   * the files are large and nothing else asks about them), so everything here
   * reads it on demand and caches per file mtime.
   */
  private dnaFolder(): string {
    const stage = this.options.meta.stageRoots?.[0];
    return stage ? `${stage}/${DNA_FOLDER}` : DNA_FOLDER;
  }

  private dnaDir(root: string): string {
    return path.join(root, ...this.dnaFolder().split("/"));
  }

  /** Every DNA file the workspace can see, the mods' own first (they win). */
  private dnaFiles(): string[] {
    const roots = this.options.mods.map((m) => m.path);
    if (this.options.cfg.gamePath) roots.push(this.options.cfg.gamePath);
    return roots.flatMap((root) => listScripts(this.dnaDir(root)));
  }

  private findDna(key: string): { file: string; block: ScriptBlock } | null {
    for (const file of this.dnaFiles()) {
      const block = this.fileBlocks(file).get(key);
      if (block) return { file, block };
    }
    return null;
  }

  private async openDna(key: string): Promise<void> {
    const found = this.findDna(key);
    if (!found) {
      this.post({ type: "toast", message: `No ${key} in ${this.dnaFolder()}.`, variant: "destructive" });
      return;
    }
    await this.openDocument(found.file, await this.blockLine(found.file, key));
  }

  /**
   * The whole block, so it can be pasted into another mod or another
   * character. A name nothing defines still copies as a name: that is what the
   * field holds, and refusing to copy it would help nobody.
   */
  private async copyDna(key: string): Promise<void> {
    const found = this.findDna(key);
    await vscode.env.clipboard.writeText(found ? found.block.text : key);
    this.post({
      type: "toast",
      message: found
        ? `Copied ${key} from ${path.basename(found.file)}.`
        : `No ${key} in ${this.dnaFolder()}, so only the name was copied.`,
    });
  }

  /**
   * A DNA off the clipboard. The game's portrait editor copies a whole
   * `<key> = { portrait_info = { … } }`; an in-file copy is often the
   * `portrait_info` half alone, which is written under the character's own
   * name. An existing key is never replaced: it is somebody's portrait, so the
   * paste takes the next free `_2`, `_3`.
   */
  private async pasteDna(character: string): Promise<void> {
    const paste = parseDnaPaste(await vscode.env.clipboard.readText());
    if (!paste) {
      this.post({
        type: "toast",
        message: "The clipboard holds neither a DNA name nor a portrait block.",
        variant: "destructive",
      });
      return;
    }
    if (paste.kind === "name") {
      this.post({ type: "pasted", field: "dna", text: paste.name });
      return;
    }
    const modPath = this.options.mods[0]?.path ?? this.options.cfg.modPath;
    if (!modPath) {
      this.post({ type: "toast", message: "No mod to write the DNA into.", variant: "destructive" });
      return;
    }

    const dir = this.dnaDir(modPath);
    const mine = listScripts(dir);
    const taken = new Set<string>();
    for (const file of mine) for (const key of this.fileBlocks(file).keys()) taken.add(key);
    const key = uniqueKey(paste.kind === "block" ? paste.key : `${character}_dna`, taken);
    const script = dnaPasteBlock(key, paste);
    if (!script) return;

    // The file holding its siblings, else one named after the mod.
    const target =
      mine.map((file) => ({ file, count: this.fileBlocks(file).size })).sort((a, b) => b.count - a.count)[0]
        ?.file ?? path.join(dir, `${sanitizeFileName(path.basename(modPath))}_dna.txt`);
    try {
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // Script `.txt` is UTF-8 WITH BOM; the game reads a headerless file
        // wrong and says nothing about it.
        fs.writeFileSync(target, "﻿", "utf8");
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      const text = doc.getText();
      const result = await this.actions.editDefinition({
        uri: doc.uri.toString(),
        text,
        ops: [{ op: "upsertBlock", name: key, text: script }],
      });
      const refused = result.ops.find((op) => op.refused)?.refused;
      if (refused) {
        this.post({ type: "toast", message: refused, variant: "destructive" });
        return;
      }
      if (!(await applyDefinitionEdits(target, text, result.edits, { reveal: false }))) return;
      await this.remember(target, text);
    } catch (err) {
      this.post({ type: "toast", message: message(err), variant: "destructive" });
      return;
    }
    this.post({ type: "pasted", field: "dna", text: key });
    this.post({ type: "toast", message: `Wrote ${key} to ${path.basename(target)}.` });
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
    // `reveal: false`: a panel that saves on every field change must not throw
    // an editor over the tree each time. The inspector says what was written
    // and offers the link instead.
    if (!(await applyDefinitionEdits(abs, text, result.edits, { reveal: false }))) return false;
    await this.remember(abs, text);

    this.post({ type: "saved", name, file: abs, line: await this.blockLine(abs, name) });
    this.reloadSoon();
    return true;
  }

  /** Journal one write: `text` was there before, whatever is there now is after. */
  private async remember(abs: string, text: string): Promise<void> {
    const after = await this.docText(abs);
    if (after !== null) this.journal.record({ file: abs, before: text, after });
    this.postJournal();
  }

  /** The written file reaches the index through the client's watcher. */
  private reloadSoon(): void {
    setTimeout(() => {
      if (this.current) void this.loadTree(this.current);
      else void this.loadList();
    }, REINDEX_GRACE_MS);
  }

  // ---- undo ------------------------------------------------------------------

  private postJournal(): void {
    this.post({ type: "journal", ...this.journal.depth });
  }

  /** The file's text as the EDITOR has it, which is what undo compares against. */
  private async docText(file: string): Promise<string | null> {
    try {
      return (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
    } catch {
      return null;
    }
  }

  /** Put a whole file back, as one edit, the way every other write here lands. */
  private async replaceDocument(file: string, text: string): Promise<boolean> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
      if (!(await vscode.workspace.applyEdit(edit))) return false;
      await doc.save();
      return true;
    } catch (err) {
      this.post({ type: "toast", message: message(err), variant: "destructive" });
      return false;
    }
  }

  private async stepJournal(which: "undo" | "redo"): Promise<void> {
    const moved = which === "undo" ? await this.journal.undo() : await this.journal.redo();
    this.postJournal();
    if (moved) this.reloadSoon();
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

  /**
   * The display name of a dynasty or house: a loc key, written through
   * writeLocSmart. The loc writer picks the file itself, so its pre-image is
   * taken from the file it SAYS it will write (`locTarget`); a write that then
   * lands somewhere else, or in a file that did not exist, is not journalled
   * rather than journalled wrongly.
   */
  private async writeName(key: string, value: string): Promise<void> {
    if (!key || !value) return;
    let predicted: string | null = null;
    let before: string | null = null;
    try {
      predicted = (await this.actions.locTarget?.(key)) ?? null;
      if (predicted) before = await this.docText(predicted);
    } catch {
      /* an unpredictable target only costs this write its undo */
    }
    try {
      const file = await this.actions.writeLoc(key, value);
      if (predicted && before !== null && samePath(predicted, file)) await this.remember(file, before);
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
 * What a trait's tooltip and its picker row need out of its own block: the
 * picture it names and every `key = number` that is a modifier
 * (`_traits.info`: "any other unknown property is read in as a modifier
 * applied to anyone who holds the trait"). `isModifier` is the panel's test,
 * built from what the game prints; nothing is decided here.
 */
export function readTraitBlock(
  text: string,
  isModifier: (key: string) => boolean
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
    else if (value.trim() !== "" && Number.isFinite(Number(value)) && isModifier(key)) {
      out.modifiers.push({ name: key, value: Number(value) });
    }
  }
  return out;
}

/** The `.txt` files of one folder, sorted, or none when it is not there. */
function listScripts(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".txt"))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/** A mod folder's name as a file name may spell it. */
function sanitizeFileName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "mod"
  );
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
