/**
 * The Culture Creator's VS Code host (px.createCulture).
 *
 * It does the three things the app cannot: ask the language server what a
 * culture may contain (paradox/definitionForm), read the named colors out of
 * the game and mod folders, and write the block and its loc through the shared
 * creator flow (creators/save.ts) so a save is one undo step and lands in a
 * file the modder picked.
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
import { applyDefinitionEdits, pickSaveTarget, writeLocValues } from "../../creators/save";
import type { LocLookup } from "../../locCommands";
import { scaffoldPrefix } from "../../scaffold/command";
import { bundleUri, watchBundle, webviewSource } from "../devReload";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";
import { cultureCreatorHtml } from "./html";
import type { AppToHost, CultureInit, HostToApp } from "./messages";

/** The definition kind this panel edits; the schema table's own spelling. */
const KIND = "culture";

export interface CultureCreatorActions {
  fetchForm(params: DefinitionFormParams): Promise<DefinitionForm | null>;
  applyEdits(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  lookupLoc: LocLookup;
}

/**
 * The named colors a culture may write instead of three components, in load
 * order with the mod last so a mod's own color wins, the way the game reads
 * `common/named_colors` (the Flag Builder's database.ts does the same).
 */
function readNamedColors(cfg: PxConfig): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const roots = [...(cfg.gamePath ? [cfg.gamePath] : []), ...cfg.parentPaths, ...cfg.workspaceMods];
  if (cfg.modPath) roots.push(cfg.modPath);
  for (const root of roots) {
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
  private cfg: PxConfig;
  /** The culture to load on the next `ready` (a deep-linked command argument). */
  private pending: string | undefined;
  private form: DefinitionForm | null = null;
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
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      CultureCreatorPanel.viewType,
      "Culture Creator",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source.root] }
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
      saveMod: this.cfg.modPath ? path.basename(this.cfg.modPath) : null,
      locLanguage: this.cfg.locLanguage,
      prefix: scaffoldPrefix(this.cfg),
      namedColors: readNamedColors(this.cfg),
      ...(this.cfg.calendar ? { calendar: this.cfg.calendar } : {}),
      noMod: this.cfg.modPath === null && this.cfg.workspaceMods.length === 0,
    };
    this.post({ type: "init", init });
  }

  private async onMessage(msg: AppToHost): Promise<void> {
    switch (msg.type) {
      case "ready": {
        const name = this.pending;
        this.pending = undefined;
        await this.load(name);
        return;
      }
      case "load":
        await this.load(msg.name);
        return;
      case "openExamples":
        await vscode.commands.executeCommand("px.showExamplesWiki", msg.name);
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
    const target = await pickSaveTarget(this.cfg, folder, {
      kind: KIND,
      ...(msg.sourceFile ? { sourceFile: msg.sourceFile } : {}),
    });
    if (!target) {
      this.post({ type: "idle" });
      return;
    }
    // An edit of the mod's own culture touches only the keys that changed; a
    // new, duplicated or overriding culture is one whole block.
    const op: DefinitionOp =
      msg.mode === "edit" && msg.changed
        ? { op: "setProperties", name: msg.name, properties: msg.changed }
        : { op: "upsertBlock", name: msg.name, text: msg.block };
    let result: DefinitionEditResult;
    try {
      result = await this.actions.applyEdits({
        uri: vscode.Uri.file(target.abs).toString(),
        text: target.text,
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
    if (!(await applyDefinitionEdits(target.abs, target.text, result.edits))) {
      this.post({ type: "idle" });
      return;
    }
    const locFiles = await writeLocValues(this.cfg, this.actions.lookupLoc, msg.loc);
    this.post({ type: "saved", name: msg.name });
    void vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: ${msg.name} written to ${target.file}` +
        (locFiles.length > 0 ? ` and ${locFiles.length} localization key(s) saved.` : ".")
    );
    // The form now holds a mod definition: reload so a second save edits it.
    await this.load(msg.name);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
