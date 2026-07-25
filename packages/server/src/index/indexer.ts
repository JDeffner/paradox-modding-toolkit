/**
 * Definition indexer for vanilla + parent-mod + mod folders, driven by the
 * schema table (packages/server/src/schema): every schema entry maps one folder to a
 * definition kind and an extraction mode.
 *
 * No `vscode` imports here: this module is unit-tested in plain Node. The
 * FileSystemWatcher wiring lives in the client.
 */
import * as fs from "fs";
import * as path from "path";
import type { DefKind, Definition, DefSource, IndexStats } from "@px-lsp/protocol/types";
import { listFiles, walkDir } from "@px-lsp/protocol/fsWalk";
import { activeProfile } from "../games/active";
import type { SchemaEntry } from "../schema/types";
import { EVENT_ID, extractDefinitions, extractLocDefinitions } from "./extract";

export { listFiles, EVENT_ID };
export type { IndexStats };

/** Priority when several sources define the same name (higher shadows lower). */
const SOURCE_RANK: Record<DefSource, number> = { mod: 2, parent: 1, vanilla: 0 };

// Back-compat helpers used by unit tests and older callers.
export function parseScriptDefinitions(
  content: string,
  kind: DefKind,
  file: string,
  source: DefSource
): Definition[] {
  const entry: SchemaEntry = {
    path: "",
    kind,
    extraction: kind === "event" ? "event-id" : "top-level-key",
  };
  return extractDefinitions(content, entry, file, source);
}

export function parseLocDefinitions(content: string, file: string, source: DefSource): Definition[] {
  return extractLocDefinitions(content, file, source);
}

function normFile(file: string): string {
  const n = path.normalize(file);
  return process.platform === "win32" ? n.toLowerCase() : n;
}

export class DefinitionIndex {
  private byName = new Map<string, Definition[]>();
  private byFile = new Map<string, Definition[]>();
  /** Bumped on every mutation; used by providers to invalidate caches. */
  revision = 0;

  addAll(defs: Definition[]): void {
    for (const def of defs) {
      let list = this.byName.get(def.name);
      if (!list) this.byName.set(def.name, (list = []));
      list.push(def);
      const fkey = normFile(def.file);
      let flist = this.byFile.get(fkey);
      if (!flist) this.byFile.set(fkey, (flist = []));
      flist.push(def);
    }
    if (defs.length > 0) this.revision++;
  }

  removeFile(file: string): void {
    const fkey = normFile(file);
    const defs = this.byFile.get(fkey);
    if (!defs) return;
    this.byFile.delete(fkey);
    for (const def of defs) {
      const list = this.byName.get(def.name);
      if (!list) continue;
      const filtered = list.filter((d) => d !== def);
      if (filtered.length === 0) this.byName.delete(def.name);
      else this.byName.set(def.name, filtered);
    }
    this.revision++;
  }

  /** Only the highest-ranked source present: mod shadows parent shadows vanilla. */
  private shadowResolve(list: Definition[]): Definition[] {
    let best = -1;
    for (const d of list) best = Math.max(best, SOURCE_RANK[d.source]);
    return list.filter((d) => SOURCE_RANK[d.source] === best);
  }

  /** All definitions for a name after shadow resolution. */
  lookup(name: string): Definition[] {
    const list = this.byName.get(name);
    if (!list || list.length === 0) return [];
    return this.shadowResolve(list);
  }

  /** All definitions for a name, all sources (for "peek all"). */
  lookupAll(name: string): Definition[] {
    return this.byName.get(name) ?? [];
  }

  /** Iterate one shadow-resolved definition per name, optionally filtered. */
  *entries(filter?: (def: Definition) => boolean): IterableIterator<Definition> {
    for (const list of this.byName.values()) {
      // Apply the filter across ALL shadow-resolved defs of the name, not just
      // the first: a name can carry several kinds (vanilla `brave` is a loc_key
      // AND a trait), and a kind-filtered caller must still see the matching one.
      const resolved = this.shadowResolve(list);
      const def = filter ? resolved.find(filter) : resolved[0];
      if (def) yield def;
    }
  }

  stats(): IndexStats {
    const byKind: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const list of this.byFile.values()) {
      for (const def of list) {
        total++;
        byKind[def.kind] = (byKind[def.kind] ?? 0) + 1;
        bySource[def.source] = (bySource[def.source] ?? 0) + 1;
      }
    }
    return { total, files: this.byFile.size, byKind, bySource };
  }

  allDefinitions(): Definition[] {
    const out: Definition[] = [];
    for (const list of this.byFile.values()) out.push(...list);
    return out;
  }

  /** Definitions in one file. */
  inFile(file: string): Definition[] {
    return this.byFile.get(normFile(file)) ?? [];
  }
}

/** Which schema entry a file contributes to under `root`, or null if not indexed. */
export function classifyFile(
  root: string,
  file: string,
  entries: SchemaEntry[] = activeProfile().schema
): SchemaEntry | null {
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const relFwd = rel.split(path.sep).join("/").toLowerCase();
  let best: SchemaEntry | null = null;
  for (const entry of entries) {
    const ext = entry.ext ?? ".txt";
    if (relFwd.startsWith(entry.path + "/") && relFwd.endsWith(ext)) {
      // Longest path wins (common/culture/traditions over a hypothetical common/culture).
      if (!best || entry.path.length > best.path.length) best = entry;
    }
  }
  return best;
}

