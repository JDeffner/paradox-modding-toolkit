import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { preparePreviewImages } from "../src/steam/previewImages";
import { readPreviews } from "../src/steam/workshopFiles";

vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));

let root: string;
let listing: string;
const large = Buffer.alloc(1_200_000, 7);
const small = Buffer.alloc(150, 3);
beforeEach(() => {
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/gallery-"));
  listing = path.join(root, "workshop");
  fs.mkdirSync(path.join(listing, "previews"), { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
const put = (name: string, bytes = large) => {
  const file = path.join(listing, "previews", name);
  fs.writeFileSync(file, bytes);
  return file;
};
const encoded = { mime: "image/jpeg" as const, data: small.toString("base64") };
const prepare = (encode = async () => encoded) =>
  preparePreviewImages(readPreviews(listing)!.images, path.join(root, "staging"), listing, encode, () => {});

it("keeps project-folder originals beside the ready gallery, preserving order, videos and name collisions", async () => {
  put("same.png");
  const jpeg = put("same.jpg", Buffer.from("unchanged image"));
  put("order.txt", Buffer.from("# My gallery\r\nsame.png\r\n"));
  put("videos.txt", Buffer.from("video-id\n"));
  await prepare();
  expect(readPreviews(listing)).toEqual({
    images: [path.join(listing, "previews/same-1.jpg"), jpeg],
    videos: ["video-id"],
  });
  expect(fs.readFileSync(path.join(listing, "previews/order.txt"), "utf8")).toBe(
    "# My gallery\r\nsame-1.jpg\r\nsame.jpg\r\n"
  );
  expect(fs.readFileSync(jpeg, "utf8")).toBe("unchanged image");
  const archive = path.join(
    listing,
    "preview-originals",
    fs.readdirSync(path.join(listing, "preview-originals"))[0]
  );
  expect(fs.readFileSync(path.join(archive, "same.png"))).toEqual(large);
  expect(fs.existsSync(path.join(root, "mod/.px-toolkit"))).toBe(false);
});

it("leaves the whole source gallery untouched when a later conversion fails", async () => {
  const first = put("1.png");
  const second = put("2.png");
  const encode = vi.fn().mockResolvedValueOnce(encoded).mockRejectedValueOnce(new Error("Invalid image"));
  await expect(prepare(encode)).rejects.toThrow("Invalid image");
  expect(fs.readFileSync(first)).toEqual(large);
  expect(fs.readFileSync(second)).toEqual(large);
  expect(fs.existsSync(path.join(listing, "preview-originals"))).toBe(false);
});

it.each(["image", "order", "added file"])("rejects a changed %s before moving originals", async (kind) => {
  const source = put("1.png");
  await expect(
    prepare(async () => {
      if (kind === "image") fs.writeFileSync(source, "new user image");
      else put(kind === "order" ? "order.txt" : "another.png", Buffer.from("new user data"));
      return encoded;
    })
  ).rejects.toThrow("gallery changed");
  expect(fs.existsSync(source)).toBe(true);
  expect(fs.existsSync(path.join(listing, "preview-originals"))).toBe(false);
});

it("restores the gallery and reports a write failure after archiving", async () => {
  const source = put("same.jpg");
  const write = fs.writeFileSync;
  vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
    if (file === source) throw new Error("Disk full");
    return write(file, ...args);
  });
  await expect(prepare()).rejects.toThrow("previous gallery was restored");
  expect(fs.readFileSync(source)).toEqual(large);
  expect(readPreviews(listing)!.images).toEqual([source]);
});

it("checks unsaved edits and cancellation after encoding, before any gallery write", async () => {
  const source = put("large.png");
  await expect(
    preparePreviewImages(
      [source],
      path.join(root, "staging"),
      listing,
      async () => encoded,
      () => {},
      undefined,
      () => {
        throw new Error("Save order.txt first");
      }
    )
  ).rejects.toThrow("Save order.txt first");
  const abort = new AbortController();
  await expect(
    preparePreviewImages(
      [source],
      path.join(root, "staging"),
      listing,
      async () => {
        abort.abort();
        return encoded;
      },
      () => {},
      abort.signal
    )
  ).rejects.toThrow();
  expect(fs.readFileSync(source)).toEqual(large);
  expect(fs.existsSync(path.join(listing, "preview-originals"))).toBe(false);
});
