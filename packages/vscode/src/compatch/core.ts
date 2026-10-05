import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseScript, parseLoc } from "@px-lsp/server/parser";
import type { GameMeta } from "@px-lsp/server/games/profile";

export type Side = "A" | "B" | "base";
export type Kind = "event" | "localization" | "file";
export interface Site {
  path: string;
  line: number;
  text: string;
}
export interface Entry {
  id: string;
  name: string;
  kind: Kind;
  sites: Record<Side, Site[]>;
}
export interface Review {
  status: "reviewed" | "skipped";
  fingerprint: string;
  sites: Entry["sites"];
}
export interface ReplacementRule {
  kind: "file" | "folder";
  /** Mod-relative path with forward slashes, without a trailing slash. */
  path: string;
}
export interface Session {
  version: 1;
  id?: string;
  name?: string;
  lastUsed?: string;
  tracked?: string[];
  manual?: string[];
  navigation?: {
    filter: string;
    state: string;
    lens: "file" | "definition";
    pages: Record<Kind, number>;
    selected?: string;
  };
  /** Explicit user links only. The old file and mod path are never moved or deleted. */
  relocations?: Record<string, string>;
  /** Explicit content ownership, independent of review and target validation. */
  intentionalReplacements?: ReplacementRule[];
  validation?: { at: string; gamePath: string; summary: string; stale?: boolean };
  runtimeTest?: { at: string; note: string };
  /** Absent on saved two-source comparisons. A is the original mod; output is the editable result. */
  mode?: "game-update";
  gameId: string;
  localizationLanguage: string;
  roots: Record<Side, string | null>;
  output: string;
  protectedRoots: string[];
  reviews: Record<string, Review>;
  results: Record<string, string>;
}
export interface Inventory {
  entries: Map<string, Entry>;
  files: Record<Side, Map<string, string>>;
  issues: string[];
}

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
const normalize = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

export function isScannableFile(relative: string, session: Session, support: GameMeta["compatch"]): boolean {
  if (!textExtensions.has(path.extname(relative).toLowerCase())) return false;
  if (
    relative
      .split("/")
      .some((part) => (part.startsWith(".") && part !== ".metadata") || part === "node_modules")
  )
    return false;
  const language = /_l_([A-Za-z_]+)\.yml$/.exec(relative)?.[1];
  return !(
    support &&
    relative.startsWith(`${support.localization}/`) &&
    language &&
    language !== session.localizationLanguage
  );
}

export function fingerprint(entry: Entry): string {
  return createHash("sha256").update(JSON.stringify(entry.sites)).digest("hex");
}

export function status(entry: Entry, review?: Review): string {
  if (review) return review.fingerprint === fingerprint(entry) ? review.status : "sources changed";
  if (Object.values(entry.sites).some((sites) => sites.length > 1)) return "multiple definitions";
  const { A, B } = entry.sites;
  if (!A.length && !B.length) return "absent from A and B";
  if (!A.length) return "B only";
  if (!B.length) return "A only";
  return normalize(A[0].text) === normalize(B[0].text) ? "same" : "different";
}

/** Index source sites without resolving winners. File identity and definition identity coexist. */
export function addFile(
  inventory: Inventory,
  side: Side,
  relative: string,
  text: string,
  support: GameMeta["compatch"],
  languageFilter?: string
): void {
  inventory.files[side].set(relative, text);
  function add(kind: Kind, name: string, content: string, line: number) {
    const id = JSON.stringify([kind, name]);
    let entry = inventory.entries.get(id);
    if (!entry) {
      entry = { id, kind, name, sites: { A: [], B: [], base: [] } };
      inventory.entries.set(id, entry);
    }
    entry.sites[side].push({ path: relative, line, text: content });
  }
  add("file", relative, text, 1);
  if (!support) return;
  if (relative.startsWith(`${support.events}/`) && relative.endsWith(".txt")) {
    const parsed = parseScript(text);
    if (parsed.errors.length)
      inventory.issues.push(`${side}: ${relative}: script parse errors; inspect the full file.`);
    // File constants and namespace declarations stay in the full-file view.
    const context = parsed.root.statements
      .filter((s) => s.kind === "assignment" && (s.key.text === "namespace" || s.key.text.startsWith("@")))
      .map((s) => text.slice(s.range.start, s.range.end))
      .join("\n");
    for (const statement of parsed.root.statements) {
      if (
        statement.kind !== "assignment" ||
        statement.value?.kind !== "block" ||
        !statement.key.text.includes(".")
      )
        continue;
      const line = text.slice(0, statement.range.start).split(/\r\n|\r|\n/).length;
      add(
        "event",
        statement.key.text,
        `${context}\n\n${text.slice(statement.range.start, statement.range.end)}\n`,
        line
      );
    }
  }
  if (relative.startsWith(`${support.localization}/`) && relative.endsWith(".yml")) {
    const parsed = parseLoc(text);
    if (parsed.errors.length)
      inventory.issues.push(`${side}: ${relative}: localization parse errors; inspect the full file.`);
    if (!parsed.language) return;
    if (languageFilter && parsed.language !== languageFilter) return;
    const lines = text.split(/\r\n|\r|\n/);
    for (const entry of parsed.entries) {
      add(
        "localization",
        `${parsed.language}:${entry.key}`,
        `l_${parsed.language}:\n${lines[entry.line]}\n`,
        entry.line + 1
      );
    }
  }
}

