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
 * G3.1 is the render stage, so the contract carries only what rendering needs.
 * Later stages add message kinds here first and implement them on both sides.
 */
import type { GuiLayoutResult } from "@px-lsp/protocol/protocol";

/** Messages the editor app sends UP to its host. */
export type AppToHost =
  /** The app finished booting and can receive pushes (the host answers with a layout). */
  | { type: "ready" }
  /** Re-run layout over the document's current text. */
  | { type: "requestLayout" };

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
  /** Layout failed; the message is shown as-is. */
  | { type: "error"; message: string };

/**
 * Debounce between a document change and the layout request it triggers,
 * matching the analysis debounce culture of the other live panels.
 */
export const LAYOUT_DEBOUNCE_MS = 300;
