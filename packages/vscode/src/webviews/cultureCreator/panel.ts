/**
 * The Culture Creator's VS Code host (px.createCulture).
 *
 * It does the four things the app cannot: ask the language server what a
 * culture may contain (paradox/definitionForm), read the named colors and the
 * tradition catalog out of the game and mod folders, decode the game's own
 * pillar and tradition art to pictures the webview may load, and write the
 * block and its loc through the shared creator flow (creators/save.ts) so a
 * save is one undo step and lands in a file the modder picked.
 *
 * Every path comes from `PxConfig`; this panel adds no setting of its own.
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
} from "@px-lsp/protocol/protocol";
import { parseNamedColors } from "@px-lsp/server/coa/coaParse";
import type { PxConfig } from "../../config";
import { type ImageRoot, wireImages } from "../../creators/images";
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
import { buildCatalog } from "./catalog";
import { cultureCreatorHtml } from "./html";
import type { AppToHost, CultureCatalog, CultureInit, HostToApp } from "./messages";

/** The definition kind this panel edits; the schema table's own spelling. */
const KIND = "culture";

export interface CultureCreatorActions {
  fetchForm(params: DefinitionFormParams): Promise<DefinitionForm | null>;
  applyEdits(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  lookupLoc: LocLookup;
}

/**
 * Every folder a culture's data and art may come from, in LOAD ORDER: the game
 * first, then dependency mods, then the workspace's own. Last-in-wins is the
 * game's rule for script databases and for assets alike, so a mod's tradition
 * and a mod's icon both win over the game's.
 */
function loadOrder(cfg: PxConfig): string[] {
  const roots = [...(cfg.gamePath ? [cfg.gamePath] : []), ...cfg.parentPaths, ...cfg.workspaceMods];
  if (cfg.modPath) roots.push(cfg.modPath);
  return roots.filter((root, at) => roots.indexOf(root) === at);
}

/**
 * The named colors a culture may write instead of three components, in load
 * order with the mod last so a mod's own color wins, the way the game reads
 * `common/named_colors` (the Flag Builder's database.ts does the same).
 */
function readNamedColors(cfg: PxConfig): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const root of loadOrder(cfg)) {
    const dir = path.join(root, "common", "named_colors");
    let files: string[];
    try {
      files = fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".txt"))
        .sort();
    } catch {
      continue; // the folder does not exist in this root
    }
    for (const file of files) {
      try {
        Object.assign(out, parseNamedColors(fs.readFileSync(path.join(dir, file), "utf8")));
      } catch {
        // an unreadable file is not worth failing the panel over
      }
    }
  }
  return out;
}

export class CultureCreatorPanel {
  private static instance: CultureCreatorPanel | undefined;
  private static readonly viewType = "px.cultureCreator";

