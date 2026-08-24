/**
 * DDS preview: a read-only custom editor for *.dds so clicking a texture shows
 * the image instead of VS Code's "binary or unsupported encoding" notice.
 * Decoding runs in the extension host with the same pure-TS decoder the hover
 * previews use (DXT1/3/5, BC7, uncompressed); the webview only displays.
 *
 * The chrome is px-ui (webviews/shared/ui.css): top bar with the file's facts
 * and clipboard/export actions, viewer tools floating bottom-left like the GUI
 * editor's stage tools.
 */
import * as vscode from "vscode";
import { decodeDds, ddsFormatInfo, encodePng } from "@px-lsp/server/dds";
import { makeNonce } from "./webviews/nonce";
import uiCss from "./webviews/shared/ui.css";
import { icon } from "./webviews/shared/icons";

class DdsDocument implements vscode.CustomDocument {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly bytes: Uint8Array
  ) {}
  dispose(): void {
    /* nothing to release */
  }
}

export class DdsPreviewProvider implements vscode.CustomReadonlyEditorProvider<DdsDocument> {
  static readonly viewType = "px.ddsPreview";
  private static readonly promptKey = "px.ddsPreviewPromptShown";

  constructor(private readonly context: vscode.ExtensionContext) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      DdsPreviewProvider.viewType,
      new DdsPreviewProvider(context),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }
    );
  }

  /**
   * One-time choice on the very first .dds open: keep this preview as the
   * default editor for .dds, or hand the extension back to VS Code's default
   * (via workbench.editorAssociations, which the user can change any time).
   */
  private async maybePromptForDefault(): Promise<void> {
    if (this.context.globalState.get<boolean>(DdsPreviewProvider.promptKey)) return;
    await this.context.globalState.update(DdsPreviewProvider.promptKey, true);
    const keep = "Keep DDS preview";
    const builtin = "Use VS Code default";
    const answer = await vscode.window.showInformationMessage(
      "The Paradox Modding Toolkit now previews .dds textures. Keep it as the default editor for .dds files?",
      keep,
      builtin
    );
    if (answer === builtin) {
      const config = vscode.workspace.getConfiguration();
      const assoc = { ...(config.get<Record<string, string>>("workbench.editorAssociations") ?? {}) };
      assoc["*.dds"] = "default";
      await config.update("workbench.editorAssociations", assoc, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        "Paradox Modding Toolkit: .dds files will use the VS Code default editor. Right-click a .dds → 'Open With…' to preview one anyway, or edit workbench.editorAssociations to undo."
      );
    }
  }

  async openCustomDocument(uri: vscode.Uri): Promise<DdsDocument> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new DdsDocument(uri, bytes);
  }

  async resolveCustomEditor(document: DdsDocument, panel: vscode.WebviewPanel): Promise<void> {
    void this.maybePromptForDefault();
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    const name = document.uri.path.split("/").pop() ?? "texture.dds";
    const nonce = makeNonce();
    const info = ddsFormatInfo(document.bytes);
    let png: Uint8Array | null = null;
    let dataUri: string | null = null;
    let error: string | null = null;
    let meta = "";
    if (!info) {
      error = "Not a DDS file (bad magic).";
    } else {
      meta = `${info.width}×${info.height} · ${info.format} · ${formatBytes(document.bytes.length)}`;
      try {
        const img = decodeDds(document.bytes);
        png = encodePng(img.width, img.height, img.pixels);
        dataUri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
      } catch (err) {
        error = `Preview failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    panel.webview.html = pageHtml({ name, meta, dataUri, error, nonce });

    const messages = panel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      switch (msg?.type) {
        case "copyPath":
          await vscode.env.clipboard.writeText(document.uri.fsPath);
          break;
        case "copyName":
          await vscode.env.clipboard.writeText(name);
          break;
        case "reveal":
          await vscode.commands.executeCommand("revealFileInOS", document.uri);
          break;
        case "savePng": {
          if (!png) return;
          const target = await vscode.window.showSaveDialog({
            defaultUri: document.uri.with({ path: document.uri.path.replace(/\.dds$/i, ".png") }),
            filters: { "PNG image": ["png"] },
          });
          if (target) await vscode.workspace.fs.writeFile(target, png);
          break;
        }
      }
    });
    panel.onDidDispose(() => messages.dispose());
  }
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

function pageHtml(opts: {
  name: string;
  meta: string;
  dataUri: string | null;
  error: string | null;
  nonce: string;
}): string {
  const { name, meta, dataUri, error, nonce } = opts;
  const barButton = (id: string, name_: Parameters<typeof icon>[0], label: string, tip: string): string =>
    `<button id="${id}" class="px-btn" data-variant="ghost" data-size="sm" data-tip="${tip}" data-tip-wrap>${icon(name_)}${label}</button>`;
  const toolButton = (id: string, name_: Parameters<typeof icon>[0], tip: string): string =>
    `<button id="${id}" class="px-btn" data-variant="ghost" data-size="icon-sm" data-tip="${tip}" data-tip-side="right" data-tip-wrap>${icon(name_)}</button>`;

  const stage = error
    ? `<div class="err">${escapeHtml(error)}</div>`
    : /* html */ `
  <img id="img" src="${dataUri}" />
  <div id="stageTools">
    ${toolButton("zout", "zoomOut", "Zoom out")}
    <span id="zoomLabel" class="px-muted px-xs" data-tip="Wheel zooms, drag pans" data-tip-side="right" data-tip-wrap>100%</span>
    ${toolButton("zin", "zoomIn", "Zoom in")}
    <div class="px-separator" data-orientation="vertical"></div>
    ${toolButton("zfit", "maximize", "Fit the image to the window")}
    ${toolButton("recenter", "locate", "Recenter at the current zoom")}
    <div class="px-separator" data-orientation="vertical"></div>
    <label class="px-toggle" data-size="sm" data-tip="Pixelated: nearest-neighbour scaling to inspect single pixels. Off matches how the game samples the texture (smooth)" data-tip-side="right" data-tip-wrap><input id="pix" type="checkbox" />${icon("grid")}</label>
  </div>`;

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
  #fileName { font-weight: 600; max-width: 260px; }
  #meta { color: var(--px-muted-fg); font-size: var(--px-text-sm); white-space: nowrap; }
  /* A checkbox inside a toggle: hidden, its state shown on the label (the px-switch pattern). */
  .px-toggle > input[type="checkbox"] { position: absolute; opacity: 0; width: 0; height: 0; }
  .px-toggle:has(> input:checked) { background: var(--px-muted); }
  .px-toggle:has(> input:focus-visible) { border-color: var(--px-ring); box-shadow: 0 0 0 3px var(--px-ring-soft); }
  /* Panning moves the image outside the stage, so clip rather than scroll. */
  #stage { flex: 1 1 auto; position: relative; overflow: hidden; background: #101010; }
  #stage.panning { cursor: grabbing; }
  #img {
    position: absolute; top: 0; left: 0; transform-origin: 0 0;
    image-rendering: auto; cursor: grab;
    /* checkerboard so alpha is visible */
    background: repeating-conic-gradient(rgba(128,128,128,0.25) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
  }
  #img.pixelated { image-rendering: pixelated; }
  #stageTools {
    position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 2px;
    padding: 2px; border-radius: var(--px-radius);
    background: color-mix(in oklch, var(--px-bg) 75%, transparent);
  }
  #zoomLabel { min-width: 44px; height: var(--px-h-sm); line-height: var(--px-h-sm); padding: 0 6px; text-align: center; font-variant-numeric: tabular-nums; cursor: default; }
  .err { padding: 24px; color: var(--px-destructive); }
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <span id="fileName" class="px-truncate">${escapeHtml(name)}</span>
    ${meta ? `<span id="meta">${escapeHtml(meta)}</span>` : ""}
    <span class="px-grow"></span>
    ${barButton("copyName", "copy", "Copy name", "Copy the file name to the clipboard")}
    ${barButton("copyPath", "copy", "Copy path", "Copy the full path to the clipboard")}
    ${barButton("reveal", "folderOpen", "Reveal", "Show the file in the system file explorer")}
    ${dataUri ? barButton("savePng", "imageDown", "Save PNG", "Decode the texture and save it as a .png") : ""}
  </div>
  <div id="stage">${stage}</div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  for (const id of ["copyName", "copyPath", "reveal", "savePng"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => vscode.postMessage({ type: id }));
  }

  const stage = document.getElementById("stage");
  const img = document.getElementById("img");
  if (img) {
    // Zoom clamps: 5% to 3200%.
    const MIN = 0.05, MAX = 32;
    let scale = 1, tx = 0, ty = 0;
    const zoomLabel = document.getElementById("zoomLabel");

    function apply() {
      img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
      zoomLabel.textContent = Math.round(scale * 100) + "%";
    }
    function fitScale() {
      return Math.min(1, stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
    }
    function center(s) {
      scale = Math.max(MIN, Math.min(MAX, s));
      tx = (stage.clientWidth - img.naturalWidth * scale) / 2;
      ty = (stage.clientHeight - img.naturalHeight * scale) / 2;
      apply();
    }
    // Zoom about a stage-relative point, keeping the image pixel under it fixed.
    function zoomAt(cx, cy, factor) {
      const next = Math.max(MIN, Math.min(MAX, scale * factor));
      const ix = (cx - tx) / scale, iy = (cy - ty) / scale;
      scale = next;
      tx = cx - ix * scale;
      ty = cy - iy * scale;
      apply();
    }

    img.addEventListener("load", () => center(fitScale() > 0 ? fitScale() : 1));
    if (img.complete && img.naturalWidth > 0) center(fitScale() > 0 ? fitScale() : 1);

    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    // Left- or middle-button drag pans; preventDefault suppresses image drag / autoscroll.
    let panX = 0, panY = 0, panning = false;
    stage.addEventListener("mousedown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      panning = true; panX = e.clientX; panY = e.clientY;
      stage.classList.add("panning");
    });
    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      tx += e.clientX - panX; ty += e.clientY - panY;
      panX = e.clientX; panY = e.clientY;
      apply();
    });
    window.addEventListener("mouseup", () => {
      if (!panning) return;
      panning = false; stage.classList.remove("panning");
    });
    stage.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    img.addEventListener("dragstart", (e) => e.preventDefault());

    const cx = () => stage.clientWidth / 2, cy = () => stage.clientHeight / 2;
    document.getElementById("zin").addEventListener("click", () => zoomAt(cx(), cy(), 1.25));
    document.getElementById("zout").addEventListener("click", () => zoomAt(cx(), cy(), 1 / 1.25));
    document.getElementById("zfit").addEventListener("click", () => center(fitScale()));
    document.getElementById("recenter").addEventListener("click", () => center(scale));
    document.getElementById("pix").addEventListener("change", (e) => img.classList.toggle("pixelated", e.target.checked));
  }
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