export function emptyInventory(): Inventory {
  return { entries: new Map(), files: { A: new Map(), B: new Map(), base: new Map() }, issues: [] };
}

/** Links are skipped, so a selected source cannot silently scan a different mod. */
export async function scan(
  session: Session,
  support: GameMeta["compatch"],
  report: (file: string) => void,
  cancelled: () => boolean
): Promise<Inventory> {
  const inventory = emptyInventory();
  for (const side of ["A", "B", "base"] as const) {
    const root = session.roots[side];
    if (!root) continue;
    async function walk(directory: string): Promise<void> {
      const children = await fs.readdir(directory, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (cancelled()) throw new Error("Compatch scan cancelled. The previous comparison is unchanged.");
        if ((child.name.startsWith(".") && child.name !== ".metadata") || child.name === "node_modules")
          continue;
        const filename = path.join(directory, child.name);
        const relative = path.relative(root!, filename).split(path.sep).join("/");
        const language = /_l_([A-Za-z_]+)\.yml$/.exec(relative)?.[1];
        if (
          support &&
          relative.startsWith(`${support.localization}/`) &&
          language &&
          language !== session.localizationLanguage
        )
          continue;
        if (child.isSymbolicLink()) {
          inventory.issues.push(`${side}: ${relative}: symbolic link skipped.`);
        } else if (child.isDirectory()) {
          await walk(filename);
        } else if (child.isFile() && textExtensions.has(path.extname(child.name).toLowerCase())) {
          report(`${side}: ${relative}`);
          const stat = await fs.stat(filename);
          if (stat.size > 8 * 1024 * 1024) {
            inventory.issues.push(`${side}: ${relative}: exceeds 8 MiB; skipped.`);
            continue;
          }
          const bytes = await fs.readFile(filename);
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            if (text.includes("\0")) throw new Error("binary");
          } catch {
            inventory.issues.push(`${side}: ${relative}: not UTF-8 text; skipped.`);
            continue;
          }
          addFile(inventory, side, relative, text, support, session.localizationLanguage);
        }
      }
    }
    await walk(root);
  }
  // Keep reviewed definitions that disappear so an upstream removal remains reviewable.
  for (const id of new Set([...Object.keys(session.reviews), ...(session.tracked ?? [])])) {
    if (!inventory.entries.has(id)) {
      const [kind, name] = JSON.parse(id) as [Kind, string];
      if (kind === "localization" && !name.startsWith(`${session.localizationLanguage}:`)) continue;
      const language = /_l_([A-Za-z_]+)\.yml$/.exec(name)?.[1];
      if (
        kind === "file" &&
        support &&
        name.startsWith(`${support.localization}/`) &&
        language &&
        language !== session.localizationLanguage
      )
        continue;
      inventory.entries.set(id, { id, kind, name, sites: { A: [], B: [], base: [] } });
    }
  }
  return inventory;
}

export function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export async function validateRoots(session: Session): Promise<void> {
  const output = await fs.realpath(session.output);
  if (session.mode === "game-update") {
    if (!session.roots.A || !session.roots.B || !session.roots.base)
      throw new Error("Choose Mod, New Game Version and Old Game Version folders.");
    const sources = await Promise.all(Object.values(session.roots).map((root) => fs.realpath(root!)));
    for (let i = 0; i < sources.length; i++)
      for (let j = i + 1; j < sources.length; j++)
        if (contains(sources[i], sources[j]) || contains(sources[j], sources[i]))
          throw new Error(
            "Mod, Old Game Version and New Game Version must be separate, non-overlapping folders."
          );
  }
  const sources =
    session.mode === "game-update" && !separateUpdateResult(session)
      ? [session.roots.B, session.roots.base]
      : Object.values(session.roots);
  for (const root of [...sources, ...session.protectedRoots]) {
    if (!root) continue;
    const source = await fs.realpath(root);
    if (contains(source, output) || contains(output, source)) {
      throw new Error(
        "Choose a separate result folder outside all source folders. Sources cannot be inside the result folder either."
      );
    }
  }
}

/** Older saved updates used A as their destination. Keep those sessions usable without moving user data. */
export function separateUpdateResult(session: Session): boolean {
  return session.mode === "game-update" && path.resolve(session.output) !== path.resolve(session.roots.A!);
}

