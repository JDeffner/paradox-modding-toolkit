/**
 * The GUI editor's interaction harness: the REAL app bundle, booted in jsdom
 * against a stubbed host.
 *
 * This is the headless stand-in for a mouse, the `--gui-edit-smoke` equivalent
 * of the Studio's checklist. Three things make it honest rather than a mock of
 * itself:
 *
 * - the bundle is built from `app/main.ts` by esbuild, exactly as the compile
 *   chain builds the shipped one, so nothing under `app/` is stubbed;
 * - the page is `html.ts`, the same markup the panel serves, so a rename that
 *   split the markup from the ids the app queries fails here;
 * - the host is a message recorder that speaks `messages.ts` and nothing else,
 *   so anything the app tries to do to the outside world shows up as a message
 *   the test can assert on.
 *
 * jsdom has no canvas, no layout engine and no pointer capture, so a handful of
 * things are stubbed and they are all browser plumbing, never app behavior: a
 * no-op 2d context, a fixed viewport size, `scrollIntoView`, and the pointer
 * capture calls a drag makes (the app guards those, so their absence changes
 * nothing about what it commits).
 */
import * as fs from "fs";
import * as path from "path";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
import { guiEditorHtml } from "../src/webviews/guiEditor/html";
import type { AppToHost, HostToApp } from "../src/webviews/guiEditor/messages";

const PKG_ROOT = path.join(__dirname, "..");

/** The canvas the harness pretends the stage has. */
export const VIEWPORT = { w: 1000, h: 600 };
/** The app's own reference viewport (render.ts WORLD_W/WORLD_H). */
const WORLD = { w: 1920, h: 1080 };

let cachedBundle: string | null = null;

