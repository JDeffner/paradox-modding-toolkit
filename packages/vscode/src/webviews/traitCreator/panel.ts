/**
 * The Trait Creator's VS Code host (px.createTrait).
 *
 * It does the four things the app cannot: ask the language server what a trait
 * may contain, decode the icon folder to PNG for the grid, resolve where a
 * definition goes and apply the server's edits as one undo step, and write the
 * loc through the normal loc writer.
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
  ModifierFormatsParams,
  ModifierFormatsResult,
} from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import type { PxConfig } from "../../config";
import { wireImages, type ImageRoot } from "../../creators/images";
import { applyDefinitionEdits, pickSaveTarget, writeLocValues } from "../../creators/save";
import { readModName } from "@px-lsp/protocol/modName";
import { convertImageToDds } from "../../ddsConvert";
import type { LocLookup } from "../../locCommands";
import { scaffoldPrefix } from "../../scaffold/command";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { GuiTextureCache } from "../guiEditor/textureCache";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { traitCreatorHtml } from "./html";
import type { AppToHost, HostToApp, TraitSave } from "./messages";

/** Icon thumbnails are grid-sized, the way the Flag Builder's browser is. */
const THUMB_DIM = 64;
/** Decodes per message, so a folder of 400 icons never blocks the host. */
const ICON_CHUNK = 40;
/** Loc keys answered per message: a trait's flags, not a dictionary. */
const LOC_CHUNK = 64;

export interface TraitCreatorActions {
  fetchForm(params: DefinitionFormParams): Promise<DefinitionForm | null>;
  editDefinition(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  /**
   * How the game prints each modifier, for the tooltip preview. Optional so a
   * client whose server predates the request still gets a working panel: the
   * preview then title-cases the names instead of quoting the game.
   */
  fetchModifierFormats?(params: ModifierFormatsParams): Promise<ModifierFormatsResult | null>;
}

export interface TraitCreatorOptions {
  cfg: PxConfig;
  meta: GameMeta;
  actions: TraitCreatorActions;
  lookupLoc: LocLookup;
  /** Open this definition instead of a blank form. */
  name?: string;
}

export class TraitCreatorPanel {
  private static instance: TraitCreatorPanel | undefined;
  private static readonly viewType = "px.traitCreator";

  private readonly panel: vscode.WebviewPanel;
  private readonly textures: GuiTextureCache;
  private options: TraitCreatorOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  /** The form last answered: the save flow needs its folder and loc patterns. */
  private form: DefinitionForm | null = null;

