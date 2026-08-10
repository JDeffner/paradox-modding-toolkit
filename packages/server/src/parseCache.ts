/**
 * Per-document parse cache: one CST (or loc parse) per open document version,
 * so completion, symbols, folding, diagnostics and semantic tokens share a
 * single parse per edit instead of each re-scanning the text.
 *
 * Keyed by document version (equivalent to a content hash for open documents,
 * and cheaper). Entries are evicted when the document closes.
 */
import type { TextDocument } from "vscode-languageserver-textdocument";
import { LineIndex, parseLoc, parseScript, type LocParseResult, type ParseResult } from "./parser";
import { collectSavedScopeTypes, type InferenceContext } from "./scopes/inference";
import type { Scope, ScopeModel } from "./scopes/model";

export interface CachedParse {
  version: number;
  result: ParseResult;
  lineIndex: LineIndex;
  /** Lazily computed save_scope_as → scope types for this document version. */
  savedScopes?: Map<string, Set<Scope> | null>;
}

export interface CachedLocParse {
  version: number;
  result: LocParseResult;
  lineIndex: LineIndex;
}

const scriptCache = new Map<string, CachedParse>();
const locCache = new Map<string, CachedLocParse>();

export function getParse(document: TextDocument): CachedParse {
  const cached = scriptCache.get(document.uri);
  if (cached && cached.version === document.version) return cached;
  const text = document.getText();
  const entry: CachedParse = {
    version: document.version,
    result: parseScript(text),
    lineIndex: new LineIndex(text),
  };
  scriptCache.set(document.uri, entry);
  return entry;
}

export function getLocParse(document: TextDocument): CachedLocParse {
  const cached = locCache.get(document.uri);
  if (cached && cached.version === document.version) return cached;
  const text = document.getText();
  const entry: CachedLocParse = {
    version: document.version,
    result: parseLoc(text),
    lineIndex: new LineIndex(text),
  };
  locCache.set(document.uri, entry);
  return entry;
}

export function evictParse(uri: string): void {
  scriptCache.delete(uri);
  locCache.delete(uri);
}

/** Saved-scope types for a document. The save-site scan is cached per version;
 *  `ambient` (engine-provided scopes from the file's schema entry, §B3) seeds
 *  the collection so saves INSIDE `scope:ambient = { … }` blocks type correctly,
 *  and `ctx` carries the per-definition root/structure/variable context.
 *  The FIRST caller per document version bakes `ambient`/`ctx` into the cache,
 *  so every caller must pass the file's `entry?.ambientScopes` and
 *  `inferenceContextFor(data, entry)` (scopes/varTypes.ts) — never a subset. */
export function getSavedScopes(
  document: TextDocument,
  model: ScopeModel,
  rootScopes: Set<Scope> | null,
  ambient?: ReadonlyArray<{ name: string; type: string }>,
  ctx?: InferenceContext
): Map<string, Set<Scope> | null> {
  const entry = getParse(document);
  if (!entry.savedScopes) {
    entry.savedScopes = collectSavedScopeTypes(entry.result, model, rootScopes, ambient, ctx);
  }
  return entry.savedScopes;
}
