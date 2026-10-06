import * as fs from "node:fs";
import * as path from "node:path";
import { PREVIEW_MAX_BYTES } from "./preflight";
import type { EncodedPreview } from "../webviews/workshop/messages";
import { ORDER_FILE, PREVIEWS_DIR } from "./workshopFiles";

export const PREVIEW_ORIGINALS_DIR = "preview-originals";

const readOptional = (file: string): Buffer | null => {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** Prepare the entire gallery before moving originals or changing any listing files. */
export async function preparePreviewImages(
  images: readonly string[],
  directory: string,
  workshopDir: string | null,
  encode: (dataUri: string) => Promise<EncodedPreview>,
  report: (message: string) => void,
  signal?: AbortSignal,
  beforeApply?: () => void
): Promise<string[]> {
  const snapshots = images.map((file) => ({ file, bytes: fs.readFileSync(file) }));
  const gallery = workshopDir ? path.join(workshopDir, PREVIEWS_DIR) : null;
  const orderFile = gallery ? path.join(gallery, ORDER_FILE) : null;
  const order = orderFile ? readOptional(orderFile) : null;
  const names = gallery ? fs.readdirSync(gallery).sort() : [];
  const reserved = new Set(names.map((name) => name.toLowerCase()));
  const changes: { file: string; target: string; bytes: Buffer; original: Buffer }[] = [];
  const prepared: string[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const { file } = snapshot;
    const name = path.basename(file);
    try {
      let bytes = snapshot.bytes;
      let targetName = name;
      if (bytes.length >= PREVIEW_MAX_BYTES) {
        const ext = path.extname(file).toLowerCase();
        if (ext === ".gif")
          throw new Error(
            "GIF previews must be under 1 MB. Resize the GIF before uploading to preserve its animation."
          );
        if (!gallery)
          throw new Error("the image now needs a smaller copy. Start the upload again to confirm.");
        const mime = ext === ".png" ? "image/png" : "image/jpeg";
        const result = await encode(`data:${mime};base64,${bytes.toString("base64")}`);
        bytes = Buffer.from(result.data, "base64");
        if (bytes.length === 0 || bytes.length >= PREVIEW_MAX_BYTES)
          throw new Error("the prepared image is not under Steam's 1 MB limit");
        targetName = path.parse(name).name + (result.mime === "image/png" ? ".png" : ".jpg");
        const outputExt = path.extname(targetName);
        const stem = path.parse(targetName).name;
        for (let suffix = 1; targetName !== name && reserved.has(targetName.toLowerCase()); suffix++)
          targetName = `${stem}-${suffix}${outputExt}`;
        reserved.add(targetName.toLowerCase());
        changes.push({ file, target: path.join(gallery, targetName), bytes, original: snapshot.bytes });
      }
      // Separate directories avoid collisions between foo.png and foo.jpg after conversion.
      const folder = path.join(directory, String(index));
      fs.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, targetName);
      fs.writeFileSync(target, bytes);
      prepared.push(target);
    } catch (e) {
      throw new Error(`Cannot prepare preview "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  signal?.throwIfAborted();
  if (changes.length && gallery && orderFile && workshopDir) {
    beforeApply?.();
    // Encoding yields to the editor. Refuse to apply an obsolete gallery or order.
    if (
      JSON.stringify(fs.readdirSync(gallery).sort()) !== JSON.stringify(names) ||
      !snapshots.every(({ file, bytes }) => readOptional(file)?.equals(bytes)) ||
      !(order === null ? readOptional(orderFile) === null : readOptional(orderFile)?.equals(order))
    )
      throw new Error("The preview gallery changed during conversion. Start the upload again.");
    const archiveRoot = path.join(workshopDir, PREVIEW_ORIGINALS_DIR);
    fs.mkdirSync(archiveRoot, { recursive: true });
    const archive = fs.mkdtempSync(path.join(archiveRoot, "originals-"));
    const moved: typeof changes = [];
    const written: typeof changes = [];
    let writingOrder = false;
    try {
      for (const change of changes) {
        // An exclusive copy also supports a linked image whose target is read-only.
        fs.copyFileSync(
          change.file,
          path.join(archive, path.basename(change.file)),
          fs.constants.COPYFILE_EXCL
        );
        fs.unlinkSync(change.file);
        moved.push(change);
        fs.writeFileSync(change.target, change.bytes, { flag: "wx" });
        written.push(change);
      }
      const replacements = new Map(changes.map((change) => [change.file, change.target]));
      const byName = new Map(
        images.map((file) => [path.basename(file), path.basename(replacements.get(file) ?? file)])
      );
      const listed = new Set<string>();
      const newline = order?.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
      let nextOrder = (order?.toString("utf8") ?? "")
        .split(/\r?\n/)
        .map((line) => {
          const name = line.trim();
          if (!byName.has(name)) return line;
          listed.add(name);
          return line.replace(name, byName.get(name)!);
        })
        .join(newline);
      if (nextOrder && !nextOrder.endsWith(newline)) nextOrder += newline;
      nextOrder += images
        .filter((file) => !listed.has(path.basename(file)))
        .map((file) => byName.get(path.basename(file)) + newline)
        .join("");
      writingOrder = true;
      fs.writeFileSync(orderFile, nextOrder);
    } catch (error) {
      const recovery: string[] = [];
      for (const change of written.reverse()) {
        try {
          if (readOptional(change.target)?.equals(change.bytes)) fs.unlinkSync(change.target);
        } catch (failure) {
          recovery.push(String(failure));
        }
      }
      for (const change of moved) {
        try {
          fs.copyFileSync(
            path.join(archive, path.basename(change.file)),
            change.file,
            fs.constants.COPYFILE_EXCL
          );
        } catch (failure) {
          recovery.push(String(failure));
        }
      }
      if (writingOrder) {
        try {
          if (order) fs.writeFileSync(orderFile, order);
          else fs.rmSync(orderFile, { force: true });
        } catch (failure) {
          recovery.push(String(failure));
        }
      }
      throw new Error(
        `Could not update the preview gallery: ${String(error)}. Originals are saved in ${archive}.${recovery.length ? ` Recovery needs attention: ${recovery.join("; ")}` : " The previous gallery was restored."}`
      );
    }
    report(
      `Saved ${changes.length} smaller preview(s) in ${gallery}. Full-size originals are in ${archive}.`
    );
  }
  return prepared;
}
