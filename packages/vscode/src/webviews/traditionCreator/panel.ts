/**
 * The Tradition Creator's VS Code host (px.createTradition).
 *
 * It does the four things the app cannot: ask the language server what a
 * culture tradition may contain, read off the game and mod folders what the
 * form request cannot answer (catalog.ts) and decode the pictures for it,
 * resolve where a definition goes and apply the server's edits as one undo
 * step, and write the loc through the normal loc writer.
 *
 * Every path comes from `PxConfig`: the creator adds no setting of its own and
 * never asks for a folder. A workspace that cannot be written to says so in
 * the panel, with the wording and the fix path the setup flow uses, instead of
 * opening a form whose Save would fail.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type {
  DefinitionEditParams,
  DefinitionEditResult,
  DefinitionForm,
  DefinitionFormParams,
  LocTextParams,
  LocTextResult,
  ModifierFormatsParams,
  ModifierFormatsResult,
} from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import { readModName } from "@px-lsp/protocol/modName";
import type { PxConfig } from "../../config";
import { wireImages, type ImageRoot } from "../../creators/images";
import {
  applyDefinitionEdits,
  defaultSaveTarget,
  openSaveTarget,
  pickSaveTargetChoice,
  samePath,
  writeLocValues,
  type SaveTargetChoice,
} from "../../creators/save";
import type { LocLookup } from "../../locCommands";
import { scaffoldPrefix } from "../../scaffold/command";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { GuiTextureCache } from "../guiEditor/textureCache";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { buildTraditionCatalog } from "./catalog";
import { traditionCreatorHtml } from "./html";
import {
  costLocKey,
  type AppToHost,
  type HostToApp,
  type TraditionCatalog,
  type TraditionSave,
} from "./messages";

/** The definition kind the CK3 schema table gives common/culture/traditions. */
const KIND = "culture_tradition";

/** Loc keys answered per message: a handful of category words, not a dictionary. */
const LOC_CHUNK = 64;

export interface TraditionCreatorActions {
  fetchForm(params: DefinitionFormParams): Promise<DefinitionForm | null>;
  editDefinition(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  /**
   * How the game prints each modifier, for the tooltip preview. Optional so a
   * client whose server predates the request still gets a working panel: the
   * preview then title-cases the names instead of quoting the game.
   */
  fetchModifierFormats?(params: ModifierFormatsParams): Promise<ModifierFormatsResult | null>;
  /**
   * A loc value as the player reads it, for the parameter sentences. Optional
   * for the same reason: without it the panel shows the value verbatim, which
   * is what it did before the request existed.
   */
  fetchLocText?(params: LocTextParams): Promise<LocTextResult>;
}

export interface TraditionCreatorOptions {
  cfg: PxConfig;
  meta: GameMeta;
  actions: TraditionCreatorActions;
  lookupLoc: LocLookup;
  /** Open this definition instead of a blank form. */
  name?: string;
}

export class TraditionCreatorPanel {
  private static instance: TraditionCreatorPanel | undefined;
  private static readonly viewType = "px.traditionCreator";

  private readonly panel: vscode.WebviewPanel;
  private readonly textures: GuiTextureCache;
  private options: TraditionCreatorOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  /** The form last answered: the save flow needs its folder and loc patterns. */
  private form: DefinitionForm | null = null;
  /** What the game and mod folders say, read once: the layer folders alone are
   *  five directory walks and they do not change while the panel is open. */
  private catalog: TraditionCatalog | null = null;
  /** The target the modder picked, which outranks the default until reset. */
  private chosen: SaveTargetChoice | null = null;

