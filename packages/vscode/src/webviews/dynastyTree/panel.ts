/**
 * The Dynasty Tree panel's VS Code host (px.openDynastyTree).
 *
 * It does the three things the app cannot: ask the language server for the
 * dynasty model, turn a filled form into script and write it into the mod, and
 * open the file it wrote. Drawing, panning and every form lives in app/.
 *
 * Writing is the other creators' flow (creators/save.ts): the target is
 * resolved by `pickSaveTarget` (the mod, the file, the vanilla-name refusal and
 * the BOM in one place), the server answers offsets into the text that pick
 * handed back, and `applyDefinitionEdits` applies them as ONE WorkspaceEdit
 * against a document that has not moved since. Nothing here reads or writes a
 * file itself, so unsaved editor changes are never overwritten.
 */
import * as vscode from "vscode";
import * as path from "path";
import type {
  DefinitionEditParams,
  DefinitionEditResult,
  DynastyTreeParams,
  DynastyTreeResult,
  EventValueOptionsParams,
  EventValueOptionsResult,
} from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import type { PxConfig } from "../../config";
import { applyDefinitionEdits, pickSaveTarget } from "../../creators/save";
import { characterBlock, dynastyBlock, houseBlock, unquotableValue } from "./blocks";
import { dynastyTreeHtml } from "./html";
import type { AppToHost, HostToApp, ModTarget, OptionSets } from "./messages";
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

export interface DynastyTreeActions {
  fetchTree(params: DynastyTreeParams): Promise<DynastyTreeResult>;
  fetchOptions(params: EventValueOptionsParams): Promise<EventValueOptionsResult | null>;
  /** paradox/definitionEdit: the offsets a block's write lands at. */
  editDefinition(params: DefinitionEditParams): Promise<DefinitionEditResult>;
  /** writeLocSmart: the one entry point for a loc value (locCommands.ts). */
  writeLoc(key: string, value: string): Promise<string>;
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
  private options: DynastyTreeOptions;
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  /** A deep-linked dynasty, replayed once the app has booted. */
  private pending: string | undefined;
  /** The dynasty currently drawn, so a save can reload the same tree. */
  private current: string | undefined;

  private constructor(
    context: vscode.ExtensionContext,
    actions: DynastyTreeActions,
    options: DynastyTreeOptions,
    dynasty?: string
  ) {
    this.actions = actions;
    this.options = options;
    this.pending = dynasty;
    const source = webviewSource(context);
    this.panel = vscode.window.createWebviewPanel(
      DynastyTreePanel.viewType,
      "Dynasty Tree",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source.root] }
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
          setupProblem: this.options.setupProblem,
        });
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
      case "saveCharacter": {
        if (this.refuseQuote(msg.form)) return;
        const block = characterBlock(msg.form, await this.previousBlock(msg.file, msg.form.id));
        for (const note of block.notes) this.post({ type: "toast", message: note });
        await this.write(TARGETS.character, msg.form.id, block.text, msg.file);
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
    this.post({ type: "options", sets });
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
    previousFile?: string
  ): Promise<boolean> {
    const stage = this.options.meta.stageRoots?.[0];
    const folder = stage ? `${stage}/${target.folder}` : target.folder;
    const where = await this.saveTarget(folder, target.kind, previousFile);
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
   * The file the block goes into, with the text its offsets are into. A block
   * that already lives in one of the workspace's mods is rewritten where it is
   * (the Trait Creator's edit path); anything else asks, which is where the
   * mod pick, the file list and the vanilla-name refusal live.
   */
  private async saveTarget(
    folder: string,
    kind: string,
    previousFile?: string
  ): Promise<{ abs: string; text: string } | null> {
    if (previousFile && this.options.mods.some((m) => isInside(m.path, previousFile))) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(previousFile));
        return { abs: previousFile, text: doc.getText() };
      } catch (err) {
        this.post({ type: "toast", message: message(err), variant: "destructive" });
        return null;
      }
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
