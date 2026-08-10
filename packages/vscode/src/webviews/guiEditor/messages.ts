/**
 * The GUI editor's webview <-> host contract.
 *
 * Written as if the host were UNKNOWN. `app/` is the whole editor and it talks
 * to nothing else: no `vscode` API, no `acquireVsCodeApi` outside the one
 * transport shim, no file system, no layout maths of its own. Everything that
 * needs the outside world is a message in this file. `panel.ts` implements the
 * contract over VS Code's `postMessage`; the Studio's G6 adapter implements the
 * same messages over WebView2 without touching a line of `app/`.
 *
 * Two rules hold the boundary up:
 * - HOST OWNS THE TEXT. The app never edits source and never computes layout.
 *   It asks; the host asks the server (`paradox/guiLayout`, `paradox/guiTree`,
 *   `paradox/guiSourceEdit`), applies the returned edits to the real document,
 *   and pushes a fresh layout back down. Undo is the host document's own.
 * - TEXTURES ARE OPAQUE. The app receives URL strings it can hand to an
 *   `Image`, and knows nothing about DDS, decoding or caches.
 *
 * G3.1 added what rendering needs, G3.2 what selecting and inspecting need,
 * G3.3 what writing needs, G4 what reordering needs, G5 what a multi-selection,
 * a palette and a clipboard need. Later stages add message kinds here first and
 * implement them on both sides.
 *
 * From G5 the app names some gestures as SERVER OPS (`GuiSourceOp`) rather than
 * as a message per gesture: insert, paste, delete, duplicate and wrap are the
 * server's own vocabulary, and one relay message for all of them keeps the host
 * thin. The two rules are untouched by that: the app still computes no edits
 * and no layout, and the host still owns the text.
 *
 * G5 stage 2 is the devtools halo, the browsers and the saved user data. It
 * adds a THIRD thing a host owns, alongside the text and the textures: PER-USER
 * STATE. A visibility mode, a saved component, a property preset and the
 * inspector's value display mode are none of them in the document and none of
 * them the server's, so the app holds no copy it could disagree with — it asks,
 * the host answers, and the host is where the state survives the panel being
 * closed.
 */
import type {
  GuiDependenciesResult,
  GuiLayoutResult,
  GuiSourceOp,
  GuiVisibilityMode,
  GuiVisibilityOptions,
  GuiVocabularyEntry,
  GuiWidgetInfo,
} from "@px-lsp/protocol/protocol";

/** One property a write sets, with its value in `.gui` syntax (`{ 10 10 }`, `0.5`, `"name"`). */
export interface EditProperty {
  key: string;
  value: string;
}

/** One `.dds` the texture browser offers, as the engine would read it. */
export interface TextureEntry {
  /**
   * Root-relative, forward slashes, exactly the string a `texture = "…"` takes
   * (`gfx/interface/icons/foo.dds`). The host walks the roots; the app never
   * builds one of these out of a file system path.
   */
  path: string;
  /** Which root it came from, so an override can be told from the original. */
  source: "mod" | "game";
}

/**
 * A selection saved for reuse, host-side. The app never sees the block text: it
 * is the document's bytes, which are the host's, exactly like the clipboard.
 */
export interface SavedComponent {
  name: string;
  /** How many top-level widgets the saved text holds, for the row's label. */
  widgets: number;
}

/** A named bundle of property writes, applied as ONE batched `setProperties`. */
export interface SavedPreset {
  name: string;
  properties: EditProperty[];
}

/**
 * How the inspector shows a property VALUE. `abbreviated` clips a long value to
 * an ellipsis with the whole of it on hover; `hidden` drops the value column
 * and lists names only, which is how a widget with forty inherited properties
 * becomes readable.
 */
export type GuiValueMode = "full" | "abbreviated" | "hidden";

/**
 * The editor's own view preferences: not in the document, not the server's, and
 * not per document either, so the host stores them exactly as it stores the
 * saved components and presets.
 */
export interface GuiEditorUiState {
  valueMode: GuiValueMode;
}