  private constructor(context: vscode.ExtensionContext, options: TraitCreatorOptions) {
    this.options = options;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, { gamePath: null, modPath: null });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      TraitCreatorPanel.viewType,
      "Trait Creator",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );
    this.panel.iconPath = tabIcon("trait-creator");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = traitCreatorHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "traitCreator"),
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
    this.disposables.push(watchBundle(source, "traitCreator", render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(context: vscode.ExtensionContext, options: TraitCreatorOptions): void {
    const existing = TraitCreatorPanel.instance;
    if (existing) {
      existing.options = options;
      existing.panel.reveal();
      void existing.postInit();
      return;
    }
    TraitCreatorPanel.instance = new TraitCreatorPanel(context, options);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    TraitCreatorPanel.instance = undefined;
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
      return "The game folder is not set, so the trait list and the icon grid are empty and a file name that would replace a game file cannot be caught. Run Setup & Health Check.";
    }
    return undefined;
  }

  private async postInit(): Promise<void> {
    const { cfg, actions, name } = this.options;
    let form: DefinitionForm | null = null;
    try {
      form = await actions.fetchForm({ kind: "trait", modRoot: cfg.modPath, ...(name ? { name } : {}) });
    } catch (err) {
      this.post({ type: "toast", message: `Trait Creator: ${messageOf(err)}`, variant: "destructive" });
      return;
    }
    if (!form) {
      this.post({
        type: "toast",
        message: `Trait Creator: ${this.options.meta.name} has no trait database.`,
        variant: "destructive",
      });
      return;
    }
    this.form = form;
    this.post({
      type: "init",
      init: {
        form,
        modLabel: cfg.modPath ? path.basename(cfg.modPath) : null,
        locLanguage: cfg.locLanguage,
        prefix: scaffoldPrefix(cfg),
        iconKeys: this.iconKeys(form),
        ...(this.problem() ? { problem: this.problem()! } : {}),
      },
    });
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
      result = await actions.fetchModifierFormats({ modRoot: cfg.modPath });
    } catch {
      // A server that does not know the request leaves the preview unformatted,
      // which is a smaller failure than a panel that does not open.
      return;
    }
    this.post({ type: "modifierFormats", formats: result?.formats ?? null });
  }

  /**
   * Where a texture path is looked up: the load order, game first, so a mod's
   * own picture of the same path wins the way it does in the game (the roots
   * `px.openFlagBuilder` builds).
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

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postInit();
        return;
      case "load": {
        const form = await this.options.actions.fetchForm({
          kind: "trait",
          name: message.name,
          modRoot: this.options.cfg.modPath,
        });
        if (form) {
          this.form = form;
          this.post({ type: "form", form });
        }
        return;
      }
      case "icons":
        await this.sendIcons(message.keys);
        return;
      case "images":
        // The texticons of a modifier line ("[gold_i]"), which are ordinary
        // game textures rather than files of the trait icon folder.
        wireImages(this.panel, this.imageRoots(), this.textures, message);
        return;
      case "loc":
        await this.sendLoc(message.keys);
        return;
      case "save":
        await this.save(message.save);
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
      case "convertIcon":
        await this.convertIcon(message.name);
        return;
    }
  }

  // -- icons ---------------------------------------------------------------

  /** Every root that can hold this kind's icons, mod first: the mod's own
   *  picture is the one a modder is looking for. */
  private iconRoots(): string[] {
    const { cfg } = this.options;
    const roots: string[] = [];
    for (const root of [...(cfg.modPath ? [cfg.modPath] : []), ...cfg.workspaceMods, ...cfg.parentPaths]) {
      if (!roots.includes(root)) roots.push(root);
    }
    if (cfg.gamePath) roots.push(cfg.gamePath);
    return roots;
  }

  private iconDirs(form: DefinitionForm): string[] {
    if (!form.iconFolder) return [];
    const stages = this.options.meta.stageRoots ?? [""];
    const dirs: string[] = [];
    for (const root of this.iconRoots()) {
      for (const stage of stages) {
        dirs.push(path.join(root, stage, ...form.iconFolder.split("/")));
      }
    }
    return dirs;
  }

  /** The icon file names of the folder, deduplicated, mod entries first. */
  private iconKeys(form: DefinitionForm): string[] {
    const seen = new Set<string>();
    for (const dir of this.iconDirs(form)) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir).sort();
      } catch {
        continue; // the folder does not exist at this root
      }
      for (const file of files) {
        if (/\.(dds|tga|png)$/i.test(file)) seen.add(file);
      }
    }
    return [...seen];
  }

  /**
   * The player's word for a loc key, for the preview. Mod first: a key the mod
   * redefines reads the way the mod defines it, the way the game reads it.
   */
  private async sendLoc(keys: string[]): Promise<void> {
    const values: Record<string, string> = {};
    for (const key of keys.slice(0, LOC_CHUNK)) {
      let entries;
      try {
        entries = await this.options.lookupLoc(key);
      } catch {
        continue; // the index is not up yet; the app shows the key instead
      }
      const value = (entries.find((e) => e.source === "mod") ?? entries[0])?.value;
      if (value) values[key] = value;
    }
    if (Object.keys(values).length > 0) this.post({ type: "loc", values });
  }

  private locateIcon(file: string): string | null {
    // Only names the listing produced ever come back, but a message is still
    // text from a webview: no path may leave the icon folder.
    if (!/^[\w.() -]+\.(dds|tga|png)$/i.test(file)) return null;
    for (const dir of this.iconDirs(this.form!)) {
      const abs = path.join(dir, file);
      if (fs.existsSync(abs)) return abs;
    }
    return null;
  }

  private async sendIcons(keys: string[]): Promise<void> {
    if (!this.form) return;
    for (let i = 0; i < keys.length; i += ICON_CHUNK) {
      const urls: Record<string, string | null> = {};
      for (const key of keys.slice(i, i + ICON_CHUNK)) {
        const abs = this.locateIcon(key);
        const png = abs ? this.textures.resolveFile(abs, THUMB_DIM) : null;
        urls[key] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
      }
      this.post({ type: "icons", urls });
      // Yield between chunks so a 400-icon folder never freezes the window.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.disposed) return;
    }
  }

  /**
   * Convert a picked image into the mod's icon folder under the trait's own
   * name. That is the path the engine derives from the key, so the block needs
   * no `icon` line at all and the trait keeps working if it is renamed by hand.
   */
  private async convertIcon(name: string): Promise<void> {
    const { cfg } = this.options;
    const modPath = cfg.modPath ?? cfg.workspaceMods[0];
    if (!modPath || !this.form?.iconFolder) {
      this.post({ type: "toast", message: "No mod folder to write the icon into.", variant: "destructive" });
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      this.post({ type: "toast", message: "Name the trait first: the icon is named after it." });
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Images: ["png", "jpg", "jpeg", "webp"] },
      title: `Image for ${name}`,
    });
    if (!picked?.length) return;
    const dir = path.join(modPath, ...this.form.iconFolder.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    const target = vscode.Uri.file(path.join(dir, `${name}.dds`));
    try {
      await convertImageToDds(picked[0], target);
    } catch (err) {
      this.post({ type: "toast", message: `Conversion failed: ${messageOf(err)}`, variant: "destructive" });
      return;
    }
    const png = this.textures.resolveFile(target.fsPath, THUMB_DIM);
    this.post({
      type: "iconWritten",
      key: `${name}.dds`,
      url: png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null,
    });
    this.post({
      type: "toast",
      message: `Wrote ${name}.dds into ${this.form.iconFolder}. The game finds it by the trait's name.`,
    });
  }

  // -- saving --------------------------------------------------------------

  private async save(save: TraitSave): Promise<void> {
    const { cfg, actions, lookupLoc } = this.options;
    if (!this.form) return;
    const folder = this.form.folder;

    // An edit rewrites the mod's own file; everything else asks where to go.
    let abs: string;
    let text: string;
    if (save.mode === "edit" && this.form.current && this.form.current.source === "mod") {
      abs = this.form.current.file;
      try {
        text = (await vscode.workspace.openTextDocument(abs)).getText();
      } catch (err) {
        void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${messageOf(err)}`);
        this.post({ type: "saved", ok: false, name: save.name });
        return;
      }
    } else {
      const target = await pickSaveTarget(cfg, folder, {
        kind: "trait",
        ...(save.sourceFile ? { sourceFile: save.sourceFile } : {}),
      });
      if (!target) {
        this.post({ type: "saved", ok: false, name: save.name });
        return;
      }
      abs = target.abs;
      text = target.text;
    }

    const uri = vscode.Uri.file(abs).toString();
    const ops =
      save.mode === "edit" && save.changed
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
    void vscode.window.showErrorMessage(`Trait Creator: cannot open ${file}: ${messageOf(err)}`);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