/** Initialize once at explicit setup, never on refresh. Copy all mod assets and languages, retaining existing result files. */
export async function initializeUpdateResult(
  session: Session
): Promise<{ copied: number; retained: number }> {
  if (!separateUpdateResult(session)) throw new Error("Choose a separate result folder for the updated mod.");
  await validateRoots(session);
  const source = await fs.realpath(session.roots.A!);
  const files: string[] = [];
  async function collect(directory: string): Promise<void> {
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      if (child.name === ".git" || child.name === "node_modules") continue;
      const file = path.join(directory, child.name);
      if (child.isSymbolicLink())
        throw new Error(
          "Resolve Mod symbolic links before creating a separate result. No linked assets are copied."
        );
      if (child.isDirectory()) await collect(file);
      else if (child.isFile()) files.push(path.relative(source, file));
      else throw new Error("The Mod contains an unsupported filesystem entry.");
    }
  }
  await collect(source);
  // Check every destination before copying, including existing junctions and source/output aliases.
  const destinations = await Promise.all(files.map((relative) => resultPath(session, relative)));
  let copied = 0;
  let retained = 0;
  for (let i = 0; i < files.length; i++) {
    const original = path.join(source, files[i]);
    if ((await fs.realpath(original)) !== original)
      throw new Error("The Mod path changed to a symbolic link during result initialization.");
    const destination = await resultPath(session, files[i]);
    if (destination !== destinations[i]) throw new Error("The result path changed during initialization.");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.copyFile(original, destination, fs.constants.COPYFILE_EXCL);
      copied++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await fs.lstat(destination)).isFile())
        throw new Error(`The result destination is not a regular file: ${files[i]}`);
      retained++;
    }
  }
  return { copied, retained };
}

/** Checks existing ancestors too: a junction in the output tree must not lead into a source. */
export async function resultPath(session: Session, relative: string): Promise<string> {
  await validateRoots(session);
  const root = await fs.realpath(session.output);
  const target = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || !contains(root, target) || target === root)
    throw new Error("Use a relative file path inside the result folder.");
  let existing = target;
  while (true) {
    try {
      const real = await fs.realpath(existing);
      if (!contains(root, real)) throw new Error("The result path follows a link outside the result folder.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      existing = path.dirname(existing);
    }
  }
  return target;
}

export async function createResult(session: Session, relative: string, text: string): Promise<string> {
  const target = await resultPath(session, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text, { encoding: "utf8", flag: "wx" });
  return target;
}

/** Full event files are the supported replacement unit until single-event priority rules ship. */
export function seedFile(relative: string, text: string, support: GameMeta["compatch"]): string {
  let content = text.replace(/^\uFEFF/, "");
  if (support && relative.startsWith(`${support.events}/`) && relative.endsWith(".txt")) {
    const parsed = parseScript(content);
    if (parsed.errors.length)
      throw new Error("Fix the source file's script errors before creating a result from it.");
    const headers = parsed.root.statements.filter(
      (s) => s.kind === "assignment" && s.key.text === "namespace" && s.value?.kind === "scalar"
    );
    if (!headers.length)
      throw new Error("The source event file has no namespace. Create or repair the result manually.");
    const prefix = headers.map((s) => content.slice(s.range.start, s.range.end)).join("\n");
    if (!content.startsWith(prefix)) {
      for (const header of [...headers].reverse())
        content = content.slice(0, header.range.start) + content.slice(header.range.end);
      content = `${prefix}\n${content}`;
    }
  }
  return /\.(txt|yml)$/i.test(relative) ? `\uFEFF${content}` : text;
}

/** Verify against this install, never infer vanilla ownership from a mod's replace folder. */
export async function hasVanillaLoc(directory: string, language: string, key: string): Promise<boolean> {
  for (const child of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, child.name);
    if (child.isSymbolicLink()) throw new Error("Cannot verify vanilla localization through symbolic links.");
    if (child.isDirectory() && (await hasVanillaLoc(filename, language, key))) return true;
    if (child.isFile() && child.name.endsWith(`_l_${language}.yml`)) {
      const parsed = parseLoc(await fs.readFile(filename, "utf8"));
      if (parsed.language === language && parsed.entries.some((entry) => entry.key === key)) return true;
    }
  }
  return false;
}

export function localizationSeed(
  text: string,
  folder: string,
  vanilla: boolean
): { relative: string; text: string } {
  const parsed = parseLoc(text);
  if (!parsed.language || parsed.errors.length || parsed.entries.length !== 1)
    throw new Error("Select a single valid localization entry.");
  const relative = `${folder}/${vanilla ? "replace" : parsed.language}/px_compatch_l_${parsed.language}.yml`;
  return { relative, text: `\uFEFF${text.replace(/^\uFEFF/, "")}` };
}
