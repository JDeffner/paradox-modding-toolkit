/**
 * Image → DDS conversion (Paradox: Convert Image to DDS).
 *
 * Decoding: a webview canvas — Chromium decodes PNG/JPEG/WebP natively, so no
 * image-codec dependencies; pixels come back over postMessage. Encoding: the
 * pure-TS DDS encoder (BC1/BC3 range-fit or uncompressed A8R8G8B8), written
 * next to the source as <name>.dds. Format "auto" picks BC3 when the image
 * has transparency, BC1 otherwise.
 */
import * as vscode from "vscode";
import { encodeDds, hasTransparency, type DdsEncodeFormat } from "@px-lsp/server/dds";
import { makeNonce } from "./webviews/nonce";

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface DecodedPixels {
  width: number;
  height: number;
  rgba: Buffer;
}

export async function convertToDdsCommand(arg?: vscode.Uri, multi?: vscode.Uri[]): Promise<void> {
  let files = (multi ?? (arg ? [arg] : [])).filter((u) => extOf(u) in EXT_MIME);
  if (files.length === 0) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { Images: ["png", "jpg", "jpeg", "webp"] },
      title: "Select images to convert to DDS",
    });
    if (!picked || picked.length === 0) return;
    files = picked.filter((u) => extOf(u) in EXT_MIME);
  }
  if (files.length === 0) return;

  const formatPick = await vscode.window.showQuickPick(
    [
      {
        label: "Auto",
        description: "BC3 (DXT5) when the image has transparency, BC1 (DXT1) otherwise — recommended",
        format: "auto" as const,
      },
      { label: "BC1 / DXT1", description: "Compressed, no alpha — smallest", format: "bc1" as const },
      { label: "BC3 / DXT5", description: "Compressed with smooth alpha", format: "bc3" as const },
      {
        label: "Uncompressed (A8R8G8B8)",
        description: "Lossless, 4 bytes per pixel — best for small GUI elements with crisp edges",
        format: "bgra8" as const,
      },
    ],
    { title: "DDS format" }
  );
  if (!formatPick) return;

  const decoder = new WebviewDecoder();
  const written: vscode.Uri[] = [];
  const failed: string[] = [];
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Converting to DDS", cancellable: false },
      async (progress) => {
        for (const file of files) {
          const name = file.path.split("/").pop() ?? "image";
          progress.report({ message: name });
          try {
            const bytes = await vscode.workspace.fs.readFile(file);
            const decoded = await decoder.decode(
              name,
              `data:${EXT_MIME[extOf(file)]};base64,${Buffer.from(bytes).toString("base64")}`
            );
            const format: DdsEncodeFormat =
              formatPick.format === "auto"
                ? hasTransparency(decoded.rgba)
                  ? "bc3"
                  : "bc1"
                : formatPick.format;
            const target = file.with({ path: file.path.replace(/\.[^.]+$/, ".dds") });
            if (await exists(target)) {
              const answer = await vscode.window.showWarningMessage(
                `${target.path.split("/").pop()} already exists. Overwrite?`,
                { modal: true },
                "Overwrite"
              );
              if (answer !== "Overwrite") continue;
            }
            const dds = encodeDds(decoded.width, decoded.height, decoded.rgba, format);
            await vscode.workspace.fs.writeFile(target, dds);
            written.push(target);
          } catch (err) {
            failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    );
  } finally {
    decoder.dispose();
  }

  if (failed.length > 0) {
    void vscode.window.showErrorMessage(
      `Paradox Modding Toolkit: DDS conversion failed for ${failed.join("; ")}`
    );
  }
  if (written.length > 0) {
    const openLabel = "Open preview";
    const guideLabel = "Image guidelines";
    const answer = await vscode.window.showInformationMessage(
      `Paradox Modding Toolkit: wrote ${written.length} DDS file${written.length === 1 ? "" : "s"} (${written
        .map((u) => u.path.split("/").pop())
        .join(", ")})`,
      openLabel,
      guideLabel
    );
    if (answer === openLabel) {
      await vscode.commands.executeCommand("vscode.openWith", written[0], "px.ddsPreview");
    } else if (answer === guideLabel) {
      await vscode.commands.executeCommand("px.imageGuidelines");
    }
  }
}

function extOf(uri: vscode.Uri): string {
  const m = /\.[^.\\/]+$/.exec(uri.path.toLowerCase());
  return m ? m[0] : "";
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * A hidden-ish webview whose only job is Image → canvas → getImageData.
 * Created on first use, disposed after the batch.
 */
class WebviewDecoder {
  private panel: vscode.WebviewPanel | null = null;
  private waiters = new Map<string, { resolve: (p: DecodedPixels) => void; reject: (e: Error) => void }>();

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      "px.ddsConvert",
      "Paradox DDS Converter",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] }
    );
    panel.webview.html = decoderHtml();
    panel.webview.onDidReceiveMessage(
      (msg: {
        type: string;
        id: string;
        width?: number;
        height?: number;
        data?: string;
        message?: string;
      }) => {
        const waiter = this.waiters.get(msg.id);
        if (!waiter) return;
        this.waiters.delete(msg.id);
        if (msg.type === "pixels" && msg.data !== undefined) {
          waiter.resolve({ width: msg.width!, height: msg.height!, rgba: Buffer.from(msg.data, "base64") });
        } else {
          waiter.reject(new Error(msg.message ?? "decode failed"));
        }
      }
    );
    panel.onDidDispose(() => {
      this.panel = null;
      for (const w of this.waiters.values()) w.reject(new Error("converter closed"));
      this.waiters.clear();
    });
    this.panel = panel;
    return panel;
  }

  decode(id: string, dataUri: string): Promise<DecodedPixels> {
    const panel = this.ensurePanel();
    return new Promise<DecodedPixels>((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiters.delete(id)) reject(new Error("decode timeout"));
      }, 30_000);
      void panel.webview.postMessage({ type: "decode", id, dataUri });
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }
}

function decoderHtml(): string {
  const nonce = makeNonce();
  return /* html */ `<!DOCTYPE html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
<style>body { font-family: sans-serif; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 16px; }</style>
</head><body>
<p>Decoding images…</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
window.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "decode") return;
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < data.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, data.subarray(i, Math.min(i + CHUNK, data.length)));
      }
      vscode.postMessage({ type: "pixels", id: msg.id, width: canvas.width, height: canvas.height, data: btoa(bin) });
    } catch (e) {
      vscode.postMessage({ type: "fail", id: msg.id, message: String(e && e.message || e) });
    }
  };
  img.onerror = () => vscode.postMessage({ type: "fail", id: msg.id, message: "image failed to load (unsupported or corrupt)" });
  img.src = msg.dataUri;
});
</script>
</body></html>`;
}
