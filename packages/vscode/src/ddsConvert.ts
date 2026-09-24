import * as vscode from "vscode";
import { ddsEncodingFromReference, IMAGE_MIME, type ImageEncoding } from "./imageCodec";

export const CONVERTIBLE_IMAGE_EXT = Object.keys(IMAGE_MIME).map((ext) => ext.slice(1));

export interface DdsEncodingChoice {
  encoding: ImageEncoding;
  referenceFile?: string;
}

/** Shared by batch conversion and creator picture imports. Cancellation never writes a file. */
export async function pickDdsEncoding(creatorPicture = false): Promise<DdsEncodingChoice | undefined> {
  const formats = [
    {
      label: "Auto",
      description: "BC3 with alpha, BC1 opaque; uncompressed for sizes not divisible by 4",
      format: "auto" as const,
    },
    {
      label: "BC1 / DXT1",
      description: "No alpha; width and height must be multiples of 4",
      format: "bc1" as const,
    },
    {
      label: "BC3 / DXT5",
      description: "With alpha; width and height must be multiples of 4",
      format: "bc3" as const,
    },
    {
      label: "Uncompressed (A8R8G8B8)",
      description: "Lossless; preserves icon edges",
      format: "bgra8" as const,
    },
    {
      label: "Match reference DDS...",
      description: "Copy a texture's format and mip count; require matching dimensions",
      format: "reference" as const,
    },
  ];
  if (creatorPicture) formats.unshift(...formats.splice(3, 1));
  const choice = await vscode.window.showQuickPick(formats, {
    title: "DDS format",
    placeHolder:
      "For texture arrays, match the original texture's size, format and mipmaps. Auto only checks pixels.",
  });
  if (!choice) return;
  const encoding: ImageEncoding = { format: "dds", dds: "auto", background: "white" };
  if (choice.format === "reference") {
    const reference = await vscode.window.showOpenDialog({
      title: "Choose the original DDS texture to match",
      filters: { "DDS texture": ["dds"] },
      canSelectMany: false,
    });
    if (!reference?.length) return;
    Object.assign(encoding, ddsEncodingFromReference(await vscode.workspace.fs.readFile(reference[0])));
    return { encoding, referenceFile: reference[0].fsPath };
  }
  encoding.dds = choice.format;
  const levels = [
    { label: "No mipmaps", description: "Base image only", value: false },
    {
      label: "Generate full mip chain",
      description: "Every level down to 1×1; filter each RGBA channel independently",
      value: true,
    },
  ];
  if (creatorPicture) levels.reverse();
  const mipmaps = await vscode.window.showQuickPick(
    [
      ...levels,
      {
        label: "Custom mip level count...",
        description: "Includes the base image: 2 levels = base + one smaller mip",
        value: "custom" as const,
      },
    ],
    {
      title: "DDS mipmaps",
      placeHolder:
        "Texture array replacements must match the original mip levels. Dimensions stay unchanged.",
    }
  );
  if (!mipmaps) return;
  if (mipmaps.value === "custom") {
    const count = await vscode.window.showInputBox({
      title: "DDS mip level count (including base)",
      value: "2",
      prompt:
        "2 = base + one smaller mip (200×200 → 100×100). Counts too large for an image fail conversion.",
      validateInput: (value) =>
        /^[1-9]\d*$/.test(value.trim()) && Number.isSafeInteger(Number(value))
          ? undefined
          : "Enter a whole number of at least 1, including the base image.",
    });
    if (count === undefined) return;
    encoding.mipmaps = Number(count);
  } else encoding.mipmaps = mipmaps.value;
  return { encoding };
}
