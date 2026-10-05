import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { MigrationCapture, MigrationManifest, MigrationRoot } from "@px-lsp/protocol/migration";
import { MIGRATION_LIMITS } from "../sdk";
import type { MigrationSnapshot, PreparedMigration } from "../sdk";
import {
  hashPlan,
  hashSnapshot,
  migrationInputMatches,
  validateMigrationDiscovery,
  validateMigrationMetadata,
  validateMigrationPath,
} from "../engine";

export type MigrationRoots = Partial<Record<MigrationRoot, string>>;
/** Editor text excludes the encoding BOM. Paths are relative to the mod root. */
export interface MigrationDocument {
  path: string;
  text: string;
  version: number;
  dirty: boolean;
}
export interface MigrationDocumentHost {
  /** Enumerate current buffers, including documents opened since capture. */
  list?(): Promise<MigrationDocument[]>;
  read(path: string): Promise<MigrationDocument | undefined>;
  /** Check the version, apply text, and save with the original BOM. Reject if any step fails. */
  write(path: string, text: string, expectedVersion: number): Promise<MigrationDocument>;
  /** Restore the original buffer, saving only a clean original. The adapter then restores exact disk bytes. */
  restore?(path: string, original: MigrationDocument, expectedVersion: number): Promise<MigrationDocument>;
}
export interface MigrationApplyOptions {
  roots: MigrationRoots;
  manifest: MigrationManifest;
  gameId: string;
  journalPath: string;
  documents?: MigrationDocument[];
  documentHost?: MigrationDocumentHost;
}
export interface MigrationResult {
  status: "applied" | "restored" | "failed" | "conflict";
  completed: string[];
  journalPath: string;
  error?: string;
  conflicts?: string[];
}
export interface FrozenFileChange {
  path: string;
  before?: Uint8Array;
  after?: Uint8Array;
}
export interface AppliedFileChange {
  path: string;
  after?: Uint8Array;
  documentAfter?: MigrationDocument;
}
export interface FileChangeApplyOptions {
  root: string;
  protectedRoots?: string[];
  journalPath: string;
  documents?: MigrationDocument[];
  documentHost?: MigrationDocumentHost;
  /** Compare every captured input with the baseline, accounting only for completed owned writes. */
  assertFresh?: () => Promise<void>;
  /** Advance that baseline from the completed change. Receives an isolated copy. */
  onApplied?: (file: AppliedFileChange) => void | Promise<void>;
  planId?: string;
}
interface JournalFile {
  path: string;
  before?: string;
  after?: string;
  documentBefore?: MigrationDocument;
  documentAfter?: MigrationDocument;
  state: "planned" | "pending" | "applied" | "restoring" | "restored";
}
interface MigrationJournal {
  version: 1;
  roots: MigrationRoots;
  planHash: string;
  files: JournalFile[];
}
interface FileChangeJournal {
  version: 2;
  root: string;
  protectedRoots: string[];
  planId?: string;
  files: JournalFile[];
}
type Journal = MigrationJournal | FileChangeJournal;
const MAX_FILE_BYTES = MIGRATION_LIMITS.fileBytes;
const rootNames: MigrationRoot[] = ["mod", "source", "target"];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const key = (value: string) => value.toLowerCase();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const encode = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : Buffer.from(bytes).toString("base64");
const decode = (bytes: string | undefined) =>
  bytes === undefined ? undefined : Buffer.from(bytes, "base64");
