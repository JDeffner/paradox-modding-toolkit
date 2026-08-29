/**
 * Parser for the wiki reference lists bundled in wikidocs/ (Markdown mirrors
 * of the Paradox wiki; see wikidocs/ATTRIBUTION.md for provenance).
 *
 * These are a fallback and enrichment source for engine tokens: script_docs
 * output is authoritative for the user's exact game version, but the wiki lists
 * work without ever launching the game in debug mode and carry usage examples
 * that script_docs lacks.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type { TokenData, TokenKind } from "@px-lsp/protocol/types";
import { activeProfile } from "../games/active";

const NAME_RE = /^[A-Za-z0-9_.:]+$/;

/** Strip markdown/HTML noise from a table cell, keeping <br> as line breaks. */
export function cleanCell(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?code[^>]*>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/`/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#124;/g, "|")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** Split a markdown table row into cleaned cells; returns null for non-row lines. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split("|").map(cleanCell);
}

function isHeaderOrSeparator(cells: string[]): boolean {
  return cells.every((c) => c === "" || /^-{3,}$/.test(c)) || cells.some((c) => /^Name$|^Scope$/i.test(c));
}

function makeToken(
  kind: TokenKind,
  name: string,
  doc: string,
  scopes: string[],
  traitLines: string[],
  usage?: string
): TokenData {
  const token: TokenData = { name, kind, doc, scopes: scopes.filter((s) => s !== "") };
  // Sections separated by blank lines so consumers can pick out e.g. the Example block.
  const traits = traitLines.filter((t) => t !== "").join("\n\n");
  if (traits) token.traits = traits;
  if (usage) token.usage = usage;
  return token;
}

function splitScopes(cell: string): string[] {
  return cell
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Effects_list.md: | Name | Desc | Example | Scopes | Target | */
export function parseWikiEffects(md: string): TokenData[] {
  const tokens: TokenData[] = [];
  for (const line of md.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells || cells.length < 4 || isHeaderOrSeparator(cells)) continue;
    const [name, desc, example, scopes, target] = cells;
    if (!NAME_RE.test(name)) continue;
    tokens.push(
      makeToken(
        "effect",
        name,
        desc,
        splitScopes(scopes ?? ""),
        [target ? `Target: ${target}` : ""],
        example || undefined
      )
    );
  }
  return tokens;
}

/** Triggers_list.md: | Name | Description | Usage | Traits | Supported Scopes | Supported Targets | */
export function parseWikiTriggers(md: string): TokenData[] {
  const tokens: TokenData[] = [];
  for (const line of md.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (!cells || cells.length < 5 || isHeaderOrSeparator(cells)) continue;
    const [name, desc, usage, traits, scopes, targets] = cells;
    if (!NAME_RE.test(name)) continue;
    tokens.push(
      makeToken(
        "trigger",
        name,
        desc,
        splitScopes(scopes ?? ""),
        [traits ? `Traits: ${traits}` : "", targets ? `Supported Targets: ${targets}` : ""],
        usage || undefined
      )
    );
  }
  return tokens;
}

/**
 * Scopes_list.md: sections (## Character, ## Culture, ...) each with
 * | Scope | Description | To scope | Version added | tables. The section is the
 * input scope, "To scope" the output scope.
 */
export function parseWikiEventTargets(md: string): TokenData[] {
  const tokens: TokenData[] = [];
  let section = "";
  for (const line of md.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line.trim());
    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }
    const cells = splitRow(line);
    if (!cells || cells.length < 3 || isHeaderOrSeparator(cells)) continue;
    const [name, desc, toScope, version] = cells;
    if (!NAME_RE.test(name)) continue;
    const scopes: string[] = [];
    if (section && section !== "primitive scopes") scopes.push(`input: ${section}`);
    if (toScope) scopes.push(`output: ${toScope}`);
    tokens.push(makeToken("event_target", name, desc, scopes, [version ? `Version added: ${version}` : ""]));
  }
  return tokens;
}

export const WIKI_FILES: Array<{ file: string; parse: (md: string) => TokenData[] }> = [
  { file: "Effects_list.md", parse: parseWikiEffects },
  { file: "Triggers_list.md", parse: parseWikiTriggers },
  { file: "Scopes_list.md", parse: parseWikiEventTargets },
];

/** Parse all bundled wiki list files found in `dir`. Missing files are skipped. */
export function loadWikiTokens(dir: string): TokenData[] {
  const tokens: TokenData[] = [];
  for (const { file, parse } of WIKI_FILES) {
    try {
      tokens.push(...parse(fs.readFileSync(path.join(dir, file), "utf8")));
    } catch {
      // Bundled file missing/unreadable: skip, the extension works without it.
    }
  }
  return tokens;
}

export interface WikiMergeOptions {
  /**
   * Drop wiki NAMES that the script_docs dump does not have, instead of adding
   * them. Pass this ONLY for the user's own dump.
   *
   * `script_docs` is what the engine registered when the game ran, so a name it
   * omits does not exist in that patch. The bundled wiki lists say as much
   * themselves ("be aware that it is outdated. Some effects have been
   * deprecated"). Measured against a real CK3 install: of 2,336 wiki tokens,
   * 2,262 were already in the dump and 74 were not, and the ones sampled from
   * that 74 (`every_activity_invited`, `every_participant`,
   * `accept_invitation_for_character`) appear in zero vanilla files. They are
   * pre-Tours-and-Tournaments activity API, and offering them in completion is
   * how a modder writes an effect that silently does nothing.
   *
   * The wiki's real contribution survives either way: 127 usage examples for
   * tokens the dump already had.
   */
  dropUnknownNames?: boolean;
}

export interface WikiMergeResult {
  tokens: TokenData[];
  /** Wiki-only names added (0 when `dropUnknownNames` suppressed them). */
  added: number;
  /** Wiki-only names dropped as absent from the authoritative dump. */
  dropped: number;
  /** Tokens that gained a usage example they did not have. */
  enriched: number;
}

/**
 * Merge script_docs tokens (authoritative) with wiki tokens (fallback and
 * enrichment): tokens present in both keep the script_docs doc and scopes but
 * gain the wiki's usage example, and wiki-only tokens are either added with a
 * provenance note or dropped (see {@link WikiMergeOptions.dropUnknownNames}).
 *
 * NOTE: this MUTATES the `scriptDocs` tokens it is handed, which is how
 * enrichment lands on them. Calling it twice on the same array therefore
 * reports `enriched: 0` the second time, because the usage examples are already
 * there. Production calls it once per load; a comparison harness must reload.
 */
export function mergeWikiTokens(
  scriptDocs: TokenData[],
  wiki: TokenData[],
  options: WikiMergeOptions = {}
): WikiMergeResult {
  const byKey = new Map<string, TokenData>();
  /** Kinds the dump actually covers, so a wiki file for a kind script_docs does
   *  not dump is never mistaken for "these all stopped existing". */
  const coveredKinds = new Set<string>();
  for (const t of scriptDocs) {
    byKey.set(`${t.kind}:${t.name}`, t);
    coveredKinds.add(t.kind);
  }

  const tokens = [...scriptDocs];
  const wikiNote = activeProfile().wikiNote;
  let added = 0;
  let dropped = 0;
  let enriched = 0;
  for (const w of wiki) {
    const existing = byKey.get(`${w.kind}:${w.name}`);
    if (!existing) {
      if (options.dropUnknownNames && coveredKinds.has(w.kind)) {
        dropped++;
        continue;
      }
      const note = w.traits ? `${w.traits}\n${wikiNote}` : wikiNote;
      tokens.push({ ...w, traits: note });
      added++;
      continue;
    }
    if (existing.doc === "" && w.doc !== "") existing.doc = w.doc;
    // script_docs is authoritative; the wiki fills a missing syntax example.
    if (!existing.usage && w.usage) {
      existing.usage = w.usage;
      enriched++;
    }
  }
  return { tokens, added, dropped, enriched };
}
