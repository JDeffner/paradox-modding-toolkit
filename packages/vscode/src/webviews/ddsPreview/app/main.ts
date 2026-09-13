import { viewerBackground } from "../../shared/viewerBackground";
import { installTips } from "../../shared/tips";
import type { AppToHost, HostToApp } from "../messages";

declare function acquireVsCodeApi(): { postMessage(message: AppToHost): void };
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
installTips();
const vscode = acquireVsCodeApi();
for (const id of ["copyPath", "reveal", "savePng"] as const) {
  const el = $(id);
  if (el) el.addEventListener("click", () => vscode.postMessage({ type: id }));
}
const copyToast = $("copyToast");
let toastTimer = 0;
$("fileName").addEventListener("click", () => {
  vscode.postMessage({ type: "copyName" });
  copyToast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => copyToast.classList.remove("show"), 1200);
});

const stage = $("stage");
const img = $<HTMLImageElement>("img");
const background = viewerBackground(
  stage,
  $("stageTools"),
  (value) => {
    vscode.postMessage({ type: "background", value });
  },
  { image: img, defaultLabel: "Checkerboard", commitOnClose: true }
);
window.addEventListener("message", (event: MessageEvent<HostToApp>) => {
  if (event.data.type === "background") background.restore(event.data.value);
});
vscode.postMessage({ type: "ready" });
if (img) {
  // Zoom clamps: 5% to 3200%.
  const MIN = 0.05,
    MAX = 32;
  let scale = 1,
    tx = 0,
    ty = 0;
  const zoomLabel = $("zoomLabel");

  function apply() {
    img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
    zoomLabel.textContent = Math.round(scale * 100) + "%";
  }
  function fitScale() {
    return Math.min(1, stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
  }
  function center(s: number) {
    scale = Math.max(MIN, Math.min(MAX, s));
    tx = (stage.clientWidth - img.naturalWidth * scale) / 2;
    ty = (stage.clientHeight - img.naturalHeight * scale) / 2;
    apply();
  }
  // Zoom about a stage-relative point, keeping the image pixel under it fixed.
  function zoomAt(cx: number, cy: number, factor: number) {
    const next = Math.max(MIN, Math.min(MAX, scale * factor));
    const ix = (cx - tx) / scale,
      iy = (cy - ty) / scale;
    scale = next;
    tx = cx - ix * scale;
    ty = cy - iy * scale;
    apply();
  }

  const fit = () => center(fitScale() > 0 ? fitScale() : 1);
  img.addEventListener("load", fit);
  if (img.complete && img.naturalWidth > 0) fit();

  // The webview often lays out at a provisional size before the editor pane
  // settles, so a load-time fit is wrong minutes later. Keep the image
  // fitted on every stage resize until the user zooms or pans themselves.
  let touched = false;
  new ResizeObserver(() => {
    if (!touched) fit();
  }).observe(stage);

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      touched = true;
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    { passive: false }
  );

  // Left- or middle-button drag pans; preventDefault suppresses image drag / autoscroll.
  let panX = 0,
    panY = 0,
    panning = false;
  stage.addEventListener("mousedown", (e) => {
    // Clicks on the floating tools interact with them, never pan.
    if (e.target instanceof Element && e.target.closest("#stageTools")) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    touched = true;
    panning = true;
    panX = e.clientX;
    panY = e.clientY;
    stage.classList.add("panning");
  });
  window.addEventListener("mousemove", (e) => {
    if (!panning) return;
    tx += e.clientX - panX;
    ty += e.clientY - panY;
    panX = e.clientX;
    panY = e.clientY;
    apply();
  });
  window.addEventListener("mouseup", () => {
    if (!panning) return;
    panning = false;
    stage.classList.remove("panning");
  });
  stage.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  img.addEventListener("dragstart", (e) => e.preventDefault());

  const cx = () => stage.clientWidth / 2,
    cy = () => stage.clientHeight / 2;
  $("zin").addEventListener("click", () => {
    touched = true;
    zoomAt(cx(), cy(), 1.25);
  });
  $("zout").addEventListener("click", () => {
    touched = true;
    zoomAt(cx(), cy(), 1 / 1.25);
  });
  // Fit re-arms the auto-fit: the view should stay fitted through resizes again.
  $("zfit").addEventListener("click", () => {
    touched = false;
    fit();
  });
  $("recenter").addEventListener("click", () => {
    touched = true;
    center(scale);
  });
  $("pix").addEventListener("change", (e) =>
    img.classList.toggle("pixelated", (e.target as HTMLInputElement).checked)
  );
}
