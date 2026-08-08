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

/**
 * What the canvas stub was told to paint with, since the last `reset`. jsdom
 * draws no pixels, so the styles the painter SETS are the only evidence a
 * canvas-only affordance (a guide line, a hover flash, a dimmed solo) actually
 * reached the canvas rather than only the app's own state.
 */
export interface PaintLog {
  strokes: string[];
  alphas: number[];
  reset(): void;
}
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
  /** A keydown at the window, with the modifiers a chord needs. */
  key(key: string, init?: ClickModifiers): void;
  /** Visible text of one of the app's panels. */
  text(
    id:
      "tree" | "layers" | "inspector" | "status" | "stats" | "focusBar" | "palette" | "haloTabs" | "haloBody"
  ): string;
  /** Flip one of the toolbar checkboxes, the way a click on it would. */
  toggle(id: "outlines" | "snap" | "grid" | "constraints" | "pulses", on: boolean): void;
  /** Choose a heatmap mode in the toolbar select. */
  heatmap(mode: "off" | "depth" | "clipped" | "synthetic"): void;
  /** Every row the devtools halo is showing, in order. */
  haloRows(): string[];
  /** Click the first element in the halo whose text contains `text`. */
  haloClick(text: string): void;
  /** Type into the halo's filter box, the way a keystroke would. */
  filterHalo(text: string): void;
  /** The conditional-visibility badge in the status strip, or null when it is down. */
  badge(): string | null;
  /** The toast currently up, or null when none is. */
  toast(): string | null;
  /** The inspector's editable input for a property row, or null when it has none. */
  rowInput(key: string): HTMLInputElement | null;
  /** The tree row currently marked selected, or null. */
  selectedRow(): string | null;
  /** Every tree row's text, in order. */
  rows(): string[];
  /** Every layers row's text, in order (the panel's head and notes excluded). */
  layers(): string[];
  /** The layers row whose label contains `name`. */
  layer(name: string): HTMLElement;
  /** Every selected row's text in a panel, tree or layers. */
  selectedRows(id: "tree" | "layers"): string[];
  /** Every palette row's text, in order. */
  paletteRows(): string[];
  /** The palette row whose text starts with `name`. */
  paletteRow(name: string): HTMLElement;
  /** Type into the palette's filter box, the way a keystroke would. */
  filterPalette(text: string): void;
  /** Click a toolbar or inspector button by its visible label. */
  button(label: string): HTMLButtonElement;
  /** Click something inside a panel: a focus crumb, a button, the first toggle. */
  clickIn(node: Element, selector: string): void;
  /** Click one of a layers row's three glyph columns. */
  clickToggle(node: Element, which: "eye" | "lock" | "solo"): void;
  /** Move the pointer onto a panel row, or off it. */
  hover(node: Element, on: boolean): void;
  /** A pointer event on a panel element, for the row drags the layers panel has. */
  rowPointer(node: Element, type: "pointerdown" | "pointermove", at?: { x: number; y: number }): void;
  /** Release the button anywhere, which is what ends a row drag. */
  releasePointer(): void;
  paint: PaintLog;
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
  const paint = stubBrowser(win);

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
    key(key, init = {}) {
      win.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, ...init }));
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
    toggle(id, on) {
      const input = el(id) as HTMLInputElement;
      input.checked = on;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    },
    heatmap(mode) {
      const select = el("heatmap") as HTMLSelectElement;
      select.value = mode;
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
    },
    haloRows() {
      return [...el("haloBody").querySelectorAll(".row, .texRow, .term, .prose, .check")].map(
        (r) => r.textContent ?? ""
      );
    },
    haloClick(text) {
      for (const node of el("haloBody").querySelectorAll<HTMLElement>("*")) {
        // The innermost match, so clicking "Insert" hits the button and not the
        // row it sits in: a row's own handler would select instead of insert.
        if (!(node.textContent ?? "").includes(text)) continue;
        if ([...node.children].some((c) => (c.textContent ?? "").includes(text))) continue;
        node.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
        return;
      }
      throw new Error(`nothing in the halo reads "${text}"`);
    },
    filterHalo(text) {
      const input = el("haloBody").querySelector<HTMLInputElement>(".filter input");
      if (!input) throw new Error("the halo has no filter box");
      input.value = text;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    },
    badge() {
      const node = el("visibilityBadge");
      return node.hasAttribute("hidden") ? null : (node.textContent ?? "");
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
    layers() {
      return [...el("layers").querySelectorAll(".row")].map((r) => r.textContent ?? "");
    },
    layer(name) {
      for (const row of el("layers").querySelectorAll<HTMLElement>(".row")) {
        if (row.querySelector(".label")?.textContent?.includes(name)) return row;
      }
      throw new Error(`no layers row for ${name}`);
    },
    selectedRows(id) {
      return [...el(id).querySelectorAll(".row.selected")].map((r) => r.textContent ?? "");
    },
    paletteRows() {
      return [...el("palette").querySelectorAll(".row")].map((r) => r.textContent ?? "");
    },
    paletteRow(name) {
      for (const row of el("palette").querySelectorAll<HTMLElement>(".row")) {
        if ((row.textContent ?? "").startsWith(name)) return row;
      }
      throw new Error(`no palette row for ${name}`);
    },
    filterPalette(text) {
      const input = el("palette").querySelector("input")!;
      input.value = text;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    },
    button(label) {
      for (const node of doc.querySelectorAll<HTMLButtonElement>("button")) {
        if (node.textContent === label) return node;
      }
      throw new Error(`no button labelled ${label}`);
    },
    clickIn(node, selector) {
      const target = node.querySelector(selector);
      if (!target) throw new Error(`no ${selector} in that element`);
      target.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    },
    clickToggle(node, which) {
      const at = { eye: 0, lock: 1, solo: 2 }[which];
      const target = node.querySelectorAll(".toggle")[at];
      if (!target) throw new Error(`no ${which} toggle in that row`);
      target.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    },
    hover(node, on) {
      node.dispatchEvent(new win.PointerEvent(on ? "pointerenter" : "pointerleave", { bubbles: false }));
    },
    rowPointer(node, type, at = { x: 0, y: 0 }) {
      node.dispatchEvent(
        new win.PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: 1,
          pointerId: 2,
          clientX: at.x,
          clientY: at.y,
        })
      );
    },
    releasePointer() {
      win.dispatchEvent(new win.PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 2 }));
    },
    paint,
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

function stubBrowser(win: Window & typeof globalThis & Record<string, unknown>): PaintLog {
  const paint: PaintLog = {
    strokes: [],
    alphas: [],
    reset() {
      paint.strokes.length = 0;
      paint.alphas.length = 0;
    },
  };
  const context = new Proxy(
    { globalAlpha: 1, lineWidth: 1, fillStyle: "", strokeStyle: "", font: "", textBaseline: "" },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
      set: (target, key, value) => {
        (target as Record<string | symbol, unknown>)[key] = value;
        if (key === "strokeStyle") paint.strokes.push(String(value));
        if (key === "globalAlpha") paint.alphas.push(Number(value));
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
  // The app repaints through requestAnimationFrame during a gesture; jsdom's
  // own schedules on a timer that never fires inside a synchronous test, so
  // the frame runs at once and every assertion sees the paint its pointer
  // event produced. The handle is 0 because the app stores what this returns
  // as "a frame is pending", and a frame that has already run is not pending.
  win.requestAnimationFrame = ((run: FrameRequestCallback) => {
    run(0);
    return 0;
  }) as typeof win.requestAnimationFrame;
  win.cancelAnimationFrame = noop;
  return paint;
}