/** The shipped bundle, built the way `compile:webview` builds it. */
export function appBundle(): string {
  if (cachedBundle) return cachedBundle;
  const result = buildSync({
    entryPoints: [path.join(PKG_ROOT, "src", "webviews", "guiEditor", "app", "main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    absWorkingDir: PKG_ROOT,
    write: false,
  });
  cachedBundle = result.outputFiles[0].text;
  return cachedBundle;
}

/** Modifier keys a click can carry. */
export interface ClickModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export interface EditorHarness {
  /** Everything the app has posted up, in order. */
  sent: AppToHost[];
  /** Push a host message down, the way a webview receives one. */
  push(message: HostToApp): void;
  /**
   * Click at a point in WORLD (game) coordinates: press and release, like a
   * mouse. `init` carries the modifiers: `{ altKey: true }` cycles,
   * `{ ctrlKey: true, shiftKey: true }` reveals.
   */
  click(x: number, y: number, init?: ClickModifiers): void;
  /** Press the left button at a WORLD point, which selects and arms a gesture. */
  press(x: number, y: number, init?: ClickModifiers): void;
  /** Move the pointer to a WORLD point with the button still down. */
  move(x: number, y: number): void;
  /** Release at a WORLD point, committing whatever the gesture became. */
  up(x: number, y: number): void;
  key(key: string): void;
  /** Visible text of one of the app's panels. */
  text(id: "tree" | "inspector" | "status"): string;
  /** The toast currently up, or null when none is. */
  toast(): string | null;
  /** The inspector's editable input for a property row, or null when it has none. */
  rowInput(key: string): HTMLInputElement | null;
  /** The tree row currently marked selected, or null. */
  selectedRow(): string | null;
  /** Every tree row's text, in order. */
  rows(): string[];
  document: Document;
  close(): void;
}

/**
 * Boot the app. The camera math below mirrors `fitAndCenter`, which the app
 * runs on its first layout: the harness has to speak client pixels and the app
 * thinks in world coordinates. If they ever disagree, a click lands on the
 * wrong widget and the assertions say so.
 */
export function bootEditor(): EditorHarness {
  const dom = new JSDOM(
    guiEditorHtml({ scriptSrc: "guiEditor.js", nonce: "test", csp: "default-src 'none'", fontDataUri: null }),
    { runScripts: "outside-only", pretendToBeVisual: true }
  );
  const win = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
  const sent: AppToHost[] = [];

  win.acquireVsCodeApi = () => ({
    postMessage: (message: AppToHost) => {
      sent.push(message);
    },
  });
  stubBrowser(win);

  win.eval(appBundle());

  const zoom = Math.min(VIEWPORT.w / WORLD.w, VIEWPORT.h / WORLD.h);
  const panX = (VIEWPORT.w - WORLD.w * zoom) / 2;
  const panY = (VIEWPORT.h - WORLD.h * zoom) / 2;
  const doc = win.document;

  const el = (id: string): HTMLElement => doc.getElementById(id)!;

  /** A pointer event at a WORLD point, through the camera the app fitted with. */
  const pointer = (type: string, x: number, y: number, init: ClickModifiers & { button?: number } = {}) => {
    el("stage").dispatchEvent(
      new win.PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pointerId: 1,
        clientX: x * zoom + panX,
        clientY: y * zoom + panY,
        ...init,
      })
    );
  };

  return {
    sent,
    push(message) {
      win.dispatchEvent(new win.MessageEvent("message", { data: message }));
    },
    click(x, y, init = {}) {
      pointer("pointerdown", x, y, init);
      pointer("pointerup", x, y, init);
    },
    press(x, y, init = {}) {
      pointer("pointerdown", x, y, init);
    },
    move(x, y) {
      pointer("pointermove", x, y);
    },
    up(x, y) {
      pointer("pointerup", x, y);
    },
    key(key) {
      win.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
    },
    text(id) {
      // What the panel SHOWS, which since G3.3 includes the inspector's input
      // values; `textContent` alone cannot see those.
      const parts: string[] = [];
      const walk = (node: Node): void => {
        if (node.nodeType === 3) parts.push(node.nodeValue ?? "");
        else if ((node as HTMLElement).tagName === "INPUT") parts.push((node as HTMLInputElement).value);
        else node.childNodes.forEach(walk);
      };
      walk(el(id));
      return parts.join("");
    },
    toast() {
      const toast = el("toast");
      return toast.hasAttribute("hidden") ? null : (toast.textContent ?? "");
    },
    rowInput(key) {
      for (const prop of doc.querySelectorAll("#inspector .prop")) {
        if (prop.querySelector(".key")?.textContent !== key) continue;
        return prop.querySelector("input.val");
      }
      return null;
    },
    selectedRow() {
      return el("tree").querySelector(".row.selected")?.textContent ?? null;
    },
    rows() {
      return [...el("tree").querySelectorAll(".row")].map((r) => r.textContent ?? "");
    },
    document: doc,
    close() {
      win.close();
    },
  };
}

/** Read a fixture from the server's gui corpus (`layout/` unless asked otherwise). */
export function guiFixture(name: string, dir = "layout"): string {
  return fs.readFileSync(path.join(PKG_ROOT, "..", "server", "test", "fixtures", "gui", dir, name), "utf8");
}

function stubBrowser(win: Window & typeof globalThis & Record<string, unknown>): void {
  const context = new Proxy(
    { globalAlpha: 1, lineWidth: 1, fillStyle: "", strokeStyle: "", font: "", textBaseline: "" },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
      set: (target, key, value) => {
        (target as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    }
  );
  win.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement["getContext"];
  for (const [prop, value] of [
    ["clientWidth", VIEWPORT.w],
    ["clientHeight", VIEWPORT.h],
  ] as const) {
    Object.defineProperty(win.HTMLElement.prototype, prop, { get: () => value, configurable: true });
  }
  win.Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: VIEWPORT.w,
      bottom: VIEWPORT.h,
      width: VIEWPORT.w,
      height: VIEWPORT.h,
      toJSON: () => ({}),
    }) as DOMRect;
  win.Element.prototype.scrollIntoView = () => undefined;
  // jsdom implements no pointer capture at all; the app calls it for every drag.
  const noop = () => undefined;
  (win.Element.prototype as unknown as Record<string, unknown>).setPointerCapture = noop;
  (win.Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = noop;
}
