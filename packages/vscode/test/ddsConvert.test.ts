import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { decodeDds, ddsMipLevels, encodeDds, encodePng } from "@px-lsp/server/dds";

const ui = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  withProgress: vi.fn(),
}));
vi.mock("vscode", () => ({
  window: ui,
  FileType: { Directory: 2 },
  ProgressLocation: { Notification: 15 },
  workspace: {
    fs: {
      stat: async () => ({ type: 1 }),
      readFile: (uri: { fsPath: string }) => fs.readFile(uri.fsPath),
    },
  },
}));
import { pickDdsEncoding } from "../src/ddsConvert";
import { convertImagesCommand } from "../src/imageConvert";

let root: string;
let source: string;
let png: Uint8Array;
beforeEach(async () => {
  vi.resetAllMocks();
  await fs.mkdir(".local/testing", { recursive: true });
  root = await fs.mkdtemp(path.resolve(".local/testing/dds-count-"));
  source = path.join(root, "source.png");
  png = encodePng(200, 200, new Uint8Array(200 * 200 * 4).fill(255));
  await fs.writeFile(source, png);
  ui.showQuickPick.mockImplementation(async (items, options) => {
    if (options.title === "DDS format")
      return items.find((item: { format: string }) => item.format === "bc3");
    if (options.title === "DDS mipmaps")
      return items.find((item: { value: unknown }) => item.value === "custom");
    return "Beside source files";
  });
  ui.showInputBox.mockResolvedValue("2");
  ui.withProgress.mockImplementation(async (_options, task) =>
    task({ report: vi.fn() }, { isCancellationRequested: false })
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const convert = () =>
  convertImagesCommand("toDds", { fsPath: source, scheme: "file" } as import("vscode").Uri);

it.each([1, 2, 4])("converts through the command with exactly %s total mip levels", async (count) => {
  ui.showInputBox.mockResolvedValue(String(count));
  const result = await convert();
  expect(result?.failed).toEqual([]);
  expect(result?.written).toEqual([path.join(root, "source.dds")]);
  const bytes = await fs.readFile(result!.written[0]);
  const sizes = [200, 100, 50, 25].slice(0, count);
  expect(ddsMipLevels(bytes).map(({ width, height }) => [width, height])).toEqual(
    sizes.map((size) => [size, size])
  );
  for (let level = 0; level < count; level++) {
    expect(decodeDds(bytes, level).pixels.every((channel) => channel === 255)).toBe(true);
  }
  expect(await fs.readFile(source)).toEqual(Buffer.from(png));
});

it("validates counts and explains that the base image is included", async () => {
  await pickDdsEncoding();
  const options = ui.showInputBox.mock.calls[0][0];
  expect(options.title).toContain("including base");
  expect(options.value).toBe("2");
  for (const invalid of ["", " ", "0", "-1", "1.5", "NaN", "2e1", "9007199254740992"])
    expect(options.validateInput(invalid)).toContain("whole number");
  for (const valid of ["1", "2", " 4 "]) expect(options.validateInput(valid)).toBeUndefined();
});

it("cancels custom count entry without creating output or asking for a destination", async () => {
  ui.showInputBox.mockResolvedValue(undefined);
  expect(await convert()).toBeUndefined();
  expect(ui.showQuickPick).toHaveBeenCalledTimes(2);
  expect(await fs.readdir(root)).toEqual(["source.png"]);
});

it("rejects a count beyond the image size and preserves existing output", async () => {
  const target = path.join(root, "source.dds");
  await fs.writeFile(target, "existing art");
  ui.showInputBox.mockResolvedValue("9");
  ui.showWarningMessage.mockResolvedValue("Overwrite Outputs");
  const result = await convert();
  expect(result?.written).toEqual([]);
  expect(result?.failed).toEqual([{ file: source, message: "Mipmap count must be between 1 and 8" }]);
  expect(await fs.readFile(target, "utf8")).toBe("existing art");
  expect(await fs.readFile(source)).toEqual(Buffer.from(png));
  expect((await fs.readdir(root)).sort()).toEqual(["source.dds", "source.png"]);
  expect(ui.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("1 failed"), "Show errors");
});

it("keeps reference matching exact without asking for a custom count", async () => {
  const reference = path.join(root, "reference.dds");
  await fs.writeFile(reference, encodeDds(200, 200, new Uint8Array(200 * 200 * 4).fill(255), "bc3", 3));
  ui.showQuickPick.mockImplementation(async (items) =>
    items.find((item: { format: string }) => item.format === "reference")
  );
  ui.showOpenDialog.mockResolvedValue([{ fsPath: reference }]);
  expect(await pickDdsEncoding()).toMatchObject({ encoding: { mipmaps: 3 }, referenceFile: reference });
  expect(ui.showInputBox).not.toHaveBeenCalled();
  expect(ui.showQuickPick).toHaveBeenCalledTimes(1);
});
