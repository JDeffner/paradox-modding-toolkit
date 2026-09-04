/**
 * Parser for the Jomini `script_docs` console command output:
 * triggers.log, effects.log, event_targets.log, modifiers.log.
 *
 * The format is line-based and has shifted slightly between game patches, so parse
 * defensively: entries are separated by dashed lines; the first content line is
 * usually `name - description`; known metadata lines (`Supported Scopes:` etc.) are
 * extracted; anything unrecognized is appended to `doc` or `traits` instead of failing.
 *
 * Newer Jomini titles dump the same information in different shapes; which one a
 * game uses is declared by its profile (GameMeta.scriptDocs, absent = classic):
 *   - "markdown" logs: `## name` / `### name` headings, `**Supported Scopes**: …`.
 *   - "masked-block" modifiers: `name:` + indented Mask/Name/Description lines.
 *   - "tag-line" modifiers: one `Tag: name, Categories: …` line per modifier.
 * All of them produce the same TokenData shape, so everything downstream (hover,
 * completion, the docs cache) is format-agnostic.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type { TokenData, TokenKind } from "@px-lsp/protocol/types";
import { LOG_FILES } from "@px-lsp/protocol/constants";
import { activeProfile } from "../games/active";

export { LOG_FILES };

const SEPARATOR = /^-{4,}\s*$/;
const NAME_DESC = /^([A-Za-z0-9_.:<>|[\]]+)\s+-\s*(.*)$/;
const BARE_NAME = /^([A-Za-z0-9_]+)\s*$/;
// A `usage:` section header; everything until the next metadata line is the example.
const USAGE_HEADER = /^usage:\s*$/i;
// An inline syntax example line: `add_hook = { … }`, `<scheme starter> = …`,
// or a comparison form like `monthly_income > 10`.
const SYNTAX_LINE = /^(?:<[^>]+>|[A-Za-z_][A-Za-z0-9_]*)\s*(?:[<>]=?|!=|=)/;
// modifiers.log style: "Tag: monthly_income, Categories: character".
// `$` admits templated tags ($CULTURE$_opinion); they are split off into
// DocsLoadResult.templates downstream, never into the concrete token list.
const TAG_LINE = /^Tag:\s*([A-Za-z0-9_.$]+)\s*(?:,\s*(.*))?$/;
const SCOPE_LINE = /^(Supported [Ss]copes|Input [Ss]copes|Output [Ss]copes):\s*(.*)$/;
const META_LINE =
  /^(Supported [Tt]argets|Targets?|Traits|Categories|Use [Aa]reas|Requires [Dd]ata|Wild[ _]?[Cc]ard|Global [Ll]ink):\s*(.*)$/;

const braceDelta = (s: string): number => (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length;

export function parseLog(content: string, kind: TokenKind): TokenData[] {
  const tokens: TokenData[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  let current: TokenData | null = null;
  // True once a `usage:` header was seen for the current entry: subsequent
  // non-metadata lines are captured (with indentation) as the usage example.
  let inUsage = false;
  // >0 while an inline (header-less) example is still open. Measured on the
  // 1.19 dumps: 378 effects.log examples run over several lines.
  let openBraces = 0;
  const flush = () => {
    if (current && current.name && !seen.has(current.name)) {
      current.doc = current.doc.trim();
      if (current.traits) current.traits = current.traits.trim();
      if (current.usage) current.usage = current.usage.replace(/^\n+|\s+$/g, "");
      if (!current.usage) delete current.usage;
      seen.add(current.name);
      tokens.push(current);
    }
    current = null;
    inUsage = false;
    openBraces = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (SEPARATOR.test(line)) {
      flush();
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") {
      // Blank lines inside a captured example are structural; keep them.
      if (current && (inUsage || openBraces > 0) && current.usage) current.usage += "\n";
      continue;
    }

    // modifiers.log (1.19+) has no dashed separators: every "Tag:" line
    // begins a new entry. Templated tags ($CULTURE$_opinion) parse like any
    // other; callers partition them out (script references the expanded
    // names, so they feed lazy expansion — modifierTemplates.ts).
    if (trimmed.startsWith("Tag:")) {
      flush();
      const m = TAG_LINE.exec(trimmed);
      if (m) {
        current = { name: m[1], kind, doc: "", scopes: [] };
        inUsage = false;
        if (m[2]) applyMetaLine(current, m[2]);
      }
      continue;
    }

    if (!current) {
      let m = NAME_DESC.exec(trimmed);
      if (m) {
        current = { name: m[1], kind, doc: m[2], scopes: [] };
        inUsage = false;
        continue;
      }
      m = BARE_NAME.exec(trimmed);
      if (m) {
        current = { name: m[1], kind, doc: "", scopes: [] };
        inUsage = false;
        continue;
      }
      // Preamble text ("Printing a list of ..."); skip.
      continue;
    }

    // An inline example that opened a block keeps capturing until the braces
    // balance. A metadata line always ends the entry's body, so it wins over an
    // example that never closes (the extractor's balance guard drops those).
    if (openBraces > 0) {
      if (applyMetaLine(current, trimmed)) {
        openBraces = 0;
        continue;
      }
      current.usage += "\n" + line;
      openBraces += braceDelta(line);
      continue;
    }
    // A metadata line ends any open usage capture and is recorded structurally.
    if (applyMetaLine(current, trimmed)) {
      inUsage = false;
      continue;
    }
    // `usage:` opens a multi-line syntax block; the header itself is dropped.
    if (USAGE_HEADER.test(trimmed)) {
      inUsage = true;
      continue;
    }
    if (inUsage) {
      current.usage = current.usage ? current.usage + "\n" + line : line;
      continue;
    }
    // A lone inline syntax example (`add_hook = { … }`): the first one becomes
    // the usage example; anything after it stays prose.
    if (current.usage === undefined && SYNTAX_LINE.test(trimmed)) {
      current.usage = trimmed;
      openBraces = Math.max(0, braceDelta(trimmed));
      continue;
    }
    // Otherwise: continuation of the description prose.
    current.doc = current.doc === "" ? trimmed : current.doc + "\n" + trimmed;
  }
  flush();
  return tokens;
}

/** Returns true if the line was a recognized metadata line and has been recorded. */
function applyMetaLine(token: TokenData, line: string): boolean {
  const scope = SCOPE_LINE.exec(line);
  if (scope) {
    const label = scope[1].toLowerCase();
    const values = scope[2]
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const prefix = label.startsWith("input") ? "input: " : label.startsWith("output") ? "output: " : "";
    for (const v of values) token.scopes.push(prefix + v);
    return true;
  }
  const meta = META_LINE.exec(line);
  if (meta) {
    const entry = `${meta[1]}: ${meta[2]}`;
    token.traits = token.traits ? token.traits + "\n" + entry : entry;
    return true;
  }
  return false;
}

