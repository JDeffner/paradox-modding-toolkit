/**
 * The GUI editor's VS Code host (px.openGuiEditor).
 *
 * It implements messages.ts and does nothing the contract does not name: fetch
 * layout and widget info from the server, resolve textures to webview URLs,
 * push results down, reveal a line in the text editor, and turn an edit gesture
 * into a `WorkspaceEdit`. The document is the source of truth and stays the
 * editor's: the host re-requests layout on every change (debounced) and on
 * save, so the canvas follows typing, formatters, undo and reverts alike.
 *
 * The write path is deliberately thin: the SERVER decides what a gesture means
 * (`paradox/guiSourceEdit` returns edits or a refusal), the host only applies
 * the offsets it is handed. One gesture is one op is one `WorkspaceEdit`, which
 * is what makes VS Code's own undo the editor's undo.
 *
 * The webview loads dist/webview/guiEditor.js under the house nonce CSP: the
 * app is a real bundle, not a serialized function, because an editor does not
 * fit in a template literal.
 *
 * G5 stage 2 gives the host a third thing to own beside the text and the
 * textures: PER-USER STATE. The conditional-visibility mode is remembered per
 * document; the saved components, the presets and the inspector's value display
 * mode are remembered globally; all of it in `workspaceState`, because none of
 * it is in the document and none of it is the server's. The app holds only a
 * copy for drawing.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type {
  GuiSaveValuesResult,
  GuiDependenciesResult,
  GuiLayoutResult,
  GuiPreviewEntry,
  GuiPreviewResult,
  GuiSourceEditResult,
  GuiSourceOp,
  GuiVisibilityOptions,
  GuiVocabularyResult,
  GuiWidgetInfo,
} from "@px-lsp/protocol/protocol";
import { GUI_PREVIEW_MAX } from "@px-lsp/protocol/protocol";
import type { GameMeta } from "@px-lsp/server/games/profile";
import {
  LAYOUT_DEBOUNCE_MS,
  type AppToHost,
  type GuiLocMode,
  type HostToApp,
  type TextureEntry,
} from "./messages";
import { guiEditorHtml } from "./html";
import { gameDocsSubdir } from "../../config";
import { GuiTextureCache, THUMBNAIL_MAX_DIM, type TextureRoots } from "./textureCache";
import {
  COMPONENTS_KEY,
  countTopLevelBlocks,
  PRESETS_KEY,
  readUiState,
  UI_KEY,
  VISIBILITY_KEY,
  type StoredComponents,
  type StoredPresets,
} from "./userData";
import { makeNonce } from "../nonce";
import { tabIcon } from "../tabIcons";

export type FetchLayout = (
  uri: vscode.Uri,
  text: string,
  visibility: GuiVisibilityOptions | undefined,
  /** How textboxes are shown (`GuiLayoutParams.loc`) and the mod's preview table. */
  textOptions: { loc: GuiLocMode | undefined; previewValues: Record<string, string> | undefined }
) => Promise<GuiLayoutResult>;
export type FetchWidgetInfo = (
  uri: vscode.Uri,
  text: string,
  line: number,
  placement: boolean
) => Promise<GuiWidgetInfo | null>;
/** One op or a batch of them; the batch is what makes a multi-widget gesture one undo step. */
export type FetchSourceEdit = (
  uri: vscode.Uri,
  text: string,
  request: { op: GuiSourceOp } | { ops: GuiSourceOp[] }
) => Promise<GuiSourceEditResult | null>;
export type FetchVocabulary = (uri: vscode.Uri, text: string) => Promise<GuiVocabularyResult>;
export type FetchDependencies = (
  uri: vscode.Uri,
  text: string,
  line: number | undefined
) => Promise<GuiDependenciesResult>;
export type FetchSaveValues = (file: string) => Promise<GuiSaveValuesResult>;
/** One loc key's value through the host's index; undefined when nothing defines it. */
export type FetchLoc = (key: string) => Promise<string | undefined>;
export type FetchPreviews = (
  uri: vscode.Uri,
  text: string,
  entries: GuiPreviewEntry[]
) => Promise<GuiPreviewResult>;

/**
 * The per-user state lives in `workspaceState` under the keys `userData.ts`
 * names; that module owns the shapes so a second host reads the same bytes.
 * The visibility map is typed here with the wire's own options type, which is
 * narrower than the storage shape and is what this host actually writes.
 */
type StoredVisibility = Record<string, GuiVisibilityOptions>;

