/**
 * Vanilla-usage harvest for [ ... ] datafunction expressions: scans the game's
 * gui/ tree and localization/<language>/ for every bracketed expression and
 * records what real code does with each name — usage counts, immediate
 * members, call arities, quoted literal arguments, formatting suffixes and
 * example sites. This is the "deduce it from how it's used" layer: it covers
 * names newer than the bundled wiki tables and enriches everything with
 * ground-truth examples. Cached in the storage dir (one full-text scan of
 * ~35 MB per game patch is too slow to repeat every start).
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { listFiles } from "@paradox-lsp/protocol/fsWalk";

export interface DataFnExample {
  /** The full bracketed expression, capped for display. */
  text: string;
  /** Game-relative file path and 1-based line, for provenance in hovers. */
  file: string;
  line: number;
}

export interface DataFnUsage {
  /** Chain-start name (PascalCase/ALL_CAPS only) -> number of uses. */
  starts: Map<string, number>;
  /** Chain-start name -> immediate `.member` -> count (datacontext-style pairs). */
  pairs: Map<string, Map<string, number>>;
  /** Any post-dot segment name -> count, across all chains (unresolved-chain fallback). */
  memberPool: Map<string, number>;
  /** Called name -> arity -> count. */
  argCounts: Map<string, Map<number, number>>;
  /** Called name -> quoted literal argument -> count. */
  literals: Map<string, Map<string, number>>;
  /** `|X` formatting suffix -> count. */
  formats: Map<string, number>;
  /** Segment name -> up to MAX_EXAMPLES shortest real expressions using it. */
  examples: Map<string, DataFnExample[]>;
  files: number;
  exprs: number;
}

export function emptyUsage(): DataFnUsage {
  return {
    starts: new Map(),
    pairs: new Map(),
    memberPool: new Map(),
    argCounts: new Map(),
    literals: new Map(),
    formats: new Map(),
    examples: new Map(),
    files: 0,
    exprs: 0,
  };
}

const MAX_EXAMPLES = 2;
const MAX_EXAMPLE_LEN = 140;
const MAX_LITERAL_LEN = 48;
const MAX_LITERALS_PER_FN = 40;

// ---- expression parsing -----------------------------------------------------

interface Seg {
  name: string;
  /** Argument list when called with parens; null when a plain segment. */
  args: Arg[] | null;
}
type Arg = { kind: "literal"; value: string } | { kind: "chain"; segments: Seg[] } | { kind: "number" };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Tolerant recursive-descent parse of one bracketed expression body (without
 * the [ ]). Returns the top-level chain plus any nested argument chains, or
 * null when the text is not a datafunction expression (loc escapes, junk).
 */