// --- Newer dump dialects ------------------------------------------------

// `## effect_name` / `### event_target_name`. Level 1 is the file title
// ("# Effect Documentation") and starts no entry.
const MD_HEADING = /^(#{1,6})\s+(.+?)$/;
// `**Supported Scopes**: state` — the bold wrapper is the only difference from
// the classic metadata lines, so it is unwrapped and fed to applyMetaLine.
const MD_BOLD_LABEL = /^\*\*([^*]+)\*\*\s*:/;
// `battle_casualties_mult:` opens a masked-block entry; its Mask/Name/Description
// lines are indented underneath it.
const MASKED_NAME = /^([A-Za-z0-9_.$]+):\s*$/;
const MASKED_FIELD = /^(Mask|Name|Description):\s*(.*)$/;
// `--- Static modifier types ---` and friends: section banners, not entries.
const SECTION_BANNER = /^-{3,}/;

/**
 * Markdown dump dialect (effects.log, triggers.log, event_targets.log of newer
 * titles): entries open at a `##`/`###` heading and run until the next one.
 * Metadata lines are the classic ones, optionally bold-wrapped; the remaining
 * body is prose, except a leading `name = { … }` example which is lifted into
 * `usage` (multi-line examples are followed until the braces balance).
 */
export function parseMarkdownLog(content: string, kind: TokenKind): TokenData[] {
  const tokens: TokenData[] = [];
  const seen = new Set<string>();

  let current: TokenData | null = null;
  // >0 while a multi-line usage example is still open.
  let openBraces = 0;
  const flush = () => {
    if (current && current.name && !seen.has(current.name)) {
      current.doc = current.doc.trim();
      if (current.traits) current.traits = current.traits.trim();
      if (current.usage) current.usage = current.usage.trim();
      if (!current.usage) delete current.usage;
      seen.add(current.name);
      tokens.push(current);
    }
    current = null;
    openBraces = 0;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    // Markdown hard line breaks are trailing double spaces; they are noise here.
    const line = rawLine.trimEnd();
    const heading = MD_HEADING.exec(line);
    if (heading) {
      flush();
      if (heading[1].length > 1) current = { name: heading[2].trim(), kind, doc: "", scopes: [] };
      continue;
    }
    const trimmed = line.trim();
    // A trailing `------` appendix (bare lists of code-saved scope names) is not
    // part of any entry.
    if (SEPARATOR.test(trimmed)) {
      flush();
      continue;
    }
    if (!current) continue;
    const meta = trimmed.replace(MD_BOLD_LABEL, "$1:");
    if (openBraces > 0) {
      // Some dumped examples never close their braces (`switch = { … ` has no
      // final `}`); a metadata line always ends the entry's body, so it wins.
      if (applyMetaLine(current, meta)) {
        openBraces = 0;
        continue;
      }
      current.usage += "\n" + line;
      openBraces += braceDelta(line);
      continue;
    }
    if (trimmed === "") continue;
    if (applyMetaLine(current, meta)) continue;
    if (current.usage === undefined && SYNTAX_LINE.test(trimmed)) {
      current.usage = trimmed;
      openBraces = Math.max(0, braceDelta(trimmed));
      continue;
    }
    current.doc = current.doc === "" ? trimmed : current.doc + "\n" + trimmed;
  }
  flush();
  return tokens;
}

/**
 * "masked-block" modifiers.log: `name:` followed by indented `Mask:`, `Name:`
 * and `Description:` lines (the display name and description become the doc,
 * the mask is metadata). Descriptions may continue on later unindented lines.
 */
export function parseMaskedBlockModifiers(content: string, kind: TokenKind): TokenData[] {
  const tokens: TokenData[] = [];
  const seen = new Set<string>();
  let current: TokenData | null = null;
  const flush = () => {
    if (current && !seen.has(current.name)) {
      current.doc = current.doc.trim();
      seen.add(current.name);
      tokens.push(current);
    }
    current = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (SECTION_BANNER.test(trimmed)) {
      flush();
      continue;
    }
    const name = MASKED_NAME.exec(line);
    if (name) {
      flush();
      current = { name: name[1], kind, doc: "", scopes: [] };
      continue;
    }
    if (!current || trimmed === "") continue;
    const field = MASKED_FIELD.exec(trimmed);
    if (field && field[1] === "Mask") {
      current.traits = current.traits ? current.traits + "\n" + trimmed : trimmed;
      continue;
    }
    // Name/Description text, plus any unindented continuation of it.
    const text = field ? field[2] : trimmed;
    if (text !== "") current.doc = current.doc === "" ? text : current.doc + "\n" + text;
  }
  flush();
  return tokens;
}

/**
 * "tag-line" modifiers.log: one `Tag: name, Categories: Country, , All,` line
 * per modifier (the category list is padded with empty entries). No description
 * is dumped, so the categories are all the metadata there is.
 */
export function parseTagLineModifiers(content: string, kind: TokenKind): TokenData[] {
  const tokens: TokenData[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const m = TAG_LINE.exec(rawLine.trim());
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const token: TokenData = { name: m[1], kind, doc: "", scopes: [] };
    const categories = (m[2] ?? "")
      .replace(/^Categories:\s*/i, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (categories.length > 0) token.traits = `Categories: ${categories.join(", ")}`;
    tokens.push(token);
  }
  return tokens;
}

export interface DocsLoadResult {
  tokens: TokenData[];
  /** Templated modifier tags ($CULTURE$_opinion), for lazy expansion. */
  templates: TokenData[];
  /** mtimeMs per log file found; the cache key. */
  mtimes: Record<string, number>;
  /** Log file names that were missing from logsPath. */
  missing: string[];
  fromCache: boolean;
}

/**
 * Parse on_actions.log (console `script_docs` output): each entry documents an
 * on_action's expected root scope. Returns an empty map when the log is absent.
 *
 *   on_death:
 *   From Code: Yes
 *   Expected Scope: character
 */
export function parseOnActionsLog(logsDir: string): Map<string, string> {
  const scopes = new Map<string, string>();
  let content: string;
  try {
    content = fs.readFileSync(path.join(logsDir, "on_actions.log"), "utf8");
  } catch {
    return scopes;
  }
  const entry = /^([A-Za-z0-9_.-]+):\s*\r?\nFrom Code: (?:Yes|No)\s*\r?\nExpected Scope: (\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(content)) !== null) scopes.set(m[1], m[2].toLowerCase());
  return scopes;
}

/** The parser for one log, per the active profile's dump dialect. */
function parserFor(kind: TokenKind): (content: string, kind: TokenKind) => TokenData[] {
  const dialect = activeProfile().scriptDocs;
  if (kind === "modifier") {
    if (dialect?.modifiers === "masked-block") return parseMaskedBlockModifiers;
    if (dialect?.modifiers === "tag-line") return parseTagLineModifiers;
    return parseLog;
  }
  return dialect?.format === "markdown" ? parseMarkdownLog : parseLog;
}

/** Parse the four script_docs logs found in `logsDir`. Missing files are reported, not fatal. */
export function loadTokenDataFromLogs(logsDir: string): DocsLoadResult {
  const tokens: TokenData[] = [];
  const templates: TokenData[] = [];
  const mtimes: Record<string, number> = {};
  const missing: string[] = [];
  for (const { file, kind } of LOG_FILES) {
    const full = path.join(logsDir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      missing.push(file);
      continue;
    }
    mtimes[file] = stat.mtimeMs;
    try {
      for (const t of parserFor(kind)(fs.readFileSync(full, "utf8"), kind)) {
        (t.name.includes("$") ? templates : tokens).push(t);
      }
    } catch {
      missing.push(file);
    }
  }
  return { tokens, templates, mtimes, missing, fromCache: false };
}

interface DocsCacheFile {
  cacheFormat: number;
  mtimes: Record<string, number>;
  tokens: TokenData[];
  templates: TokenData[];
}

// Bump when the parsed TokenData shape changes (a stale mtime-keyed cache would
// otherwise serve old parses). 3: templated modifier tags ($CULTURE$_opinion).
// 4: added the `usage` field (syntax examples).
// 5: per-profile dump dialects (markdown / masked-block / tag-line), which the
// classic parser had mangled into near-empty caches for the newer titles.
const DOCS_CACHE_FORMAT = 5;

/** Load token data, using the JSON cache when log mtimes are unchanged. */
export function loadTokenData(logsDir: string, cacheFile: string, forceReparse = false): DocsLoadResult {
  const fresh = () => {
    const result = loadTokenDataFromLogs(logsDir);
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const payload: DocsCacheFile = {
        cacheFormat: DOCS_CACHE_FORMAT,
        mtimes: result.mtimes,
        tokens: result.tokens,
        templates: result.templates,
      };
      fs.writeFileSync(cacheFile, JSON.stringify(payload));
    } catch {
      // Cache write failure is non-fatal.
    }
    return result;
  };

  if (forceReparse) return fresh();

  let cached: DocsCacheFile;
  try {
    cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    return fresh();
  }
  if (cached.cacheFormat !== DOCS_CACHE_FORMAT || !cached.tokens || !cached.templates || !cached.mtimes)
    return fresh();

  // Cache is valid only if the exact same set of files exists with the same mtimes.
  const currentMtimes: Record<string, number> = {};
  const missing: string[] = [];
  for (const { file } of LOG_FILES) {
    try {
      currentMtimes[file] = fs.statSync(path.join(logsDir, file)).mtimeMs;
    } catch {
      missing.push(file);
    }
  }
  const cachedKeys = Object.keys(cached.mtimes).sort().join(",");
  const currentKeys = Object.keys(currentMtimes).sort().join(",");
  const same =
    cachedKeys === currentKeys && Object.entries(currentMtimes).every(([f, t]) => cached.mtimes[f] === t);
  if (!same) return fresh();

  return {
    tokens: cached.tokens,
    templates: cached.templates,
    mtimes: cached.mtimes,
    missing,
    fromCache: true,
  };
}