function equal(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return a === undefined || b === undefined ? a === b : Buffer.from(a).equals(Buffer.from(b));
}
function contains(parent: string, child: string): boolean {
  const relative = path.relative(key(parent), key(child));
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
  );
}
async function statOrAbsent(filename: string) {
  try {
    return await fs.lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
/** Reject aliases and links in every existing ancestor, including junctions. */
async function safePath(root: string, relative: string): Promise<string> {
  validateMigrationPath(relative, true);
  const destination = path.resolve(root, relative);
  if (!contains(root, destination)) throw new Error(`Path escapes root: ${relative}`);
  const parsed = path.parse(destination);
  let current = parsed.root;
  for (const part of destination.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    const parent = await statOrAbsent(current);
    if (!parent) break;
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Unsafe ancestor: ${current}`);
    const names = await fs.readdir(current);
    const matching = names.filter((name) => key(name) === key(part));
    if (matching.length > 1 || (matching.length === 1 && matching[0] !== part))
      throw new Error(`Case collision or alias: ${destination}`);
    current = path.join(current, part);
    const stat = await statOrAbsent(current);
    if (stat?.isSymbolicLink()) throw new Error(`Links are not migration inputs: ${current}`);
    if (stat && key(await fs.realpath(current)) !== key(current))
      throw new Error(`Reparse path is not allowed: ${current}`);
  }
  return destination;
}
async function resolveRoots(roots: MigrationRoots): Promise<MigrationRoots> {
  if (!roots.mod) throw new Error("A mod root is required");
  const resolved: MigrationRoots = {};
  for (const name of rootNames) {
    const value = roots[name];
    if (!value) continue;
    // The host explicitly selected this root. Resolve its aliases once, then
    // reject links below the canonical boundary.
    const absolute = await fs.realpath(path.resolve(value));
    const stat = await fs.lstat(absolute);
    if (!stat.isDirectory()) throw new Error(`Root is not a directory: ${name}`);
    resolved[name] = await fs.realpath(absolute);
    for (const other of rootNames) {
      if (
        other !== name &&
        resolved[other] &&
        (contains(resolved[other]!, resolved[name]!) || contains(resolved[name]!, resolved[other]!))
      )
        throw new Error(`Migration roots overlap: ${name} and ${other}`);
    }
  }
  return resolved;
}
export async function resolveFileChangeRoots(root: string, protectedRoots: string[] = []) {
  const resolved: string[] = [];
  for (const value of [root, ...protectedRoots]) {
    if (typeof value !== "string" || !value) throw new Error("A file transaction root is required");
    const selected = path.resolve(value);
    if ((await fs.lstat(selected)).isSymbolicLink())
      throw new Error(`Links are not migration inputs: ${selected}`);
    // Resolve aliases above the selected boundary, as captureMigration does.
    const absolute = await fs.realpath(selected);
    const drive = path.parse(absolute).root;
    await safePath(drive, path.relative(drive, absolute).split(path.sep).join("/"));
    const stat = await fs.lstat(absolute);
    if (!stat.isDirectory()) throw new Error(`Root is not a directory: ${value}`);
    const canonical = await fs.realpath(absolute);
    if (resolved.some((other) => contains(other, canonical) || contains(canonical, other)))
      throw new Error("File transaction roots overlap");
    resolved.push(canonical);
  }
  return { root: resolved[0], protectedRoots: resolved.slice(1) };
}
function freezeDocumentHost(host: MigrationDocumentHost | undefined): MigrationDocumentHost | undefined {
  return (
    host && {
      list: host.list?.bind(host),
      read: host.read.bind(host),
      write: host.write.bind(host),
      restore: host.restore?.bind(host),
    }
  );
}
async function readBytes(filename: string): Promise<Uint8Array | undefined> {
  const stat = await statOrAbsent(filename);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular migration file: ${filename}`);
  if (stat.size > MAX_FILE_BYTES)
    throw new Error(`Migration input exceeds ${MAX_FILE_BYTES} bytes: ${filename}`);
  const bytes = await fs.readFile(filename);
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error(`Migration input exceeds ${MAX_FILE_BYTES} bytes: ${filename}`);
  return bytes;
}
function overlayBytes(document: MigrationDocument, disk: Uint8Array | undefined): Uint8Array {
  const hasBom = disk?.[0] === 0xef && disk[1] === 0xbb && disk[2] === 0xbf;
  const bytes = Buffer.from((hasBom ? "\uFEFF" : "") + document.text, "utf8");
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`Editor input is too large: ${document.path}`);
  return bytes;
}
function documentMap(documents: MigrationDocument[]): Map<string, MigrationDocument> {
  const map = new Map<string, MigrationDocument>();
  for (const document of documents) {
    validateMigrationPath(document.path);
    if (
      !Number.isSafeInteger(document.version) ||
      typeof document.text !== "string" ||
      typeof document.dirty !== "boolean"
    )
      throw new Error(`Invalid editor document: ${document.path}`);
    if (document.text.startsWith("\uFEFF"))
      throw new Error(`Editor text must exclude the BOM: ${document.path}`);
    if ([...map.keys()].some((entry) => key(entry) === key(document.path)))
      throw new Error(`Duplicate editor path: ${document.path}`);
    map.set(document.path, document);
  }
  return map;
}
export interface MigrationCaptureOptions {
  capture?: MigrationCapture;
  signal?: AbortSignal;
  /** Lower limits support focused checks without large fixtures. Never raises production limits. */
  limits?: Partial<{ [K in keyof typeof MIGRATION_LIMITS]: number }>;
}
export async function captureMigration(
  roots: MigrationRoots,
  manifest: MigrationManifest,
  gameId: string,
  documents: MigrationDocument[] = [],
  options: MigrationCaptureOptions = {}
): Promise<MigrationSnapshot> {
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new Error("Migration cancelled.");
  };
  checkCancelled();
  manifest = validateMigrationMetadata(manifest);
  if (manifest.gameId !== gameId) throw new Error("Recipe game does not match workspace game");
  const limits: { -readonly [K in keyof typeof MIGRATION_LIMITS]: number } = { ...MIGRATION_LIMITS };
  for (const name of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = options.limits?.[name];
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 0 || value > limits[name])
        throw new Error("Invalid migration capture limit");
      limits[name] = value;
    }
  }
  const failLimit = () => {
    throw new Error("Migration capture limit exceeded. Select a smaller migration batch.");
  };
  const resolved = await resolveRoots(roots);
  const overlays = documentMap(documents);
  const snapshot: MigrationSnapshot = {
    gameId,
    files: [],
    metadata: {},
    ...(manifest.sdkVersion === 2 ? { listings: [] } : {}),
  };
  const seen = new Set<string>();
  const listed = new Set<string>();
  const modPaths = new Set<string>();
  let capturedBytes = 0;
  let listingCount = 0;
  const charge = (size: number, previous = 0) => {
    if (size > limits.fileBytes || capturedBytes - previous + size > limits.inputBytes) failLimit();
    capturedBytes += size - previous;
  };
  async function captureFile(
    rootName: MigrationRoot,
    relative: string,
    mode: "bytes" | "prefix",
    prefixBytes?: number,
    enumerated = false
  ) {
    checkCancelled();
    const root = resolved[rootName]!;
    const filename = enumerated
      ? path.resolve(root, validateMigrationPath(relative))
      : await safePath(root, relative);
    const stat = await statOrAbsent(filename);
    // Enumeration checked spelling and every parent boundary. Recheck the
    // current complete target before reading, so an ancestor swap cannot redirect it.
    if (stat && enumerated && key(await fs.realpath(filename)) !== key(filename))
      throw new Error(`Reparse path is not allowed: ${filename}`);
    const identity = `${rootName}:${relative}`;
    const previous = snapshot.files.find((file) => file.root === rootName && file.path === relative);
    if (!stat) {
      snapshot.metadata[`disk:${identity}`] = "absent";
      const document = rootName === "mod" ? overlays.get(relative) : undefined;
      if (document) {
        const effective = overlayBytes(document, undefined);
        charge(effective.length, previous?.bytes.length ?? 0);
        if (!previous && snapshot.files.length >= limits.files) failLimit();
        snapshot.metadata[`editor:${relative}`] = JSON.stringify(document);
        if (previous) previous.bytes = effective;
        else snapshot.files.push({ root: rootName, path: relative, bytes: effective });
      }
      return;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular migration file: ${relative}`);
    const length = mode === "prefix" ? Math.min(stat.size, prefixBytes!) : stat.size;
    charge(length, previous?.bytes.length ?? 0);
    checkCancelled();
    let disk: Uint8Array;
    if (mode === "prefix") {
      const handle = await fs.open(filename, "r");
      try {
        const buffer = Buffer.alloc(length);
        const result = await handle.read(buffer, 0, length, 0);
        if (result.bytesRead !== length) throw new Error(`Input changed while reading: ${relative}`);
        disk = buffer;
      } finally {
        await handle.close();
      }
    } else disk = (await readBytes(filename))!;
    checkCancelled();
    if (disk.length !== length) throw new Error(`Input changed while reading: ${relative}`);
    const document = rootName === "mod" ? overlays.get(relative) : undefined;
    const effective = document ? overlayBytes(document, disk) : disk;
    if (effective.length !== disk.length) charge(effective.length, disk.length);
    snapshot.metadata[`disk:${identity}`] = digest(disk);
    if (document) snapshot.metadata[`editor:${relative}`] = JSON.stringify(document);
    if (previous) previous.bytes = effective;
    else {
      if (snapshot.files.length >= limits.files) failLimit();
      snapshot.files.push({ root: rootName, path: relative, bytes: effective });
    }
  }
  for (const name of rootNames) snapshot.metadata[`root:${name}`] = resolved[name] ?? "absent";
  // Mod inputs are surveyed first so matching reference selectors remain bounded.
  for (const input of [...manifest.inputs].sort(
    (a, b) => rootNames.indexOf(a.root) - rootNames.indexOf(b.root)
  )) {
    const root = resolved[input.root];
    const listing: string[] = [];
    if (!root) throw new Error(`Required input root is unavailable: ${input.root}`);
    const matches = (relative: string) =>
      migrationInputMatches(input, input.root, relative) && (!input.matchModFiles || modPaths.has(relative));
    async function visit(
      relative: string,
      parentChecked = false,
      entry?: import("node:fs").Dirent
    ): Promise<void> {
      checkCancelled();
      validateMigrationPath(relative, true);
      if (entry?.isSymbolicLink()) throw new Error(`Links are not migration inputs: ${relative}`);
      if (entry?.isFile() && !matches(relative)) return;
      // Recursive names come from a checked parent listing. Do not rescan every
      // ancestor for each unrelated child; content reads recheck their current target.
      const filename = parentChecked ? path.join(root!, relative) : await safePath(root!, relative);
      const stat = await statOrAbsent(filename);
      if (!stat) {
        listing.push(`${relative}:absent`);
        return;
      }
      if (stat.isSymbolicLink()) throw new Error(`Links are not migration inputs: ${filename}`);
      if (!stat.isDirectory() && !matches(relative)) return;
      if (key(await fs.realpath(filename)) !== key(filename))
        throw new Error(`Reparse path is not allowed: ${filename}`);
      if (stat.isDirectory()) {
        if (++listingCount > limits.listingEntries) failLimit();
        listing.push(`${relative}:directory`);
        const entries = (await fs.readdir(filename, { withFileTypes: true })).sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        );
        if (new Set(entries.map((child) => key(child.name))).size !== entries.length)
          throw new Error(`Case collision: ${relative}`);
        for (const child of entries)
          await visit(relative ? `${relative}/${child.name}` : child.name, true, child);
        return;
      }
      if (++listingCount > limits.listingEntries) failLimit();
      listing.push(`${relative}:file`);
      const identity = `${input.root}:${relative}`;
      if (input.root === "mod") modPaths.add(relative);
      if (snapshot.listings && !listed.has(identity)) {
        listed.add(identity);
        snapshot.listings.push({ root: input.root, path: relative, size: stat.size });
      }
      if (seen.has(identity)) return;
      if (input.capture === "listing") return;
      seen.add(identity);
      const selectors = manifest.inputs.filter(
        (selector) => migrationInputMatches(selector, input.root, relative) && selector.capture !== "listing"
      );
      const full = selectors.some((selector) => !selector.capture || selector.capture === "bytes");
      await captureFile(
        input.root,
        relative,
        full ? "bytes" : "prefix",
        Math.max(0, ...selectors.map((selector) => selector.prefixBytes ?? 0)),
        parentChecked
      );
    }
    if (input.matchModFiles) {
      for (const relative of [...modPaths].sort()) if (matches(relative)) await visit(relative);
    } else await visit(input.path);
    if (input.root === "mod")
      for (const [relative, document] of overlays) {
        checkCancelled();
        if (!matches(relative)) continue;
        await safePath(root, relative);
        const stat = await statOrAbsent(path.join(root, relative));
        if (!stat) listing.push(`${relative}:editor`);
        modPaths.add(relative);
        const identity = `mod:${relative}`;
        if (snapshot.listings && !listed.has(identity)) {
          listed.add(identity);
          snapshot.listings.push({
            root: "mod",
            path: relative,
            size: Buffer.byteLength(document.text, "utf8"),
          });
        }
        snapshot.metadata[`editor:${relative}`] = JSON.stringify(document);
        if (seen.has(identity) || input.capture === "listing") continue;
        seen.add(identity);
        if (stat)
          await captureFile(
            "mod",
            relative,
            input.capture === "prefix" ? "prefix" : "bytes",
            input.prefixBytes
          );
        else {
          const effective = overlayBytes(document, undefined);
          charge(effective.length);
          if (snapshot.files.length >= limits.files) failLimit();
          snapshot.metadata[`disk:${identity}`] = "absent";
          snapshot.metadata[`editor:${relative}`] = JSON.stringify(document);
          snapshot.files.push({ root: "mod", path: relative, bytes: effective });
        }
      }
    snapshot.metadata[
      `listing:${input.root}:${input.path}:${input.extensions?.join(",") ?? "*"}:${input.capture ?? "bytes"}`
    ] = JSON.stringify(listing.sort());
  }
  snapshot.files.sort((a, b) => `${a.root}:${a.path}`.localeCompare(`${b.root}:${b.path}`));
  snapshot.listings?.sort((a, b) => `${a.root}:${a.path}`.localeCompare(`${b.root}:${b.path}`));
  if (options.capture) {
    const selected = validateMigrationDiscovery(manifest, options.capture.selected);
    const seedHash = await hashSnapshot(snapshot);
    for (const request of selected) await captureFile(request.root, request.path, "bytes");
    if (
      (await hashSnapshot(
        await captureMigration(roots, manifest, gameId, documents, {
          limits: options.limits,
          signal: options.signal,
        })
      )) !== seedHash
    )
      throw new Error("Migration inputs changed during capture. Inspect again.");
    snapshot.capture = { selected };
    snapshot.files.sort((a, b) => `${a.root}:${a.path}`.localeCompare(`${b.root}:${b.path}`));
  }
  checkCancelled();
  return snapshot;
}
export async function assertMigrationFresh(
  roots: MigrationRoots,
  manifest: MigrationManifest,
  snapshotHash: string,
  documents: MigrationDocument[] = [],
  capture?: MigrationCapture,
  signal?: AbortSignal
): Promise<void> {
  if (
    (await hashSnapshot(
      await captureMigration(roots, manifest, manifest.gameId, documents, { capture, signal })
    )) !== snapshotHash
  )
    throw new Error("Migration inputs changed. Prepare a fresh preview.");
}
async function currentDocuments(
  options: Pick<MigrationApplyOptions, "documents" | "documentHost">
): Promise<MigrationDocument[]> {
  if (!options.documentHost) return structuredClone(options.documents ?? []);
  if (options.documentHost.list) return structuredClone(await options.documentHost.list());
  const result: MigrationDocument[] = [];
  for (const document of options.documents ?? []) {
    const current = await options.documentHost.read(document.path);
    if (!current) throw new Error(`Editor document closed: ${document.path}`);
    result.push(structuredClone(current));
  }
  return result;
}
async function writeBytes(filename: string, bytes: Uint8Array | undefined): Promise<void> {
  if (bytes === undefined) {
    await fs.unlink(filename);
    return;
  }
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.migration-tmp`
  );
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function saveJournal(filename: string, journal: Journal): Promise<void> {
  await writeBytes(filename, Buffer.from(JSON.stringify(journal), "utf8"));
}
function textBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function sameDocument(a: MigrationDocument | undefined, b: MigrationDocument | undefined): boolean {
  return a === undefined || b === undefined
    ? a === b
    : a.path === b.path && a.version === b.version && a.text === b.text && a.dirty === b.dirty;
}
function sameDocumentContent(a: MigrationDocument | undefined, b: MigrationDocument | undefined): boolean {
  return a === undefined || b === undefined
    ? a === b
    : a.path === b.path && a.text === b.text && a.dirty === b.dirty;
}
function ownedPlannedDocument(
  document: MigrationDocument | undefined,
  file: JournalFile,
  disk: Uint8Array | undefined
): MigrationDocument | undefined {
  const after = decode(file.after);
  return document &&
    after &&
    document.path === file.path &&
    document.text === textBytes(after) &&
    (equal(disk, decode(file.before)) || equal(disk, after))
    ? document
    : undefined;
}
/** Advance the captured baseline using only our completed operation, never a fresh read. */
function stageSnapshot(snapshot: MigrationSnapshot, manifest: MigrationManifest, file: JournalFile): void {
  const inputs = manifest.inputs.filter((input) => migrationInputMatches(input, "mod", file.path));
  if (!inputs.length) return;
  const after = decode(file.after);
  const selected = snapshot.capture?.selected.some(
    (request) => request.root === "mod" && request.path === file.path
  );
  const byteInput =
    inputs.find((input) => !input.capture || input.capture === "bytes") ??
    inputs.filter((input) => input.capture === "prefix").sort((a, b) => b.prefixBytes! - a.prefixBytes!)[0];
  snapshot.files = snapshot.files.filter((entry) => entry.root !== "mod" || entry.path !== file.path);
  snapshot.listings = snapshot.listings?.filter((entry) => entry.root !== "mod" || entry.path !== file.path);
  delete snapshot.metadata[`disk:mod:${file.path}`];
  delete snapshot.metadata[`editor:${file.path}`];
  if (after !== undefined) {
    if (snapshot.listings) snapshot.listings.push({ root: "mod", path: file.path, size: after.length });
    if (selected || byteInput) {
      const bytes =
        !selected && byteInput?.capture === "prefix" ? after.slice(0, byteInput.prefixBytes) : after;
      snapshot.files.push({ root: "mod", path: file.path, bytes });
      snapshot.metadata[`disk:mod:${file.path}`] = digest(bytes);
      if (file.documentAfter) snapshot.metadata[`editor:${file.path}`] = JSON.stringify(file.documentAfter);
    }
  } else if (selected) snapshot.metadata[`disk:mod:${file.path}`] = "absent";
  for (const input of inputs) {
    const listingKey = `listing:mod:${input.path}:${input.extensions?.join(",") ?? "*"}:${input.capture ?? "bytes"}`;
    const listing = new Set<string>(
      (JSON.parse(snapshot.metadata[listingKey]) as string[]).filter(
        (entry) => !entry.startsWith(file.path + ":")
      )
    );
    if (after === undefined) {
      if (input.path === file.path) listing.add(`${file.path}:absent`);
    } else {
      listing.add(`${file.path}:file`);
      let parent = path.posix.dirname(file.path);
      while (
        parent !== "." &&
        (!input.path || parent === input.path || parent.startsWith(input.path + "/"))
      ) {
        listing.delete(`${parent}:absent`);
        listing.add(`${parent}:directory`);
        parent = path.posix.dirname(parent);
      }
    }
    snapshot.metadata[listingKey] = JSON.stringify([...listing].sort());
  }
  snapshot.listings?.sort((a, b) => `${a.root}:${a.path}`.localeCompare(`${b.root}:${b.path}`));
}
export async function applyMigration(
  plan: PreparedMigration,
  options: MigrationApplyOptions
): Promise<MigrationResult> {
  const result = { completed: [] as string[], journalPath: options.journalPath };
  try {
    // Copy before awaiting, so callers cannot mutate bytes, roots or manifest during apply.
    plan = structuredClone(plan);
    options = {
      ...options,
      roots: structuredClone(options.roots),
      manifest: structuredClone(options.manifest),
      documents: structuredClone(options.documents),
      documentHost: freezeDocumentHost(options.documentHost),
    };
    const { hash, ...unsigned } = plan;
    if ((await hashPlan(unsigned)) !== hash) throw new Error("Prepared migration hash is invalid");
    if (plan.recipe.id !== options.manifest.id || plan.recipe.revision !== options.manifest.revision)
      throw new Error("Prepared migration does not match the selected recipe");
    if (
      plan.unresolved.some((finding) => finding.severity === "error") ||
      plan.checks.some(
        (check) =>
          check.stage === "before-apply" && check.necessity === "required" && check.status !== "passed"
      )
    )
      throw new Error("Required migration findings or checks are unresolved");
    const roots = await resolveRoots(options.roots);
    let snapshot: MigrationSnapshot | undefined;
    return applyFrozenFileChanges(
      plan.files,
      {
        root: roots.mod!,
        protectedRoots: [roots.source, roots.target].filter((root): root is string => root !== undefined),
        journalPath: options.journalPath,
        documents: options.documents,
        documentHost: options.documentHost,
        planId: hash,
        assertFresh: async () => {
          const fresh = await captureMigration(
            roots,
            options.manifest,
            options.gameId,
            await currentDocuments(options),
            {
              capture: plan.capture,
            }
          );
          if ((await hashSnapshot(fresh)) !== (snapshot ? await hashSnapshot(snapshot) : plan.snapshotHash))
            throw new Error(
              snapshot
                ? "Migration inputs changed during apply"
                : "Migration inputs changed. Prepare a fresh preview."
            );
          snapshot ??= fresh;
        },
        onApplied: (file) =>
          stageSnapshot(snapshot!, options.manifest, {
            ...file,
            after: encode(file.after),
            state: "applied",
          }),
      },
      roots
    );
  } catch (error) {
    return { ...result, status: "failed", error: errorText(error) };
  }
}
/** Apply caller-frozen changes in order, preserving exact disk bytes and editor buffers for recovery. */
export function applyFileChanges(
  changes: FrozenFileChange[],
  options: FileChangeApplyOptions
): Promise<MigrationResult> {
  return applyFrozenFileChanges(changes, options);
}
async function applyFrozenFileChanges(
  changes: FrozenFileChange[],
  options: FileChangeApplyOptions,
  migrationJournalRoots?: MigrationRoots
): Promise<MigrationResult> {
  const completed: string[] = [];
  const result = { completed, journalPath: options.journalPath };
  try {
    changes = structuredClone(changes);
    options = {
      ...options,
      protectedRoots: structuredClone(options.protectedRoots),
      documents: structuredClone(options.documents),
      documentHost: freezeDocumentHost(options.documentHost),
    };
    migrationJournalRoots = structuredClone(migrationJournalRoots);
    await options.assertFresh?.();
    const roots = await resolveFileChangeRoots(options.root, options.protectedRoots);
    const documents = await currentDocuments(options);
    const documentEntries = documentMap(documents);
    const journal: Journal = migrationJournalRoots
      ? { version: 1, roots: migrationJournalRoots, planHash: options.planId!, files: [] }
      : { version: 2, ...roots, planId: options.planId, files: [] };
    const paths = new Set<string>();
    for (const file of changes) {
      validateMigrationPath(file.path);
      if (
        [file.before, file.after].some(
          (bytes) => bytes !== undefined && (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_BYTES)
        )
      )
        throw new Error(`Invalid file change bytes: ${file.path}`);
      if (paths.has(key(file.path))) throw new Error(`Duplicate destination: ${file.path}`);
      paths.add(key(file.path));
      const filename = await safePath(roots.root, file.path);
      const disk = await readBytes(filename);
      const document = documentEntries.get(file.path);
      if (options.documentHost && !sameDocument(await options.documentHost.read(file.path), document))
        throw new Error(`Editor changed: ${file.path}`);
      if (!equal(document ? overlayBytes(document, disk) : disk, file.before))
        throw new Error(`Destination changed: ${file.path}`);
      if (equal(file.before, file.after)) continue;
      if (
        document &&
        (!options.documentHost ||
          file.after === undefined ||
          (document.dirty && !options.documentHost.restore))
      )
        throw new Error(`Editor operation cannot be safely saved and restored: ${file.path}`);
      if (document && file.after) textBytes(file.after);
      journal.files.push({
        path: file.path,
        before: encode(disk),
        after: encode(file.after),
        documentBefore: document,
        state: "planned",
      });
    }
    if (!journal.files.length) {
      await options.assertFresh?.();
      await resolveFileChangeRoots(roots.root, roots.protectedRoots);
      return { ...result, status: "applied" };
    }
    const journalFilename = path.join(
      await fs.realpath(path.dirname(options.journalPath)),
      path.basename(options.journalPath)
    );
    if ([roots.root, ...roots.protectedRoots].some((root) => contains(root, journalFilename)))
      throw new Error("Journal storage must be outside migration roots");
    await safePath(path.dirname(journalFilename), path.basename(journalFilename));
    await fs.writeFile(journalFilename, JSON.stringify(journal), { flag: "wx" });
    for (const file of journal.files) {
      await options.assertFresh?.();
      await resolveFileChangeRoots(roots.root, roots.protectedRoots);
      const filename = await safePath(roots.root, file.path);
      if (!equal(await readBytes(filename), decode(file.before)))
        throw new Error(`Destination changed during apply: ${file.path}`);
      if (
        options.documentHost &&
        !sameDocument(await options.documentHost.read(file.path), file.documentBefore)
      )
        throw new Error(`Editor changed during apply: ${file.path}`);
      file.state = "pending";
      await saveJournal(journalFilename, journal);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await resolveFileChangeRoots(roots.root, roots.protectedRoots);
      await safePath(roots.root, file.path);
      if (!equal(await readBytes(filename), decode(file.before)))
        throw new Error(`Destination changed during apply: ${file.path}`);
      if (
        options.documentHost &&
        !sameDocument(await options.documentHost.read(file.path), file.documentBefore)
      )
        throw new Error(`Editor changed during apply: ${file.path}`);
      if (file.documentBefore) {
        let saved: MigrationDocument;
        try {
          saved = await options.documentHost!.write(
            file.path,
            textBytes(decode(file.after)!),
            file.documentBefore.version
          );
        } catch (error) {
          const disk = await readBytes(filename);
          file.documentAfter = ownedPlannedDocument(await options.documentHost!.read(file.path), file, disk);
          if (equal(disk, decode(file.after))) completed.push(file.path);
          await saveJournal(journalFilename, journal);
          throw error;
        }
        const live = await options.documentHost!.read(file.path);
        const disk = await readBytes(filename);
        if (!sameDocument(live, saved) || saved.dirty || saved.text !== textBytes(decode(file.after)!)) {
          file.documentAfter = ownedPlannedDocument(live, file, disk);
          if (equal(disk, decode(file.after))) completed.push(file.path);
          await saveJournal(journalFilename, journal);
          throw new Error(`Editor save did not produce the planned buffer: ${file.path}`);
        }
        if (!equal(disk, decode(file.after))) {
          file.documentAfter = ownedPlannedDocument(live, file, disk);
          await saveJournal(journalFilename, journal);
          throw new Error(`Editor save did not write planned bytes: ${file.path}`);
        }
        file.documentAfter = saved;
      } else await writeBytes(filename, decode(file.after));
      file.state = "applied";
      completed.push(file.path);
      await saveJournal(journalFilename, journal);
      await options.onApplied?.(
        structuredClone({
          path: file.path,
          after: decode(file.after),
          documentAfter: file.documentAfter,
        })
      );
    }
    await options.assertFresh?.();
    await resolveFileChangeRoots(roots.root, roots.protectedRoots);
    return { ...result, status: "applied" };
  } catch (error) {
    return { ...result, status: "failed", error: errorText(error) };
  }
}
export async function restoreFileChanges(
  journalPath: string,
  options: { documentHost?: MigrationDocumentHost } = {}
): Promise<MigrationResult> {
  const completed: string[] = [];
  const conflicts: string[] = [];
  const openCreatedFiles: string[] = [];
  try {
    options = { documentHost: freezeDocumentHost(options.documentHost) };
    journalPath = path.join(await fs.realpath(path.dirname(journalPath)), path.basename(journalPath));
    await safePath(path.dirname(journalPath), path.basename(journalPath));
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as Journal;
    if (![1, 2].includes(journal.version) || !Array.isArray(journal.files))
      throw new Error("Unsupported migration journal");
    if (journal.version === 2 && !Array.isArray(journal.protectedRoots))
      throw new Error("Invalid protected journal roots");
    const roots =
      journal.version === 1
        ? await resolveFileChangeRoots(
            journal.roots.mod!,
            [journal.roots.source, journal.roots.target].filter((root): root is string => root !== undefined)
          )
        : await resolveFileChangeRoots(journal.root, journal.protectedRoots);
    if ([roots.root, ...roots.protectedRoots].some((root) => contains(root, path.resolve(journalPath))))
      throw new Error("Journal storage is inside migration roots");
    const paths = new Set<string>();
    for (const file of journal.files) {
      validateMigrationPath(file.path);
      if (
        !["planned", "pending", "applied", "restoring", "restored"].includes(file.state) ||
        [file.before, file.after].some(
          (bytes) =>
            bytes !== undefined &&
            (typeof bytes !== "string" || Buffer.from(bytes, "base64").toString("base64") !== bytes)
        )
      )
        throw new Error(`Invalid journal entry: ${file.path}`);
      if (paths.has(key(file.path))) throw new Error(`Duplicate journal destination: ${file.path}`);
      paths.add(key(file.path));
    }
    for (const file of [...journal.files].reverse()) {
      if (file.state === "restored" || file.state === "planned") continue;
      await resolveFileChangeRoots(roots.root, roots.protectedRoots);
      const filename = await safePath(roots.root, file.path);
      const disk = await readBytes(filename);
      const before = decode(file.before);
      const after = decode(file.after);
      const document = await options.documentHost?.read(file.path);
      // The document host can edit buffers, but cannot close an editor before deleting its file.
      if (
        !file.documentBefore &&
        before === undefined &&
        after &&
        equal(disk, after) &&
        document &&
        !document.dirty &&
        document.text === textBytes(after)
      ) {
        conflicts.push(file.path);
        openCreatedFiles.push(file.path);
        continue;
      }
      const pendingMatches =
        file.state === "pending" &&
        document &&
        after &&
        !document.dirty &&
        document.text === textBytes(after);
      const reopenedMatches =
        document &&
        !document.dirty &&
        before &&
        after &&
        (document.text === textBytes(after) ||
          (file.state === "restoring" && document.text === textBytes(before)));
      const originalDocument =
        file.documentBefore ??
        (reopenedMatches ? { ...document!, text: textBytes(before!), dirty: false } : undefined);
      const restoredBufferMatches =
        file.state === "restoring" &&
        document &&
        originalDocument &&
        sameDocumentContent(document, originalDocument);
      if (
        file.documentBefore
          ? (!document && file.documentBefore.dirty) ||
            (document && !options.documentHost) ||
            (file.documentBefore.dirty && !options.documentHost?.restore) ||
            (document &&
              !restoredBufferMatches &&
              (file.documentAfter
                ? !sameDocumentContent(document, file.documentAfter)
                : !sameDocumentContent(document, file.documentBefore) && !pendingMatches))
          : !!document && !reopenedMatches
      ) {
        conflicts.push(file.path);
        continue;
      }
      if (!equal(disk, after) && !(["pending", "restoring"].includes(file.state) && equal(disk, before))) {
        conflicts.push(file.path);
        continue;
      }
      file.state = "restoring";
      await saveJournal(journalPath, journal);
      if (
        !equal(await readBytes(filename), disk) ||
        (options.documentHost && !sameDocument(await options.documentHost.read(file.path), document))
      ) {
        conflicts.push(file.path);
        continue;
      }
      if (document && originalDocument && !restoredBufferMatches) {
        if (options.documentHost!.restore)
          await options.documentHost!.restore(file.path, originalDocument, document.version);
        else await options.documentHost!.write(file.path, originalDocument.text, document.version);
      }
      await resolveFileChangeRoots(roots.root, roots.protectedRoots);
      await safePath(roots.root, file.path);
      const currentDisk = await readBytes(filename);
      if (!equal(currentDisk, before) && !equal(currentDisk, after)) {
        conflicts.push(file.path);
        continue;
      }
      if (!equal(currentDisk, before)) await writeBytes(filename, before);
      if (document && !sameDocumentContent(await options.documentHost!.read(file.path), originalDocument))
        throw new Error(`Editor changed during restore: ${file.path}`);
      file.state = "restored";
      completed.push(file.path);
      await saveJournal(journalPath, journal);
    }
    return {
      status: conflicts.length ? "conflict" : "restored",
      completed,
      conflicts,
      journalPath,
      ...(openCreatedFiles.length
        ? {
            error: `Close these unchanged generated files, then retry Restore so they can be removed: ${openCreatedFiles.join(", ")}`,
          }
        : {}),
    };
  } catch (error) {
    return { status: "failed", completed, conflicts, journalPath, error: errorText(error) };
  }
}

/** Migration version 1 and generic version 2 journals share the recovery implementation. */
export const restoreMigration = restoreFileChanges;

/** Reject unsafe file aliases and links inside a canonical transaction root. */
export const assertFileChangePath = safePath;
