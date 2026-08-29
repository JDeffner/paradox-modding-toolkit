/**
 * Fused definition + reference scan of one workspace-mod root.
 *
 * A mod root used to be walked twice: once over the ~156 schema folders for
 * definitions, then once over the whole root for `.txt` references. 154 of the
 * default profile's 156 schema entries are `.txt`, so the two file sets overlap on
 * essentially all script and every file was read twice and parsed twice.
 * Measured on game + 5 Workshop mods (29,641 script files): AGOT alone spent
 * 8,743 ms on 3,482 definition files and 30,023 ms on 4,497 reference files.
 *
 * This walks the root once for `.txt`, reads each file once, parses it once and
 * feeds that one CST to both extractors. `classifyFile` supplies the schema
 * entry the definition pass would have found it under, which is also what the
 * incremental rescan uses, so scan and rescan now classify identically. The
 * `.yml` localization and `.gui` entries are not `.txt` and keep the
 * schema-folder listing.
 *
 * The returned `defs` are ordered by schema entry and, within an entry, by walk
 * order — byte for byte what the schema-folder pass produced, because a DFS of
 * the root visits a schema subtree in the same order as a DFS of that subtree.
 *
 * No `vscode` imports: unit-tested in plain Node (see fusedScan.test.ts, which
 * runs this and the two-pass logic it replaces over the same fixture root).
 */
import * as path from "path";
import type { Definition, DefSource, Reference } from "@px-lsp/protocol/types";
import { iterFiles } from "@px-lsp/protocol/fsWalk";
import { pushAll } from "@px-lsp/protocol/arrays";
import { LineIndex, parseScript } from "../parser";
import type { SchemaData } from "../schema/loader";
import type { SchemaEntry } from "../schema/types";
import { classifyFile, isWantedLocFile } from "./indexer";
import { extractDefinitions, extractDefinitionsParsed } from "./extract";
import { extractReferencesParsed } from "./references";

/** Files read per batch, as in the two passes this replaces. */
const BATCH = 150;

export interface FusedScanDeps {
  schema: SchemaData;
  source: DefSource;
  locLanguage: string;
  /** Engine-token filter handed to reference extraction (see extractReferences). */
  isEngineToken?: (name: string) => boolean;
  /** Read a batch of files, BOM stripped, `null` for an unreadable one. */
  readBatch(files: string[]): Promise<Array<string | null>>;
  /** True when a newer scan superseded this one: abort and return null. */
  superseded(): boolean;
  yieldNow(): Promise<void>;
  onProgress?(percent: number, message: string): void;
  /**
   * References of one batch. A sink rather than a return value: a total
   * conversion contributes millions and buffering them for the whole root would
   * be pure heap pressure, exactly as the pass this replaces avoided.
   */
  addReferences(refs: Reference[]): void;
  /** `namespace = x` declarations of one file (only called when non-empty). */
  setNamespaces(file: string, namespaces: string[]): void;
}

export interface FusedScanResult {
  /** Schema definitions, schema-entry order (identical to the old defs pass). */
  defs: Definition[];
  /** save_scope_as / set_variable / flag sites, walk order (as the old ref pass). */
  implicitDefs: Definition[];
  /** Files read (script plus the non-`.txt` schema entries). */
  files: number;
  /** Script files read, i.e. what the old reference pass counted. */
  scriptFiles: number;
  references: number;
  /** Wall clock of the listing phase alone, for the perf trace. */
  listMs: number;
}

