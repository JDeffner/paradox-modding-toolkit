import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { PxtkRequest } from "@px-lsp/protocol/agentTools";
import { digest, isWithin, type Configuration } from "./config";
import { ToolError, errorMessage } from "./errors";

export interface Change {
  file: string;
  before: Buffer | null;
  after: Buffer;
  text?: boolean;
}
export interface InputSnapshot {
  file: string;
  bytes: Buffer;
}

export async function readOptional(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export function utf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
/** Writes stay in the selected mod, including through existing path components. */
export async function targetPath(config: Configuration, name: string): Promise<string> {
  const file = path.resolve(config.mod, name);
  if (file === config.mod || !isWithin(config.mod, file))
    throw new ToolError("outside_mod", "Destination must be inside the editable mod: " + file);
  for (const root of [config.gamePath, ...config.parents]) {
    if (root && isWithin(root, file))
      throw new ToolError("read_only_source", "Read-only destination: " + file);
  }
  let current = config.mod;
  for (const part of path.relative(config.mod, file).split(path.sep)) {
    current = path.join(current, part);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
        throw new ToolError("linked_destination", "Linked destinations are not writable: " + current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return file;
}
export async function changeFor(
  config: Configuration,
  file: string,
  after: string | Buffer
): Promise<Change> {
  file = await targetPath(config, file);
  return {
    file,
    before: await readOptional(file),
    after: Buffer.from(after),
    text: typeof after === "string",
  };
}

/** A token binds a preview to its exact inputs and outputs; each application recomputes it. */
export async function finishChanges(
  config: Configuration,
  request: PxtkRequest,
  proposed: Change[],
  inputs: InputSnapshot[] = [],
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const changes = proposed.filter((change) => !change.before?.equals(change.after));
  const names = changes.map((change) => change.file.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new ToolError("duplicate_output", "Several inputs map to the same output.");
  const token = digest(
    JSON.stringify({
      changes: changes.map((c) => [c.file, c.before && digest(c.before), digest(c.after)]),
      inputs: inputs.map((s) => [s.file, digest(s.bytes)]),
    })
  );
  if (request.expect && request.expect !== token)
    throw new ToolError("stale_preview", "Inputs or options changed. Generate a fresh preview.");
  const assertCurrent = async () => {
    signal?.throwIfAborted();
    for (const input of inputs) {
      if (!(await readOptional(input.file))?.equals(input.bytes))
        throw new ToolError("stale_preview", "Source changed: " + input.file);
    }
    for (const change of changes) {
      await targetPath(config, change.file);
      const current = await readOptional(change.file);
      if (current === null ? change.before !== null : !change.before?.equals(current))
        throw new ToolError("stale_preview", "Destination changed: " + change.file);
    }
  };
  await assertCurrent();
  const written: string[] = [];
  if (request.write) {
    const staged: Array<{ change: Change; temp: string }> = [];
    try {
      for (const change of changes) {
        await fs.mkdir(path.dirname(change.file), { recursive: true });
        const temp = path.join(path.dirname(change.file), ".pxtk-" + randomUUID() + ".tmp");
        await fs.writeFile(temp, change.after, { flag: "wx", mode: 0o600 });
        staged.push({ change, temp });
      }
      await assertCurrent();
      for (const { change, temp } of staged) {
        signal?.throwIfAborted();
        if (change.before === null) {
          await fs.link(temp, change.file);
        } else {
          const current = await fs.readFile(change.file);
          if (!current.equals(change.before))
            throw new ToolError("stale_preview", "Destination changed: " + change.file);
          await fs.chmod(temp, (await fs.stat(change.file)).mode);
          await fs.rename(temp, change.file);
        }
        written.push(change.file);
      }
    } catch (error) {
      throw new ToolError(
        "write_failed",
        errorMessage(error) + "\nCompleted files: " + JSON.stringify(written)
      );
    } finally {
      for (const { temp } of staged) await fs.rm(temp, { force: true });
    }
  }
  return {
    mode: request.write ? "written" : request.check ? "check" : "preview",
    previewToken: token,
    changed: changes.length,
    written,
    files: changes.map((c) => ({
      file: path.relative(config.mod, c.file).replace(/\\/g, "/"),
      action: c.before === null ? "create" : "update",
      beforeSha256: c.before && digest(c.before),
      afterSha256: digest(c.after),
      bytes: c.after.length,
      ...(c.text
        ? { content: utf8(c.after).slice(0, 16000), contentTruncated: utf8(c.after).length > 16000 }
        : {}),
    })),
  };
}
