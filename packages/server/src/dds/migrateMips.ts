import { decodeDds, type DdsMipLevel } from "./decoder";
import { encodeDds, type DdsEncodeFormat } from "./encode";

const MIP_COUNT = 0x20000;
const MIP_CAPS = 0x400008;

export interface DdsResourceHeader {
  width: number;
  height: number;
  format: string;
  /** Includes the base image. A zero header field means one stored image. */
  mipLevelCount: number;
  fullMipLevelCount: number;
  resourceKind: "2d" | "cube" | "volume" | "array" | "1d" | "unknown";
  dataOffset: number;
  /** Tightly packed simple-2D size, when the format and resource layout are supported. */
  expectedByteLength?: number;
}

export interface DdsResource extends DdsResourceHeader {
  levels: DdsMipLevel[];
  byteLength: number;
}

interface Layout {
  name: string;
  blockBytes?: number;
  pixelBytes?: number;
  generate?: DdsEncodeFormat;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function tag(value: number): string {
  return String.fromCharCode(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24);
}

function formatLayout(bytes: Uint8Array): Layout {
  const dv = view(bytes);
  const flags = dv.getUint32(80, true);
  if (flags & 4) {
    const fourCC = tag(dv.getUint32(84, true));
    if (fourCC === "DX10") {
      const format = dv.getUint32(128, true);
      const blockFormats: [number[], string, number, DdsEncodeFormat?][] = [
        [[70, 71, 72], "BC1", 8, "bc1"],
        [[73, 74, 75], "BC2", 16],
        [[76, 77, 78], "BC3", 16, "bc3"],
        [[79, 80, 81], "BC4", 8],
        [[82, 83, 84], "BC5", 16],
        [[94, 95, 96], "BC6", 16],
        [[97, 98, 99], "BC7", 16],
      ];
      for (const [formats, name, blockBytes, generate] of blockFormats) {
        if (formats.includes(format))
          return {
            name: `${name} (DXGI ${format})`,
            blockBytes,
            generate: format === formats[0] ? undefined : generate,
          };
      }
      if ([27, 28, 29, 87, 88, 90, 91, 92, 93].includes(format))
        return {
          name: `RGB32 (DXGI ${format})`,
          pixelBytes: 4,
          generate: [87, 91].includes(format) ? "bgra8" : undefined,
        };
      throw new Error(`Unsupported DDS format: DXGI ${format}`);
    }
    const legacy: Record<string, Layout> = {
      DXT1: { name: "BC1 (DXT1)", blockBytes: 8, generate: "bc1" },
      DXT2: { name: "BC2 (DXT2)", blockBytes: 16 },
      DXT3: { name: "BC2 (DXT3)", blockBytes: 16 },
      DXT4: { name: "BC3 (DXT4)", blockBytes: 16 },
      DXT5: { name: "BC3 (DXT5)", blockBytes: 16, generate: "bc3" },
      ATI1: { name: "BC4 (ATI1)", blockBytes: 8 },
      BC4U: { name: "BC4 (BC4U)", blockBytes: 8 },
      BC4S: { name: "BC4 (BC4S)", blockBytes: 8 },
      ATI2: { name: "BC5 (ATI2)", blockBytes: 16 },
      BC5U: { name: "BC5 (BC5U)", blockBytes: 16 },
      BC5S: { name: "BC5 (BC5S)", blockBytes: 16 },
    };
    const layout = legacy[fourCC];
    if (layout) return layout;
    throw new Error(`Unsupported DDS format: FourCC ${JSON.stringify(fourCC)}`);
  }
  if (flags & 0x40) {
    const bits = dv.getUint32(88, true);
    const r = dv.getUint32(92, true),
      g = dv.getUint32(96, true),
      b = dv.getUint32(100, true),
      a = dv.getUint32(104, true);
    const bgra = r === 0xff0000 && g === 0xff00 && b === 0xff;
    const rgba = r === 0xff && g === 0xff00 && b === 0xff0000;
    if (bits === 24 && bgra && a === 0 && !(flags & 1)) return { name: "RGB24", pixelBytes: 3 };
    if (bits === 32 && (bgra || rgba) && (a === 0 || a === 0xff000000) && Boolean(flags & 1) === Boolean(a))
      return {
        name: bgra ? "BGRA8" : "RGBA8",
        pixelBytes: 4,
        generate: bgra && a === 0xff000000 ? "bgra8" : undefined,
      };
    throw new Error(`Unsupported DDS format: ${bits}-bit RGB masks`);
  }
  throw new Error("Unsupported DDS format: pixel format flags");
}

function levelBytes(width: number, height: number, layout: Layout): number {
  return layout.blockBytes
    ? Math.ceil(width / 4) * Math.ceil(height / 4) * layout.blockBytes
    : width * height * layout.pixelBytes!;
}

function validatePitch(bytes: Uint8Array, width: number, height: number, layout: Layout): void {
  const dv = view(bytes),
    flags = dv.getUint32(8, true),
    pitch = dv.getUint32(20, true);
  if (layout.pixelBytes && flags & 8 && pitch !== width * layout.pixelBytes)
    throw new Error("DDS mip adjustment does not support padded or inconsistent rows");
  if (layout.blockBytes && flags & 0x80000 && pitch !== levelBytes(width, height, layout))
    throw new Error("Invalid DDS base-level linear size");
}

/** Header-only discovery. This does not certify the payload or permit a write. */
export function inspectDdsHeader(bytes: Uint8Array): DdsResourceHeader {
  if (bytes.length < 128) throw new Error("Truncated DDS header");
  const dv = view(bytes);
  if (dv.getUint32(0, true) !== 0x20534444 || dv.getUint32(4, true) !== 124 || dv.getUint32(76, true) !== 32)
    throw new Error("Invalid DDS header");
  const width = dv.getUint32(16, true),
    height = dv.getUint32(12, true);
  if (!width || !height) throw new Error("Invalid DDS dimensions");
  const fullMipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const mipLevelCount = Math.max(1, dv.getUint32(28, true));
  if (mipLevelCount > fullMipLevelCount) throw new Error("Invalid DDS mipmap count");
  const caps2 = dv.getUint32(112, true);
  let resourceKind: DdsResourceHeader["resourceKind"] = "2d";
  if (caps2 & 0xfe00) resourceKind = "cube";
  if (caps2 & 0x200000 || dv.getUint32(24, true) !== 0 || dv.getUint32(8, true) & 0x800000)
    resourceKind = "volume";
  let dataOffset = 128;
  if (dv.getUint32(80, true) & 4 && tag(dv.getUint32(84, true)) === "DX10") {
    if (bytes.length < 148) throw new Error("Truncated DDS DX10 header");
    dataOffset = 148;
    const dimension = dv.getUint32(132, true),
      arraySize = dv.getUint32(140, true);
    if (arraySize === 0) throw new Error("Invalid DDS array size");
    if (dimension !== 3) resourceKind = dimension === 2 ? "1d" : dimension === 4 ? "volume" : "unknown";
    if (arraySize > 1) resourceKind = "array";
    if (dv.getUint32(136, true) & 4) resourceKind = "cube";
  }
  let format: string, layout: Layout | undefined;
  try {
    layout = formatLayout(bytes);
    format = layout.name;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Unsupported DDS format:")) throw error;
    format = error.message.slice("Unsupported DDS format: ".length);
  }
  let expectedByteLength: number | undefined;
  if (layout && resourceKind === "2d") {
    validatePitch(bytes, width, height, layout);
    let w = width,
      h = height,
      total = dataOffset;
    for (let level = 0; level < mipLevelCount; level++) {
      total += levelBytes(w, h, layout);
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
    if (!Number.isSafeInteger(total))
      throw new Error("Invalid DDS dimensions: payload size exceeds safe integer range");
    expectedByteLength = total;
  }
  return {
    width,
    height,
    format,
    mipLevelCount,
    fullMipLevelCount,
    resourceKind,
    dataOffset,
    expectedByteLength,
  };
}

/** Strict, tightly packed simple-2D layout. Reject anything the writer cannot preserve exactly. */
export function inspectDdsResource(bytes: Uint8Array): DdsResource {
  const header = inspectDdsHeader(bytes);
  if (header.resourceKind !== "2d")
    throw new Error(`DDS mip adjustment supports only simple 2D textures, got ${header.resourceKind}`);
  const layout = formatLayout(bytes);
  const levels: DdsMipLevel[] = [];
  let width = header.width,
    height = header.height,
    offset = header.dataOffset;
  for (let level = 0; level < header.mipLevelCount; level++) {
    const byteLength = levelBytes(width, height, layout);
    if (!Number.isSafeInteger(offset + byteLength) || offset + byteLength > bytes.length)
      throw new Error(`Truncated DDS mip level ${level}`);
    levels.push({ level, width, height, offset, byteLength });
    offset += byteLength;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  if (offset !== bytes.length) throw new Error("DDS has trailing bytes or an unsupported padded mip layout");
  return { ...header, levels, byteLength: offset };
}

function encodeMip(width: number, height: number, pixels: Uint8Array, format: DdsEncodeFormat): Uint8Array {
  if (format === "bgra8") return encodeDds(width, height, pixels, format).subarray(128);
  // The encoder requires a block-aligned base image. Clamp only the block padding, after filtering.
  const paddedWidth = Math.ceil(width / 4) * 4,
    paddedHeight = Math.ceil(height / 4) * 4;
  const padded = new Uint8Array(paddedWidth * paddedHeight * 4);
  for (let y = 0; y < paddedHeight; y++) {
    for (let x = 0; x < paddedWidth; x++) {
      const source = (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4;
      padded.set(pixels.subarray(source, source + 4), (y * paddedWidth + x) * 4);
    }
  }
  return encodeDds(paddedWidth, paddedHeight, padded, format).subarray(128);
}

/** Counts include the base image. Retained levels and all unrelated header bytes stay unchanged. */
export function adjustDdsMipLevels(bytes: Uint8Array, targetCount: number): Uint8Array {
  const resource = inspectDdsResource(bytes);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > resource.fullMipLevelCount)
    throw new Error(`DDS mipmap count must be between 1 and ${resource.fullMipLevelCount}`);
  if (targetCount === resource.mipLevelCount) return bytes.slice();
  const retained = resource.levels[Math.min(targetCount, resource.mipLevelCount) - 1];
  const retainedEnd = retained.offset + retained.byteLength;
  const tail: Uint8Array[] = [];
  if (targetCount > resource.mipLevelCount) {
    const layout = formatLayout(bytes);
    if (!layout.generate)
      throw new Error(
        `DDS mip generation is unsupported for ${resource.format}; existing levels can be retained or shortened`
      );
    if (resource.dataOffset === 148 && (view(bytes).getUint32(144, true) & 7) === 2)
      throw new Error("DDS mip generation does not support premultiplied alpha");
    const last = decodeDds(bytes, retained.level);
    if (layout.generate === "bc1" && last.pixels.some((value, index) => index % 4 === 3 && value !== 255))
      throw new Error("DDS mip generation does not support BC1 transparency");
    // Existing encoder filtering averages each channel independently, preserving mask semantics.
    const filtered = encodeDds(
      last.width,
      last.height,
      last.pixels,
      "bgra8",
      targetCount - resource.mipLevelCount + 1
    );
    for (let level = 1; level <= targetCount - resource.mipLevelCount; level++) {
      const image = decodeDds(filtered, level);
      tail.push(encodeMip(image.width, image.height, image.pixels, layout.generate));
    }
  }
  const out = new Uint8Array(retainedEnd + tail.reduce((sum, mip) => sum + mip.length, 0));
  out.set(bytes.subarray(0, retainedEnd));
  let offset = retainedEnd;
  for (const mip of tail) {
    out.set(mip, offset);
    offset += mip.length;
  }
  const dv = view(out);
  // Microsoft DDS_HEADER and DDS_HEADER_DXT10 contracts:
  // https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header
  // https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10
  dv.setUint32(28, targetCount, true);
  dv.setUint32(8, (dv.getUint32(8, true) & ~MIP_COUNT) | (targetCount > 1 ? MIP_COUNT : 0), true);
  dv.setUint32(108, (dv.getUint32(108, true) & ~MIP_CAPS) | 0x1000 | (targetCount > 1 ? MIP_CAPS : 0), true);
  const written = inspectDdsResource(out);
  if (written.mipLevelCount !== targetCount)
    throw new Error("DDS mip adjustment produced an invalid level count");
  return out;
}