export async function scanModRootFused(root: string, deps: FusedScanDeps): Promise<FusedScanResult | null> {
  const tList = Date.now();
  const entries = deps.schema.entries;
  // Definitions are collected per schema entry and concatenated in schema order
  // at the end, so the result matches the folder-by-folder pass exactly.
  const defsByEntry: Definition[][] = entries.map(() => []);
  const entryIndex = new Map<SchemaEntry, number>();
  entries.forEach((e, i) => entryIndex.set(e, i));

  // A mod root is walked whole, gfx/ and all, so the listing yields on the same
  // rhythm as the read loop rather than blocking through it.
  const scriptFiles: string[] = [];
  for (const file of iterFiles(root, ".txt")) {
    if (file === null) {
      if (deps.superseded()) return null;
      await deps.yieldNow();
    } else {
      scriptFiles.push(file);
    }
  }

  // Schema entries the whole-root `.txt` walk cannot see: localization (.yml)
  // and gui (.gui). Listed exactly as the schema-folder pass listed them.
  const otherWork: Array<{ index: number; entry: SchemaEntry; files: string[] }> = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const ext = entry.ext ?? ".txt";
    if (ext === ".txt") continue;
    const dir = path.join(root, ...entry.path.split("/"));
    let files: string[] = [];
    for (const file of iterFiles(dir, ext)) {
      if (file === null) {
        if (deps.superseded()) return null;
        await deps.yieldNow();
      } else {
        files.push(file);
      }
    }
    if (entry.kind === "loc_key") {
      files = files.filter((f) => isWantedLocFile(path.relative(root, f), deps.locLanguage));
    }
    otherWork.push({ index: i, entry, files });
  }

  let total = scriptFiles.length;
  for (const w of otherWork) total += w.files.length;
  const listMs = Date.now() - tList;
  let done = 0;
  const report = (message: string) =>
    deps.onProgress?.(total === 0 ? 100 : Math.round((done / total) * 100), message);

  const implicitDefs: Definition[] = [];
  let references = 0;

  for (let i = 0; i < scriptFiles.length; i += BATCH) {
    if (deps.superseded()) return null;
    const batch = scriptFiles.slice(i, i + BATCH);
    const contents = await deps.readBatch(batch);
    if (deps.superseded()) return null; // superseded while reading
    for (let k = 0; k < batch.length; k++) {
      const content = contents[k];
      if (content === null) continue;
      const file = batch[k];
      // ONE parse, both extractors.
      const { root: cst } = parseScript(content);
      const lines = new LineIndex(content);
      const entry = classifyFile(root, file, entries);
      if (
        entry &&
        (entry.kind !== "loc_key" || isWantedLocFile(path.relative(root, file), deps.locLanguage))
      ) {
        pushAll(
          defsByEntry[entryIndex.get(entry)!],
          extractDefinitionsParsed(content, cst, lines, entry, file, deps.source)
        );
      }
      // Files outside every schema folder still carry references, which is why
      // the reference pass walked the whole root in the first place.
      const extracted = extractReferencesParsed(
        cst,
        lines,
        file,
        deps.source,
        deps.schema,
        deps.isEngineToken
      );
      deps.addReferences(extracted.references);
      pushAll(implicitDefs, extracted.implicitDefs);
      if (extracted.namespaces.length > 0) deps.setNamespaces(file, extracted.namespaces);
      references += extracted.references.length;
    }
    done += batch.length;
    report(path.relative(root, path.dirname(batch[batch.length - 1])));
    await deps.yieldNow();
  }

  for (const { index, entry, files } of otherWork) {
    for (let i = 0; i < files.length; i += BATCH) {
      if (deps.superseded()) return null;
      const batch = files.slice(i, i + BATCH);
      const contents = await deps.readBatch(batch);
      if (deps.superseded()) return null;
      for (let k = 0; k < batch.length; k++) {
        const content = contents[k];
        if (content === null) continue;
        // Not `.txt`: nothing shares this parse, so the plain extractor.
        pushAll(defsByEntry[index], extractDefinitions(content, entry, batch[k], deps.source));
      }
      done += batch.length;
      report(entry.path);
      await deps.yieldNow();
    }
  }

  const defs: Definition[] = [];
  for (const list of defsByEntry) pushAll(defs, list);
  return { defs, implicitDefs, files: total, scriptFiles: scriptFiles.length, references, listMs };
}
