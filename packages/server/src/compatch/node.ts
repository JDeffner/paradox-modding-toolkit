import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { hasUtf8Bom } from "../parser/encoding";
import { parseScript } from "../parser/parser";
import { assertFileChangePath, resolveFileChangeRoots } from "../migrations/node/files";
import type {
  PatchDesiredOutput,
  PatchFile,
  PatchOutputPlan,
  PatchPolicy,
  PatchProject,
  PatchSnapshot,
  PatchSource,
} from "./model";
import { parsePatchProject, validatePatchPath } from "./project";

export interface PatchSourceDocument {
  sourceId: string;
  path: string;
  text: string;
  version: number;
  dirty: boolean;
}
export interface PatchSourceBindings {
  output: string;
  sources: Record<string, string>;
}
export interface PatchCaptureOptions {
  documents?: PatchSourceDocument[];
  signal?: AbortSignal;
}
export interface PatchCapture {
  snapshot: PatchSnapshot;
  stamp: string;
  bindings: PatchSourceBindings;
  /** Includes binary inventory and disk bytes hidden by dirty editor buffers. */
  inventory: {
    sourceId: string;
    path: string;
    kind: "directory" | "text" | "binary" | "editor";
    size: number;
    diskHash?: string;
    modified?: number;
  }[];
}

