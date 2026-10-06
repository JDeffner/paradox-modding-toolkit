import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PatchDesiredOutput, PatchFile, PatchProject } from "@px-lsp/server/compatch/model";
import { validatePatchPath } from "@px-lsp/server/compatch/project";
import { parseLoc } from "@px-lsp/server/parser/locParser";
import { upsertLocalizationText } from "@px-lsp/protocol/localizationPolicy";
import type { AppliedFileChange, MigrationDocument } from "@px-lsp/server/migrations/node/files";
import type { PxConfig } from "../config";
import { LocalizationProject, localizationDefaultsFile, localizationRoots } from "../localizationProject";
import { prepareLocalizationWrite } from "../locCommands";
import { patchDocuments } from "./documents";

const bom = (text: string) => "\uFEFF" + text.replace(/^\uFEFF/, "");
interface OutputState {
  disk?: Buffer;
  document?: MigrationDocument;
  text?: string;
}

/** Read only regular files below the selected output, including unsaved editor text. */
async function readOutput(root: string, relative: string): Promise<OutputState> {
  validatePatchPath(relative);
  let filename = root;
  let absent = false;
  for (const segment of relative.split("/")) {
    filename = path.join(filename, segment);
    if (absent) continue;
    try {
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) throw new Error(`Output contains a link: ${relative}`);
      const names = await fs.readdir(path.dirname(filename));
      if (
        names.filter((name) => name.toLowerCase() === segment.toLowerCase()).length !== 1 ||
        !names.includes(segment)
      )
        throw new Error(`Output has an ambiguous file name: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      absent = true;
    }
  }
  let disk: Buffer | undefined;
  if (!absent) {
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
      throw new Error(`Output is not a supported text file: ${relative}`);
    disk = await fs.readFile(filename);
  }
  const document = patchDocuments(root).find((doc) => doc.path === relative);
  const diskText = disk && new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(disk);
  if (diskText?.includes("\0")) throw new Error(`Output is not UTF-8 text: ${relative}`);
  return {
    disk,
    document,
    text: document ? (diskText?.startsWith("\uFEFF") ? "\uFEFF" : "") + document.text : diskText,
  };
}

/** Includes routing inputs so a newly added localization file cannot change ownership during apply. */
export class PatchOutputGuard {
  private readonly states = new Map<string, OutputState>();
  private localizationPaths: string[] = [];
  private constructor(
    readonly root: string,
    private readonly cfg: PxConfig
  ) {}
  static async capture(root: string, cfg: PxConfig, paths: string[]): Promise<PatchOutputGuard> {
    const guard = new PatchOutputGuard(root, { ...cfg, modPath: root });
    const localization = new LocalizationProject(guard.cfg);
    guard.localizationPaths = localization.documents.map((doc) => doc.path).sort();
    const defaults = path.relative(root, localizationDefaultsFile(guard.cfg)).replace(/\\/g, "/");
    for (const relative of new Set([...paths, ...guard.localizationPaths, defaults]))
      guard.states.set(relative, await readOutput(root, relative));
    return guard;
  }
  files(): PatchFile[] {
    return [...this.states].flatMap(([relative, state]) =>
      state.text === undefined ? [] : [{ path: relative, text: state.text }]
    );
  }
  text(relative: string): string | undefined {
    return this.states.get(relative)?.text;
  }
  async assertCurrent(): Promise<void> {
    const listed = new LocalizationProject(this.cfg).documents.map((doc) => doc.path).sort();
    if (JSON.stringify(listed) !== JSON.stringify(this.localizationPaths))
      throw new Error("Output localization changed. Build the patch again.");
    for (const [relative, before] of this.states) {
      const current = await readOutput(this.root, relative);
      if (
        (before.disk ? !current.disk?.equals(before.disk) : current.disk !== undefined) ||
        JSON.stringify(current.document) !== JSON.stringify(before.document)
      )
        throw new Error(`${relative} changed. Build the patch again.`);
    }
  }
  applied(file: AppliedFileChange): void {
    const relative = file.path;
    const state: OutputState = {
      disk: file.after === undefined ? undefined : Buffer.from(file.after),
      document: file.documentAfter,
      text:
        file.after === undefined
          ? undefined
          : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.after),
    };
    this.states.set(relative, state);
    if (
      localizationRoots(this.cfg).some((root) => relative.startsWith(`${root}/`)) &&
      /_l_[a-z_]+\.yml$/i.test(relative)
    ) {
      this.localizationPaths = this.localizationPaths.filter((file) => file !== relative);
      if (state.text !== undefined) this.localizationPaths.push(relative);
      this.localizationPaths.sort();
    }
  }
}

/** Resolve key ownership with the same policy used by every localization writer. */
export async function routePatchLocalization(
  project: PatchProject,
  desired: PatchDesiredOutput,
  cfg: PxConfig
): Promise<{ project: PatchProject; desired: PatchDesiredOutput }> {
  const staged = structuredClone(project);
  const routed = new Map<string, { path: string; text: string; entries: string[] }>();
  const files = desired.files.filter((file) => !file.localization);
  for (const file of desired.files.filter((file) => file.localization)) {
    const metadata = file.localization!;
    const parsed = parseLoc(file.text);
    if (parsed.errors.length || parsed.language !== metadata.language)
      throw new Error(`Invalid generated localization: ${file.path}`);
    for (const entry of parsed.entries.filter((entry) => metadata.keys.includes(entry.key))) {
      const write = await prepareLocalizationWrite(cfg, async () => [], entry.key, {
        language: metadata.language,
        override: true,
        sourcePath: metadata.sourcePath,
        fallbackPath: `${metadata.sourcePath.split("/")[0]}/replace/${path.basename(file.path)}`,
        relatedKeys: metadata.keys,
      });
      if (!write) throw new Error("Localization routing was cancelled.");
      const relative = path.relative(cfg.modPath!, write.file).replace(/\\/g, "/");
      if (!relative.split("/").includes("replace"))
        throw new Error(
          `${entry.key} belongs to ${relative}, which is outside replace. Move that entry to a replace file before generating an override.`
        );
      let destination = routed.get(relative);
      if (!destination) {
        const previous = staged.generated[relative];
        const current = await readOutput(cfg.modPath!, relative);
        const original = previous
          ? typeof previous.original === "string"
            ? previous.original
            : ""
          : (current.text ?? "");
        if (!previous && current.text !== undefined)
          staged.generated[relative] = { text: current.text, entries: [], original: current.text };
        destination = { path: relative, text: original, entries: [] };
        routed.set(relative, destination);
      }
      destination.text = bom(
        upsertLocalizationText(
          destination.text,
          metadata.language,
          entry.key,
          entry.value,
          new LocalizationProject(cfg).defaults.entryVersion
        )
      );
      destination.entries = [...new Set([...destination.entries, ...file.entries])];
    }
  }
  for (const file of routed.values()) {
    if (files.some((other) => other.path === file.path))
      throw new Error(`Multiple generators target ${file.path}`);
    files.push(file);
  }
  return { project: staged, desired: { ...desired, files } };
}