/** Messages the editor app sends UP to its host. */
export type AppToHost =
  /** The app finished booting and can receive pushes (the host answers with a layout). */
  | { type: "ready" }
  /** Re-run layout over the document's current text. */
  | { type: "requestLayout" }
  /**
   * The selection moved to the widget declared on `line` (the layout node's own
   * 0-based line). The host answers with `widgetInfo` for the same line.
   *
   * `placement` asks for the "why is it here" trace as well
   * (`GuiWidgetInfoParams.placement`), which costs a full layout of the
   * document server side. The app sets it ONLY while the panel that reads it is
   * open, so an inspector-only selection never pays for it, and it is a flag on
   * this message rather than a second request because two answers echoing the
   * same line would race and the plainer one could land last.
   */
  | { type: "requestWidgetInfo"; line: number; placement?: boolean }
  /** Show the widget's declaration in the host's text editor. */
  | { type: "reveal"; line: number }
  /**
   * Ask the guards what `applyEdit` would answer for these properties and
   * WRITE NOTHING. This is the gesture-start check: a drag on a widget whose
   * parent owns its slot is refused before it moves, which is why it is a
   * message of its own rather than a flag on `applyEdit`: a host that misread
   * a flag would edit the document on a mouse-down.
   *
   * The properties carry the widget's CURRENT values, so the request is a
   * no-op write and the verdict is exactly the commit's. The keys are every
   * key the gesture could write, which can be more than the commit sends.
   */
  | { type: "checkEdit"; id: number; line: number; properties: EditProperty[] }
  /**
   * Write these properties on the widget declared on `line`, as ONE edit: one
   * op, one document change, one native undo step. The host answers with a
   * verdict for `id` either way, and pushes a fresh layout when the write
   * changed the document.
   */
  | { type: "applyEdit"; id: number; line: number; properties: EditProperty[] }
  /**
   * The gesture-start check for a reorder drag, the counterpart of `checkEdit`:
   * ask the guards and WRITE NOTHING. The move it asks about is the moved
   * child's NEIGHBOURING slot, the smallest legal one, because the drop is not
   * known yet; that answers the questions the user needs before dragging (a
   * type definition other files instantiate, a body with nothing to permute)
   * and the commit's own answer is still shown when it differs.
   */
  | { type: "checkReorder"; id: number; line: number; from: number; to: number }
  /**
   * Move one source child of the widget declared on `line`, as ONE edit: the
   * child at index `from` ends up at index `to`. Same contract as `applyEdit`:
   * a verdict for `id` either way, a fresh layout when the document changed.
   *
   * The indices count the container's children THIS DOCUMENT DECLARES, in
   * source order, which is the order the layout reports them in and the order
   * the layers panel lists. Children spliced in from a template or a type are
   * not counted: they have no bytes at the use site, so no index can name them.
   *
   * In an hbox/vbox/flowcontainer this IS the layout order, and the app says so
   * rather than calling it a z-order: source order is the only order those
   * containers have.
   */
  | { type: "reorder"; id: number; line: number; from: number; to: number }
  /**
   * The gesture-start check for a BATCH: ask the guards about every op and
   * WRITE NOTHING. Same contract as `checkEdit`, one verdict per op in
   * `editVerdict.ops`, so a multi-selection drag knows before it moves which
   * of its members will not.
   */
  | { type: "checkOps"; id: number; ops: GuiSourceOp[] }
  /**
   * Commit these ops as ONE document change and ONE undo step: the host sends
   * them as the server's `ops` batch, applies the single edit set it gets back,
   * and pushes a fresh layout. `editVerdict.ops` carries each op's own verdict,
   * because a refused member must be named rather than folded into a summary.
   *
   * This is the general write path (insert, insertRaw, delete, duplicate, wrap,
   * and a setProperties over several widgets). `applyEdit` stays the
   * single-widget property spelling: it is the hot path, and the inspector and
   * a one-widget drag never need op vocabulary to use it.
   */
  | { type: "applyOps"; id: number; ops: GuiSourceOp[] }
  /**
   * Put these widgets' verbatim blocks on the system clipboard, in the order
   * given. The app never sees the text: a clipboard is the host's, like the
   * document is, and a paste has to survive being made in another editor.
   * Answer `editVerdict` for `id`; a refusal is shown verbatim.
   */
  | { type: "copyBlocks"; id: number; lines: number[] }
  /**
   * Paste whatever `.gui` text the clipboard holds into the widget on `line`,
   * at `index` among its source children (absent appends). The host reads the
   * clipboard and sends it as one `insertRaw` op; same verdict-then-layout
   * contract as `applyEdit`. An empty or unusable clipboard is a refusal.
   */
  | { type: "pasteInto"; id: number; line: number; index?: number }
  /**
   * Ask for the widget names a palette may offer for THIS document
   * (`paradox/guiVocabulary`). Sent when the palette opens and after a layout
   * while it is open, because a document's own templates and types change as it
   * is edited. The host answers `vocabulary`.
   */
  | { type: "requestVocabulary" }
  /**
   * Lay the document out in this conditional-visibility mode from now on
   * (`GuiLayoutParams.visibility`), and REMEMBER it for this document: a widget
   * the user hid must still be hidden when they come back to the file, and a
   * mode that reset on reopen would make a missing widget a mystery.
   *
   * The host answers by pushing a fresh `layout`, whose `visibility` field
   * echoes what it stored. There is no separate verdict: the layout IS the
   * answer, and a mode change writes nothing to the document.
   */
  | { type: "setVisibility"; mode: GuiVisibilityMode; checks?: Record<string, boolean> }
  /**
   * What the document (or one widget's source subtree) reaches on the script
   * side: `paradox/guiDependencies` for `line`, or for the whole file when it
   * is absent. The host answers `dependencies`, ECHOING the line for the same
   * reason `widgetInfo` does.
   */
  | { type: "requestDependencies"; line?: number }
  /**
   * Show `file`'s `line` in the host's text editor, the way `reveal` shows the
   * edited document's. A dependency row points at a scripted_gui, an event or a
   * loc key, and none of those live in the .gui file being edited, which is why
   * this is a second message rather than a field on `reveal`: a host that
   * ignored an unknown file would silently reveal the wrong line.
   */
  | { type: "revealAt"; file: string; line: number }
  /**
   * The `.dds` files under the mod's and the game's `gfx/` trees whose path
   * contains `query`. The host walks the roots (bounded, lazily, cached) and
   * answers `textureList`; the app never touches a file system path and never
   * builds a texture value out of one.
   */
  | { type: "requestTextureList"; query: string }
  /**
   * Thumbnails for the rows currently on screen, through the host's existing
   * texture pipeline and its cache. Sent for a bounded page, never for a whole
   * listing: decoding a game's entire gfx tree to draw a scrollable list is the
   * cost this message exists to avoid. The host answers `thumbnails`.
   */
  | { type: "requestThumbnails"; paths: string[] }
  /** The user's saved components and presets. The host answers `userData`. */
  | { type: "requestUserData" }
  /**
   * Save the widgets on those lines as a named component: the host reads their
   * verbatim blocks (a `blockText` op each, one batch, like `copyBlocks`) and
   * keeps the TEXT, not a rendering of it. Answer `editVerdict` for `id`, then
   * push `userData`. An existing name is overwritten, which is what "save as"
   * means everywhere else.
   */
  | { type: "saveComponent"; id: number; name: string; lines: number[] }
  /**
   * Insert a saved component into the widget on `line`, at `index` among its
   * source children (absent appends). The host sends its stored text as one
   * `insertRaw` op: same verdict-then-layout contract as `pasteInto`, and a
   * component the host no longer has is a refusal, not silence.
   */
  | { type: "insertComponent"; id: number; name: string; line: number; index?: number }
  /**
   * Remember the inspector's value display mode. There is no answer: the app
   * applied it the moment the user picked it, and the host's copy is what the
   * NEXT panel boots with (it rides down on `layout.ui`). A host that stored it
   * and echoed it back mid-session would fight a user who changed it twice
   * before the first write landed.
   */
  | { type: "setUiState"; valueMode: GuiValueMode }
  /** Remember these properties under a name. The host answers by pushing `userData`. */
  | { type: "savePreset"; name: string; properties: EditProperty[] }
  /** Forget a saved component or preset. The host answers by pushing `userData`. */
  | { type: "forgetSaved"; kind: "component" | "preset"; name: string };