/**
 * Bounds on the texture walk. A game's `gfx/` tree is tens of thousands of
 * files deep in places, and the browser is a picker, not an asset database: the
 * walk stops at a depth no vanilla sprite path exceeds and at an entry count
 * that still holds every texture either root realistically ships, and the answer
 * itself is capped far lower because the panel thumbnails what it lists.
 *
 * TEXTURE_WALK_MAX counts every entry the walk MEETS, not the `.dds` it keeps:
 * models, meshes, `.asset` and portrait data are the bulk of a `gfx/` tree and
 * they cost the same readdirSync work. Counting hits instead left the walk
 * unbounded on exactly the trees it was meant to bound (a 22,314-entry tree with
 * zero `.dds` measured 5,290 ms cold, 776 ms warm, all of it on the extension
 * host). The value is raised to match the new unit.
 */
const TEXTURE_WALK_DEPTH = 10;
const TEXTURE_WALK_MAX = 200_000;
const TEXTURE_ANSWER_MAX = 200;
/** One page of thumbnails is what the app asks for; a longer batch is truncated. */
const THUMBNAIL_BATCH_MAX = 60;
/**
 * The modder's preview text per `[expression]`, kept with the mod under its
 * game's config folder (`.vic3modding/gui-preview-values.json`): it describes
 * what THAT mod's datafunctions should read as, so it travels with the mod and
 * not with the user.
 */
/** workspaceState key: the save file whose values feed the preview. */
const SAVE_KEY = "px.guiEditor.save";
const PREVIEW_VALUES_FILE = "gui-preview-values.json";

