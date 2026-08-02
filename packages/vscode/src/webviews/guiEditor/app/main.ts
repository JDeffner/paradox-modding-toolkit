/**
 * The GUI editor app: the thin DOM shell around the pure scene builder and the
 * canvas painter. It owns the camera and the DOM, and nothing else — layout,
 * text and every future edit come from the host (../messages.ts).
 *
 * G3.1 is the render stage: pan, zoom, outlines, refresh. Selection, the tree,
 * the inspector and the edit gestures land in G3.2/G3.3.
 */
import type { GuiLayoutResult } from "@px-lsp/protocol/protocol";
import { connectHost } from "./host";
import { buildScene, type Scene } from "./scene";
import { drawScene, resetImageCache, type Images, WORLD_H, WORLD_W } from "./render";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const stage = document.getElementById("stage") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const metaEl = document.getElementById("meta") as HTMLSpanElement;
const zoomLabel = document.getElementById("zoomLabel") as HTMLSpanElement;
const outlinesEl = document.getElementById("outlines") as HTMLInputElement;
/** The game font is embedded by the host when it could read it. */
const fontFamily = document.body.dataset.font === "game" ? "PxGuiGameFont, Georgia, serif" : "Georgia, serif";

let scene: Scene = { items: [], count: 0 };
let images: Images = {};
let file = "";
let defsFiles = 0;
let zoom = 0.5;
/** Canvas-local screen = world * zoom + pan. Unclamped, so nothing is unreachable. */
let panX = 0;
let panY = 0;
let fitPending = true;
let panning = false;
let panFrom = { x: 0, y: 0, panX: 0, panY: 0 };

function clampZoom(z: number): number {
  return Math.min(4, Math.max(0.05, z));
}

function draw(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  canvas.width = w;
  canvas.height = h;
  drawScene(
    ctx,
    scene,
    images,
    { zoom, panX, panY },
    { w, h },
    {
      outlines: outlinesEl.checked,
      fontFamily,
    }
  );
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

/** Zoom to z keeping the world point at canvas-local (sx, sy) fixed on screen. */
function zoomToPoint(sx: number, sy: number, z: number): void {
  const next = clampZoom(z);
  panX = sx - ((sx - panX) / zoom) * next;
  panY = sy - ((sy - panY) / zoom) * next;
  zoom = next;
  draw();
}

function fitAndCenter(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  zoom = clampZoom(Math.min(w / WORLD_W, h / WORLD_H));
  panX = (w - WORLD_W * zoom) / 2;
  panY = (h - WORLD_H * zoom) / 2;
  draw();
}

function statusLine(): string {
  const ghosts = scene.items.filter((i) => i.ghostBox).length;
  const estimated = ghosts > 0 ? ` · ${ghosts} unmeasurable (dashed)` : "";
  return `${scene.count} widgets · ${file}${estimated}`;
}

function loadTextures(urls: Record<string, string | null>): void {
  images = {};
  resetImageCache();
  let pending = 0;
  for (const [texture, url] of Object.entries(urls)) {
    if (!url) continue;
    const img = new Image();
    pending++;
    const done = () => {
      if (--pending === 0) draw();
    };
    img.onload = () => {
      images[texture] = img;
      done();
    };
    img.onerror = done;
    img.src = url;
  }
}

function onLayout(result: GuiLayoutResult, textures: Record<string, string | null>, name: string): void {
  file = name;
  defsFiles = result.defsFiles;
  scene = buildScene(result.nodes);
  metaEl.textContent = `${defsFiles} gui files in template store`;
  statusEl.textContent = statusLine();
  loadTextures(textures);
  if (fitPending) {
    fitPending = false;
    fitAndCenter();
  } else {
    draw();
  }
}

const host = connectHost((message) => {
  switch (message.type) {
    case "loading":
      statusEl.textContent = `Laying out ${message.file}…`;
      return;
    case "layout":
      onLayout(message.result, message.textures, message.file);
      return;
    case "error":
      statusEl.textContent = `Error: ${message.message}`;
      return;
  }
});

// ---- camera interactions --------------------------------------------------

stage.addEventListener("pointerdown", (ev) => {
  // Middle mouse drags the camera; left-button gestures belong to selection
  // and editing, which land in G3.2/G3.3.
  if (ev.button !== 1) return;
  ev.preventDefault();
  panning = true;
  panFrom = { x: ev.clientX, y: ev.clientY, panX, panY };
  stage.setPointerCapture(ev.pointerId);
  stage.style.cursor = "move";
});
stage.addEventListener("pointermove", (ev) => {
  if (!panning) return;
  panX = panFrom.panX + (ev.clientX - panFrom.x);
  panY = panFrom.panY + (ev.clientY - panFrom.y);
  draw();
});
stage.addEventListener("pointerup", (ev) => {
  if (ev.button !== 1 || !panning) return;
  panning = false;
  stage.releasePointerCapture(ev.pointerId);
  stage.style.cursor = "default";
});
stage.addEventListener("auxclick", (ev) => {
  if (ev.button === 1) ev.preventDefault();
});
stage.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomToPoint(ev.clientX - rect.left, ev.clientY - rect.top, zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15));
  },
  { passive: false }
);

// ---- toolbar ---------------------------------------------------------------

document.getElementById("zoomIn")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom * 1.25);
});
document.getElementById("zoomOut")!.addEventListener("click", () => {
  zoomToPoint(stage.clientWidth / 2, stage.clientHeight / 2, zoom / 1.25);
});
document.getElementById("zoomFit")!.addEventListener("click", fitAndCenter);
document.getElementById("refresh")!.addEventListener("click", () => host.send({ type: "requestLayout" }));
outlinesEl.addEventListener("change", draw);
window.addEventListener("resize", draw);

host.send({ type: "ready" });
