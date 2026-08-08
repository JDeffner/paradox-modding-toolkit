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
 * G3.3 what writing needs, G4 what reordering needs. Later stages add message
 * kinds here first and implement them on both sides.
 */
import type { GuiLayoutResult, GuiWidgetInfo } from "@px-lsp/protocol/protocol";

/** One property a write sets, with its value in `.gui` syntax (`{ 10 10 }`, `0.5`, `"name"`). */
export interface EditProperty {
  key: string;
  value: string;
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
   */
  | { type: "requestWidgetInfo"; line: number }
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
  | { type: "reorder"; id: number; line: number; from: number; to: number };

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
    }
  /**
   * Answer to `requestWidgetInfo`. `line` is echoed so the app can drop an
   * answer the selection has already moved past; `info` is null when that line
   * has no widget source of its own.
   */
  | { type: "widgetInfo"; line: number; info: GuiWidgetInfo | null }
  /**
   * The answer to the `checkEdit` or `applyEdit` numbered `id`.
   *
   * `refused` means nothing was written and the reason is the SERVER'S OWN
   * string, shown verbatim: it names what the engine would have done with the
   * write, which is knowledge the app does not have and must not paraphrase.
   * `warning` rides along with a write that went ahead and is only half
   * honoured. Neither means it was written as asked.
   */
  | { type: "editVerdict"; id: number; refused?: string; warning?: string }
  /** Layout failed; the message is shown as-is. */
  | { type: "error"; message: string };

/**
 * Debounce between a document change and the layout request it triggers,
 * matching the analysis debounce culture of the other live panels.
 */
export const LAYOUT_DEBOUNCE_MS = 300;
