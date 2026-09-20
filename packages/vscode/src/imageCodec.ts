import * as vscode from "vscode";
import { decodeDds, encodeDds, encodePng, hasTransparency, type DdsEncodeFormat } from "@px-lsp/server/dds";
import { makeNonce } from "./webviews/nonce";

export const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
export type ImageFormat = "png" | "jpeg" | "webp" | "dds";
export interface ImagePixels {
  width: number;
  height: number;
  rgba: Uint8Array;
}
export interface ImageEncoding {
  format: ImageFormat;
  dds: DdsEncodeFormat | "auto";
  background: "white" | "black";
}

/** Native DDS/PNG codecs and Chromium's image codecs share one batch lifetime. */
export class ImageCodec {
  private panel?: vscode.WebviewPanel;
  private sequence = 0;
  private ready?: Promise<void>;
  private waiters = new Map<string, { resolve: (value: Reply) => void; reject: (error: Error) => void }>();

  async decode(bytes: Uint8Array, ext: string, token?: vscode.CancellationToken): Promise<ImagePixels> {
    if (ext === ".dds") {
      const image = decodeDds(bytes);
      return { width: image.width, height: image.height, rgba: image.pixels };
    }
    const mime = IMAGE_MIME[ext];
    if (!mime) throw new Error(`Unsupported image extension: ${ext}`);
    const reply = await this.request(
      { type: "decode", dataUri: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` },
      token
    );
    const rgba = Buffer.from(reply.data, "base64");
    if (
      !Number.isSafeInteger(reply.width) ||
      !Number.isSafeInteger(reply.height) ||
      reply.width <= 0 ||
      reply.height <= 0 ||
      rgba.length !== reply.width * reply.height * 4
    )
      throw new Error("Invalid decoded image dimensions");
    return { width: reply.width, height: reply.height, rgba };
  }

  async encode(
    image: ImagePixels,
    options: ImageEncoding,
    token?: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const { width, height, rgba } = image;
    if (options.format === "dds")
      return encodeDds(
        width,
        height,
        rgba,
        options.dds === "auto" ? (hasTransparency(rgba) ? "bc3" : "bc1") : options.dds
      );
    const png = encodePng(width, height, rgba);
    if (options.format === "png") return png;
    const reply = await this.request(
      {
        type: "encode",
        dataUri: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        format: options.format,
        background: options.background,
      },
      token
    );
    return Buffer.from(reply.data, "base64");
  }

  private ensurePanel(): void {
    if (this.panel) return;
    const panel = vscode.window.createWebviewPanel(
      "px.imageConverter",
      "PX Toolkit Image Converter",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
    );
    this.panel = panel;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Image converter did not start")), 30_000);
      panel.webview.onDidReceiveMessage((message: Reply & { type: string; id: string; message?: string }) => {
        if (message.type === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        const waiter = this.waiters.get(message.id);
        if (!waiter) return;
        if (message.type === "result" && typeof message.data === "string") waiter.resolve(message);
        else waiter.reject(new Error(message.message ?? "Image conversion failed"));
      });
      panel.onDidDispose(() => {
        clearTimeout(timer);
        const error = new Error("Image converter closed");
        reject(error);
        for (const waiter of this.waiters.values()) waiter.reject(error);
        this.waiters.clear();
        this.panel = undefined;
        this.ready = undefined;
      });
    });
    panel.webview.html = codecHtml();
  }

  private async request(message: Record<string, unknown>, token?: vscode.CancellationToken): Promise<Reply> {
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    this.ensurePanel();
    const panel = this.panel!;
    const id = String(++this.sequence);
    return new Promise<Reply>((resolve, reject) => {
      const finish = (error?: Error, result?: Reply) => {
        clearTimeout(timer);
        cancellation?.dispose();
        this.waiters.delete(id);
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(() => finish(new Error("Image conversion timed out")), 30_000);
      this.waiters.set(id, {
        resolve: (result) => finish(undefined, result),
        reject: (error) => finish(error),
      });
      const cancellation = token?.onCancellationRequested(() => finish(new vscode.CancellationError()));
      void this.ready!.then(async () => {
        if (!this.waiters.has(id)) return;
        if (!(await panel.webview.postMessage({ ...message, id })))
          finish(new Error("Image converter is unavailable"));
      }).catch((error: Error) => finish(error));
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

interface Reply {
  width: number;
  height: number;
  data: string;
}

export function codecHtml(): string {
  const nonce = makeNonce();
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
<style>body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 16px; }</style>
</head><body><p>Converting images. Progress and cancellation are available in the notification.</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
window.addEventListener("message", ({data: msg}) => {
  if (!msg || !["decode", "encode"].includes(msg.type)) return;
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (msg.type === "encode" && msg.format === "jpeg") {
        ctx.fillStyle = msg.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      let data;
      if (msg.type === "decode") {
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let binary = "";
        for (let i = 0; i < pixels.length; i += 0x8000) binary += String.fromCharCode.apply(null, pixels.subarray(i, i + 0x8000));
        data = btoa(binary);
      } else {
        const mime = "image/" + msg.format;
        const url = canvas.toDataURL(mime, 0.92);
        if (!url.startsWith("data:" + mime + ";base64,")) throw new Error("Unsupported output format: " + msg.format);
        data = url.split(",")[1];
      }
      vscode.postMessage({ type: "result", id: msg.id, width: canvas.width, height: canvas.height, data });
    } catch (error) { vscode.postMessage({ type: "fail", id: msg.id, message: String(error.message || error) }); }
  };
  img.onerror = () => vscode.postMessage({ type: "fail", id: msg.id, message: "Unsupported or corrupt image" });
  img.src = msg.dataUri;
});
vscode.postMessage({ type: "ready" });
</script></body></html>`;
}
