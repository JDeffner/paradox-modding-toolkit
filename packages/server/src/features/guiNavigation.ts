/**
 * Go-to-definition for .gui files: widget type usages, `using = Template`
 * references, base types in `type X = base` declarations, and
 * `blockoverride "name"` → the `block "name"` site in the widget's
 * template/type chain. Resolution order: the current document's own
 * declarations (including local_templates) first, then the cross-file FIOS
 * store (mod + parents + vanilla, first definition wins — what the game uses).
 */
import * as fs from "fs";
import type { Location, Position } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import {
  collectGuiDefsParsed,
  collectOverridableBlocks,
  resolveGuiDef,
  type GuiBlockSite,
  type GuiDefs,
} from "../gui/guiDefs";
import { getGuiDefs } from "../gui/layoutService";
import { LineIndex, nodeAtOffset, type BlockNode, type Statement } from "../parser";
import { getParse } from "../parseCache";
import { getLineText } from "../documents";
import { wordRangeAt } from "../wordAt";

export interface GuiPaths {
  gamePath: string | null;
  modPath: string | null;
  parentPaths: string[];
  /** Engine-layer roots (jomini), lowest FIOS priority. */
  engineRoots?: string[];
}

/** Current-document defs (live text, cached parse) + the cached cross-file store. */
export function guiDefSources(document: TextDocument, paths: GuiPaths): GuiDefs[] {
  const fsPath = URI.parse(document.uri).fsPath;
  const { result, lineIndex } = getParse(document);
  const docDefs = collectGuiDefsParsed(result.root.statements, undefined, fsPath, lineIndex);
  return [docDefs, getGuiDefs(paths.gamePath, paths.modPath, paths.parentPaths, paths.engineRoots)];
}

function locationAt(file: string, line: number): Location {
  return {
    uri: URI.file(file).toString(),
    range: { start: { line, character: 0 }, end: { line, character: 0 } },
  };
}

/** Convert a block site (file + offset) to a Location, using the live document for its own file. */
function siteLocation(site: GuiBlockSite, document: TextDocument, docFsPath: string): Location | null {
  if (site.file === undefined) return null;
  if (site.file === docFsPath) {
    const { lineIndex } = getParse(document);
    return locationAt(site.file, lineIndex.positionAt(site.offset).line);
  }
  try {
    const text = fs.readFileSync(site.file, "utf8");
    return locationAt(site.file, new LineIndex(text).positionAt(site.offset).line);
  } catch {
    return null;
  }
}

/** `using = X` values among a block's direct statements, in order. */
function usingRefs(block: BlockNode): string[] {
  const refs: string[] = [];
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment") continue;
    if (stmt.key.text.toLowerCase() !== "using") continue;
    if (stmt.value?.kind === "scalar") refs.push(stmt.value.text);
  }
  return refs;
}

function childBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment" || !stmt.value) return null;
  if (stmt.value.kind === "block") return stmt.value;
  if (stmt.value.kind === "tagged-block") return stmt.value.block;
  return null;
}

/**
 * Candidate template/type names whose chain may define the block a
 * `blockoverride "name"` targets, innermost enclosing widget first: for each
 * ancestor block enclosing the offset, its `using =` templates, then the
 * ancestor's own key (a widget type usage).
 */
function blockOverrideCandidates(document: TextDocument, offset: number): string[] {
  const { result } = getParse(document);
  const hit = nodeAtOffset(result.root, offset);
  if (!hit) return [];
  const candidates: string[] = [];
  for (let i = hit.path.length - 1; i >= 0; i--) {
    const stmt = hit.path[i];
    const block = childBlock(stmt);
    if (!block) continue;
    if (offset <= block.openBrace) continue;
    if (block.closeBrace !== null && offset > block.closeBrace) continue;
    candidates.push(...usingRefs(block));
    if (stmt.kind === "assignment") candidates.push(stmt.key.text);
  }
  return candidates;
}

export function provideGuiDefinition(
  document: TextDocument,
  position: Position,
  paths: GuiPaths
): Location[] | null {
  const lineText = getLineText(document, position.line);
  const range = wordRangeAt(lineText, position.character);
  if (!range) return null;
  const word = range.word;
  const { lineIndex } = getParse(document);
  const offset = lineIndex.offsetAt(position);
  const docFsPath = URI.parse(document.uri).fsPath;
  const sources = guiDefSources(document, paths);

  // blockoverride "name" → the block "name" site in the enclosing chain.
  const before = lineText.slice(0, range.start);
  if (/\bblockoverride\s+"?$/i.test(before)) {
    for (const candidate of blockOverrideCandidates(document, offset)) {
      const resolved = resolveGuiDef(candidate, sources);
      if (!resolved) continue;
      const site = collectOverridableBlocks(resolved, sources).get(word);
      if (site) {
        const loc = siteLocation(site, document, docFsPath);
        if (loc) return [loc];
      }
    }
    return null;
  }

  // Template/type name: widget key, `using =` value, or a base in `type X = base`.
  const resolved = resolveGuiDef(word, sources);
  if (resolved && resolved.def.file !== undefined && resolved.def.line !== undefined) {
    return [locationAt(resolved.def.file, resolved.def.line)];
  }
  return null;
}
