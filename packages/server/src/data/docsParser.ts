/**
 * Parser for the Jomini `script_docs` console command output:
 * triggers.log, effects.log, event_targets.log, modifiers.log.
 *
 * The format is line-based and has shifted slightly between game patches, so parse
 * defensively: entries are separated by dashed lines; the first content line is
 * usually `name - description`; known metadata lines (`Supported Scopes:` etc.) are
 * extracted; anything unrecognized is appended to `doc` or `traits` instead of failing.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type { TokenData, TokenKind } from "@paradox-lsp/protocol/types";
import { LOG_FILES } from "@paradox-lsp/protocol/constants";

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

export function parseLog(content: string, kind: TokenKind): TokenData[] {
  const tokens: TokenData[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  let current: TokenData | null = null;
  // True once a `usage:` header was seen for the current entry: subsequent
  // non-metadata lines are captured (with indentation) as the usage example.
  let inUsage = false;
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
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (SEPARATOR.test(line)) {
      flush();
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "") {
      // Blank lines inside a `usage:` block are structural; keep them.
      if (current && inUsage && current.usage) current.usage += "\n";
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
  const entry = /^([A-Za-z0-9_.\-]+):\s*\r?\nFrom Code: (?:Yes|No)\s*\r?\nExpected Scope: (\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(content)) !== null) scopes.set(m[1], m[2].toLowerCase());
  return scopes;
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
      for (const t of parseLog(fs.readFileSync(full, "utf8"), kind)) {
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
const DOCS_CACHE_FORMAT = 4;

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
