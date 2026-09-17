import * as fs from "fs";
import * as path from "path";
import { iterFiles } from "@px-lsp/protocol/fsWalk";
import { detectLocFileLanguage } from "@px-lsp/protocol/translationCore";
import type { LocCoverage } from "@px-lsp/protocol/protocol";
import { parseLoc } from "../parser";
import type { SchemaEntry } from "../schema/types";
import type { ServerData } from "../serverData";
import { computeLocCoverage, type LocEntrySite, type LocLanguages } from "./locCoverage";

interface LocFile {
  language: string;
  entries: LocEntrySite[];
}

interface CoverageState {
  root: string;
  schema: SchemaEntry[];
  version: number;
  dirty: Set<string>;
  files: Map<string, LocFile>;
  languages?: LocLanguages;
  pending?: Promise<void>;
  result?: {
    index: ServerData["index"];
    refs: ServerData["refIndex"];
    indexRevision: number;
    refRevision: number;
    version: number;
    language: string;
    value: LocCoverage[];
  };
}

const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const fileKey = (file: string): string => {
  const absolute = path.resolve(file);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
};

/** Coverage needs every language, while completion indexes the configured one.
 * Load translations lazily and retain at most two completed mods, so changing
 * focus cannot retain every translation in a large playset. */
export class LocalizationCoverage {
  private states = new Map<string, CoverageState>();

  constructor(
    private readonly data: ServerData,
    private readonly readText: (file: string) => Promise<string> = (file) =>
      fs.promises.readFile(file, "utf8")
  ) {}

  clear(): void {
    for (const state of this.states.values()) state.version++;
    this.states.clear();
  }

  /** Includes languages omitted from the completion index. */
  invalidate(file: string): boolean {
    if (!file.toLowerCase().endsWith(".yml")) return false;
    let changed = false;
    for (const state of this.states.values()) {
      const relative = path.relative(state.root, file);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      state.dirty.add(fileKey(file));
      state.version++;
      changed = true;
    }
    return changed;
  }

  async get(
    root: string | null,
    language: string,
    schema: SchemaEntry[],
    inFocus: (file: string) => boolean = () => true
  ): Promise<LocCoverage[]> {
    if (!root) return [];
    const key = fileKey(root);
    let state = this.states.get(key);
    if (!state || state.schema !== schema) {
      state = { root, schema, version: 0, dirty: new Set(), files: new Map() };
    }
    this.states.delete(key);
    this.states.set(key, state);
    const current = state;
    try {
      for (;;) {
        const { index, refIndex: refs } = this.data;
        const cached = current.result;
        if (
          cached &&
          cached.index === index &&
          cached.refs === refs &&
          cached.indexRevision === index.revision &&
          cached.refRevision === refs.revision &&
          cached.version === current.version &&
          cached.language === language
        )
          return cached.value;
        if (current.pending) {
          await current.pending;
          continue;
        }
        const version = current.version;
        const indexRevision = index.revision;
        const refRevision = refs.revision;
        current.pending = (async () => {
          const languages = await this.load(current);
          if (
            version !== current.version ||
            index !== this.data.index ||
            refs !== this.data.refIndex ||
            indexRevision !== index.revision ||
            refRevision !== refs.revision
          )
            return;
          const value = await computeLocCoverage(this.data, languages, language, schema, inFocus);
          // An edit or rebuild can arrive while I/O or a yield is pending.
          if (
            version === current.version &&
            index === this.data.index &&
            refs === this.data.refIndex &&
            indexRevision === index.revision &&
            refRevision === refs.revision
          ) {
            current.result = { index, refs, indexRevision, refRevision, version, language, value };
          }
        })();
        try {
          await current.pending;
        } finally {
          current.pending = undefined;
        }
      }
    } finally {
      for (const [oldKey, old] of this.states) {
        if (this.states.size <= 2) break;
        if (!old.pending && old !== current) this.states.delete(oldKey);
      }
    }
  }

  private async load(state: CoverageState): Promise<LocLanguages> {
    if (state.languages && state.dirty.size === 0) return state.languages;
    // Edits arriving during this read belong to the next pass. Retain files
    // already loaded so one edited translation cannot force a full reread.
    const dirty = state.dirty;
    state.dirty = new Set();
    const files = new Map<string, LocFile>();
    const paths: string[] = [];
    const roots = [...new Set(state.schema.filter((e) => e.kind === "loc_key").map((e) => e.path))];
    // Relist only after localization changes, preserving the original walk's
    // duplicate-key order and detecting create/delete/rename without polling.
    for (const root of roots.length > 0 ? roots : ["localization"]) {
      for (const file of iterFiles(path.join(state.root, root), ".yml")) {
        if (file !== null) paths.push(file);
        if (file === null || paths.length % 128 === 0) await yieldNow();
      }
    }
    const languages: LocLanguages = new Map();
    let visited = 0;
    for (let i = 0; i < paths.length; i += 8) {
      const batch = await Promise.all(
        paths.slice(i, i + 8).map(async (file) => {
          const key = fileKey(file);
          const cached = state.files.get(key);
          if (cached && !dirty.has(key)) return { key, parsed: cached };
          const language = detectLocFileLanguage(file);
          if (!language) return null;
          try {
            const text = await this.readText(file);
            const entries = parseLoc(text).entries.map((e) => ({
              key: e.key,
              value: e.value,
              file,
              line: e.line,
            }));
            return { key, parsed: { language, entries } };
          } catch {
            return null;
          }
        })
      );
      for (const item of batch) {
        if (!item) continue;
        files.set(item.key, item.parsed);
        let entries = languages.get(item.parsed.language);
        if (!entries) languages.set(item.parsed.language, (entries = new Map()));
        for (const entry of item.parsed.entries) {
          entries.set(entry.key, entry);
          if (++visited % 1024 === 0) await yieldNow();
        }
      }
      await yieldNow();
    }
    state.files = files;
    state.languages = languages;
    return languages;
  }
}