export class GuiEditorPanel {
  private static instance: GuiEditorPanel | undefined;
  private static readonly viewType = "px.guiEditor";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchLayout: FetchLayout;
  private readonly fetchWidgetInfo: FetchWidgetInfo;
  private readonly fetchSourceEdit: FetchSourceEdit;
  private readonly fetchVocabulary: FetchVocabulary;
  private readonly fetchDependencies: FetchDependencies;
  private readonly fetchPreviews: FetchPreviews;
  private readonly fetchSaveValues: FetchSaveValues;
  private readonly fetchLoc: FetchLoc;
  private readonly state: vscode.Memento;
  private readonly storageDir: string;
  private textures: GuiTextureCache;
  private roots: TextureRoots;
  /** The active game: its font, its stage root, its measured text metrics. */
  private meta: GameMeta;
  /** The gfx walk's answer, built once per panel per root set. */
  private textureIndex: TextureEntry[] | null = null;
  private disposables: vscode.Disposable[] = [];
  private sourceUri: vscode.Uri;
  private disposed = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  private constructor(
    context: vscode.ExtensionContext,
    fetchLayout: FetchLayout,
    fetchWidgetInfo: FetchWidgetInfo,
    fetchSourceEdit: FetchSourceEdit,
    fetchVocabulary: FetchVocabulary,
    fetchDependencies: FetchDependencies,
    fetchPreviews: FetchPreviews,
    fetchSaveValues: FetchSaveValues,
    fetchLoc: FetchLoc,
    source: vscode.TextDocument,
    roots: TextureRoots,
    meta: GameMeta
  ) {
    this.fetchLayout = fetchLayout;
    this.fetchLoc = fetchLoc;
    this.fetchWidgetInfo = fetchWidgetInfo;
    this.fetchSourceEdit = fetchSourceEdit;
    this.fetchVocabulary = fetchVocabulary;
    this.fetchDependencies = fetchDependencies;
    this.fetchPreviews = fetchPreviews;
    this.fetchSaveValues = fetchSaveValues;
    this.state = context.workspaceState;
    this.sourceUri = source.uri;
    this.storageDir = context.globalStorageUri.fsPath;
    this.roots = roots;
    this.meta = meta;
    this.textures = new GuiTextureCache(this.storageDir, roots);
    fs.mkdirSync(this.textures.cacheDir, { recursive: true });

    this.panel = vscode.window.createWebviewPanel(
      GuiEditorPanel.viewType,
      "GUI Editor",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Exactly two: the app bundle and the decoded textures.
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          vscode.Uri.file(this.textures.cacheDir),
        ],
      }
    );
    this.panel.iconPath = tabIcon("gui-editor");
    this.panel.webview.html = buildHtml(
      this.panel.webview,
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "guiEditor.js"),
      loadGameFont(roots.gamePath, meta.uiFont)
    );

    // onMessage awaits openTextDocument outside its own try, and the .gui can
    // stop being openable while the panel is up (a branch switch, a rename, a
    // mod rebuild that moves the folder). A rejection dropped here answers
    // nothing, so the app's `committing` stays set forever: the canvas keeps
    // drawing the stale live preview and every later gesture is swallowed by an
    // `if (committing) return;` guard. Answer the message instead, verbatim.
    this.panel.webview.onDidReceiveMessage(
      (message: AppToHost) => {
        void this.onMessage(message).catch((err: unknown) => {
          const id = (message as { id?: number }).id;
          const refused = err instanceof Error ? err.message : String(err);
          if (id !== undefined) this.post({ type: "editVerdict", id, refused });
          else this.post({ type: "error", message: refused });
        });
      },
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    vscode.workspace.onDidChangeTextDocument(
      (ev) => {
        if (ev.document.uri.toString() !== this.sourceUri.toString()) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.load(ev.document), LAYOUT_DEBOUNCE_MS);
      },
      undefined,
      this.disposables
    );
    vscode.workspace.onDidSaveTextDocument(
      (doc) => {
        if (doc.uri.toString() === this.sourceUri.toString()) void this.load(doc);
      },
      undefined,
      this.disposables
    );
  }

  static show(
    context: vscode.ExtensionContext,
    fetchLayout: FetchLayout,
    fetchWidgetInfo: FetchWidgetInfo,
    fetchSourceEdit: FetchSourceEdit,
    fetchVocabulary: FetchVocabulary,
    fetchDependencies: FetchDependencies,
    fetchPreviews: FetchPreviews,
    fetchSaveValues: FetchSaveValues,
    fetchLoc: FetchLoc,
    source: vscode.TextDocument,
    roots: TextureRoots,
    meta: GameMeta
  ): void {
    const existing = GuiEditorPanel.instance;
    if (existing) {
      // A .gui from another mod resolves its textures against THAT mod, so the
      // cache follows the document; and a debounce still pending for the old
      // one must not push its layout under the new title.
      if (existing.debounce) clearTimeout(existing.debounce);
      existing.debounce = undefined;
      existing.sourceUri = source.uri;
      existing.roots = roots;
      existing.meta = meta;
      existing.textures = new GuiTextureCache(existing.storageDir, roots);
      // The browser lists the roots the document resolves against, so the walk
      // is thrown away with the cache it belongs to.
      existing.textureIndex = null;
      existing.panel.reveal(undefined, true);
      void existing.load(source);
      return;
    }
    GuiEditorPanel.instance = new GuiEditorPanel(
      context,
      fetchLayout,
      fetchWidgetInfo,
      fetchSourceEdit,
      fetchVocabulary,
      fetchDependencies,
      fetchPreviews,
      fetchSaveValues,
      fetchLoc,
      source,
      roots,
      meta
    );
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    GuiEditorPanel.instance = undefined;
    if (this.debounce) clearTimeout(this.debounce);
    for (const d of this.disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    this.panel.dispose();
  }

  private async load(source: vscode.TextDocument): Promise<void> {
    const generation = ++this.generation;
    const file = source.uri.path.split("/").pop() ?? "gui";
    this.panel.title = `GUI Editor - ${file}`;
    this.post({ type: "loading", file });
    try {
      // The stored mode is read per push rather than held in a field: the mode
      // belongs to the document, and `show` can point this panel at a new one.
      const visibility = this.visibility();
      const ui = readUiState(this.state.get(UI_KEY));
      // The mod's own table wins over the save: typed values are deliberate.
      const save = await this.saveValues();
      const previewValues =
        save || this.readPreviewValues()
          ? { ...(save?.values ?? {}), ...(this.readPreviewValues() ?? {}) }
          : undefined;
      const result = await this.fetchLayout(source.uri, source.getText(), visibility, {
        loc: ui?.loc,
        previewValues,
      });
      if (this.disposed || generation !== this.generation) return;
      const textures: Record<string, string | null> = {};
      for (const texture of result.textures) {
        const png = this.textures.resolve(texture);
        textures[texture] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
      }
      if (this.disposed || generation !== this.generation) return;
      this.post({
        type: "layout",
        file,
        result,
        textures,
        visibility,
        ui,
        previewValues,
        save: save
          ? { ...save.source, file: save.file }
          : this.state.get<string>(SAVE_KEY)
            ? null
            : undefined,
        dirty: source.isDirty,
        lineHeightRatio: this.meta.guiTextMetrics
          ? this.meta.guiTextMetrics.lineHeight / this.meta.guiTextMetrics.baseFontsize
          : undefined,
        // No game root means the store holds mod files alone: vanilla-template
        // sizes collapse and the canvas looks broken for no visible reason.
        storeWarning: this.roots.gamePath
          ? undefined
          : "game install not found: layout is missing the game's templates. Run “Paradox: Run Setup & Health Check” or set px.gamePath",
      });
    } catch (err) {
      if (this.disposed) return;
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** The chosen save's values (server-cached by path + mtime), or null when none is chosen or it fails. */
  private async saveValues(): Promise<{
    values: Record<string, string>;
    source: { name: string; date: string };
    file: string;
  } | null> {
    const file = this.state.get<string>(SAVE_KEY);
    if (!file) return null;
    try {
      const result = await this.fetchSaveValues(file);
      if (result.error) {
        void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${result.error}`);
        return null;
      }
      return { values: result.values, source: { name: result.source.name, date: result.source.date }, file };
    } catch {
      return null;
    }
  }

  /** File picker over the game's save folder; a plain-text (non-ironman) save is required. */
  private async pickSave(): Promise<void> {
    const folder = gameDocsSubdir(this.meta, "save games");
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: folder ? vscode.Uri.file(folder) : undefined,
      openLabel: "Use for preview",
      title: "Choose a save (plain text; ironman saves are for challenge runs, not dev previews)",
      filters: { "Save games": ["v3", "ck3", "eu5", "sav"], "All files": ["*"] },
    });
    const file = picked?.[0]?.fsPath;
    if (!file) return;
    const result = await this.fetchSaveValues(file);
    if (result.error) {
      void vscode.window.showWarningMessage(`Paradox Modding Toolkit: ${result.error}`);
      return;
    }
    await this.state.update(SAVE_KEY, file);
    await this.load(await vscode.workspace.openTextDocument(this.sourceUri));
  }

  private previewValuesPath(): string | null {
    return this.roots.modPath
      ? path.join(this.roots.modPath, this.meta.configDirName, PREVIEW_VALUES_FILE)
      : null;
  }

  /** The mod's preview table, or undefined when there is none (or it is not a flat string map). */
  private readPreviewValues(): Record<string, string> | undefined {
    const file = this.previewValuesPath();
    if (!file) return undefined;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") out[key] = value;
      return out;
    } catch {
      return undefined;
    }
  }

  /** Rewrite the table with one entry set or dropped, then lay the document out with it. */
  private async updatePreviewValues(expression: string, value: string | undefined): Promise<void> {
    const file = this.previewValuesPath();
    if (!file) {
      void vscode.window.showWarningMessage(
        "Paradox Modding Toolkit: no mod folder for this .gui file, so there is nowhere to keep a preview value."
      );
      return;
    }
    const table = this.readPreviewValues() ?? {};
    const key = `[${expression}]`;
    if (value === undefined) delete table[key];
    else table[key] = value;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(table, null, 2) + "\n", "utf8");
    await this.load(await vscode.workspace.openTextDocument(this.sourceUri));
  }

  /** The conditional-visibility options stored for THIS document, if any. */
  private visibility(): GuiVisibilityOptions | undefined {
    const all = this.state.get<StoredVisibility>(VISIBILITY_KEY) ?? {};
    return all[this.sourceUri.toString()];
  }

  private async setVisibility(options: GuiVisibilityOptions | undefined): Promise<void> {
    const all = { ...(this.state.get<StoredVisibility>(VISIBILITY_KEY) ?? {}) };
    const key = this.sourceUri.toString();
    // The default is not a setting: storing it would grow the map by one entry
    // per file ever opened, for the mode those files already have.
    if (!options || (options.mode === "showAll" && !hasAssignment(options.checks))) delete all[key];
    else all[key] = options;
    await this.state.update(VISIBILITY_KEY, all);
  }

  /** Push the saved library the app draws from. There is no bundled content. */
  private postUserData(): void {
    const components = this.state.get<StoredComponents>(COMPONENTS_KEY) ?? {};
    const presets = this.state.get<StoredPresets>(PRESETS_KEY) ?? {};
    this.post({
      type: "userData",
      components: Object.entries(components).map(([name, text]) => ({
        name,
        widgets: countTopLevelBlocks(text),
        text,
      })),
      presets: Object.entries(presets).map(([name, properties]) => ({ name, properties })),
    });
  }

  /**
   * Every `.dds` under the roots' `gfx/` trees, as the engine would name it:
   * root-relative, forward slashes. Walked once per panel per root set, bounded
   * in depth and in count, and never re-walked for a keystroke in the filter
   * box — the filter runs over this array.
   *
   * The mod is walked first and wins a duplicate path, which is the order the
   * game itself resolves an asset in.
   */
  private textureCatalogue(): TextureEntry[] {
    if (this.textureIndex) return this.textureIndex;
    const seen = new Map<string, TextureEntry>();
    let budget = TEXTURE_WALK_MAX;
    for (const [root, source] of [
      [this.roots.modPath, "mod"],
      [this.roots.gamePath, "game"],
    ] as const) {
      if (!root) continue;
      // Games with load-stage roots keep their content under one of them, so
      // the walk starts there rather than at the mod root.
      const gfx = path.join(root, ...stagePrefix(this.meta), "gfx");
      const walk = (dir: string, rel: string, depth: number): void => {
        if (budget <= 0 || depth > TEXTURE_WALK_DEPTH) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (budget <= 0) return;
          budget--;
          const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), next, depth + 1);
          } else if (entry.name.toLowerCase().endsWith(".dds")) {
            const key = `gfx/${next}`;
            if (!seen.has(key)) seen.set(key, { path: key, source });
          }
        }
      };
      walk(gfx, "", 0);
    }
    this.textureIndex = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
    return this.textureIndex;
  }

  /**
   * One op against the document's current text. The server decides everything:
   * which bytes change, whether the gesture is refused and with what words. The
   * version is captured with the text the offsets were computed from, so a
   * stale batch can be recognised instead of applied.
   */
  private async sourceEdit(
    request: { op: GuiSourceOp } | { ops: GuiSourceOp[] }
  ): Promise<{ doc: vscode.TextDocument; version: number; result: GuiSourceEditResult }> {
    const doc = await vscode.workspace.openTextDocument(this.sourceUri);
    const version = doc.version;
    try {
      const result = await this.fetchSourceEdit(doc.uri, doc.getText(), request);
      return { doc, version, result: result ?? { refused: "the server had no answer for that edit." } };
    } catch (err) {
      return {
        doc,
        version,
        result: { refused: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /**
   * The server's offsets applied as ONE `WorkspaceEdit`: one undo step for one
   * gesture, in the document's own history, which is why this editor has no
   * undo stack of its own. Returns the reason it did not happen, or undefined.
   */
  private async applyEdits(
    doc: vscode.TextDocument,
    version: number,
    edits: readonly { start: number; end: number; newText: string }[]
  ): Promise<string | undefined> {
    if (doc.version !== version) {
      return "the document changed while that edit was being computed, so its offsets no longer point where they did.";
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      const range = new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end));
      workspaceEdit.replace(doc.uri, range, edit.newText);
    }
    return (await vscode.workspace.applyEdit(workspaceEdit))
      ? undefined
      : "the editor did not apply that edit.";
  }

  private post(message: HostToApp): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }

  /**
   * One gesture: ask the server, apply the whole edit set as ONE
   * `WorkspaceEdit`, answer the verdict, push the fresh layout. A batch takes
   * exactly this path, which is what makes a multi-widget gesture one undo step
   * rather than one per member.
   */
  private async commit(id: number, request: { op: GuiSourceOp } | { ops: GuiSourceOp[] }): Promise<void> {
    const attempt = await this.sourceEdit(request);
    const { refused, warning, edits, results } = attempt.result;
    const ops = results?.map((r) => ({ refused: r.refused, warning: r.warning }));
    if (refused || !edits || edits.length === 0) {
      // No edits and no refusal is the writer saying the bytes it would write
      // are already there. Nothing happened, so the app hears it as a refusal
      // rather than waiting for a layout that will not come.
      this.post({
        type: "editVerdict",
        id,
        refused: refused ?? "that edit changes nothing: the file already says exactly that.",
        warning,
        ops,
      });
      return;
    }
    const failure = await this.applyEdits(attempt.doc, attempt.version, edits);
    this.post({
      type: "editVerdict",
      id,
      refused: failure,
      warning: failure ? undefined : warning,
      ops: failure ? undefined : ops,
    });
    if (!failure) {
      // Our own single write, not a burst of typing: the debounce exists to
      // coalesce keystrokes and there is nothing here to coalesce. Skipping it
      // is what keeps a released drag from hanging on its preview.
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = undefined;
      await this.load(await vscode.workspace.openTextDocument(this.sourceUri));
    }
  }

  private async onMessage(message: AppToHost): Promise<void> {
    switch (message.type) {
      case "ready":
      case "requestLayout": {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        await this.load(doc);
        return;
      }
      case "requestWidgetInfo": {
        const line = message.line;
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        try {
          const info = await this.fetchWidgetInfo(doc.uri, doc.getText(), line, message.placement === true);
          this.post({ type: "widgetInfo", line, info });
        } catch {
          // A failed inspector read is not worth an error banner over the
          // canvas: the app shows the selection with no rows.
          this.post({ type: "widgetInfo", line, info: null });
        }
        return;
      }
      case "checkEdit":
      case "checkReorder":
      case "checkOps": {
        // A gesture-start check. Whatever the server returns, the edits are
        // thrown away: the point of asking early is that the answer arrives
        // before anything moves, and a check that wrote would be a bug the
        // user could only discover through undo.
        const { result } = await this.sourceEdit(requestOf(message));
        this.post({
          type: "editVerdict",
          id: message.id,
          refused: result.refused,
          warning: result.warning,
          ops: result.results?.map((r) => ({ refused: r.refused, warning: r.warning })),
        });
        return;
      }
      case "applyEdit":
      case "reorder":
      case "applyOps": {
        await this.commit(message.id, requestOf(message));
        return;
      }
      case "copyBlocks": {
        // One `blockText` op per widget, as a batch so every block is read off
        // the SAME text, then joined in the order the app asked for. The app
        // never sees the text: the clipboard is the host's, like the document.
        const { result } = await this.sourceEdit({
          ops: message.lines.map((line) => ({ kind: "blockText", line })),
        });
        const blocks = (result.results ?? []).map((r) => r.blockText).filter((b): b is string => !!b);
        if (blocks.length === 0) {
          const reason = result.refused ?? result.results?.find((r) => r.refused)?.refused;
          this.post({
            type: "editVerdict",
            id: message.id,
            refused: reason ?? "there was nothing to copy on those lines.",
          });
          return;
        }
        await vscode.env.clipboard.writeText(blocks.join(""));
        const skipped = result.results?.filter((r) => r.refused) ?? [];
        this.post({
          type: "editVerdict",
          id: message.id,
          warning: skipped.length > 0 ? skipped.map((r) => r.refused).join(" ") : undefined,
        });
        return;
      }
      case "pasteInto": {
        const fragment = await vscode.env.clipboard.readText();
        if (fragment.trim().length === 0) {
          this.post({
            type: "editVerdict",
            id: message.id,
            refused: "the clipboard is empty, so there is nothing to paste.",
          });
          return;
        }
        await this.commit(message.id, {
          op: { kind: "insertRaw", line: message.line, fragment, index: message.index },
        });
        return;
      }
      case "requestVocabulary": {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        try {
          const result = await this.fetchVocabulary(doc.uri, doc.getText());
          this.post({
            type: "vocabulary",
            entries: result.entries,
            total: result.total,
            // Forwarded UNCHANGED per messages.ts: the add-property row is the
            // sole consumer, and a host that dropped these would leave it
            // offering nothing (which is exactly what the first version did).
            properties: result.properties ?? {},
            commonProperties: result.commonProperties ?? [],
          });
        } catch {
          // A palette with no entries says so on its own; an error banner over
          // the canvas would be about the wrong thing.
          this.post({ type: "vocabulary", entries: [], total: 0, properties: {}, commonProperties: [] });
        }
        return;
      }
      case "setVisibility": {
        await this.setVisibility({ mode: message.mode, checks: message.checks });
        // The layout IS the answer: no verdict, because nothing was written to
        // the document and there is nothing for the guards to refuse.
        await this.load(await vscode.workspace.openTextDocument(this.sourceUri));
        return;
      }
      case "requestDependencies": {
        const line = message.line;
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        try {
          const result = await this.fetchDependencies(doc.uri, doc.getText(), line);
          this.post({ type: "dependencies", line, result });
        } catch {
          // Same rule as a failed inspector read: the panel says it has no
          // answer rather than putting a banner over the canvas.
          this.post({ type: "dependencies", line, result: null });
        }
        return;
      }
      case "requestTextureList": {
        const catalogue = this.textureCatalogue();
        const needle = message.query.trim().toLowerCase();
        const matches =
          needle.length === 0
            ? catalogue
            : catalogue.filter((entry) => entry.path.toLowerCase().includes(needle));
        this.post({
          type: "textureList",
          entries: matches.slice(0, TEXTURE_ANSWER_MAX),
          total: matches.length,
          roots: this.roots.modPath !== null || this.roots.gamePath !== null,
        });
        return;
      }
      case "requestPreviews": {
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        const entries = message.entries.slice(0, GUI_PREVIEW_MAX);
        let previews: GuiPreviewResult["previews"];
        try {
          previews = (await this.fetchPreviews(doc.uri, doc.getText(), entries)).previews;
        } catch (err) {
          // A tile with no preview says so in its tooltip; a banner over the
          // canvas would be about the wrong thing.
          const reason = err instanceof Error ? err.message : String(err);
          previews = entries.map((e) => ({ name: e.name, node: null, textures: [], reason }));
        }
        if (this.disposed) return;
        const textures: Record<string, string | null> = {};
        for (const preview of previews) {
          for (const rel of preview.textures) {
            if (rel in textures) continue;
            // Thumbnail-capped, through the same cache the canvas fills use.
            const png = this.textures.resolve(rel, THUMBNAIL_MAX_DIM);
            textures[rel] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
          }
        }
        this.post({ type: "previews", previews, textures });
        return;
      }
      case "requestThumbnails": {
        const urls: Record<string, string | null> = {};
        for (const rel of message.paths.slice(0, THUMBNAIL_BATCH_MAX)) {
          // Capped decode, through the same cache and the same eviction the
          // canvas fills use: a browser row draws 28 pixels and must never pay
          // for a 4096x4096 one.
          const png = this.textures.resolve(rel, THUMBNAIL_MAX_DIM);
          urls[rel] = png ? this.panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : null;
        }
        this.post({ type: "thumbnails", urls });
        return;
      }
      case "requestUserData": {
        this.postUserData();
        return;
      }
      case "saveComponent": {
        // The same read `copyBlocks` does, for the same reason: one batch, so
        // every block comes off the same text and they concatenate in order.
        const { result } = await this.sourceEdit({
          ops: message.lines.map((line) => ({ kind: "blockText", line })),
        });
        const blocks = (result.results ?? []).map((r) => r.blockText).filter((b): b is string => !!b);
        if (blocks.length === 0) {
          const reason = result.refused ?? result.results?.find((r) => r.refused)?.refused;
          this.post({
            type: "editVerdict",
            id: message.id,
            refused: reason ?? "there was nothing to save on those lines.",
          });
          return;
        }
        const stored = { ...(this.state.get<StoredComponents>(COMPONENTS_KEY) ?? {}) };
        stored[message.name] = blocks.join("");
        await this.state.update(COMPONENTS_KEY, stored);
        const skipped = result.results?.filter((r) => r.refused) ?? [];
        this.post({
          type: "editVerdict",
          id: message.id,
          warning: skipped.length > 0 ? skipped.map((r) => r.refused).join(" ") : undefined,
        });
        this.postUserData();
        return;
      }
      case "insertComponent": {
        const stored = this.state.get<StoredComponents>(COMPONENTS_KEY) ?? {};
        const fragment = stored[message.name];
        if (!fragment || fragment.trim().length === 0) {
          this.post({
            type: "editVerdict",
            id: message.id,
            refused: `there is no saved component called "${message.name}" any more.`,
          });
          return;
        }
        await this.commit(message.id, {
          op: { kind: "insertRaw", line: message.line, fragment, index: message.index },
        });
        return;
      }
      case "requestLoc": {
        const value = await this.fetchLoc(message.key);
        this.post({ type: "loc", key: message.key, value: value ?? null });
        return;
      }
      case "pickReference": {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Use as reference",
          filters: { Images: ["png", "jpg", "jpeg", "webp"] },
        });
        const uri = picked?.[0];
        if (!uri) {
          this.post({ type: "reference", name: "", url: null });
          return;
        }
        // Any folder on disk may hold the screenshot, and the webview may only
        // load from its resource roots, so the bytes travel as a data URI.
        const bytes = await vscode.workspace.fs.readFile(uri);
        const ext = uri.fsPath.toLowerCase().split(".").pop() ?? "png";
        const mime =
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        this.post({
          type: "reference",
          name: path.basename(uri.fsPath),
          url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
        });
        return;
      }
      case "setUiState": {
        // Stored, not echoed: the app has already applied it, and the next
        // panel picks it up from the `ui` field of its first layout.
        const stored = readUiState(this.state.get(UI_KEY));
        await this.state.update(UI_KEY, {
          valueMode: message.valueMode,
          panels: message.panels ?? stored?.panels,
          snap: message.snap ?? stored?.snap,
          grid: message.grid ?? stored?.grid,
          loc: message.loc ?? stored?.loc,
          sections: message.sections ?? stored?.sections,
        });
        return;
      }
      case "editLoc": {
        // The toolkit's own loc flow: it asks for the value and writes it where
        // the key's siblings live. The server re-indexes the changed file
        // through the mod watcher, so the layout is re-requested after the
        // debounce the rest of the extension gives a file change.
        await vscode.commands.executeCommand("px.editLocalization", message.key);
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          void vscode.workspace.openTextDocument(this.sourceUri).then((doc) => this.load(doc));
        }, LAYOUT_DEBOUNCE_MS);
        return;
      }
      case "pickSave":
        await this.pickSave();
        return;
      case "clearSave":
        await this.state.update(SAVE_KEY, undefined);
        await this.load(await vscode.workspace.openTextDocument(this.sourceUri));
        return;
      case "setPreviewValue": {
        await this.updatePreviewValues(message.expression, message.value);
        return;
      }
      case "clearPreviewValue": {
        await this.updatePreviewValues(message.expression, undefined);
        return;
      }
      case "save": {
        // The commits landed in the in-memory document; this is the one step
        // that writes it to disk. The save event triggers a layout push whose
        // `dirty: false` resets the button.
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        const ok = doc.isDirty ? await doc.save() : true;
        this.post({ type: "saved", ok });
        return;
      }
      case "undo":
      case "redo": {
        // The document's own history: the editor command acts on the ACTIVE
        // editor, so the source is shown with focus first (the one reveal that
        // may take it), and the change comes back down as a normal layout push.
        const doc = await vscode.workspace.openTextDocument(this.sourceUri);
        const visible = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === doc.uri.toString()
        );
        await vscode.window.showTextDocument(doc, {
          viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
          preserveFocus: false,
          preview: false,
        });
        await vscode.commands.executeCommand(message.type);
        return;
      }
      case "savePreset": {
        const stored = { ...(this.state.get<StoredPresets>(PRESETS_KEY) ?? {}) };
        stored[message.name] = message.properties;
        await this.state.update(PRESETS_KEY, stored);
        this.postUserData();
        return;
      }
      case "forgetSaved": {
        const key = message.kind === "component" ? COMPONENTS_KEY : PRESETS_KEY;
        const stored = { ...(this.state.get<Record<string, unknown>>(key) ?? {}) };
        delete stored[message.name];
        await this.state.update(key, stored);
        this.postUserData();
        return;
      }
      case "revealAt": {
        // A dependency row points OUTSIDE the edited document, so the file is
        // opened rather than assumed; a path that no longer resolves is said
        // plainly instead of revealing the wrong line in the wrong file.
        try {
          const target = await vscode.workspace.openTextDocument(vscode.Uri.file(message.file));
          await this.revealIn(target, message.line);
        } catch {
          void vscode.window.showWarningMessage(
            `Paradox Modding Toolkit: could not open ${message.file}. The index may be out of date.`
          );
        }
        return;
      }
      case "reveal": {
        await this.revealIn(await vscode.workspace.openTextDocument(this.sourceUri), message.line);
        return;
      }
    }
  }

  /**
   * Show a line without stealing focus and without hijacking the column the
   * editor panel is in: the DOCUMENT's own column, never the ACTIVE one, which
   * is the panel's while the canvas has focus. Opening it there would shove the
   * editor the reveal was meant to point at.
   */
  private async revealIn(doc: vscode.TextDocument, at: number): Promise<void> {
    const line = Math.max(0, Math.min(at, doc.lineCount - 1));
    const range = doc.lineAt(line).range;
    const visible = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === doc.uri.toString()
    );
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
      preserveFocus: true,
      preview: false,
    });
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

/** An `evaluate` mode with no assignment is still not the default: it hides nothing yet. */
function hasAssignment(checks: Record<string, boolean> | undefined): boolean {
  return checks !== undefined && Object.values(checks).some((v) => v === false);
}

/**
 * The server request one edit message means. A check and its commit send the
 * SAME thing: the only difference is what the host does with the answer, which
 * is why the two are separate message kinds rather than one with a flag.
 */
function requestOf(
  message: Extract<
    AppToHost,
    { type: "checkEdit" | "applyEdit" | "checkReorder" | "reorder" | "checkOps" | "applyOps" }
  >
): { op: GuiSourceOp } | { ops: GuiSourceOp[] } {
  switch (message.type) {
    case "checkEdit":
    case "applyEdit":
      return {
        op: {
          kind: "setProperties",
          line: message.line,
          properties: message.properties.map((p) => ({ key: p.key, value: p.value })),
        },
      };
    case "checkReorder":
    case "reorder":
      return { op: { kind: "reorder", line: message.line, from: message.from, to: message.to } };
    default:
      return { ops: message.ops };
  }
}

/**
 * The game's standard UI font, embedded so canvas text looks like the game's.
 * Null when the game has no verified font file (meta.uiFont absent): the
 * webview then falls back to a system serif.
 */
function loadGameFont(gamePath: string | null, uiFont: string | undefined): string | null {
  if (!gamePath || !uiFont) return null;
  try {
    const file = path.join(gamePath, ...uiFont.split("/"));
    return `data:font/otf;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The active game's load-stage prefix for a content path, if it has one. */
function stagePrefix(meta: GameMeta): string[] {
  const stage = meta.stageRoots?.[0];
  return stage ? [stage] : [];
}

function buildHtml(webview: vscode.Webview, script: vscode.Uri, fontDataUri: string | null): string {
  const nonce = makeNonce();
  return guiEditorHtml({
    scriptSrc: webview.asWebviewUri(script).toString(),
    nonce,
    csp: [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `font-src data:`,
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join("; "),
    fontDataUri,
  });
}
