/**
 * On-demand reference search over roots that are NOT reference-indexed up
 * front: vanilla and read-only dependency parents (rework plan AD-4). Keeping
 * those out of the persistent ReferenceIndex is a memory guard (vanilla alone
 * holds hundreds of thousands of usage sites); find-references still has to
 * SHOW them (#3), so this scanner greps the roots for one name at a time.
 *
 * The scan is textual (exact-token match per line, comments stripped), not
 * schema-driven: script values, trigger/effect arguments and loc-key values
 * are all real usage sites even where the schema has no ref-field for the
 * enclosing key. Column-0 keys are skipped — those are the definition sites,
 * which the provider appends separately under includeDeclaration.
 *
 * Costs are bounded three ways: the per-root file list is enumerated once,
 * lines are tokenized only when a cheap substring test hits, and results are
 * memoized per name until the roots change. First lookup of a name pays one
 * pass of disk reads; repeats are O(1).
 *
 * No `vscode` imports here: unit-tested in plain Node.
 */
import * as fs from "fs";
import type { DefSource, Reference } from "@px-lsp/protocol/types";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { isStructuralKeyword } from "../contextKeywords";

export interface LazyRefRoot {
  root: string;
  source: DefSource;
}

/** Memoized names kept per roots generation (FIFO eviction). */
const CACHE_CAP = 64;
/** Files read per event-loop turn. */
const BATCH = 200;
/** Result cap per name: protects the peek widget and memory from a lookup on
 * a near-universal name; real identifiers stay far below it. */
const MAX_REFS = 5000;

const NAME_OK = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
/** Identifier characters: a hit is a token only when NOT flanked by these. */
const IDENT = /[A-Za-z0-9_.-]/;

const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));

export class LazyReferenceScanner {
  private roots: LazyRefRoot[] = [];
  private isEngineToken?: (name: string) => boolean;
  private fileLists = new Map<string, string[]>();
  private cache = new Map<string, Promise<Reference[]>>();

  /** Reconfigure (on reindex/settings change): drops all memoized results. */
  setRoots(roots: LazyRefRoot[], isEngineToken?: (name: string) => boolean): void {
    this.roots = roots;
    this.isEngineToken = isEngineToken;
    this.fileLists.clear();
    this.cache.clear();
  }

  /** All usage sites of `name` across the configured roots. Engine tokens and
   * structural grammar keywords are excluded: they appear in nearly every
   * file, and their documentation comes from script_docs, not the index.
   * (isStructuralKeyword, not classifyKeyword: the latter's naming-convention
   * buckets would swallow every *_trigger-named scripted trigger, #5.) */
  lookup(name: string): Promise<Reference[]> {
    if (
      this.roots.length === 0 ||
      name.length < 2 ||
      !NAME_OK.test(name) ||
      isStructuralKeyword(name) ||
      this.isEngineToken?.(name)
    ) {
      return Promise.resolve([]);
    }
    let pending = this.cache.get(name);
    if (!pending) {
      pending = this.scan(name);
      // FIFO eviction: Map iteration order is insertion order.
      if (this.cache.size >= CACHE_CAP) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(name, pending);
    }
    return pending;
  }

  private filesOf(root: string): string[] {
    let files = this.fileLists.get(root);
    if (!files) this.fileLists.set(root, (files = listFiles(root, ".txt")));
    return files;
  }

  private async scan(name: string): Promise<Reference[]> {
    const out: Reference[] = [];
    for (const { root } of this.roots) {
      const files = this.filesOf(root);
      for (let i = 0; i < files.length; i += BATCH) {
        for (const file of files.slice(i, i + BATCH)) {
          let content: string;
          try {
            content = fs.readFileSync(file, "utf8");
          } catch {
            continue;
          }
          if (!content.includes(name)) continue;
          scanContent(content, name, file, out);
          if (out.length >= MAX_REFS) return out.slice(0, MAX_REFS);
        }
        await yieldNow();
      }
    }
    return out;
  }
}

/** Exact-token occurrences of `name` in `content`, appended to `out`. */
export function scanContent(content: string, name: string, file: string, out: Reference[]): void {
  const lines = content.split("\n");
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    let line = lines[lineNo];
    if (!line.includes(name)) continue;
    // Strip comments; # inside a string is rare enough to accept the miss.
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash);
    let from = 0;
    for (;;) {
      const at = line.indexOf(name, from);
      if (at < 0) break;
      from = at + name.length;
      if (at > 0 && IDENT.test(line[at - 1])) continue;
      const after = line[at + name.length];
      if (after !== undefined && IDENT.test(after)) continue;
      // Column-0 keys are definition sites (top-level assignments), not uses.
      if (at === 0) continue;
      out.push({
        name,
        kinds: [],
        file,
        line: lineNo,
        startChar: at,
        endChar: at + name.length,
      });
    }
  }
}
