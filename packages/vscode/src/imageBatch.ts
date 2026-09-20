import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ImageEncoding, ImagePixels } from "./imageCodec";

export interface ImageInput {
  file: string;
  relative: string;
}
export interface BatchOptions extends ImageEncoding {
  destination?: string;
  overwrite: boolean;
}
export interface BatchResult {
  written: string[];
  skipped: string[];
  failed: { file: string; message: string }[];
  cancelled: boolean;
}
export interface BatchControl {
  cancelled(): boolean;
  report(file: string, completed: number, total: number): void;
}
export interface BatchCodec {
  decode(bytes: Uint8Array, ext: string): Promise<ImagePixels>;
  encode(image: ImagePixels, options: ImageEncoding): Promise<Uint8Array>;
}

const pathKey = (file: string) =>
  process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file);

/** Folder selections retain their relative paths. Symlinks are never followed. */
export async function collectImageInputs(
  selections: string[],
  extensions: ReadonlySet<string>,
  recursive: boolean,
  cancelled: () => boolean
): Promise<ImageInput[]> {
  const inputs: ImageInput[] = [];
  const seen = new Set<string>();
  async function visit(file: string, relative: string): Promise<void> {
    if (cancelled()) return;
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      const entries = await fs.readdir(file, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && !recursive) continue;
        await visit(path.join(file, entry.name), path.join(relative, entry.name));
      }
    } else if (
      stat.isFile() &&
      extensions.has(path.extname(file).toLowerCase()) &&
      !seen.has(pathKey(file))
    ) {
      seen.add(pathKey(file));
      inputs.push({ file, relative });
    }
  }
  for (const file of selections) {
    const stat = await fs.lstat(file);
    await visit(file, stat.isDirectory() && selections.length === 1 ? "" : path.basename(file));
  }
  return inputs;
}

/** A batch cannot overwrite an input or let two inputs silently replace each other. */
export async function convertImageBatch(
  inputs: ImageInput[],
  options: BatchOptions,
  codec: BatchCodec,
  control: BatchControl
): Promise<BatchResult> {
  const result: BatchResult = { written: [], skipped: [], failed: [], cancelled: false };
  const sources = new Set(inputs.map((input) => pathKey(input.file)));
  const outputs = new Set<string>();
  const ext = options.format === "jpeg" ? ".jpg" : `.${options.format}`;
  for (const [index, input] of inputs.entries()) {
    if (control.cancelled()) break;
    control.report(input.file, index, inputs.length);
    const relative = input.relative.slice(0, -path.extname(input.relative).length) + ext;
    const target = options.destination
      ? path.join(options.destination, relative)
      : input.file.slice(0, -path.extname(input.file).length) + ext;
    const key = pathKey(target);
    if (sources.has(key) || outputs.has(key)) {
      result.skipped.push(target);
      continue;
    }
    outputs.add(key);
    let temporary: string | undefined;
    try {
      try {
        const existing = await fs.lstat(target);
        if (!options.overwrite) {
          result.skipped.push(target);
          continue;
        }
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Output is not a regular file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const bytes = await fs.readFile(input.file);
      const image = await codec.decode(bytes, path.extname(input.file).toLowerCase());
      if (control.cancelled()) break;
      const encoded = await codec.encode(image, options);
      if (control.cancelled()) break;
      await fs.mkdir(path.dirname(target), { recursive: true });
      temporary = path.join(path.dirname(target), `.px-image-${randomUUID()}.tmp`);
      await fs.writeFile(temporary, encoded, { flag: "wx" });
      if (control.cancelled()) break;
      if (options.overwrite) await fs.rename(temporary, target);
      else {
        // Exclusive copy also works on filesystems without hard-link support.
        try {
          await fs.copyFile(temporary, target, constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          result.skipped.push(target);
          continue;
        }
        await fs.unlink(temporary);
      }
      temporary = undefined;
      result.written.push(target);
    } catch (error) {
      if (control.cancelled()) break;
      result.failed.push({
        file: input.file,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (temporary) {
        try {
          await fs.unlink(temporary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            result.failed.push({
              file: temporary,
              message: `Temporary file cleanup failed: ${String(error)}`,
            });
        }
      }
    }
  }
  result.cancelled = control.cancelled();
  return result;
}