export function parseDataFnExpr(text: string): { chain: Seg[]; format: string | null } | null {
  let pos = 0;
  const skipWs = () => {
    while (pos < text.length && (text[pos] === " " || text[pos] === "\t")) pos++;
  };

  function parseChain(): Seg[] | null {
    const segments: Seg[] = [];
    for (;;) {
      skipWs();
      const m = IDENT.exec(text.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      skipWs();
      let args: Arg[] | null = null;
      if (text[pos] === "(") {
        pos++;
        args = [];
        skipWs();
        if (text[pos] === ")") pos++;
        else {
          for (;;) {
            const arg = parseArg();
            if (!arg) return null;
            args.push(arg);
            skipWs();
            if (text[pos] === ",") {
              pos++;
              continue;
            }
            if (text[pos] === ")") {
              pos++;
              break;
            }
            return null;
          }
        }
      }
      segments.push({ name: m[0], args });
      skipWs();
      if (text[pos] === ".") {
        pos++;
        continue;
      }
      return segments;
    }
  }

  function parseArg(): Arg | null {
    skipWs();
    const ch = text[pos];
    if (ch === "'") {
      const close = text.indexOf("'", pos + 1);
      if (close < 0) return null;
      const value = text.slice(pos + 1, close);
      pos = close + 1;
      return { kind: "literal", value };
    }
    if (/[0-9\-]/.test(ch)) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(text.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      return { kind: "number" };
    }
    const segments = parseChain();
    return segments ? { kind: "chain", segments } : null;
  }

  const chain = parseChain();
  if (!chain) return null;
  skipWs();
  let format: string | null = null;
  if (text[pos] === "|") {
    format = text.slice(pos + 1).trim();
    pos = text.length;
  }
  skipWs();
  if (pos < text.length) return null;
  return { chain, format };
}

// ---- recording ---------------------------------------------------------------

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function addExample(usage: DataFnUsage, name: string, ex: DataFnExample): void {
  let list = usage.examples.get(name);
  if (!list) usage.examples.set(name, (list = []));
  if (list.some((e) => e.text === ex.text)) return;
  if (list.length < MAX_EXAMPLES) {
    list.push(ex);
    return;
  }
  // Prefer the shortest examples: they read best in a hover.
  let longest = 0;
  for (let i = 1; i < list.length; i++) if (list[i].text.length > list[longest].text.length) longest = i;
  if (ex.text.length < list[longest].text.length) list[longest] = ex;
}

function recordChain(usage: DataFnUsage, chain: Seg[], ex: DataFnExample, topLevel: boolean): void {
  const first = chain[0];
  // Chain starts: types / global promotes / global functions are PascalCase or
  // ALL_CAPS in vanilla. Lowercase starts in loc are script-scope bindings
  // (owner.GetName) — not completable names, but their members still count.
  if (/^[A-Z]/.test(first.name)) {
    bump(usage.starts, first.name);
    addExample(usage, first.name, ex);
    if (chain.length > 1) {
      let members = usage.pairs.get(first.name);
      if (!members) usage.pairs.set(first.name, (members = new Map()));
      bump(members, chain[1].name);
    }
  }
  for (let i = 0; i < chain.length; i++) {
    const seg = chain[i];
    if (i > 0) {
      bump(usage.memberPool, seg.name);
      addExample(usage, seg.name, ex);
    }
    if (seg.args !== null) {
      let arities = usage.argCounts.get(seg.name);
      if (!arities) usage.argCounts.set(seg.name, (arities = new Map()));
      bump(arities, seg.args.length);
      for (const arg of seg.args) {
        if (arg.kind === "literal") {
          if (arg.value.length === 0 || arg.value.length > MAX_LITERAL_LEN) continue;
          let lits = usage.literals.get(seg.name);
          if (!lits) usage.literals.set(seg.name, (lits = new Map()));
          if (lits.size < MAX_LITERALS_PER_FN || lits.has(arg.value)) bump(lits, arg.value);
        } else if (arg.kind === "chain") {
          recordChain(usage, arg.segments, ex, false);
        }
      }
    }
  }
  if (topLevel) usage.exprs++;
}

/** Bracketed expressions in one line of text; `\[` (loc escape) is skipped. */
const EXPR_RE = /\[([^\][\r\n]+)\]/g;

export function harvestLine(usage: DataFnUsage, lineText: string, file: string, lineNo: number): void {
  EXPR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPR_RE.exec(lineText)) !== null) {
    if (m.index > 0 && lineText[m.index - 1] === "\\") continue;
    const parsed = parseDataFnExpr(m[1]);
    if (!parsed) continue;
    const text = `[${m[1]}]`;
    const ex: DataFnExample = {
      text: text.length > MAX_EXAMPLE_LEN ? text.slice(0, MAX_EXAMPLE_LEN - 1) + "…" : text,
      file,
      line: lineNo,
    };
    recordChain(usage, parsed.chain, ex, true);
    if (parsed.format) {
      // Suffix may itself chain formats; count the leading token only.
      const fmt = /^[A-Za-z0-9+\-=*%.]+/.exec(parsed.format)?.[0];
      if (fmt && fmt.length <= 3) bump(usage.formats, fmt);
    }
  }
}

// ---- scanning + cache ---------------------------------------------------------

function harvestFile(usage: DataFnUsage, filePath: string, relPath: string): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  if (!text.includes("[")) {
    usage.files++;
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("[")) harvestLine(usage, lines[i], relPath, i + 1);
  }
  usage.files++;
}

/** The two scanned trees under a game root: the gui/ tree and one localization language folder. */
function scanRoots(gamePath: string, locLanguage: string): ReadonlyArray<readonly [string, string]> {
  return [
    [path.join(gamePath, "gui"), ".gui"],
    [path.join(gamePath, "localization", locLanguage), ".yml"],
  ];
}

export function harvestGameUsage(gamePath: string, locLanguage = "english"): DataFnUsage {
  const usage = emptyUsage();
  for (const [root, ext] of scanRoots(gamePath, locLanguage)) {
    for (const file of listFiles(root, ext)) {
      harvestFile(usage, file, path.relative(gamePath, file).replace(/\\/g, "/"));
    }
  }
  return usage;
}

// JSON cache: bump CACHE_VERSION whenever the harvest shape or logic changes.
const CACHE_VERSION = 1;

interface CacheShape {
  version: number;
  stamp: string;
  starts: Record<string, number>;
  pairs: Record<string, Record<string, number>>;
  memberPool: Record<string, number>;
  argCounts: Record<string, Record<string, number>>;
  literals: Record<string, Record<string, number>>;
  formats: Record<string, number>;
  examples: Record<string, DataFnExample[]>;
  files: number;
  exprs: number;
}

