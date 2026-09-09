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
export interface Session {
  version: 1;
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
  for (const id of Object.keys(session.reviews)) {
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
  for (const root of [...Object.values(session.roots), ...session.protectedRoots]) {
    if (!root) continue;
    const source = await fs.realpath(root);
    if (contains(source, output) || contains(output, source)) {
      throw new Error(
        "Choose a separate result folder outside all source folders. Sources cannot be inside the result folder either."
      );
    }
  }
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
    for (const header of [...headers].reverse())
      content = content.slice(0, header.range.start) + content.slice(header.range.end);
    content = `${prefix}\n${content}`;
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
