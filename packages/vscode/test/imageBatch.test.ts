import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { decodeDds, ddsFormatInfo, encodeDds, encodePng } from "@px-lsp/server/dds";
import { collectImageInputs, convertImageBatch, type BatchOptions } from "../src/imageBatch";
vi.mock("vscode", () => ({}));
import { ImageCodec, ddsEncodingFromReference } from "../src/imageCodec";

let root: string;
beforeEach(async () => {
  const scratch = path.resolve(".local/testing");
  await fs.mkdir(scratch, { recursive: true });
  root = await fs.mkdtemp(path.join(scratch, "image-batch-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const encoding: BatchOptions = { format: "png", dds: "auto", background: "white", overwrite: false };
const control = { cancelled: () => false, report: () => undefined };
const pixels = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 128]);

it.each(["cube", "volume", "dx10-cube", "dx10-array", "dx10-volume"])(
  "rejects %s DDS conversion without replacing output or modifying the source",
  async (kind) => {
    const base = encodeDds(4, 4, new Uint8Array(64).fill(255), "bgra8");
    const bytes = new Uint8Array(148 + 64 * 6);
    bytes.set(base);
    const header = new DataView(bytes.buffer);
    if (kind.startsWith("dx10")) {
      header.setUint32(80, 4, true);
      bytes.set(new TextEncoder().encode("DX10"), 84);
      header.setUint32(128, 87, true);
      header.setUint32(132, kind === "dx10-volume" ? 4 : 3, true);
      header.setUint32(136, kind === "dx10-cube" ? 4 : 0, true);
      header.setUint32(140, kind === "dx10-array" ? 2 : 1, true);
    } else header.setUint32(112, kind === "cube" ? 0xfe00 : 0x200000, true);
    const file = path.join(root, "source.dds");
    await fs.writeFile(file, bytes);
    const destination = path.join(root, "out");
    await fs.mkdir(destination);
    const target = path.join(destination, "source.dds");
    await fs.writeFile(target, "existing art");
    const result = await convertImageBatch(
      [{ file, relative: "source.dds" }],
      { ...encoding, format: "dds", destination, overwrite: true },
      new ImageCodec(),
      control
    );
    expect(result.written).toEqual([]);
    expect(result.failed).toEqual([{ file, message: expect.stringContaining("single 2D DDS image") }]);
    expect(await fs.readFile(target, "utf8")).toBe("existing art");
    expect(await fs.readFile(file)).toEqual(Buffer.from(bytes));
    expect(await fs.readdir(destination)).toEqual(["source.dds"]);
  }
);

it.each([0, 255])("Auto preserves dimensions and pixels at non-block sizes (alpha %s)", async (alpha) => {
  const rgba = new Uint8Array(150 * 130 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([170, 85, 30, alpha], i);
  const encoded = await new ImageCodec().encode(
    { width: 150, height: 130, rgba },
    { ...encoding, format: "dds" }
  );
  expect(ddsFormatInfo(encoded)?.format).toBe("A8R8G8B8");
  const decoded = decodeDds(encoded);
  expect([decoded.width, decoded.height]).toEqual([150, 130]);
  expect(decoded.pixels).toEqual(rgba);
});

it.each([
  [0, "DXT5"],
  [255, "DXT1"],
] as const)("Auto still compresses block-aligned images (alpha %s)", async (alpha, format) => {
  const rgba = new Uint8Array(4 * 4 * 4).fill(alpha);
  const encoded = await new ImageCodec().encode(
    { width: 4, height: 4, rgba },
    { ...encoding, format: "dds" }
  );
  expect(ddsFormatInfo(encoded)?.format).toBe(format);
});

it("keeps existing output when an explicit compressed format has invalid dimensions", async () => {
  const file = await dds("source.dds");
  const target = path.join(root, "out/source.dds");
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, "keep existing output");
  const source = await fs.readFile(file);
  const result = await convertImageBatch(
    [{ file, relative: "source.dds" }],
    { ...encoding, format: "dds", dds: "bc3", destination: path.dirname(target), overwrite: true },
    new ImageCodec(),
    control
  );
  expect(result.written).toEqual([]);
  expect(result.failed).toEqual([{ file, message: expect.stringMatching(/multiples of 4/) }]);
  expect(await fs.readFile(target, "utf8")).toBe("keep existing output");
  expect(await fs.readFile(file)).toEqual(source);
  expect(await fs.readdir(path.dirname(target))).toEqual(["source.dds"]);
});

async function dds(name: string): Promise<string> {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodeDds(2, 1, pixels, "bgra8"));
  return file;
}

it("preserves PNG mask channels, including RGB under zero alpha, through uncompressed DDS", async () => {
  const rgba = new Uint8Array([255, 85, 170, 0, 17, 123, 231, 1, 151, 37, 219, 128]);
  const codec = new ImageCodec();
  const decoded = await codec.decode(encodePng(3, 1, rgba), ".png");
  expect(decoded.rgba).toEqual(Buffer.from(rgba));
  const encoded = await codec.encode(decoded, { ...encoding, format: "dds", dds: "bgra8" });
  expect(decodeDds(encoded).pixels).toEqual(rgba);
});

it("creates the full BC3 mip chain selected for an opaque mask instead of Auto's BC1", async () => {
  const rgba = new Uint8Array(512 * 512 * 4).fill(255);
  const encoded = await new ImageCodec().encode(
    { width: 512, height: 512, rgba },
    { ...encoding, format: "dds", dds: "bc3", mipmaps: true }
  );
  expect(ddsFormatInfo(encoded)?.format).toBe("DXT5");
  expect(new DataView(encoded.buffer).getUint32(28, true)).toBe(10);
  expect(encoded.length).toBe(349680);
});

it("matches a reference format and partial chain, and rejects different dimensions", async () => {
  const reference = encodeDds(16, 8, new Uint8Array(512).fill(255), "bc3", 3);
  const matched = { ...encoding, format: "dds" as const, ...ddsEncodingFromReference(reference) };
  const codec = new ImageCodec();
  const output = await codec.encode({ width: 16, height: 8, rgba: new Uint8Array(512).fill(255) }, matched);
  expect(ddsFormatInfo(output)?.format).toBe("DXT5");
  expect(new DataView(output.buffer).getUint32(28, true)).toBe(3);
  await expect(codec.encode({ width: 8, height: 8, rgba: new Uint8Array(256) }, matched)).rejects.toThrow(
    /reference requires 16x8/
  );
  const unsupported = reference.slice();
  unsupported.set(new TextEncoder().encode("DXT3"), 84);
  expect(() => ddsEncodingFromReference(unsupported)).toThrow(/cannot write/);
  expect(() => ddsEncodingFromReference(reference.subarray(0, 128))).toThrow(/truncated/);
});

it("never overwrites the reference DDS, even with overwrite enabled", async () => {
  const file = path.join(root, "mask.png");
  const referenceFile = path.join(root, "mask.dds");
  await fs.writeFile(file, encodePng(2, 1, pixels));
  const reference = encodeDds(2, 1, pixels, "bgra8");
  await fs.writeFile(referenceFile, reference);
  const result = await convertImageBatch(
    [{ file, relative: "mask.png" }],
    { ...encoding, format: "dds", overwrite: true, referenceFile, ...ddsEncodingFromReference(reference) },
    new ImageCodec(),
    control
  );
  expect(result.failed[0].message).toMatch(/reference DDS is read-only/);
  expect(await fs.readFile(referenceFile)).toEqual(Buffer.from(reference));
});

it("exports real DDS pixels to PNG, retains alpha and leaves the source unchanged", async () => {
  const file = await dds("alpha.dds");
  const before = await fs.readFile(file);
  const inputs = await collectImageInputs([file], new Set([".dds"]), false, control.cancelled);
  const result = await convertImageBatch(inputs, encoding, new ImageCodec(), control);
  expect(result.failed).toEqual([]);
  const png = await fs.readFile(result.written[0]);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      idat.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  expect(inflateSync(Buffer.concat(idat))).toEqual(Buffer.from([0, ...pixels]));
  expect(await fs.readFile(file)).toEqual(before);
});

it("retains recursive paths and honors the non-recursive choice", async () => {
  await dds("source/a.dds");
  await dds("source/deep/b.dds");
  const flat = await collectImageInputs(
    [path.join(root, "source")],
    new Set([".dds"]),
    false,
    control.cancelled
  );
  expect(flat.map((x) => x.relative)).toEqual(["a.dds"]);
  const inputs = await collectImageInputs(
    [path.join(root, "source")],
    new Set([".dds"]),
    true,
    control.cancelled
  );
  const result = await convertImageBatch(
    inputs,
    { ...encoding, destination: path.join(root, "out") },
    new ImageCodec(),
    control
  );
  expect(result.written.map((file) => path.relative(path.join(root, "out"), file))).toEqual([
    "a.png",
    path.join("deep", "b.png"),
  ]);
});

it("skips existing outputs by default and overwrites only with that explicit choice", async () => {
  const file = await dds("a.dds");
  const target = path.join(root, "a.png");
  await fs.writeFile(target, "user output");
  const inputs = [{ file, relative: "a.dds" }];
  const skipped = await convertImageBatch(inputs, encoding, new ImageCodec(), control);
  expect(skipped.skipped).toEqual([target]);
  expect(await fs.readFile(target, "utf8")).toBe("user output");
  const overwritten = await convertImageBatch(
    inputs,
    { ...encoding, overwrite: true },
    new ImageCodec(),
    control
  );
  expect(overwritten.written).toEqual([target]);
  expect((await fs.readFile(target))[0]).toBe(137);
});

it("protects every selected source even when overwriting outputs is enabled", async () => {
  const file = await dds("a.dds");
  const png = path.join(root, "a.png");
  await fs.writeFile(png, "source");
  const result = await convertImageBatch(
    [
      { file, relative: "a.dds" },
      { file: png, relative: "a.png" },
    ],
    { ...encoding, overwrite: true },
    new ImageCodec(),
    control
  );
  expect(result.written).toEqual([]);
  expect(await fs.readFile(png, "utf8")).toBe("source");
});

it("does not let equal basenames overwrite one another within a batch", async () => {
  const first = await dds("a/icon.dds");
  const second = await dds("b/icon.dds");
  const result = await convertImageBatch(
    [
      { file: first, relative: "icon.dds" },
      { file: second, relative: "icon.dds" },
    ],
    { ...encoding, destination: path.join(root, "out"), overwrite: true },
    new ImageCodec(),
    control
  );
  expect(result.written).toHaveLength(1);
  expect(result.skipped).toHaveLength(1);
});

it("reports corrupt inputs and continues with the next image", async () => {
  const bad = path.join(root, "bad.dds");
  await fs.writeFile(bad, "corrupt");
  const good = await dds("good.dds");
  const result = await convertImageBatch(
    [
      { file: bad, relative: "bad.dds" },
      { file: good, relative: "good.dds" },
    ],
    encoding,
    new ImageCodec(),
    control
  );
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0].file).toBe(bad);
  expect(result.written).toHaveLength(1);
});