/**
 * Cheap change stamp: file count + total size of both scanned trees. A game
 * patch always changes it; it costs one directory walk, not 35 MB of reads.
 */
function usageStamp(gamePath: string, locLanguage: string): string {
  let count = 0;
  let size = 0;
  for (const [root, ext] of scanRoots(gamePath, locLanguage)) {
    for (const file of listFiles(root, ext)) {
      count++;
      try {
        size += fs.statSync(file).size;
      } catch {
        /* unreadable file: stamp from the rest */
      }
    }
  }
  return `${CACHE_VERSION}:${gamePath}:${locLanguage}:${count}:${size}`;
}

function toObj<V>(map: Map<string, V>): Record<string, V> {
  return Object.fromEntries(map);
}
function toMap<V>(obj: Record<string, V> | undefined): Map<string, V> {
  return new Map(Object.entries(obj ?? {}));
}

function serialize(usage: DataFnUsage, stamp: string): CacheShape {
  return {
    version: CACHE_VERSION,
    stamp,
    starts: toObj(usage.starts),
    pairs: toObj(new Map([...usage.pairs].map(([k, v]) => [k, toObj(v)]))),
    memberPool: toObj(usage.memberPool),
    argCounts: toObj(
      new Map(
        [...usage.argCounts].map(([k, v]) => [k, toObj(new Map([...v].map(([n, c]) => [String(n), c])))])
      )
    ),
    literals: toObj(new Map([...usage.literals].map(([k, v]) => [k, toObj(v)]))),
    formats: toObj(usage.formats),
    examples: toObj(usage.examples),
    files: usage.files,
    exprs: usage.exprs,
  };
}

function deserialize(cache: CacheShape): DataFnUsage {
  return {
    starts: toMap(cache.starts),
    pairs: new Map(Object.entries(cache.pairs ?? {}).map(([k, v]) => [k, toMap(v)])),
    memberPool: toMap(cache.memberPool),
    argCounts: new Map(
      Object.entries(cache.argCounts ?? {}).map(([k, v]) => [
        k,
        new Map(Object.entries(v).map(([n, c]) => [Number(n), c])),
      ])
    ),
    literals: new Map(Object.entries(cache.literals ?? {}).map(([k, v]) => [k, toMap(v)])),
    formats: toMap(cache.formats),
    examples: toMap(cache.examples),
    files: cache.files ?? 0,
    exprs: cache.exprs ?? 0,
  };
}

export interface UsageLoadResult {
  usage: DataFnUsage;
  fromCache: boolean;
}

/** Harvest with a stamp-validated JSON cache; empty usage when no game path. */
export function loadDataFnUsage(
  gamePath: string | null,
  locLanguage: string,
  cacheFile: string | null,
  force = false
): UsageLoadResult {
  if (!gamePath) return { usage: emptyUsage(), fromCache: false };
  const stamp = usageStamp(gamePath, locLanguage);
  const cached = readCache(cacheFile, stamp, force);
  if (cached) return { usage: cached, fromCache: true };
  const usage = harvestGameUsage(gamePath, locLanguage);
  writeCache(cacheFile, usage, stamp);
  return { usage, fromCache: false };
}

/**
 * Async variant for server startup: the uncached first harvest reads ~35 MB
 * (20s on a cold OS cache), so it yields to the event loop between files
 * instead of blocking every LSP request. Cache hits return without yielding.
 */
export async function loadDataFnUsageAsync(
  gamePath: string | null,
  locLanguage: string,
  cacheFile: string | null,
  force = false
): Promise<UsageLoadResult> {
  if (!gamePath) return { usage: emptyUsage(), fromCache: false };
  const stamp = usageStamp(gamePath, locLanguage);
  const cached = readCache(cacheFile, stamp, force);
  if (cached) return { usage: cached, fromCache: true };
  const usage = emptyUsage();
  const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));
  for (const [root, ext] of scanRoots(gamePath, locLanguage)) {
    for (const file of listFiles(root, ext)) {
      harvestFile(usage, file, path.relative(gamePath, file).replace(/\\/g, "/"));
      if (usage.files % 20 === 0) await yieldNow();
    }
  }
  writeCache(cacheFile, usage, stamp);
  return { usage, fromCache: false };
}

function readCache(cacheFile: string | null, stamp: string, force: boolean): DataFnUsage | null {
  if (!cacheFile || force) return null;
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as CacheShape;
    if (cache.version === CACHE_VERSION && cache.stamp === stamp) return deserialize(cache);
  } catch {
    /* no/invalid cache: harvest */
  }
  return null;
}

function writeCache(cacheFile: string | null, usage: DataFnUsage, stamp: string): void {
  if (!cacheFile || usage.exprs === 0) return;
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(serialize(usage, stamp)));
  } catch {
    /* cache write is best-effort */
  }
}
