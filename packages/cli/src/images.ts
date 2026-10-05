import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PxtkRequest } from "@px-lsp/protocol/agentTools";
import { decodeDds, decodeTga, ddsFormatInfo, encodeDds, hasTransparency } from "@px-lsp/server/dds";
import type { Configuration } from "./config";
import { ToolError } from "./errors";
import { changeFor, finishChanges, type Change, type InputSnapshot } from "./writes";

const extensions = new Set([".dds", ".tga", ".png", ".jpg", ".jpeg", ".webp"]);
const MAX_PIXELS = 16_777_216;
export async function images(
  config: Configuration,
  request: PxtkRequest,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const action = request.action ?? "inspect";
  if (!["inspect", "convert"].includes(action))
    throw new ToolError("invalid_action", "Use image inspect or convert.");
  if (!request.files?.length) throw new ToolError("files_required", "Supply image files or folders.");
  if (action === "convert" && (!request.output || !request.format))
    throw new ToolError("output_required", "Conversion needs --output and --to.");
  for (const dimension of [request.width, request.height]) {
    if (dimension !== undefined && (!Number.isInteger(dimension) || dimension < 1 || dimension > 16384))
      throw new ToolError("invalid_dimensions", "Dimensions must be integers from 1 to 16384.");
  }
  if ((request.width ?? 1) * (request.height ?? 1) > MAX_PIXELS)
    throw new ToolError("image_too_large", "Output exceeds 16 megapixels.");
  const files: Array<{ file: string; relative: string }> = [];
  const skipped: string[] = [];
  const walk = async (file: string, relative: string): Promise<void> => {
    const info = await fs.lstat(file);
    if (info.isSymbolicLink()) throw new ToolError("linked_image", "Select ordinary image files: " + file);
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort())
        await walk(path.join(file, name), path.join(relative, name));
    } else if (extensions.has(path.extname(file).toLowerCase())) files.push({ file, relative });
    else skipped.push(file);
    if (files.length > 200) throw new ToolError("batch_too_large", "Select at most 200 images per batch.");
  };
  for (const input of request.files) {
    const file = path.resolve(config.mod, input);
    const info = await fs.lstat(file);
    await walk(file, info.isDirectory() ? "" : path.basename(file));
  }
  if (!files.length)
    throw new ToolError("no_images", "No supported images found (DDS, TGA, PNG, JPEG, WebP).");
  const sharp = (await import("sharp")).default;
  const input: InputSnapshot[] = [];
  const changes: Change[] = [];
  const inspected: Record<string, unknown>[] = [];
  let totalBytes = 0;
  let outputBytes = 0;
  for (const source of files) {
    signal?.throwIfAborted();
    const stat = await fs.stat(source.file);
    totalBytes += stat.size;
    if (stat.size > 64 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024)
      throw new ToolError(
        "image_too_large",
        "Image inputs exceed the 64 MiB per-file or 256 MiB batch limit."
      );
    const bytes = await fs.readFile(source.file);
    const ext = path.extname(source.file).toLowerCase();
    let pipeline;
    let dds: ReturnType<typeof ddsFormatInfo> = null;
    let mipmaps = 1;
    if (ext === ".dds" || ext === ".tga") {
      if (ext === ".dds") {
        dds = ddsFormatInfo(bytes);
        if (!dds) throw new ToolError("invalid_image", "Invalid DDS: " + source.file);
        if (dds.width * dds.height > MAX_PIXELS)
          throw new ToolError("image_too_large", "DDS exceeds 16 megapixels.");
        if (
          bytes.readUInt32LE(112) !== 0 ||
          (bytes.toString("ascii", 84, 88) === "DX10" &&
            (bytes.length < 148 ||
              bytes.readUInt32LE(140) !== 1 ||
              bytes.readUInt32LE(132) !== 3 ||
              bytes.readUInt32LE(136) & 4))
        )
          throw new ToolError(
            "unsupported_texture",
            "Only a single 2D texture is supported, not arrays, cubemaps or volumes."
          );
        mipmaps = Math.max(1, bytes.readUInt32LE(28));
      } else if (bytes.length < 18 || bytes.readUInt16LE(12) * bytes.readUInt16LE(14) > MAX_PIXELS)
        throw new ToolError("invalid_image", "Invalid or oversized TGA.");
      const image = ext === ".dds" ? decodeDds(bytes) : decodeTga(bytes);
      pipeline = sharp(Buffer.from(image.pixels), {
        raw: { width: image.width, height: image.height, channels: 4 },
        limitInputPixels: MAX_PIXELS,
      });
    } else pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    const metadata = await pipeline.metadata();
    const outputWidth =
      request.width ??
      (request.height ? Math.ceil((request.height * metadata.width!) / metadata.height!) : metadata.width!);
    const outputHeight =
      request.height ??
      (request.width ? Math.ceil((request.width * metadata.height!) / metadata.width!) : metadata.height!);
    if (outputWidth * outputHeight > MAX_PIXELS)
      throw new ToolError("image_too_large", "Resized output exceeds 16 megapixels.");
    if ((metadata.pages ?? 1) > 1)
      throw new ToolError(
        "animated_image",
        "Animated images require an explicitly selected frame outside this command."
      );
    inspected.push({
      file: source.file,
      format: dds?.format ?? ext.slice(1),
      width: metadata.width,
      height: metadata.height,
      alpha: metadata.hasAlpha,
      mipmaps,
      bytes: bytes.length,
    });
    if (action === "inspect") continue;
    input.push({ file: source.file, bytes });
    pipeline = pipeline.rotate();
    if (request.width || request.height)
      pipeline = pipeline.resize({
        width: request.width,
        height: request.height,
        fit: request.fit ?? "contain",
        background: request.background ?? "#00000000",
      });
    const pixels = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const transparent = hasTransparency(pixels.data);
    let after: Buffer;
    let compression: string | undefined;
    if (request.format === "dds") {
      compression = request.dds && request.dds !== "auto" ? request.dds : transparent ? "bc3" : "bc1";
      if (compression === "bc1" && transparent)
        throw new ToolError("alpha_loss", "Use BC3 or BGRA8 to preserve transparency.");
      after = Buffer.from(
        encodeDds(pixels.info.width, pixels.info.height, pixels.data, compression as "bc1" | "bc3" | "bgra8")
      );
    } else {
      let output = sharp(pixels.data, {
        raw: { width: pixels.info.width, height: pixels.info.height, channels: 4 },
      });
      if (request.format === "jpeg") {
        if (transparent && !request.background)
          throw new ToolError("background_required", "JPEG cannot preserve alpha. Supply --background.");
        output = output.flatten({ background: request.background ?? "#ffffff" });
      }
      after = await output.toFormat(request.format!).toBuffer();
    }
    const extension = "." + (request.format === "jpeg" ? "jpg" : request.format);
    const outputExtension = path.extname(request.output!).toLowerCase();
    if (
      extensions.has(outputExtension) &&
      outputExtension !== extension &&
      !(request.format === "jpeg" && outputExtension === ".jpeg")
    )
      throw new ToolError("invalid_output", "Output filename extension must match --to.");
    outputBytes += after.length;
    if (outputBytes > 256 * 1024 * 1024)
      throw new ToolError("batch_too_large", "Encoded outputs exceed the 256 MiB batch limit.");
    const singleFile =
      files.length === 1 &&
      [extension, request.format === "jpeg" ? ".jpeg" : extension].includes(
        path.extname(request.output!).toLowerCase()
      );
    const destination = singleFile
      ? request.output!
      : path.join(request.output!, source.relative.slice(0, -ext.length) + extension);
    const change = await changeFor(config, destination, after);
    if (change.before)
      throw new ToolError("output_exists", "Image outputs must be new files: " + change.file);
    changes.push(change);
    Object.assign(inspected.at(-1)!, {
      output: change.file,
      outputWidth: pixels.info.width,
      outputHeight: pixels.info.height,
      compression,
    });
  }
  const limit = request.limit ?? 20;
  const result = {
    images: {
      items: inspected.slice(0, limit),
      total: inspected.length,
      truncated: inspected.length > limit,
    },
    skipped: { items: skipped.slice(0, limit), total: skipped.length, truncated: skipped.length > limit },
    notes:
      action === "convert"
        ? ["DDS output has one mip level. Image metadata is not copied; EXIF orientation is applied."]
        : [],
  };
  return action === "convert"
    ? { ...result, ...(await finishChanges(config, request, changes, input, signal)) }
    : result;
}
