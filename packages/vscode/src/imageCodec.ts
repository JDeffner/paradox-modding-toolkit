import * as vscode from "vscode";
import {
  decodeDds,
  ddsFormatInfo,
  ddsMipLevels,
  encodeDds,
  encodePng,
  hasTransparency,
  type DdsEncodeFormat,
} from "@px-lsp/server/dds";
import { makeNonce } from "./webviews/nonce";
import { PNG } from "pngjs";
import { MAX_DECODE_PIXELS } from "@px-lsp/server/dds/decoder";

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
  /** Full chain or an explicit count, including the base image. Channels are filtered independently. */
  mipmaps?: boolean | number;
  referenceSize?: { width: number; height: number };
}

/** The converter writes one 2D image. Preview decoders may still show the first surface. */
function requireSingleImageDds(bytes: Uint8Array): void {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128 || header.getUint32(0, true) !== 0x20534444 || header.getUint32(4, true) !== 124)
    throw new Error("Not a valid DDS file");
  let multiple = (header.getUint32(112, true) & (0x200000 | 0xfe00)) !== 0 || header.getUint32(24, true) > 1;
  if (header.getUint32(80, true) & 0x4 && header.getUint32(84, true) === 0x30315844) {
    if (bytes.length < 148) throw new Error("Truncated DDS DX10 header");
    multiple ||=
      header.getUint32(132, true) !== 3 ||
      (header.getUint32(136, true) & 0x4) !== 0 ||
      header.getUint32(140, true) !== 1;
  }
  if (multiple)
    throw new Error(
      "Conversion requires a single 2D DDS image. Cubemaps, texture arrays and volume textures need a DDS tool that preserves all surfaces. To extract only the displayed surface, export the DDS preview as PNG."
    );
}

/** Match a supported vanilla texture without guessing a format from its alpha pixels. */
export function ddsEncodingFromReference(
  bytes: Uint8Array
): Pick<ImageEncoding, "dds" | "mipmaps" | "referenceSize"> {
  requireSingleImageDds(bytes);
  const info = ddsFormatInfo(bytes);
  if (!info) throw new Error("Reference is not a valid DDS file");
  const formats: Record<string, DdsEncodeFormat> = { DXT1: "bc1", DXT5: "bc3", A8R8G8B8: "bgra8" };
  const format = formats[info.format];
  if (!format)
    throw new Error(
      `Reference uses ${info.format}, which this converter cannot write. Use a DDS tool supporting that format.`
    );
  const levels = ddsMipLevels(bytes);
  return { dds: format, mipmaps: levels.length, referenceSize: { width: info.width, height: info.height } };
}

/** Native DDS/PNG codecs and Chromium's image codecs share one batch lifetime. */
export class ImageCodec {
  private panel?: vscode.WebviewPanel;
  private sequence = 0;
  private ready?: Promise<void>;
  private waiters = new Map<string, { resolve: (value: Reply) => void; reject: (error: Error) => void }>();

  async decode(bytes: Uint8Array, ext: string, token?: vscode.CancellationToken): Promise<ImagePixels> {
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
    if (ext === ".dds") {
      requireSingleImageDds(bytes);
      const image = decodeDds(bytes);
      return { width: image.width, height: image.height, rgba: image.pixels };
    }
    if (ext === ".png") {
      // Canvas premultiplies alpha and discards RGB at alpha 0. PNG masks need all four channels.
      const buffer = Buffer.from(bytes);
      if (buffer.length < 24) throw new Error("Invalid PNG header");
      const width = buffer.readUInt32BE(16),
        height = buffer.readUInt32BE(20);
      if (width * height > MAX_DECODE_PIXELS) throw new Error("PNG exceeds the image pixel limit");
      const image = PNG.sync.read(buffer);
      return { width: image.width, height: image.height, rgba: image.data };
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
    if (options.format === "dds") {
      if (
        options.referenceSize &&
        (width !== options.referenceSize.width || height !== options.referenceSize.height)
      )
        throw new Error(
          `Image is ${width}x${height}; reference requires ${options.referenceSize.width}x${options.referenceSize.height}. Resize the source image before converting.`
        );
      const format =
        options.dds === "auto"
          ? width % 4 || height % 4
            ? "bgra8"
            : hasTransparency(rgba)
              ? "bc3"
              : "bc1"
          : options.dds;
      return encodeDds(width, height, rgba, format, options.mipmaps);
    }
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
