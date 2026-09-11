import uiCss from "../shared/ui.css";
import { icon } from "../shared/icons";
import { TEXTURE_CHECKER_SIZE, texturePreviewColors } from "@px-lsp/protocol/texturePreview";

export function ddsPreviewHtml(opts: {
  name: string;
  meta: string;
  dataUri: string | null;
  error: string | null;
  nonce: string;
  scriptSrc: string;
}): string {
  const { name, meta, dataUri, error, nonce, scriptSrc } = opts;
  const checker = texturePreviewColors("checkerboard");
  const barButton = (id: string, name_: Parameters<typeof icon>[0], label: string, tip: string): string =>
    `<button id="${id}" class="px-btn" data-variant="ghost" data-size="sm" data-tip="${tip}" data-tip-wrap>${icon(name_)}${label}</button>`;
  const toolButton = (id: string, name_: Parameters<typeof icon>[0], tip: string): string =>
    `<button id="${id}" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="${tip}" data-tip-side="top" data-tip-wrap>${icon(name_)}</button>`;

  const stageInfo = meta ? `<div id="stageInfo">${escapeHtml(meta)}</div>` : "";
  const stage = error
    ? `<div class="err">${escapeHtml(error)}</div><div id="stageTools"></div>${stageInfo}`
    : /* html */ `
  <img id="img" src="${dataUri}" />
  <div id="stageTools">
    ${toolButton("zout", "zoomOut", "Zoom out")}
    <span id="zoomLabel" class="px-muted px-xs" data-tip="Wheel zooms, drag pans" data-tip-side="top" data-tip-wrap>100%</span>
    ${toolButton("zin", "zoomIn", "Zoom in")}
    <div class="px-separator" data-orientation="vertical"></div>
    ${toolButton("zfit", "maximize", "Fit the image to the window")}
    ${toolButton("recenter", "locate", "Recenter at the current zoom")}
    <div class="px-separator" data-orientation="vertical"></div>
    <label class="px-toggle" data-size="sm" data-tip="Pixelated: nearest-neighbour scaling to inspect single pixels. Off matches how the game samples the texture (smooth)" data-tip-side="top" data-tip-wrap><input id="pix" type="checkbox" />${icon("grid")}</label>
  </div>
  ${stageInfo}`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
<title>DDS Preview</title>
<style>
${uiCss}
  body { overflow: hidden; }
  #app { display: flex; flex-direction: column; height: 100vh; }
  #bar {
    display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
    padding: 6px 8px; border-bottom: 1px solid var(--px-border);
  }
  #bar .px-separator { height: 20px; align-self: center; }
  /* The name has its own padding-free text edge; the buttons carry inner padding.
     Extra margin around this divider keeps the visual gaps equal. */
  #fileNameWrap + .px-separator { margin: 0 4px; }
  #fileNameWrap { position: relative; display: flex; min-width: 0; }
  #fileName { font-weight: 600; max-width: 260px; cursor: pointer; }
  #copyToast {
    position: absolute; left: 50%; top: calc(100% + 6px); transform: translateX(-50%);
    padding: 3px 8px; border-radius: var(--px-radius-md); z-index: 61;
    font-size: var(--px-text-xs); color: var(--px-bg); background: var(--px-fg);
    opacity: 0; transition: opacity var(--px-ease); pointer-events: none; white-space: nowrap;
  }
  #copyToast.show { opacity: 1; }
  /* The toast owns the spot below the name; mute the hover tooltip while it shows. */
  #fileNameWrap:has(> #copyToast.show)::after { opacity: 0 !important; }
  /* A checkbox inside a toggle: hidden, its state shown on the label (the px-switch pattern). */
  .px-toggle > input[type="checkbox"] { position: absolute; opacity: 0; width: 0; height: 0; }
  .px-toggle:has(> input:checked) { background: var(--px-muted); }
  .px-toggle:has(> input:focus-visible) { border-color: var(--px-ring); box-shadow: 0 0 0 3px var(--px-ring-soft); }
  /* Panning moves the image outside the stage, so clip rather than scroll. */
  #stage { flex: 1 1 auto; position: relative; overflow: hidden; background: #101010; }
  #stage.panning, #stage.panning #img { cursor: grabbing; }
  #img {
    position: absolute; top: 0; left: 0; transform-origin: 0 0;
    image-rendering: auto; cursor: grab;
    /* checkerboard so alpha is visible */
    background: repeating-conic-gradient(${checker[0]} 0% 25%, ${checker[1]} 0% 50%) 0 0 / ${TEXTURE_CHECKER_SIZE * 2}px ${TEXTURE_CHECKER_SIZE * 2}px;
  }
  #img.pixelated { image-rendering: pixelated; }
  #stageTools {
    position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 2px;
    padding: 2px; border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #zoomLabel { min-width: 44px; height: var(--px-h-sm); line-height: var(--px-h-sm); padding: 0 6px; text-align: center; font-variant-numeric: tabular-nums; cursor: default; }
  #stageInfo {
    position: absolute; right: 8px; bottom: 8px;
    padding: 4px 10px; border-radius: var(--px-radius);
    color: var(--px-muted-fg); font-size: var(--px-text-xs); font-variant-numeric: tabular-nums;
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
    pointer-events: none;
  }
  .err { padding: 24px; color: var(--px-destructive); }
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <span id="fileNameWrap" data-tip="Click to copy the file name"><span id="fileName" class="px-truncate">${escapeHtml(name)}</span><span id="copyToast">Copied!</span></span>
    <div class="px-separator" data-orientation="vertical"></div>
    ${barButton("copyPath", "copy", "Copy path", "Copy the path from the gfx/ root, as script references it")}
    ${barButton("reveal", "folderOpen", "Reveal", "Show the file in the system file explorer")}
    ${dataUri ? barButton("savePng", "imageDown", "Save PNG", "Decode the texture and save it as a .png") : ""}
  </div>
  <div id="stage">${stage}</div>
</div>
<script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
