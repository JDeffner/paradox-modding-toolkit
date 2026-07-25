/**
 * GUI layout preview (px.showGuiPreview): renders a .gui file as the game
 * would lay it out — rectangles from the server's measured layout engine
 * (docs/gui-designer/calibration/spec.md), real DDS textures decoded via the
 * bundled decoder, and the game's own Gitan font for text.
 *
 * Interaction model:
 * - hover: inspect (key, name, rect) in the status bar
 * - click: select — persistent highlight + property panel; clicking the
 *   same spot again drills down through the overlapping widgets under it
 * - drag: moves a widget whose `position` is honored AND whose statement
 *   lives in this document (children from type definitions are read-only
 *   here — editing them would change the wrong widget)
 * - middle-mouse drag pans the camera; the scroll wheel zooms at the cursor
 * - toolbar: Undo/Redo (the preview's own edits), Reset (revert the file to
 *   its last saved state, like closing without saving)
 *
 * Every mutation goes through paradox/guiWidgetEdit and is applied as a
 * WorkspaceEdit, so editor undo and the live-preview refresh also work.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GuiLayoutResult, GuiWidgetEditResult } from "@px-lsp/protocol/protocol";
import { decodeDds, encodePng } from "@px-lsp/server/dds";

/** Messages the webview sends to the host. */
type InboundMessage =
  | { type: "open"; line: number }
  | { type: "refresh" }
  | { type: "edit"; line: number; property: "position" | "size"; values: [number, number] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

/** Messages the host sends to the webview. */
type OutboundMessage =
  | {
      type: "layout";
      result: GuiLayoutResult;
      /** texture path -> PNG data URI (null = unresolvable). */
      textures: Record<string, string | null>;
      file: string;
    }
  | { type: "error"; message: string }
  | { type: "loading" }
  | { type: "history"; canUndo: boolean; canRedo: boolean };

export interface GuiPreviewRoots {
  gamePath: string | null;
  modPath: string | null;
}

export type GuiWidgetEditFn = (
  uri: vscode.Uri,
  text: string,
  line: number,
  property: "position" | "size",
  values: [number, number]
) => Promise<GuiWidgetEditResult | null>;

interface OffsetEdit {
  start: number;
  end: number;
  newText: string;
}

const DEBOUNCE_MS = 300;
/** Skip decoding textures beyond this pixel count (loading screens etc.). */
const MAX_TEXTURE_PIXELS = 4096 * 4096;

export class GuiPreviewPanel {
  private static instance: GuiPreviewPanel | undefined;
  private static readonly viewType = "px.guiPreview";

  private readonly panel: vscode.WebviewPanel;
  private readonly fetchLayout: (uri: vscode.Uri, text: string) => Promise<GuiLayoutResult>;
  private readonly editWidget: GuiWidgetEditFn;
  private readonly roots: GuiPreviewRoots;
  private readonly textureCache = new Map<string, string | null>();
  private disposables: vscode.Disposable[] = [];
  private sourceUri: vscode.Uri;
  private disposed = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  /** The preview's own edit history (forward + inverse offset edits). */
  private history: Array<{ forward: OffsetEdit; inverse: OffsetEdit }> = [];
  private historyIndex = 0;

  private constructor(
    fetchLayout: (uri: vscode.Uri, text: string) => Promise<GuiLayoutResult>,
    editWidget: GuiWidgetEditFn,
    source: vscode.TextDocument,
    roots: GuiPreviewRoots
  ) {
    this.fetchLayout = fetchLayout;
    this.editWidget = editWidget;
    this.roots = roots;
    this.sourceUri = source.uri;

    this.panel = vscode.window.createWebviewPanel(
      GuiPreviewPanel.viewType,
      "CK3 GUI Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
    );
    this.panel.webview.html = buildHtml(this.panel.webview, loadGameFont(roots.gamePath));

    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => void this.onMessage(msg),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Live preview: re-render while typing (debounced) AND on save (edits
    // made outside the editor, revert-on-disk, formatters).
    vscode.workspace.onDidChangeTextDocument(
      (ev) => {
        if (ev.document.uri.toString() !== this.sourceUri.toString()) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.load(ev.document), DEBOUNCE_MS);
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

    void this.load(source);
  }

  static show(
    fetchLayout: (uri: vscode.Uri, text: string) => Promise<GuiLayoutResult>,
    editWidget: GuiWidgetEditFn,
    source: vscode.TextDocument,
    roots: GuiPreviewRoots
  ): void {
    if (GuiPreviewPanel.instance) {
      const inst = GuiPreviewPanel.instance;
      if (inst.sourceUri.toString() !== source.uri.toString()) {
        inst.sourceUri = source.uri;
        inst.history = [];
        inst.historyIndex = 0;
        inst.postHistory();
      }
      inst.panel.reveal(undefined, true);
      void inst.load(source);
      return;
    }
    GuiPreviewPanel.instance = new GuiPreviewPanel(fetchLayout, editWidget, source, roots);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    GuiPreviewPanel.instance = undefined;
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
    const gen = ++this.generation;
    this.post({ type: "loading" });
    this.panel.title = `CK3 GUI Preview — ${source.uri.path.split("/").pop() ?? "gui"}`;
    try {
      const result = await this.fetchLayout(source.uri, source.getText());
      if (this.disposed || gen !== this.generation) return;
      const textures: Record<string, string | null> = {};
      for (const tex of result.textures) textures[tex] = this.resolveTexture(tex);
      if (this.disposed || gen !== this.generation) return;
      this.post({ type: "layout", result, textures, file: source.uri.fsPath });
      this.postHistory();
    } catch (err) {
      if (this.disposed) return;
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Mod folder wins over game folder, mirroring the game's file override. */
  private resolveTexture(rel: string): string | null {
    const cached = this.textureCache.get(rel);
    if (cached !== undefined) return cached;
    let out: string | null = null;
    for (const root of [this.roots.modPath, this.roots.gamePath]) {
      if (!root) continue;
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      try {
        const bytes = fs.readFileSync(abs);
        if (rel.toLowerCase().endsWith(".dds")) {
          const img = decodeDds(new Uint8Array(bytes));
          if (img.width * img.height <= MAX_TEXTURE_PIXELS) {
            const png = encodePng(img.width, img.height, img.pixels);
            out = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
          }
        } else if (/\.png$/i.test(rel)) {
          out = `data:image/png;base64,${bytes.toString("base64")}`;
        }
      } catch {
        out = null;
      }
      break;
    }
    this.textureCache.set(rel, out);
    return out;
  }

  private post(msg: OutboundMessage): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(msg);
  }

  private postHistory(): void {
    this.post({
      type: "history",
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex < this.history.length,
    });
  }

  private async applyOffsetEdit(doc: vscode.TextDocument, edit: OffsetEdit): Promise<boolean> {
    const ws = new vscode.WorkspaceEdit();
    ws.replace(
      this.sourceUri,
      new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)),
      edit.newText
    );
    return vscode.workspace.applyEdit(ws);
  }

  private async onMessage(msg: InboundMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "open": {
          const doc = await vscode.workspace.openTextDocument(this.sourceUri);
          const position = new vscode.Position(Math.max(0, msg.line), 0);
          await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            selection: new vscode.Range(position, position),
          });
          return;
        }
        case "refresh": {
          const doc = await vscode.workspace.openTextDocument(this.sourceUri);
          await this.load(doc);
          return;
        }
        case "edit": {
          const doc = await vscode.workspace.openTextDocument(this.sourceUri);
          const text = doc.getText();
          const edit = await this.editWidget(this.sourceUri, text, msg.line, msg.property, msg.values);
          if (!edit) {
            void vscode.window.showWarningMessage(
              `CK3 GUI Preview: could not edit ${msg.property} of the widget on line ${msg.line + 1}.`
            );
            return;
          }
          const inverse: OffsetEdit = {
            start: edit.start,
            end: edit.start + edit.newText.length,
            newText: text.slice(edit.start, edit.end),
          };
          if (await this.applyOffsetEdit(doc, edit)) {
            this.history.splice(this.historyIndex);
            this.history.push({ forward: edit, inverse });
            this.historyIndex = this.history.length;
            this.postHistory();
          }
          return;
        }
        case "undo": {
          if (this.historyIndex === 0) return;
          const entry = this.history[this.historyIndex - 1];
          const doc = await vscode.workspace.openTextDocument(this.sourceUri);
          const current = doc.getText().slice(entry.inverse.start, entry.inverse.end);
          if (current !== entry.forward.newText) {
            void vscode.window.showWarningMessage(
              "CK3 GUI Preview: the document changed since this edit — use the editor's own undo."
            );
            return;
          }
          if (await this.applyOffsetEdit(doc, entry.inverse)) {
            this.historyIndex--;
            this.postHistory();
          }
          return;
        }
        case "redo": {
          if (this.historyIndex >= this.history.length) return;
          const entry = this.history[this.historyIndex];
          const doc = await vscode.workspace.openTextDocument(this.sourceUri);
          const current = doc.getText().slice(entry.forward.start, entry.forward.end);
          if (current !== entry.inverse.newText) {
            void vscode.window.showWarningMessage(
              "CK3 GUI Preview: the document changed since this edit — redo is no longer possible."
            );
            return;
          }
          if (await this.applyOffsetEdit(doc, entry.forward)) {
            this.historyIndex++;
            this.postHistory();
          }
          return;
        }
        case "reset": {
          const doc = await vscode.workspace.openTextDocument(this.sourceUri);
          const disk = fs.readFileSync(this.sourceUri.fsPath, "utf8");
          if (doc.getText() === disk) {
            void vscode.window.showInformationMessage("CK3 GUI Preview: no unsaved changes to reset.");
            return;
          }
          const fileName = this.sourceUri.path.split("/").pop() ?? "file";
          const pick = await vscode.window.showWarningMessage(
            `Reset ${fileName} to its last saved state? All unsaved changes are discarded.`,
            { modal: true },
            "Reset"
          );
          if (pick !== "Reset") return;
          const full: OffsetEdit = { start: 0, end: doc.getText().length, newText: disk };
          if (await this.applyOffsetEdit(doc, full)) {
            this.history = [];
            this.historyIndex = 0;
            this.postHistory();
          }
          return;
        }
      }
    } catch (err) {
      void vscode.window.showErrorMessage(
        `CK3 GUI Preview: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/** The game's standard UI font, embedded so text metrics roughly match. */
function loadGameFont(gamePath: string | null): string | null {
  if (!gamePath) return null;
  const otf = path.join(gamePath, "fonts", "Gitan", "GitanLatin-Regular.otf");
  try {
    return `data:font/otf;base64,${fs.readFileSync(otf).toString("base64")}`;
  } catch {
    return null;
  }
}

function buildHtml(webview: vscode.Webview, fontDataUri: string | null): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `font-src data:`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  const fontFace = fontDataUri
    ? `@font-face { font-family: "CK3Gitan"; src: url("${fontDataUri}") format("opentype"); }`
    : "";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>CK3 GUI Preview</title>
<style>
  ${fontFace}
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  #toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; flex: 0 0 auto; flex-wrap: wrap;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  button {
    padding: 3px 10px; border-radius: 2px; cursor: pointer;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  button:disabled { opacity: 0.4; cursor: default; }
  #toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
  #zoomLabel { min-width: 46px; text-align: center; }
  .sep { width: 1px; align-self: stretch; background: var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  #main { flex: 1 1 auto; position: relative; overflow: hidden; display: flex; }
  #scroller { flex: 1 1 auto; overflow: hidden; background: #101010; }
  #canvas { display: block; cursor: default; }
  #props {
    position: absolute; top: 8px; right: 8px; width: 210px;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.4));
    border-radius: 4px; padding: 8px; display: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4); z-index: 5;
  }
  #props h3 { margin: 0 0 2px; font-size: 1em; word-break: break-all; }
  #props .sub { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 6px; }
  #props .grid { display: grid; grid-template-columns: auto 1fr 1fr; gap: 4px 6px; align-items: center; }
  #props .grid span { color: var(--vscode-descriptionForeground); }
  #props input {
    width: 100%; padding: 2px 4px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
    border-radius: 2px;
  }
  #props input:disabled { opacity: 0.45; }
  #props .row { display: flex; gap: 6px; margin-top: 8px; }
  #props .hint { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 6px; }
  #status {
    flex: 0 0 auto; padding: 4px 8px; font-size: 0.9em;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    color: var(--vscode-descriptionForeground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <button id="zoomOut">−</button>
    <span id="zoomLabel">100%</span>
    <button id="zoomIn">+</button>
    <button id="zoomFit">Fit</button>
    <span class="sep"></span>
    <button id="undo" disabled title="Undo the preview's last edit">Undo</button>
    <button id="redo" disabled title="Redo">Redo</button>
    <button id="reset" title="Revert the file to its last saved state">Reset</button>
    <span class="sep"></span>
    <label><input id="outlines" type="checkbox" /> Outlines</label>
    <button id="refresh">Refresh</button>
    <span id="meta" style="margin-left:auto;color:var(--vscode-descriptionForeground)"></span>
  </div>
  <div id="main">
    <div id="scroller"><canvas id="canvas"></canvas></div>
    <div id="props">
      <h3 id="propTitle"></h3>
      <div class="sub" id="propSub"></div>
      <div class="grid">
        <span>pos</span><input id="posX" type="number" step="1" /><input id="posY" type="number" step="1" />
        <span>size</span><input id="sizeW" type="number" step="1" /><input id="sizeH" type="number" step="1" />
      </div>
      <div class="row">
        <button id="goSource">Source</button>
        <button id="deselect">Close</button>
      </div>
      <div class="hint" id="propHint"></div>
    </div>
  </div>
  <div id="status">Loading…</div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const WORLD_W = 1920, WORLD_H = 1080;
// Datamodel list placeholders render at this opacity (matches GHOST_OPACITY
// in the layout engine). Presentation only.
const GHOST_OPACITY = 0.45;
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const scroller = document.getElementById("scroller");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const zoomLabel = document.getElementById("zoomLabel");
const outlinesEl = document.getElementById("outlines");
const propsEl = document.getElementById("props");
const posX = document.getElementById("posX"), posY = document.getElementById("posY");
const sizeW = document.getElementById("sizeW"), sizeH = document.getElementById("sizeH");
const undoBtn = document.getElementById("undo"), redoBtn = document.getElementById("redo");

let nodes = [];
let images = {};
let tintCache = {};
let zoom = 0.5;
// Free camera: canvas-local screen = world * zoom + pan (pan in CSS px).
// Not clamped, so the layout can be moved anywhere, even out of view.
let panX = 0, panY = 0;
let firstRender = true;
let hover = null;
let selected = null;
let selectedRef = null;
let flat = [];
let fileName = "";
let nodeCount = 0;
// drag state
let dragNode = null, dragDX = 0, dragDY = 0, dragging = false;
let downX = 0, downY = 0, downNode = null;
// drill-down state: clicking the same spot cycles through overlapping widgets
let lastClick = { x: -1e9, y: -1e9, index: -1 };
// middle-mouse camera pan
let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;

function clampZoom(z) { return Math.min(4, Math.max(0.1, z)); }

function applyZoom(z) {
  zoom = clampZoom(z);
  zoomLabel.textContent = Math.round(zoom * 100) + "%";
  draw();
}

/**
 * Client (viewport) coords -> world coords. Canvas maps world to screen as
 * screenLocal = world * zoom + pan (screenLocal relative to the canvas
 * top-left), so world = (client - canvasOrigin - pan) / zoom. Used by every
 * hit-test, drag and hover path so they stay pixel-accurate at any pan/zoom.
 */
function toWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
}

/** Zoom to z keeping the world point at canvas-local (sx, sy) fixed on screen. */
function zoomToScreenPoint(sx, sy, z) {
  const z2 = clampZoom(z);
  panX = sx - ((sx - panX) / zoom) * z2;
  panY = sy - ((sy - panY) / zoom) * z2;
  zoom = z2;
  zoomLabel.textContent = Math.round(zoom * 100) + "%";
  draw();
}

function setZoom(z, keepCenter) {
  if (keepCenter) zoomToScreenPoint(scroller.clientWidth / 2, scroller.clientHeight / 2, z);
  else applyZoom(z);
}

/** Zoom keeping the world point under the cursor fixed. */
function zoomAt(clientX, clientY, factor) {
  const rect = canvas.getBoundingClientRect();
  zoomToScreenPoint(clientX - rect.left, clientY - rect.top, zoom * factor);
}

/** Fit the whole world in the viewport and center it. */
function fitAndCenter() {
  const w = scroller.clientWidth, h = scroller.clientHeight;
  zoom = clampZoom(Math.min(w / WORLD_W, h / WORLD_H));
  zoomLabel.textContent = Math.round(zoom * 100) + "%";
  panX = (w - WORLD_W * zoom) / 2;
  panY = (h - WORLD_H * zoom) / 2;
  draw();
}

function rgba(c, mulAlpha) {
  const a = (c && c.length > 3 ? c[3] : 1) * (mulAlpha === undefined ? 1 : mulAlpha);
  if (!c) return "rgba(255,255,255," + a + ")";
  return "rgba(" + Math.round(c[0]*255) + "," + Math.round(c[1]*255) + "," + Math.round(c[2]*255) + "," + a + ")";
}

function isTintless(c) {
  return !c || (c[0] >= 0.999 && c[1] >= 0.999 && c[2] >= 0.999);
}

function tinted(texPath, img, color) {
  const key = texPath + "|" + color.slice(0,3).join(",");
  let cv = tintCache[key];
  if (cv) return cv;
  cv = document.createElement("canvas");
  cv.width = img.naturalWidth || 1;
  cv.height = img.naturalHeight || 1;
  const c2 = cv.getContext("2d");
  c2.drawImage(img, 0, 0);
  c2.globalCompositeOperation = "multiply";
  c2.fillStyle = rgba([color[0], color[1], color[2], 1]);
  c2.fillRect(0, 0, cv.width, cv.height);
  c2.globalCompositeOperation = "destination-in";
  c2.drawImage(img, 0, 0);
  tintCache[key] = cv;
  return cv;
}

// Nine-slice regions: mirrors computeNineSlice in the layout engine (corners
// 1:1, edges stretched one axis, center both). Deterministic geometry.
function nineSlice(rect, border, texW, texH) {
  const bl = Math.max(0, Math.min(border[0], texW, rect.w));
  const bt = Math.max(0, Math.min(border[1], texH, rect.h));
  const br = Math.max(0, Math.min(border[2], texW - bl, rect.w - bl));
  const bb = Math.max(0, Math.min(border[3], texH - bt, rect.h - bt));
  const sCols = [[0, bl], [bl, texW - bl - br], [texW - br, br]];
  const sRows = [[0, bt], [bt, texH - bt - bb], [texH - bb, bb]];
  const dCols = [[rect.x, bl], [rect.x + bl, rect.w - bl - br], [rect.x + rect.w - br, br]];
  const dRows = [[rect.y, bt], [rect.y + bt, rect.h - bt - bb], [rect.y + rect.h - bb, bb]];
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const [sx, sw] = sCols[c], [sy, sh] = sRows[r];
    const [dx, dw] = dCols[c], [dy, dh] = dRows[r];
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
    out.push([sx, sy, sw, sh, dx, dy, dw, dh]);
  }
  return out;
}

function paintFill(rect, fill) {
  if (!fill || rect.w <= 0 || rect.h <= 0) return;
  const img = fill.texture ? images[fill.texture] : null;
  const color = fill.color;
  const alpha = color && color.length > 3 ? color[3] : 1;
  if (img) {
    const src = isTintless(color) ? img : tinted(fill.texture, img, color);
    ctx.save();
    ctx.globalAlpha *= alpha;
    const tw = src.naturalWidth || src.width || 0;
    const th = src.naturalHeight || src.height || 0;
    if (fill.border && tw > 0 && th > 0) {
      for (const [sx, sy, sw, sh, dx, dy, dw, dh] of nineSlice(rect, fill.border, tw, th)) {
        ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
      }
    } else {
      ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
  } else if (color) {
    ctx.save();
    ctx.fillStyle = rgba(color);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
}

function drawNode(node, inheritedGhost) {
  const isDragged = dragging && node === dragNode;
  if (isDragged) {
    ctx.save();
    ctx.translate(dragDX, dragDY);
    ctx.globalAlpha *= 0.85;
  }
  // Dim a datamodel placeholder subtree once, at its topmost ghost node.
  const dimGhost = node.ghost && !inheritedGhost;
  if (dimGhost) { ctx.save(); ctx.globalAlpha *= GHOST_OPACITY; }
  const childGhost = inheritedGhost || node.ghost;
  const r = node.rect;
  paintFill(r, node.bg);
  paintFill(r, node.fill);
  if (node.text && node.text.lines.length) {
    const fs = node.text.fontsize;
    const lineH = (21 / 15) * fs;
    ctx.save();
    ctx.font = fs + "px CK3Gitan, Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = node.text.color ? rgba(node.text.color) : "#e3dac3";
    for (let i = 0; i < node.text.lines.length; i++) {
      ctx.fillText(node.text.lines[i], r.x + node.text.offsetX, r.y + node.text.offsetY + i * lineH + (lineH - fs) / 2);
    }
    ctx.restore();
  }
  if (outlinesEl.checked) {
    ctx.save();
    ctx.strokeStyle = "rgba(120,180,255,0.35)";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  if (node.clip) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    for (const c of node.children) drawNode(c, childGhost);
    ctx.restore();
  } else {
    for (const c of node.children) drawNode(c, childGhost);
  }
  if (dimGhost) ctx.restore();
  if (isDragged) ctx.restore();
}

function isInDragSubtree(node) {
  if (!dragNode) return false;
  let stack = [dragNode];
  while (stack.length) {
    const n = stack.pop();
    if (n === node) return true;
    for (const c of n.children) stack.push(c);
  }
  return false;
}

function outline(node, color, width, fillAlpha) {
  const r = node.rect;
  const dx = dragging && isInDragSubtree(node) ? dragDX : 0;
  const dy = dragging && isInDragSubtree(node) ? dragDY : 0;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width / zoom;
  ctx.strokeRect(r.x + dx, r.y + dy, r.w, r.h);
  if (fillAlpha) {
    ctx.fillStyle = color;
    ctx.globalAlpha = fillAlpha;
    ctx.fillRect(r.x + dx, r.y + dy, r.w, r.h);
  }
  ctx.restore();
}

function flatten() {
  flat = [];
  const walk = (n, clips) => {
    flat.push({ node: n, clips });
    const next = n.clip ? clips.concat([n.rect]) : clips;
    for (const c of n.children) walk(c, next);
  };
  for (const n of nodes) walk(n, []);
}

function draw() {
  // Canvas fills the viewport; the camera transform positions the world in it.
  const w = scroller.clientWidth, h = scroller.clientHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  for (const n of nodes) drawNode(n);
  if (selected) outline(selected, "#ff9f43", 2, 0.06);
  if (hover && hover !== selected) outline(hover, "#4dc3ff", 1.5, 0.08);
}

/** All widgets under a point, topmost (last drawn) first. */
function hitStack(x, y) {
  const out = [];
  for (const { node, clips } of flat) {
    const r = node.rect;
    if (r.w < 1 || r.h < 1) continue;
    if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
    let clipped = false;
    for (const c of clips) {
      if (x < c.x || y < c.y || x > c.x + c.w || y > c.y + c.h) { clipped = true; break; }
    }
    if (!clipped) out.push(node);
  }
  return out.reverse();
}

function hitTest(x, y) {
  const stack = hitStack(x, y);
  return stack.length ? stack[0] : null;
}

function fmt(v) { return Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1); }
function defaultStatus() { return nodeCount + " widgets · " + fileName; }
function nodeLabel(n) { return n.key + (n.name ? ' "' + n.name + '"' : ""); }
function canDrag(n) { return n && n.positioned && n.editable; }

function select(node) {
  selected = node;
  selectedRef = node ? { line: node.line, key: node.key, name: node.name } : null;
  updateProps();
  draw();
}

function updateProps() {
  if (!selected) { propsEl.style.display = "none"; return; }
  propsEl.style.display = "block";
  const n = selected;
  document.getElementById("propTitle").textContent = nodeLabel(n);
  document.getElementById("propSub").textContent =
    "rect " + fmt(n.rect.x) + ", " + fmt(n.rect.y) + " · " + fmt(n.rect.w) + " × " + fmt(n.rect.h) +
    (n.line !== undefined ? " · line " + (n.line + 1) : "");
  const pos = n.srcPosition || [0, 0];
  posX.value = fmt(pos[0]); posY.value = fmt(pos[1]);
  posX.disabled = posY.disabled = !n.positioned || !n.editable;
  const size = n.srcSize || [n.rect.w, n.rect.h];
  sizeW.value = fmt(size[0]); sizeH.value = fmt(size[1]);
  sizeW.disabled = sizeH.disabled = !n.editable;
  document.getElementById("propHint").textContent = !n.editable
    ? "Defined inside a template/type (possibly another file): edit it at its definition."
    : !n.positioned
      ? "Layout-managed by its parent box: position is ignored by the game, so moving is disabled."
      : "Drag the widget on the canvas or edit values here.";
}

function postEdit(property, values) {
  if (!selected || selected.line === undefined || !selected.editable) return;
  vscode.postMessage({ type: "edit", line: selected.line, property, values });
}

function bindPair(inputA, inputB, property) {
  const commit = () => {
    const a = parseFloat(inputA.value), b = parseFloat(inputB.value);
    if (Number.isFinite(a) && Number.isFinite(b)) postEdit(property, [a, b]);
  };
  for (const el of [inputA, inputB]) {
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") commit(); });
    el.addEventListener("change", commit);
  }
}
bindPair(posX, posY, "position");
bindPair(sizeW, sizeH, "size");

document.getElementById("goSource").addEventListener("click", () => {
  if (selected && selected.line !== undefined) vscode.postMessage({ type: "open", line: selected.line });
});
document.getElementById("deselect").addEventListener("click", () => select(null));

// ---- pointer interactions -------------------------------------------------

scroller.addEventListener("pointerdown", (ev) => {
  if (ev.button === 1) {
    // middle mouse: pan the camera
    ev.preventDefault();
    panning = true;
    panStartX = ev.clientX; panStartY = ev.clientY;
    panOrigX = panX; panOrigY = panY;
    scroller.setPointerCapture(ev.pointerId);
    canvas.style.cursor = "move";
  }
});
scroller.addEventListener("pointermove", (ev) => {
  if (!panning) return;
  // Grab-pan: content follows the cursor 1:1, with no bounds.
  panX = panOrigX + (ev.clientX - panStartX);
  panY = panOrigY + (ev.clientY - panStartY);
  draw();
});
scroller.addEventListener("pointerup", (ev) => {
  if (ev.button === 1 && panning) {
    panning = false;
    scroller.releasePointerCapture(ev.pointerId);
    canvas.style.cursor = "default";
  }
});
// suppress the middle-click autoscroll/paste behaviors
scroller.addEventListener("auxclick", (ev) => { if (ev.button === 1) ev.preventDefault(); });

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  const p = toWorld(ev.clientX, ev.clientY);
  downX = p.x;
  downY = p.y;
  const stack = hitStack(downX, downY);
  // Predictable dragging: if the SELECTED widget is under the cursor, the
  // drag applies to it, not to whatever is topmost.
  downNode = selected && stack.indexOf(selected) >= 0 ? selected : (stack[0] || null);
  canvas.setPointerCapture(ev.pointerId);
});

canvas.addEventListener("pointermove", (ev) => {
  if (panning) return;
  const p = toWorld(ev.clientX, ev.clientY);
  const x = p.x, y = p.y;

  if (downNode && ev.buttons === 1) {
    const dx = x - downX, dy = y - downY;
    if (!dragging && Math.hypot(dx, dy) * zoom > 3) {
      if (canDrag(downNode)) {
        dragNode = downNode;
        dragging = true;
        canvas.style.cursor = "grabbing";
      } else if (downNode.line !== undefined) {
        statusEl.textContent = !downNode.editable
          ? nodeLabel(downNode) + " comes from a template/type — edit it at its definition."
          : nodeLabel(downNode) + " is layout-managed by its parent box — drag disabled.";
      }
    }
    if (dragging) {
      dragDX = Math.round(dx);
      dragDY = Math.round(dy);
      const pos = dragNode.srcPosition || [0, 0];
      statusEl.textContent =
        nodeLabel(dragNode) + " → position { " + fmt(pos[0] + dragDX) + " " + fmt(pos[1] + dragDY) + " }";
      draw();
      return;
    }
  }

  const n = hitTest(x, y);
  if (n !== hover) { hover = n; draw(); }
  canvas.style.cursor = canDrag(n) ? "grab" : "default";
  if (n) {
    const r = n.rect;
    statusEl.textContent =
      nodeLabel(n) + "  ·  x " + fmt(r.x) + "  y " + fmt(r.y) + "  ·  " + fmt(r.w) + " × " + fmt(r.h) +
      (n.line !== undefined ? "  ·  line " + (n.line + 1) : "") +
      (canDrag(n) ? "  ·  drag to move" : "");
  } else {
    statusEl.textContent = defaultStatus();
  }
});

canvas.addEventListener("pointerup", (ev) => {
  if (ev.button !== 0) return;
  canvas.releasePointerCapture(ev.pointerId);
  if (dragging) {
    const pos = dragNode.srcPosition || [0, 0];
    const values = [pos[0] + dragDX, pos[1] + dragDY];
    const line = dragNode.line;
    selected = dragNode;
    selectedRef = { line: line, key: dragNode.key, name: dragNode.name };
    vscode.postMessage({ type: "edit", line: line, property: "position", values: values });
    dragging = false; dragNode = null; dragDX = 0; dragDY = 0;
    canvas.style.cursor = "grab";
    updateProps();
    draw();
    downNode = null;
    return;
  }
  // Click: select. Clicking (roughly) the same spot again drills down
  // through the stack of overlapping widgets, topmost first.
  const stack = hitStack(downX, downY);
  if (stack.length === 0) {
    select(null);
    lastClick = { x: -1e9, y: -1e9, index: -1 };
  } else {
    const near = Math.hypot(downX - lastClick.x, downY - lastClick.y) * zoom < 5;
    const index = near ? (lastClick.index + 1) % stack.length : 0;
    lastClick = { x: downX, y: downY, index };
    select(stack[index]);
    if (stack.length > 1) {
      statusEl.textContent =
        nodeLabel(stack[index]) + "  ·  layer " + (index + 1) + "/" + stack.length +
        " — click again for the one beneath";
    }
  }
  downNode = null;
});

canvas.addEventListener("pointerleave", () => {
  hover = null;
  if (!dragging) { draw(); statusEl.textContent = defaultStatus(); }
});

// wheel: zoom at the cursor (no modifier needed)
scroller.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

// ---- toolbar ----------------------------------------------------------------

document.getElementById("zoomIn").addEventListener("click", () => setZoom(zoom * 1.25, true));
document.getElementById("zoomOut").addEventListener("click", () => setZoom(zoom / 1.25, true));
document.getElementById("zoomFit").addEventListener("click", fitAndCenter);
window.addEventListener("resize", draw);
document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
undoBtn.addEventListener("click", () => vscode.postMessage({ type: "undo" }));
redoBtn.addEventListener("click", () => vscode.postMessage({ type: "redo" }));
document.getElementById("reset").addEventListener("click", () => vscode.postMessage({ type: "reset" }));
outlinesEl.addEventListener("change", draw);

function reselect() {
  if (!selectedRef) return;
  let found = null;
  for (const { node } of flat) {
    if (node.line === selectedRef.line && node.key === selectedRef.key &&
        (node.name || "") === (selectedRef.name || "")) { found = node; break; }
  }
  selected = found;
  if (!found) selectedRef = null;
  updateProps();
}

window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === "loading") { statusEl.textContent = "Loading…"; return; }
  if (msg.type === "error") { statusEl.textContent = "Error: " + msg.message; return; }
  if (msg.type === "history") {
    undoBtn.disabled = !msg.canUndo;
    redoBtn.disabled = !msg.canRedo;
    return;
  }
  if (msg.type !== "layout") return;

  nodes = msg.result.nodes;
  nodeCount = msg.result.nodeCount;
  fileName = msg.file.split(/[\\\\/]/).pop();
  metaEl.textContent = msg.result.defsFiles + " gui files in template store";
  tintCache = {};
  hover = null;
  dragging = false; dragNode = null;
  flatten();
  reselect();

  images = {};
  let pending = 0;
  for (const [tex, uri] of Object.entries(msg.textures)) {
    if (!uri) continue;
    const img = new Image();
    pending++;
    img.onload = () => { images[tex] = img; if (--pending === 0) draw(); };
    img.onerror = () => { if (--pending === 0) draw(); };
    img.src = uri;
  }
  statusEl.textContent = defaultStatus();
  // First render: fit and center the layout instead of pinning it top-left.
  if (firstRender) { firstRender = false; fitAndCenter(); }
  else draw();
});
</script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
