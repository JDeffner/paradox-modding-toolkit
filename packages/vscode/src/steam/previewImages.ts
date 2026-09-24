import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PREVIEW_MAX_BYTES } from "./preflight";
import type { EncodedPreview } from "../webviews/workshop/messages";

/** Snapshot every gallery image before Steam changes anything. Originals stay read-only. */
export async function preparePreviewImages(
  images: readonly string[],
  directory: string,
  copiesDirectory: string | null,
  encode: (dataUri: string) => Promise<EncodedPreview>,
  report: (message: string) => void
): Promise<string[]> {
  const prepared: string[] = [];
  for (const [index, file] of images.entries()) {
    const name = path.basename(file);
    try {
      let bytes = await fs.readFile(file);
      let targetName = name;
      if (bytes.length >= PREVIEW_MAX_BYTES) {
        const ext = path.extname(file).toLowerCase();
        if (ext === ".gif")
          throw new Error(
            "GIF previews must be under 1 MB. Resize the GIF before uploading to preserve its animation."
          );
        if (!copiesDirectory)
          throw new Error("the image now needs a smaller copy. Start the upload again to confirm.");
        const mime = ext === ".png" ? "image/png" : "image/jpeg";
        const result = await encode(`data:${mime};base64,${bytes.toString("base64")}`);
        const originalSize = bytes.length;
        bytes = Buffer.from(result.data, "base64");
        if (bytes.length === 0 || bytes.length >= PREVIEW_MAX_BYTES)
          throw new Error("the prepared image is not under Steam's 1 MB limit");
        targetName = path.parse(name).name + (result.mime === "image/png" ? ".png" : ".jpg");
        const copyFolder = path.join(copiesDirectory, String(index + 1));
        await fs.mkdir(copyFolder, { recursive: true });
        const copy = path.join(copyFolder, targetName);
        await fs.writeFile(copy, bytes, { flag: "wx" });
        report(
          `${name}: saved smaller copy to ${copy} (${originalSize} -> ${bytes.length} bytes). Original unchanged.`
        );
      }
      // Separate directories avoid collisions between foo.png and foo.jpg after conversion.
      const folder = path.join(directory, String(index));
      await fs.mkdir(folder, { recursive: true });
      const target = path.join(folder, targetName);
      await fs.writeFile(target, bytes);
      prepared.push(target);
    } catch (e) {
      throw new Error(`Cannot prepare preview "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return prepared;
}