it("does not publish an in-flight conversion after cancellation", async () => {
  const file = await dds("a.dds");
  let cancelled = false;
  const real = new ImageCodec();
  const result = await convertImageBatch(
    [{ file, relative: "a.dds" }],
    encoding,
    {
      decode: (...args) => real.decode(...args),
      encode: async (...args) => {
        const bytes = await real.encode(...args);
        cancelled = true;
        return bytes;
      },
    },
    { ...control, cancelled: () => cancelled }
  );
  expect(result.cancelled).toBe(true);
  expect(result.written).toEqual([]);
  await expect(fs.stat(path.join(root, "a.png"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("reports an unwritable destination as a failure", async () => {
  const file = await dds("a.dds");
  const destination = path.join(root, "not-a-folder");
  await fs.writeFile(destination, "keep");
  const result = await convertImageBatch(
    [{ file, relative: "a.dds" }],
    { ...encoding, destination },
    new ImageCodec(),
    control
  );
  expect(result.failed).toHaveLength(1);
  expect(result.written).toEqual([]);
  expect(await fs.readFile(destination, "utf8")).toBe("keep");
});

it("asks about conflicts only when an output exists and remembers the batch choice", async () => {
  const a = await dds("a.dds");
  const b = await dds("b.dds");
  const resolveConflict = vi.fn(async () => "skip" as const);
  await convertImageBatch([{ file: a, relative: "a.dds" }], encoding, new ImageCodec(), {
    ...control,
    resolveConflict,
  });
  expect(resolveConflict).not.toHaveBeenCalled();
  await fs.writeFile(path.join(root, "b.png"), "keep");
  const result = await convertImageBatch(
    [
      { file: a, relative: "a.dds" },
      { file: b, relative: "b.dds" },
    ],
    encoding,
    new ImageCodec(),
    { ...control, resolveConflict }
  );
  expect(resolveConflict).toHaveBeenCalledTimes(1);
  expect(result.skipped).toHaveLength(2);
  expect(await fs.readFile(path.join(root, "b.png"), "utf8")).toBe("keep");
});

it.each(["cancel", "overwrite"] as const)(
  "handles the conflict toast choice %s without changing the source",
  async (choice) => {
    const file = await dds("a.dds");
    const before = await fs.readFile(file);
    const target = path.join(root, "a.png");
    await fs.writeFile(target, "existing");
    const result = await convertImageBatch([{ file, relative: "a.dds" }], encoding, new ImageCodec(), {
      ...control,
      resolveConflict: async () => choice,
    });
    expect(result.cancelled).toBe(choice === "cancel");
    expect(result.written).toHaveLength(choice === "overwrite" ? 1 : 0);
    if (choice === "cancel") expect(await fs.readFile(target, "utf8")).toBe("existing");
    expect(await fs.readFile(file)).toEqual(before);
  }
);