  private constructor(context: vscode.ExtensionContext, options: TraditionCreatorOptions) {
    this.options = options;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, { gamePath: null, modPath: null });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      TraditionCreatorPanel.viewType,
      "Tradition Creator",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );
    this.panel.iconPath = tabIcon("tradition-creator");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = traditionCreatorHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "traditionCreator"),
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
    // The rebooted app sends "ready" and postInit answers it; nothing else.
    this.disposables.push(watchBundle(source, "traditionCreator", render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(context: vscode.ExtensionContext, options: TraditionCreatorOptions): void {
    const existing = TraditionCreatorPanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal();
      void existing.postInit();
      return;
    }
    TraditionCreatorPanel.instance = new TraditionCreatorPanel(context, options);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    TraditionCreatorPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  /** What is missing, said the way the setup flow says it, or undefined. */
  private problem(): string | undefined {
    const { cfg } = this.options;
    if (!cfg.modPath && cfg.workspaceMods.length === 0) {
      return "No mod folder found. Open your mod folder (the one with the mod's descriptor) as a workspace folder, then reopen this panel.";
    }
    if (!cfg.gamePath) {
      return "The game folder is not set, so the tradition list, the icon layers and the cost currencies are empty and a file name that would replace a game file cannot be caught. Run Setup & Health Check.";
    }
    return undefined;
  }

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

  private async postInit(): Promise<void> {
    const { cfg, actions, name } = this.options;
    let form: DefinitionForm | null = null;
    try {
      form = await actions.fetchForm({ kind: KIND, modRoot: cfg.modPath, ...(name ? { name } : {}) });
    } catch (err) {
      this.post({ type: "toast", message: `Tradition Creator: ${messageOf(err)}`, variant: "destructive" });
      return;
    }
    if (!form) {
      this.post({
        type: "toast",
        message: `Tradition Creator: ${this.options.meta.name} has no culture tradition database.`,
        variant: "destructive",
      });
      return;
    }
    this.form = form;
    this.catalog ??= buildTraditionCatalog(this.imageRoots().map((root) => root.path));
    this.post({
      type: "init",
      init: {
        form,
        locLanguage: cfg.locLanguage,
        prefix: scaffoldPrefix(cfg),
        catalog: this.catalog,
        ...(this.problem() ? { problem: this.problem()! } : {}),
      },
    });
    this.postTarget();
    await this.postModifierFormats();
  }

  /**
   * The game's own print rules for every modifier, fetched ONCE per panel: the
   * preview needs them for every line and they do not change while it is open.
   */
  private async postModifierFormats(): Promise<void> {
    const { cfg, actions } = this.options;
    if (!actions.fetchModifierFormats) return;
    let result: ModifierFormatsResult | null = null;
    try {
      result = await actions.fetchModifierFormats({
        modRoot: cfg.modPath,
        // The game's own cost line per currency, for the tile preview.
        lines: (this.catalog?.costKeys ?? []).map(costLocKey),
      });
    } catch {
      // A server that does not know the request leaves the preview unformatted,
      // which is a smaller failure than a panel that does not open.
      return;
    }
    this.post({ type: "modifierFormats", formats: result?.formats ?? null, lines: result?.lines ?? {} });
  }

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postInit();
        return;
      case "load": {
        const form = await this.options.actions.fetchForm({
          kind: KIND,
          name: message.name,
          modRoot: this.options.cfg.modPath,
        });
        if (form) {
          this.form = form;
          // The definition that was opened decides where a save goes, so a
          // target the modder picked for the previous one does not carry over.
          this.chosen = null;
          this.post({ type: "form", form });
          this.postTarget();
        }
        return;
      }
      case "images":
        wireImages(this.panel, this.imageRoots(), this.textures, message);
        return;
      case "loc":
        await this.sendLoc(message.keys);
        return;
      case "save":
        await this.save(message.save);
        return;
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: "toast", message: "Script copied to the clipboard." });
        return;
      case "changeTarget":
        await this.changeTarget();
        return;
      case "openFile":
        await openAt(message.file, message.line);
        return;
      case "openExamples":
        // The only names the panel links out with are modifier rows.
        await vscode.commands.executeCommand("px.showExamplesWiki", {
          name: message.name,
          kind: "modifier",
        });
        return;
    }
  }

  /**
   * The player's word for a loc key, for the preview. Mod first: a key the mod
   * redefines reads the way the mod defines it, the way the game reads it.
   *
   * Two answers per key, because the panel needs both: the value VERBATIM (a
   * loc field edits it, a save writes it) and the value as the player READS it
   * (paradox/locText resolves the game's own `[GetTrait('x').GetName( … )]`
   * chains, which 145 of the 280 parameter sentences with a call take).
   */
  private async sendLoc(keys: string[]): Promise<void> {
    const asked = keys.slice(0, LOC_CHUNK);
    const values: Record<string, string> = {};
    for (const key of asked) {
      let entries;
      try {
        entries = await this.options.lookupLoc(key);
      } catch {
        continue; // the index is not up yet; the app shows the key instead
      }
      const value = (entries.find((e) => e.source === "mod") ?? entries[0])?.value;
      if (value) values[key] = value;
    }
    if (Object.keys(values).length === 0) return;
    const texts = await this.locTexts(asked);
    this.post({ type: "loc", values, ...(texts ? { texts } : {}) });
  }

  /** The rendered sentences, or undefined when the server does not serve them. */
  private async locTexts(keys: string[]): Promise<Record<string, string> | undefined> {
    if (!this.options.actions.fetchLocText) return undefined;
    try {
      const result = await this.options.actions.fetchLocText({ keys, modRoot: this.options.cfg.modPath });
      const texts: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.values)) texts[key] = value.text;
      return texts;
    } catch {
      return undefined; // the index is not up yet; the app shows the raw value
    }
  }

  // -- where it saves ------------------------------------------------------

  /**
   * Where the next save goes: what the modder picked, else the default the
   * rules give (the file a mod definition was loaded from, else the mod of
   * record under the kind's default file name).
   */
  private targetChoice(): SaveTargetChoice | null {
    if (this.chosen) return this.chosen;
    const current = this.form?.current;
    return defaultSaveTarget(this.options.cfg, {
      kind: KIND,
      ...(current && current.source === "mod" ? { sourcePath: current.file } : {}),
    });
  }

  /** Tell the app where it saves, so its top bar can say so. */
  private postTarget(): void {
    const choice = this.targetChoice();
    const folder = this.form?.folder;
    this.post({
      type: "target",
      target: choice && folder ? { modLabel: choice.modLabel, path: `${folder}/${choice.file}` } : null,
    });
  }

  /** The target line was clicked: the same picker the save used to open. */
  private async changeTarget(): Promise<void> {
    if (!this.form) return;
    const picked = await pickSaveTargetChoice(this.options.cfg, this.form.folder, {
      kind: KIND,
      ...(this.form.current ? { sourceFile: path.basename(this.form.current.file) } : {}),
    });
    if (!picked) return;
    this.chosen = picked;
    this.postTarget();
  }

  // -- saving --------------------------------------------------------------

  private async save(save: TraditionSave): Promise<void> {
    const { cfg, actions, lookupLoc } = this.options;
    if (!this.form) return;
    const folder = this.form.folder;

    // No question here: the target has been on screen since the form loaded.
    const choice = this.targetChoice();
    if (!choice) {
      this.post({ type: "toast", message: "No mod folder to save into.", variant: "destructive" });
      this.post({ type: "saved", ok: false, name: save.name });
      return;
    }
    const wanted = path.join(choice.modPath, ...folder.split("/"), choice.file);
    const source =
      save.mode === "edit" && this.form.current?.source === "mod" ? this.form.current.file : null;

    // Writing back into the file the definition already lives in: the block is
    // there, so the edit can touch only the lines that moved.
    const inPlace = source !== null && samePath(wanted, source);
    let abs: string;
    let text: string;
    if (inPlace) {
      abs = source!;
      try {
        text = (await vscode.workspace.openTextDocument(abs)).getText();
      } catch (err) {
        void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${messageOf(err)}`);
        this.post({ type: "saved", ok: false, name: save.name });
        return;
      }
    } else {
      const target = await openSaveTarget(cfg, folder, choice);
      if (!target) {
        this.post({ type: "saved", ok: false, name: save.name });
        return;
      }
      abs = target.abs;
      text = target.text;
    }

    const uri = vscode.Uri.file(abs).toString();
    const ops =
      inPlace && save.changed
        ? [{ op: "setProperties" as const, name: save.name, properties: save.changed }]
        : [{ op: "upsertBlock" as const, name: save.name, text: save.block }];
    const result = await actions.editDefinition({ uri, text, ops });
    const refused = result.ops.find((op) => op.refused)?.refused;
    if (refused) {
      void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${refused}`);
      this.post({ type: "saved", ok: false, name: save.name });
      return;
    }
    if (!(await applyDefinitionEdits(abs, text, result.edits))) {
      this.post({ type: "saved", ok: false, name: save.name });
      return;
    }

    let locFiles: string[];
    try {
      locFiles = await writeLocValues(cfg, lookupLoc, save.loc);
    } catch (err) {
      // The block is written; only the loc failed. The app is told the save is
      // over either way, or its Save button stays disabled until it reopens.
      this.post({
        type: "toast",
        message: `${save.name} was written, but its localization was not: ${messageOf(err)}`,
        variant: "destructive",
      });
      this.post({ type: "saved", ok: false, name: save.name });
      return;
    }
    const written = [path.basename(abs), ...locFiles.map((file) => path.basename(file))];
    this.post({ type: "toast", message: `Saved ${save.name} into ${written.join(", ")}.` });
    this.post({ type: "saved", ok: true, name: save.name });
  }
}

async function openAt(file: string, line: number): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const zero = Math.min(Math.max(0, line), Math.max(0, doc.lineCount - 1));
    const at = new vscode.Position(zero, 0);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      selection: new vscode.Range(at, at),
    });
  } catch (err) {
    void vscode.window.showErrorMessage(`Tradition Creator: cannot open ${file}: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