// Same text formats as the existing compatibility scan; binaries remain explicit inventory issues.
const textExtensions = new Set([
  ".txt",
  ".gui",
  ".yml",
  ".yaml",
  ".asset",
  ".gfx",
  ".mod",
  ".json",
  ".lua",
  ".shader",
  ".fx",
  ".fxh",
  ".csv",
  ".info",
  ".settings",
  ".map",
  ".md",
]);
const captureLimits = {
  fileBytes: 32 * 1024 * 1024,
  inputBytes: 128 * 1024 * 1024,
  files: 10_000,
  listingEntries: 100_000,
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const decode = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const skip = (relative: string) =>
  relative
    .split("/")
    .some((part) => (part.startsWith(".") && part !== ".metadata") || part === "node_modules");

function descriptor(source: PatchSource, text: string): void {
  const parsed = parseScript(text);
  if (parsed.errors.length) throw new Error(`Invalid descriptor.mod in ${source.name}`);
  for (const node of parsed.root.statements) {
    if (node.kind !== "assignment") continue;
    if ((node.key.text === "name" || node.key.text === "version") && node.value?.kind === "scalar") {
      if (node.key.text === "name") source.name = node.value.text;
      else source.version = node.value.text;
    } else if (node.key.text === "replace_path") {
      if (node.value?.kind !== "scalar") throw new Error(`Invalid replace_path in ${source.name}`);
      source.replacePaths.push(validatePatchPath(node.value.text));
    } else if (node.key.text === "dependencies") {
      if (node.value?.kind !== "block") throw new Error(`Invalid dependencies in ${source.name}`);
      for (const dependency of node.value.statements) {
        if (dependency.kind !== "value" || dependency.value.kind !== "scalar")
          throw new Error(`Invalid dependency in ${source.name}`);
        source.dependencies.push(dependency.value.text);
      }
    }
  }
}

/** Capture every source in declared launcher order, retaining exact text and editor provenance. */
export async function capturePatchSources(
  project: PatchProject,
  bindings: PatchSourceBindings,
  policy: PatchPolicy,
  options: PatchCaptureOptions = {}
): Promise<PatchCapture> {
  project = parsePatchProject(project);
  bindings = structuredClone(bindings);
  policy = structuredClone(policy);
  const documents = structuredClone(options.documents ?? []);
  const signal = options.signal;
  const cancelled = () => {
    if (signal?.aborted) throw new Error("Patch capture cancelled");
  };
  cancelled();
  const roots = await resolveFileChangeRoots(
    bindings.output,
    project.inputs.map((input) => {
      const root = bindings.sources[input.id];
      if (!root) throw new Error(`Source folder is not configured: ${input.name}`);
      return root;
    })
  );
  const canonical: PatchSourceBindings = { output: roots.root, sources: {} };
  project.inputs.forEach((input, index) => {
    canonical.sources[input.id] = roots.protectedRoots[index];
  });
  const overlays = new Map<string, PatchSourceDocument>();
  const sourceIds = new Set(project.inputs.map((input) => input.id));
  for (const document of documents) {
    validatePatchPath(document.path);
    if (
      !sourceIds.has(document.sourceId) ||
      !Number.isSafeInteger(document.version) ||
      typeof document.text !== "string" ||
      typeof document.dirty !== "boolean" ||
      document.text.startsWith("\uFEFF")
    )
      throw new Error(`Invalid source editor document: ${document.path}`);
    const identity = JSON.stringify([document.sourceId, document.path.toLowerCase()]);
    if (overlays.has(identity)) throw new Error(`Duplicate source editor document: ${document.path}`);
    overlays.set(identity, document);
  }
  const snapshot: PatchSnapshot = { gameId: project.gameId, sources: [] };
  const inventory: PatchCapture["inventory"] = [];
  let capturedBytes = 0;
  let capturedFiles = 0;
  const charge = (size: number) => {
    if (
      size > captureLimits.fileBytes ||
      (capturedBytes += size) > captureLimits.inputBytes ||
      ++capturedFiles > captureLimits.files
    )
      throw new Error("Patch source capture limit exceeded. Select fewer or smaller source mods.");
  };
  const addInventory = (entry: PatchCapture["inventory"][number]) => {
    if (inventory.length >= captureLimits.listingEntries)
      throw new Error("Patch source inventory limit exceeded");
    inventory.push(entry);
  };
  for (const input of project.inputs) {
    cancelled();
    const root = canonical.sources[input.id];
    const source: PatchSource = { ...input, files: [], replacePaths: [], dependencies: [], issues: [] };
    const seen = new Set<string>();
    let descriptorText: string | undefined;
    const readText = async (relative: string, size: number): Promise<void> => {
      cancelled();
      const filename = await assertFileChangePath(root, relative);
      const document = overlays.get(JSON.stringify([input.id, relative.toLowerCase()]));
      if (document && document.path !== relative)
        throw new Error(`Case collision or alias: ${document.path}`);
      charge(size);
      const disk = await fs.readFile(filename);
      if (disk.length > captureLimits.fileBytes || disk.length !== size)
        throw new Error(`Source changed during capture: ${relative}`);
      let text: string;
      try {
        text = decode(disk);
      } catch {
        throw new Error(`Source is not valid UTF-8: ${input.name}/${relative}`);
      }
      if (document) {
        const editorSize = Buffer.byteLength(document.text, "utf8");
        if (editorSize > captureLimits.fileBytes || (capturedBytes += editorSize) > captureLimits.inputBytes)
          throw new Error("Patch source capture limit exceeded");
        text = (hasUtf8Bom(disk) ? "\uFEFF" : "") + document.text;
      }
      addInventory({
        sourceId: input.id,
        path: relative,
        kind: "text",
        size: disk.length,
        diskHash: hash(disk),
      });
      seen.add(relative);
      if (relative === "descriptor.mod") descriptorText = text;
      else source.files.push({ path: relative, text });
    };
    const walk = async (relative: string): Promise<void> => {
      cancelled();
      const directory = await assertFileChangePath(root, relative);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const names = new Set<string>();
      for (const entry of entries) {
        cancelled();
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (skip(child)) continue;
        validatePatchPath(child);
        if (names.has(entry.name.toLowerCase())) throw new Error(`Case collision or alias: ${child}`);
        names.add(entry.name.toLowerCase());
        const filename = path.join(directory, entry.name);
        const stat = await fs.lstat(filename);
        if (
          stat.isSymbolicLink() ||
          path.resolve(await fs.realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase()
        )
          throw new Error(`Links are not patch source inputs: ${child}`);
        if (stat.isDirectory()) {
          addInventory({ sourceId: input.id, path: child, kind: "directory", size: 0 });
          await walk(child);
        } else if (stat.isFile()) {
          if (textExtensions.has(path.extname(child).toLowerCase())) await readText(child, stat.size);
          else {
            addInventory({
              sourceId: input.id,
              path: child,
              kind: "binary",
              size: stat.size,
              modified: stat.mtimeMs,
            });
            source.issues.push(`Binary file requires external review and is not generated: ${child}`);
          }
        } else throw new Error(`Not a regular patch source file: ${child}`);
      }
    };
    await walk("");
    for (const document of documents.filter((item) => item.sourceId === input.id)) {
      if (skip(document.path) || seen.has(document.path)) continue;
      if (!textExtensions.has(path.extname(document.path).toLowerCase())) {
        source.issues.push(`Editor file requires external review and is not generated: ${document.path}`);
        continue;
      }
      cancelled();
      await assertFileChangePath(root, document.path);
      const size = Buffer.byteLength(document.text, "utf8");
      charge(size);
      addInventory({ sourceId: input.id, path: document.path, kind: "editor", size });
      if (document.path === "descriptor.mod") descriptorText = document.text;
      else source.files.push({ path: document.path, text: document.text });
    }
    if (descriptorText !== undefined) descriptor(source, descriptorText);
    else
      source.issues.push(
        "descriptor.mod is missing; launcher name, version and dependency metadata cannot be verified."
      );
    source.files.sort((a, b) => a.path.localeCompare(b.path));
    snapshot.sources.push(source);
  }
  cancelled();
  await resolveFileChangeRoots(
    canonical.output,
    project.inputs.map((input) => canonical.sources[input.id])
  );
  inventory.sort((a, b) => `${a.sourceId}:${a.path}`.localeCompare(`${b.sourceId}:${b.path}`));
  documents.sort((a, b) => `${a.sourceId}:${a.path}`.localeCompare(`${b.sourceId}:${b.path}`));
  const stamp = hash(
    JSON.stringify({
      gameId: project.gameId,
      inputs: project.inputs,
      bindings: canonical,
      policy,
      snapshot,
      inventory,
      documents,
    })
  );
  return { snapshot, inventory, stamp, bindings: canonical };
}

export async function assertPatchSourcesFresh(
  capture: PatchCapture,
  project: PatchProject,
  bindings: PatchSourceBindings,
  policy: PatchPolicy,
  options: PatchCaptureOptions = {}
): Promise<void> {
  const stamp = capture.stamp;
  if ((await capturePatchSources(project, bindings, policy, options)).stamp !== stamp)
    throw new Error("Patch sources changed. Prepare a fresh preview.");
}

const run = promisify(execFile);
async function mergeText(current: string, previous: string, desired: string): Promise<string | undefined> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "px-patch-merge-"));
  try {
    const files = ["current", "previous", "desired"].map((name) => path.join(directory, name));
    await Promise.all(
      files.map((filename, index) => fs.writeFile(filename, [current, previous, desired][index], "utf8"))
    );
    try {
      return (
        await run("git", ["merge-file", "-p", "--diff3", "--", ...files], {
          windowsHide: true,
          maxBuffer: captureLimits.fileBytes * 3,
          encoding: "utf8",
        })
      ).stdout;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "number" && code > 0 && code <= 127) return undefined;
      if (code === "ENOENT")
        throw new Error(
          "Git is required to merge manual patch edits. Install Git, restart the editor, then build again.",
          { cause: error }
        );
      throw error;
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** Rebase new pure generated output onto independent manual edits, without taking over unrelated files. */
export async function preparePatchOutput(
  project: PatchProject,
  desired: PatchDesiredOutput,
  current: PatchFile[],
  resolutions: Record<string, "current" | "generated"> = {}
): Promise<PatchOutputPlan> {
  project = parsePatchProject(project);
  desired = structuredClone(desired);
  current = structuredClone(current);
  resolutions = structuredClone(resolutions);
  const existing = new Map<string, string>();
  const generated = new Map<string, (typeof desired.files)[number]>();
  const paths = new Map<string, string>();
  const register = (filename: string) => {
    validatePatchPath(filename);
    const previous = paths.get(filename.toLowerCase());
    if (previous && previous !== filename) throw new Error(`Case collision or alias: ${filename}`);
    paths.set(filename.toLowerCase(), filename);
  };
  for (const file of current) {
    register(file.path);
    if (existing.has(file.path) || typeof file.text !== "string")
      throw new Error(`Invalid current patch file: ${file.path}`);
    existing.set(file.path, file.text);
  }
  for (const file of desired.files) {
    register(file.path);
    if (generated.has(file.path) || typeof file.text !== "string" || !Array.isArray(file.entries))
      throw new Error(`Invalid generated patch file: ${file.path}`);
    generated.set(file.path, file);
  }
  for (const filename of Object.keys(project.generated)) register(filename);
  for (const [filename, choice] of Object.entries(resolutions)) {
    register(filename);
    if (choice !== "current" && choice !== "generated") throw new Error(`Invalid output choice: ${filename}`);
  }
  const result: PatchOutputPlan = { files: [], conflicts: [], project };
  const baseline: PatchProject["generated"] = {};
  for (const filename of new Set([...Object.keys(project.generated), ...generated.keys()])) {
    const previous = project.generated[filename];
    const next = generated.get(filename);
    const before = existing.get(filename);
    const target = next?.text ?? previous?.original;
    if (target !== undefined && typeof target !== "string")
      throw new Error(`Invalid original patch file: ${filename}`);
    let after = target;
    let conflict: string | undefined;
    if (resolutions[filename] === "current") after = before;
    else if (resolutions[filename] !== "generated") {
      if (!previous) {
        if (before !== undefined) conflict = "An existing file is not owned by this patch project.";
      } else if (!next && target === undefined) {
        if (before !== undefined && before !== previous.text)
          conflict = "An obsolete generated file has manual edits. Choose whether to keep or remove it.";
      } else if (before === undefined) {
        conflict =
          "A previously generated file was deleted. Choose whether to keep the deletion or generate it again.";
      } else if (before !== previous.text && before !== target && target !== previous.text) {
        after = await mergeText(before, previous.text, target!);
        if (after === undefined) conflict = "Manual edits overlap the new generated changes.";
      } else if (target === previous.text) after = before;
    }
    if (conflict) {
      result.conflicts.push({ path: filename, reason: conflict, current: before, generated: target });
      if (previous) baseline[filename] = previous;
      continue;
    }
    // Persist pure generated text, never the manually merged output.
    if (next)
      baseline[filename] = {
        ...previous,
        ...(!previous && before !== undefined ? { original: before } : {}),
        text: next.text,
        entries: [...next.entries],
      };
    if (before !== after) result.files.push({ path: filename, before, after });
  }
  project.generated = baseline;
  return result;
}
