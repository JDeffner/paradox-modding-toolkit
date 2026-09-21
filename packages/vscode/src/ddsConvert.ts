import * as vscode from "vscode";
import * as path from "node:path";
import { ImageCodec, IMAGE_MIME } from "./imageCodec";

export const CONVERTIBLE_IMAGE_EXT = Object.keys(IMAGE_MIME).map((ext) => ext.slice(1));

/** Creator writes use the same codecs and automatic compression as the batch converter. */
export async function convertImageToDds(source: vscode.Uri, target: vscode.Uri): Promise<void> {
  const codec = new ImageCodec();
  try {
    const image = await codec.decode(
      await vscode.workspace.fs.readFile(source),
      path.extname(source.path).toLowerCase()
    );
    const encoded = await codec.encode(image, { format: "dds", dds: "auto", background: "white" });
    await vscode.workspace.fs.writeFile(target, encoded);
  } finally {
    codec.dispose();
  }
}
