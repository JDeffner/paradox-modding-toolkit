/**
 * DDS preview: a read-only custom editor for *.dds so clicking a texture shows
 * the image instead of VS Code's "binary or unsupported encoding" notice.
 * Decoding runs in the extension host with the same pure-TS decoder the hover
 * previews use (DXT1/3/5, BC7, uncompressed); the webview only displays.
 */
import * as vscode from "vscode";
import { decodeDds, ddsFormatInfo, encodePng } from "@px-lsp/server/dds";
import { makeNonce } from "./webviews/nonce";

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
    let body: string;
    if (!info) {
      body = errorHtml(`${name} is not a DDS file (bad magic).`);
    } else {
      try {
        const img = decodeDds(document.bytes);
        const png = encodePng(img.width, img.height, img.pixels);
        const dataUri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
        const kb = (document.bytes.length / 1024).toFixed(1);
        body = imageHtml(dataUri, `${name} · ${info.format} · ${img.width}×${img.height} · ${kb} KB`, nonce);
      } catch (err) {
        body = errorHtml(
          `${name}: ${info.format} ${info.width}×${info.height} — preview failed: ` +
            (err instanceof Error ? err.message : String(err))
        );
      }
    }
    panel.webview.html = wrapHtml(body, nonce);
  }
}

function wrapHtml(body: string, nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  body { display: flex; flex-direction: column; }
  #bar {
    flex: 0 0 auto; display: flex; gap: 10px; align-items: center;
    padding: 5px 10px; font-size: 0.9em;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
  }
  #bar button {
    padding: 1px 8px; cursor: pointer; border-radius: 2px;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));
  }
  /* Panning moves the image outside the stage, so clip rather than scroll. */
  #stage { flex: 1 1 auto; position: relative; overflow: hidden; }
  #stage.panning { cursor: grabbing; }
  #img {
    position: absolute; top: 0; left: 0; transform-origin: 0 0;
    image-rendering: auto;
    /* checkerboard so alpha is visible */
    background: repeating-conic-gradient(rgba(128,128,128,0.25) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
  }
  #img.pixelated { image-rendering: pixelated; }
  .err { padding: 24px; color: var(--vscode-editorError-foreground, #f14c4c); }
</style>
</head>
<body>${body}</body>
</html>`;
}

function imageHtml(dataUri: string, caption: string, nonce: string): string {
  return /* html */ `
<div id="bar">
  <span>${escapeHtml(caption)}</span>
  <button id="zin">+</button><button id="zout">−</button><button id="zfit">Fit</button><button id="z100">1:1</button>
  <label><input type="checkbox" id="pix" checked /> pixelated</label>
</div>
<div id="stage"><img id="img" class="pixelated" src="${dataUri}" /></div>
<script nonce="${nonce}">
  const stage = document.getElementById("stage");
  const img = document.getElementById("img");
  // Zoom clamps: 5% to 3200%.
  const MIN = 0.05, MAX = 32;
  let scale = 1, tx = 0, ty = 0;

  function apply() { img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")"; }
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

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  // Middle-button drag pans freely; preventDefault suppresses autoscroll.
  let panX = 0, panY = 0, panning = false;
  stage.addEventListener("mousedown", (e) => {
    if (e.button !== 1) return;
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
  window.addEventListener("mouseup", (e) => {
    if (e.button !== 1 || !panning) return;
    panning = false; stage.classList.remove("panning");
  });
  stage.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });

  const cx = () => stage.clientWidth / 2, cy = () => stage.clientHeight / 2;
  document.getElementById("zin").addEventListener("click", () => zoomAt(cx(), cy(), 1.25));
  document.getElementById("zout").addEventListener("click", () => zoomAt(cx(), cy(), 1 / 1.25));
  document.getElementById("z100").addEventListener("click", () => center(1));
  document.getElementById("zfit").addEventListener("click", () => center(fitScale()));
  document.getElementById("pix").addEventListener("change", (e) => img.classList.toggle("pixelated", e.target.checked));
</script>`;
}

function errorHtml(message: string): string {
  return `<div class="err">${escapeHtml(message)}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
