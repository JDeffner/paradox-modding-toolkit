import * as vscode from "vscode";
import * as path from "node:path";
import { ImageCodec, IMAGE_MIME, type ImageFormat, type ImageEncoding } from "./imageCodec";
import { collectImageInputs, convertImageBatch, type BatchResult } from "./imageBatch";

export type ConversionMode = "images" | "toDds" | "fromDds";

export async function convertImagesCommand(
  mode: ConversionMode,
  arg?: vscode.Uri,
  multi?: vscode.Uri[]
): Promise<BatchResult | undefined> {
  const extensions = new Set(
    mode === "fromDds" ? [".dds"] : [...Object.keys(IMAGE_MIME), ...(mode === "images" ? [".dds"] : [])]
  );
  let sources = multi?.length ? multi : arg ? [arg] : [];
  if (!sources.length) {
    sources =
      (await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        filters: { Images: [...extensions].map((ext) => ext.slice(1)) },
        title: "Select images to convert",
      })) ?? [];
  }
  if (!sources.length) return;
  if (sources.some((uri) => uri.scheme !== "file")) {
    void vscode.window.showErrorMessage(
      "PX Toolkit: image conversion requires files on the extension host's filesystem."
    );
    return;
  }
  try {
    const stats = await Promise.all(sources.map((uri) => vscode.workspace.fs.stat(uri)));
    let recursive = false;
    if (stats.some((stat) => (stat.type & vscode.FileType.Directory) !== 0)) {
      const choice = await vscode.window.showQuickPick(["Include subfolders", "Selected folder only"], {
        title: "Folders to convert",
      });
      if (!choice) return;
      recursive = choice === "Include subfolders";
    }
    const format =
      mode === "toDds"
        ? "dds"
        : (
            await vscode.window.showQuickPick(
              [
                { label: "PNG", description: "Lossless, preserves transparency", format: "png" as const },
                { label: "JPEG", description: "Lossy, uses a solid background", format: "jpeg" as const },
                { label: "WebP", description: "Lossy, preserves transparency", format: "webp" as const },
                ...(mode === "images"
                  ? [{ label: "DDS", description: "Game texture", format: "dds" as const }]
                  : []),
              ],
              { title: "Output image format" }
            )
          )?.format;
    if (!format) return;
    const encoding: ImageEncoding = { format: format as ImageFormat, dds: "auto", background: "white" };
    if (format === "dds") {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "Auto", description: "BC3 with transparency, BC1 otherwise", format: "auto" as const },
          { label: "BC1 / DXT1", description: "Compressed, no alpha", format: "bc1" as const },
          { label: "BC3 / DXT5", description: "Compressed with alpha", format: "bc3" as const },
          { label: "Uncompressed (A8R8G8B8)", description: "Lossless", format: "bgra8" as const },
        ],
        { title: "DDS format" }
      );
      if (!choice) return;
      encoding.dds = choice.format;
    }
    if (format === "jpeg") {
      const choice = await vscode.window.showQuickPick(["White", "Black"], {
        title: "JPEG background for transparent pixels",
      });
      if (!choice) return;
      encoding.background = choice === "Black" ? "black" : "white";
    }
    const location = await vscode.window.showQuickPick(["Choose output folder", "Beside source files"], {
      title: "Conversion destination",
    });
    if (!location) return;
    let destination: string | undefined;
    if (location === "Choose output folder") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "Output folder",
      });
      if (!picked?.length) return;
      destination = picked[0].fsPath;
    }
    const codec = new ImageCodec();
    let result: BatchResult;
    try {
      result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Converting images", cancellable: true },
        async (progress, token) => {
          progress.report({ message: "Finding images" });
          const inputs = await collectImageInputs(
            sources.map((uri) => uri.fsPath),
            extensions,
            recursive,
            () => token.isCancellationRequested
          );
          return convertImageBatch(
            inputs,
            { ...encoding, destination, overwrite: false },
            {
              decode: (bytes, ext) => codec.decode(bytes, ext, token),
              encode: (image, options) => codec.encode(image, options, token),
            },
            {
              resolveConflict: async (file) => {
                const choice = await vscode.window.showWarningMessage(
                  `An output already exists: ${path.basename(file)}. Choose how to handle existing outputs in this batch. Source images are always preserved.`,
                  "Skip Existing",
                  "Overwrite Outputs"
                );
                return choice === "Skip Existing"
                  ? "skip"
                  : choice === "Overwrite Outputs"
                    ? "overwrite"
                    : "cancel";
              },
              cancelled: () => token.isCancellationRequested,
              report: (file, _completed, total) =>
                progress.report({ message: path.basename(file), increment: 100 / total }),
            }
          );
        }
      );
    } finally {
      codec.dispose();
    }
    const summary = `PX Toolkit: ${result.written.length} converted, ${result.skipped.length} skipped, ${result.failed.length} failed${result.cancelled ? "; cancelled" : ""}.`;
    if (result.failed.length) {
      const choice = await vscode.window.showErrorMessage(summary, "Show errors");
      if (choice) {
        const document = await vscode.workspace.openTextDocument({
          content: result.failed.map(({ file, message }) => `${file}: ${message}`).join("\n"),
          language: "plaintext",
        });
        await vscode.window.showTextDocument(document);
      }
    } else void vscode.window.showInformationMessage(summary);
    return result;
  } catch (error) {
    void vscode.window.showErrorMessage(
      `PX Toolkit: image conversion failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
}