  private readonly panel: vscode.WebviewPanel;
  private readonly actions: CultureCreatorActions;
  private readonly textures: GuiTextureCache;
  private cfg: PxConfig;
  /** The culture to load on the next `ready` (a deep-linked command argument). */
  private pending: string | undefined;
  private form: DefinitionForm | null = null;
  /** Read from disk once: it describes the game, not the culture being edited. */
  private catalog: CultureCatalog | undefined;
  /** Where the modder said the next save goes; null means the default rules. */
  private chosen: SaveTargetChoice | null = null;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(
    context: vscode.ExtensionContext,
    cfg: PxConfig,
    actions: CultureCreatorActions,
    name?: string
  ) {
    this.cfg = cfg;
    this.actions = actions;
    this.pending = name;
    this.textures = new GuiTextureCache(context.globalStorageUri.fsPath, {
      gamePath: null,
      modPath: null,
    });
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      CultureCreatorPanel.viewType,
      "Culture Creator",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [source.root, vscode.Uri.file(this.textures.cacheDir)],
      }
    );
    this.panel.iconPath = tabIcon("culture-creator");
    const render = (): void => {
      const nonce = makeNonce();
      this.panel.webview.html = cultureCreatorHtml({
        scriptSrc: bundleUri(this.panel.webview, source, "cultureCreator"),
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
    // The rebooted app sends "ready" and the host answers it with the form.
    this.disposables.push(watchBundle(source, "cultureCreator", render));
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => void this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static show(
    context: vscode.ExtensionContext,
    cfg: PxConfig,
    actions: CultureCreatorActions,
    name?: string
  ): void {
    const existing = CultureCreatorPanel.instance;
    if (existing) {
      existing.cfg = cfg;
      existing.panel.reveal(vscode.ViewColumn.Active);
      void existing.load(name);
      return;
    }
    CultureCreatorPanel.instance = new CultureCreatorPanel(context, cfg, actions, name);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    CultureCreatorPanel.instance = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
    this.panel.dispose();
  }

  private post(message: HostToApp): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  /** Fetch the form (for `name`, when given) and hand the app everything at once. */
  private async load(name?: string): Promise<void> {
    this.post({ type: "loading" });
    // The culture being opened decides where a save goes, so a target picked
    // for the previous one does not carry over to it.
    this.chosen = null;
    let form: DefinitionForm | null;
    try {
      form = await this.actions.fetchForm({
        kind: KIND,
        modRoot: this.cfg.modPath,
        ...(name ? { name } : {}),
      });
    } catch (err) {
      this.post({ type: "error", message: errorText(err) });
      return;
    }
    if (!form) {
      this.post({
        type: "error",
        message: "This workspace's game has no culture folder, so there is nothing to write.",
      });
      return;
    }
    this.form = form;
    const init: CultureInit = {
      form,
      locLanguage: this.cfg.locLanguage,
      prefix: scaffoldPrefix(this.cfg),
      namedColors: readNamedColors(this.cfg),
      catalog: await this.readCatalog(form),
      ...(this.cfg.calendar ? { calendar: this.cfg.calendar } : {}),
      noMod: this.cfg.modPath === null && this.cfg.workspaceMods.length === 0,
      noGame: this.cfg.gamePath === null,
    };
    this.post({ type: "init", init });
    this.postTarget();
  }

  // -- where it saves ------------------------------------------------------

  /**
   * Where the next save goes: what the modder picked, else the default rules
   * (the file a mod culture was loaded from, else the mod of record under the
   * kind's default file name).
   */
  private targetChoice(): SaveTargetChoice | null {
    if (this.chosen) return this.chosen;
    const current = this.form?.current;
    return defaultSaveTarget(this.cfg, {
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
    const picked = await pickSaveTargetChoice(this.cfg, this.form.folder, {
      kind: KIND,
      ...(this.form.current ? { sourceFile: path.basename(this.form.current.file) } : {}),
    });
    if (!picked) return;
    this.chosen = picked;
    this.postTarget();
  }

  /**
   * The pillar and tradition catalog, read once. It describes the installed
   * game and the mods, so loading a second culture reuses it rather than
   * walking the tradition folder and asking for hundreds of loc lines again.
   */
  private async readCatalog(form: DefinitionForm): Promise<CultureCatalog> {
    if (this.catalog) return this.catalog;
    const describe = [...(form.options.culture_pillar ?? []), ...(form.options.culture_tradition ?? [])].map(
      (item) => item.value
    );
    this.catalog = await buildCatalog(loadOrder(this.cfg), describe, this.actions.lookupLoc);
    return this.catalog;
  }

  /** Where a picture may come from, game first: `resolveImage` takes the last. */
  private imageRoots(): ImageRoot[] {
    return loadOrder(this.cfg).map((root) => ({ label: path.basename(root), path: root }));
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "ready": {
        const name = this.pending;
        this.pending = undefined;
        await this.load(name);
        return;
      }
      case "new":
        await this.load();
        return;
      case "load":
        await this.load(msg.name);
        return;
      case "images":
        wireImages(this.panel, this.imageRoots(), this.textures, msg);
        return;
      case "editTradition":
        // The Tradition Creator is its own panel and command; an empty name opens it blank.
        await vscode.commands.executeCommand("px.createTradition", msg.name || undefined);
        return;
      case "openExamples":
        // A culture key is no wiki article, so the button opens the index.
        await vscode.commands.executeCommand("px.showExamplesWiki");
        return;
      case "copy":
        await vscode.env.clipboard.writeText(msg.text);
        this.post({ type: "toast", message: "Script copied to the clipboard." });
        return;
      case "changeTarget":
        await this.changeTarget();
        return;
      case "save":
        await this.save(msg);
        return;
    }
  }

  private async save(msg: Extract<AppToHost, { type: "save" }>): Promise<void> {
    const folder = this.form?.folder;
    if (!folder) {
      this.post({ type: "idle" });
      return;
    }
    // No question here: the target has been in the top bar since the form
    // loaded, and clicking it is how a modder changes where this lands.
    const choice = this.targetChoice();
    if (!choice) {
      this.post({ type: "error", message: "No mod folder to save into." });
      return;
    }
    const wanted = path.join(choice.modPath, ...folder.split("/"), choice.file);
    const from = msg.mode === "edit" && this.form?.current?.source === "mod" ? this.form.current.file : null;
    // Writing back into the file the culture already lives in: the block is
    // there, so `setProperties` can touch only the statements that moved.
    const inPlace = from !== null && samePath(wanted, from);

    let abs: string;
    let text: string;
    let label: string;
    if (inPlace) {
      abs = from;
      label = path.basename(abs);
      try {
        text = (await vscode.workspace.openTextDocument(abs)).getText();
      } catch (err) {
        this.post({ type: "error", message: errorText(err) });
        return;
      }
    } else {
      const target = await openSaveTarget(this.cfg, folder, choice);
      if (!target) {
        this.post({ type: "idle" });
        return;
      }
      abs = target.abs;
      text = target.text;
      label = target.file;
    }
    // An edit of the mod's own culture, in its own file, touches only the keys
    // that changed; everything else is one whole block.
    const op: DefinitionOp =
      inPlace && msg.changed
        ? { op: "setProperties", name: msg.name, properties: msg.changed }
        : { op: "upsertBlock", name: msg.name, text: msg.block };
    let result: DefinitionEditResult;
    try {
      result = await this.actions.applyEdits({
        uri: vscode.Uri.file(abs).toString(),
        text,
        ops: [op],
      });
    } catch (err) {
      this.post({ type: "error", message: errorText(err) });
      return;
    }
    const refused = result.ops.find((o) => o.refused)?.refused;
    if (refused) {
      this.post({ type: "error", message: refused });
      return;
    }
    if (!(await applyDefinitionEdits(abs, text, result.edits))) {
      this.post({ type: "idle" });
      return;
    }
    let locFiles: string[];
    try {
      // The target, so a NEW key lands in the loc file named after the script
      // file it belongs to rather than in the mod's largest one.
      locFiles = await writeLocValues(this.cfg, this.actions.lookupLoc, msg.loc, choice);
    } catch (err) {
      // The block is written; only the loc failed. Say so and let the app go
      // back to idle, or its Save button stays disabled for good.
      this.post({ type: "idle" });
      void vscode.window.showWarningMessage(
        `Paradox Modding Toolkit: ${msg.name} was written to ${label}, but its localization was not: ${errorText(err)}`
      );
      return;
    }
    this.post({ type: "saved", name: msg.name });
    // The loc FILES by name, not a count: "2 keys saved" left a modder with
    // nowhere to look when the words did not show up in the game.
    const written = [label, ...new Set(locFiles.map((file) => path.basename(file)))];
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: ${msg.name} written to ${written.join(", ")}.`
    );
    // The form now holds a mod definition: reload so a second save edits it.
    await this.load(msg.name);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