/** True if a localization file belongs to the configured language. */
export function isWantedLocFile(relPath: string, locLanguage: string): boolean {
  const lower = relPath.toLowerCase().split(path.sep).join("/");
  if (lower.includes(`l_${locLanguage}`)) return true;
  return lower.split("/").includes(locLanguage);
}

export function parseFile(file: string, entry: SchemaEntry, source: DefSource): Definition[] {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  content = content.replace(/^﻿/, "");
  return extractDefinitions(content, entry, file, source);
}

export interface ScanOptions {
  locLanguage: string;
  entries?: SchemaEntry[];
}

/** Scan every schema folder under `root` and return the definitions found. */
export function scanRoot(root: string, source: DefSource, opts: ScanOptions): Definition[] {
  const defs: Definition[] = [];
  for (const entry of opts.entries ?? activeProfile().schema) {
    const dir = path.join(root, ...entry.path.split("/"));
    const files: string[] = [];
    walkDir(dir, entry.ext ?? ".txt", files);
    for (const file of files) {
      if (entry.kind === "loc_key" && !isWantedLocFile(path.relative(root, file), opts.locLanguage)) continue;
      defs.push(...parseFile(file, entry, source));
    }
  }
  return defs;
}

// ---------------------------------------------------------------------------
// Vanilla index cache (compact JSON, keyed by game version)
// ---------------------------------------------------------------------------

// Bumped to 4 for §E doc/tags columns; a v3 cache is silently rejected and rebuilt.
// Bumped to 5 when engine-layer (jomini) definitions joined the vanilla scan;
// older caches lack them and must rebuild.
const INDEX_CACHE_FORMAT = 5;

/** Compact "absent" marker inside cache rows. */
type Absent = 0;

/** Tags serialized as a compact array; absent → 0. */
type CachedTags = Array<[string, string]> | Absent;

interface IndexCacheFile {
  cacheFormat: number;
  gameVersion: string;
  /** Kind string table (schema-driven, open set). */
  kinds: string[];
  files: string[];
  // [name, kindIdx, fileIdx, line, value|0, paramsSpaceJoined|0, doc|0, tags|0]
  defs: Array<
    [string, number, number, number, string | Absent, string | Absent, string | Absent, CachedTags]
  >;
}

export function saveIndexCache(cacheFile: string, gameVersion: string, defs: Definition[]): void {
  const kindIdx = new Map<string, number>();
  const kinds: string[] = [];
  const fileIdx = new Map<string, number>();
  const files: string[] = [];
  const rows: IndexCacheFile["defs"] = [];
  for (const def of defs) {
    let ki = kindIdx.get(def.kind);
    if (ki === undefined) {
      ki = kinds.length;
      kinds.push(def.kind);
      kindIdx.set(def.kind, ki);
    }
    let fi = fileIdx.get(def.file);
    if (fi === undefined) {
      fi = files.length;
      files.push(def.file);
      fileIdx.set(def.file, fi);
    }
    const tags: CachedTags = def.tags && def.tags.length > 0 ? def.tags.map((t) => [t.tag, t.text]) : 0;
    rows.push([
      def.name,
      ki,
      fi,
      def.line,
      def.value ?? 0,
      def.params ? def.params.join(" ") : 0,
      def.doc ?? 0,
      tags,
    ]);
  }
  const payload: IndexCacheFile = { cacheFormat: INDEX_CACHE_FORMAT, gameVersion, kinds, files, defs: rows };
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(payload));
}

export function loadIndexCache(cacheFile: string, expectedGameVersion: string): Definition[] | null {
  let payload: IndexCacheFile;
  try {
    payload = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    return null;
  }
  if (payload.cacheFormat !== INDEX_CACHE_FORMAT || payload.gameVersion !== expectedGameVersion) return null;
  if (!Array.isArray(payload.files) || !Array.isArray(payload.defs) || !Array.isArray(payload.kinds))
    return null;
  const defs: Definition[] = [];
  for (const [name, kindIdx, fileIdx, line, value, params, doc, tags] of payload.defs) {
    const kind = payload.kinds[kindIdx];
    const file = payload.files[fileIdx];
    if (!kind || !file) return null;
    const def: Definition = { name, kind, file, line, source: "vanilla" };
    if (typeof value === "string") def.value = value;
    if (typeof params === "string" && params !== "") def.params = params.split(" ");
    if (typeof doc === "string" && doc !== "") def.doc = doc;
    if (Array.isArray(tags) && tags.length > 0) def.tags = tags.map(([tag, text]) => ({ tag, text }));
    defs.push(def);
  }
  return defs;
}

/**
 * Game version used as the vanilla cache key: `rawVersion` from
 * launcher/launcher-settings.json, falling back to the game folder mtime.
 */
export function detectGameVersion(gamePath: string): string {
  try {
    const launcherSettings = path.join(path.dirname(gamePath), "launcher", "launcher-settings.json");
    const parsed = JSON.parse(fs.readFileSync(launcherSettings, "utf8"));
    if (typeof parsed.rawVersion === "string" && parsed.rawVersion !== "") return parsed.rawVersion;
    if (typeof parsed.version === "string" && parsed.version !== "") return parsed.version;
  } catch {
    // fall through
  }
  try {
    return `mtime-${fs.statSync(gamePath).mtimeMs}`;
  } catch {
    return "unknown";
  }
}
