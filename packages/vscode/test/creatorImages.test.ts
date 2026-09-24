import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { encodeDds, encodePng, decodeDds, ddsFormatInfo, ddsMipLevels } from "@px-lsp/server/dds";

const ui = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showWarningMessage: vi.fn(),
  rejectWrite: false,
}));
vi.mock("fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (ui.rejectWrite) throw new Error("write denied");
      actual.renameSync(...args);
    },
  };
});
vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath, path: fsPath.replaceAll("\\", "/") }) },
  window: ui,
  workspace: { fs: { readFile: async (uri: { fsPath: string }) => fs.readFileSync(uri.fsPath) } },
}));
import { importPicture, type ImportPictureOptions } from "../src/creators/images";

let root: string;
let source: string;
let options: ImportPictureOptions;
const rgba = new Uint8Array(120 * 120 * 4);
for (let i = 0; i < rgba.length; i += 4) rgba.set([123, 45, 67, 255], i);

beforeEach(() => {
  vi.resetAllMocks();
  ui.rejectWrite = false;
  fs.mkdirSync(".local/testing", { recursive: true });
  root = fs.mkdtempSync(path.resolve(".local/testing/creator-images-"));
  source = path.join(root, "source.png");
  fs.writeFileSync(source, encodePng(120, 120, rgba));
  options = {
    modPath: path.join(root, "mod"),
    folder: "gfx/icons",
    name: "picture",
    title: "Picture",
    textures: {} as ImportPictureOptions["textures"],
  };
  fs.mkdirSync(options.modPath);
  ui.showOpenDialog.mockResolvedValue([{ fsPath: source }]);
  ui.showQuickPick.mockImplementation(async (items) => items[0]);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
const target = () => path.join(options.modPath, options.folder, `${options.name}.dds`);
function existing(): Buffer {
  fs.mkdirSync(path.dirname(target()), { recursive: true });
  const bytes = Buffer.from(encodeDds(4, 4, new Uint8Array(64).fill(255), "bc3", true));
  fs.writeFileSync(target(), bytes);
  return bytes;
}

it("defaults custom pictures to lossless DDS with a full mip chain", async () => {
  const result = await importPicture(options);
  const bytes = fs.readFileSync(result!.abs);
  expect(ddsFormatInfo(bytes)?.format).toBe("A8R8G8B8");
  expect(ddsMipLevels(bytes).map((level) => level.width)).toEqual([120, 60, 30, 15, 7, 3, 1]);
  expect(decodeDds(bytes).pixels).toEqual(rgba);
  expect(fs.readFileSync(source)).toEqual(Buffer.from(encodePng(120, 120, rgba)));
});

it("offers explicit compression and mip choices in the creator flow", async () => {
  ui.showQuickPick.mockImplementation(async (items, settings) =>
    settings.title === "DDS format"
      ? items.find((item: { format: string }) => item.format === "bc3")
      : settings.title === "DDS mipmaps"
        ? items.find((item: { value: boolean }) => !item.value)
        : items[0]
  );
  await importPicture(options);
  const bytes = fs.readFileSync(target());
  expect(ddsFormatInfo(bytes)?.format).toBe("DXT5");
  expect(ddsMipLevels(bytes)).toHaveLength(1);
});

it.each(["2", undefined])("handles custom mip count %s in creator imports", async (count) => {
  ui.showQuickPick.mockImplementation(async (items, settings) =>
    settings.title === "DDS mipmaps"
      ? items.find((item: { value: unknown }) => item.value === "custom")
      : items[0]
  );
  ui.showInputBox.mockResolvedValue(count);
  const result = await importPicture(options);
  if (count === undefined) {
    expect(result).toBeNull();
    expect(fs.readdirSync(options.modPath)).toEqual([]);
  } else {
    expect(ddsMipLevels(fs.readFileSync(result!.abs)).map((level) => level.width)).toEqual([120, 60]);
  }
});

it("copies a selected DDS byte for byte, including its compression and stored mips", async () => {
  source = path.join(root, "source.dds");
  const bytes = encodeDds(8, 8, new Uint8Array(256).fill(255), "bc3", true);
  fs.writeFileSync(source, bytes);
  ui.showOpenDialog.mockResolvedValue([{ fsPath: source }]);
  await importPicture(options);
  expect(fs.readFileSync(target())).toEqual(Buffer.from(bytes));
  expect(ui.showQuickPick).toHaveBeenCalledTimes(1);
});

it.each([undefined, "Cancel"])("keeps existing art when replacement is dismissed with %s", async (answer) => {
  const bytes = existing();
  ui.showWarningMessage.mockResolvedValue(answer);
  expect(await importPicture(options)).toBeNull();
  expect(fs.readFileSync(target())).toEqual(bytes);
  expect(fs.readdirSync(path.dirname(target()))).toEqual(["picture.dds"]);
});

it("replaces only the chosen picture after an explicit conflict choice", async () => {
  existing();
  const sibling = path.join(path.dirname(target()), "keep.dds");
  fs.writeFileSync(sibling, "keep");
  ui.showWarningMessage.mockResolvedValue("Replace Picture");
  await importPicture(options);
  expect(decodeDds(fs.readFileSync(target())).pixels).toEqual(rgba);
  expect(fs.readFileSync(sibling, "utf8")).toBe("keep");
  expect(fs.readdirSync(path.dirname(target())).sort()).toEqual(["keep.dds", "picture.dds"]);
});

it("rejects a stale replacement and keeps the newer picture", async () => {
  existing();
  ui.showWarningMessage.mockImplementation(async () => {
    fs.writeFileSync(target(), "changed while prompt was open");
    return "Replace Picture";
  });
  await expect(importPicture(options)).rejects.toThrow(/changed during import/);
  expect(fs.readFileSync(target(), "utf8")).toBe("changed while prompt was open");
  expect(fs.readdirSync(path.dirname(target()))).toEqual(["picture.dds"]);
});

it("does not create a destination when encoding is cancelled", async () => {
  ui.showQuickPick.mockImplementation(async (items, settings) =>
    settings.title === "DDS mipmaps" ? undefined : items[0]
  );
  expect(await importPicture(options)).toBeNull();
  expect(fs.readdirSync(options.modPath)).toEqual([]);
});

it("reports publication failures and preserves existing art", async () => {
  const bytes = existing();
  ui.showWarningMessage.mockResolvedValue("Replace Picture");
  ui.rejectWrite = true;
  await expect(importPicture(options)).rejects.toThrow("write denied");
  expect(fs.readFileSync(target())).toEqual(bytes);
  expect(fs.readdirSync(path.dirname(target()))).toEqual(["picture.dds"]);
});

it("remembers folders within one mod without offering another mod's destination", async () => {
  const custom = path.join(options.modPath, "art");
  fs.mkdirSync(custom);
  ui.showOpenDialog.mockImplementation(async (settings) => [
    { fsPath: settings.canSelectFolders ? custom : source },
  ]);
  ui.showQuickPick.mockImplementation(async (items, settings) =>
    settings.title ? items[0] : items.find((item: { dir: string }) => item.dir === "")
  );
  await importPicture(options);
  const otherMod = path.join(root, "other-mod");
  fs.mkdirSync(otherMod);
  ui.showQuickPick.mockImplementation(async (items, settings) => {
    if (!settings.title)
      expect(
        items.some((item: { description: string }) => item.description === "the folder you chose last time")
      ).toBe(false);
    return items[0];
  });
  const result = await importPicture({ ...options, modPath: otherMod, name: "second" });
  expect(result!.abs).toBe(path.join(otherMod, options.folder, "second.dds"));
  expect(fs.readdirSync(custom)).toEqual(["picture.dds"]);
  ui.showQuickPick.mockImplementation(async (items, settings) =>
    settings.title
      ? items[0]
      : items.find((item: { description: string }) => item.description === "the folder you chose last time")
  );
  const remembered = await importPicture({ ...options, name: "third" });
  expect(remembered!.abs).toBe(path.join(custom, "third.dds"));
});

it("rejects an outside folder and a directory alias escaping the mod", async (context) => {
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  ui.showOpenDialog.mockImplementation(async (settings) => [
    { fsPath: settings.canSelectFolders ? outside : source },
  ]);
  ui.showQuickPick.mockImplementation(async (items) =>
    items.find((item: { dir: string }) => item.dir === "")
  );
  await expect(importPicture(options)).rejects.toThrow(/outside the selected mod/);
  const alias = path.join(options.modPath, "alias");
  try {
    fs.symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      context.skip();
      return;
    }
    throw error;
  }
  ui.showOpenDialog.mockImplementation(async (settings) => [
    { fsPath: settings.canSelectFolders ? alias : source },
  ]);
  await expect(importPicture(options)).rejects.toThrow(/links to a folder outside/);
  expect(fs.readdirSync(outside)).toEqual([]);
});

it("keeps the reference texture read-only", async () => {
  const bytes = existing();
  ui.showOpenDialog.mockImplementation(async (settings) => [
    { fsPath: settings.title === "Choose the original DDS texture to match" ? target() : source },
  ]);
  ui.showQuickPick.mockImplementation(async (items, settings) =>
    settings.title === "DDS format"
      ? items.find((item: { format: string }) => item.format === "reference")
      : items[0]
  );
  await expect(importPicture(options)).rejects.toThrow(/destination is the reference/);
  expect(fs.readFileSync(target())).toEqual(bytes);
});