/** Messages the host pushes DOWN to the editor app. */
export type HostToApp =
  /** A layout is being computed; the previous scene stays on screen. */
  | { type: "loading"; file: string }
  | {
      type: "layout";
      /** Display name of the edited document. */
      file: string;
      result: GuiLayoutResult;
      /**
       * Every texture path in `result.textures`, mapped to a URL the app can
       * load, or null when it could not be resolved or decoded.
       */
      textures: Record<string, string | null>;
      /**
       * The conditional-visibility options this layout was computed with, as
       * the host has them stored for this document. Absent means the default
       * (`showAll`). It rides on the layout rather than being pushed separately
       * because it is a property OF this layout: the app shows the mode
       * indicator next to a canvas that was actually laid out that way.
       */
      visibility?: GuiVisibilityOptions;
      /**
       * The view preferences the host has stored, which the app adopts ONCE,
       * from the first layout it receives. They ride here rather than on a
       * request of their own so the very first inspector render already honours
       * them, and they are adopted once so a layout in flight cannot undo a
       * choice the user has just made.
       */
      ui?: GuiEditorUiState;
      /**
       * The host's own words for a template store built without the game's
       * files (no game install configured/found): sizes and positions that
       * resolve through vanilla templates collapse, which looks like a broken
       * canvas. Shown verbatim in the meta line; absent means the store is
       * complete and the app shows the file count alone.
       */
      storeWarning?: string;
    }
  /**
   * Answer to `requestWidgetInfo`. `line` is echoed so the app can drop an
   * answer the selection has already moved past; `info` is null when that line
   * has no widget source of its own.
   */
  | { type: "widgetInfo"; line: number; info: GuiWidgetInfo | null }
  /**
   * The answer to the `checkEdit`, `applyEdit`, `checkOps`, `applyOps`,
   * `copyBlocks` or `pasteInto` numbered `id`.
   *
   * `refused` means nothing was written and the reason is the SERVER'S OWN
   * string, shown verbatim: it names what the engine would have done with the
   * write, which is knowledge the app does not have and must not paraphrase.
   * `warning` rides along with a write that went ahead and is only half
   * honoured. Neither means it was written as asked.
   *
   * `ops` answers a BATCH, one entry per requested op in the same order. A
   * per-op refusal means that member alone was skipped while the rest applied,
   * so top-level `refused` on a batch means the WHOLE gesture failed. Present
   * only for `checkOps` / `applyOps`.
   */
  | {
      type: "editVerdict";
      id: number;
      refused?: string;
      warning?: string;
      ops?: { refused?: string; warning?: string }[];
    }
  /**
   * Answer to `requestVocabulary`: what the palette and the inspector may
   * offer. `total` is the real count behind a capped list, so the panel can say
   * what it hid.
   */
  | {
      type: "vocabulary";
      entries: GuiVocabularyEntry[];
      total: number;
      /**
       * The property half of the same answer, forwarded UNCHANGED: widget type
       * -> the harvested property names, and the tree-wide ranking behind them.
       * REQUIRED, unlike the wire type's optional fields, precisely because the
       * first VS Code host dropped them while typechecking cleanly and shipped
       * an add-property row that offered nothing. A host with no data sends
       * `{}` / `[]` and says so with its own eyes open.
       */
      properties: Record<string, string[]>;
      commonProperties: string[];
    }
  /**
   * Answer to `requestDependencies`. `line` is echoed (absent for a
   * whole-document answer) so the app can drop an answer the selection has
   * moved past; `result` is null when the host could not ask.
   */
  | { type: "dependencies"; line?: number; result: GuiDependenciesResult | null }
  /**
   * Answer to `requestTextureList`: the matches, capped, with `total` giving
   * the real count so the panel can say what it hid. `roots` is false when the
   * host has no mod or game folder configured, which is a different thing from
   * a query that matched nothing and is said differently.
   */
  | { type: "textureList"; entries: TextureEntry[]; total: number; roots: boolean }
  /** Answer to `requestThumbnails`: each asked path mapped to a URL, or null. */
  | { type: "thumbnails"; urls: Record<string, string | null> }
  /**
   * The user's saved components and presets, pushed after every change to them
   * and in answer to `requestUserData`. There is no built-in content: a host
   * with nothing stored answers with two empty lists, and the panel says so.
   */
  | { type: "userData"; components: SavedComponent[]; presets: SavedPreset[] }
  /** Layout failed; the message is shown as-is. */
  | { type: "error"; message: string };

/**
 * Debounce between a document change and the layout request it triggers,
 * matching the analysis debounce culture of the other live panels.
 */
export const LAYOUT_DEBOUNCE_MS = 300;
