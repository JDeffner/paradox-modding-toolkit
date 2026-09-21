import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { inflateSync } from "node:zlib";
import { encodeDds } from "@px-lsp/server/dds";
import { collectImageInputs, convertImageBatch, type BatchOptions } from "../src/imageBatch";
vi.mock("vscode", () => ({}));
import { ImageCodec } from "../src/imageCodec";

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
async function dds(name: string): Promise<string> {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encodeDds(2, 1, pixels, "bgra8"));
  return file;
}

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
