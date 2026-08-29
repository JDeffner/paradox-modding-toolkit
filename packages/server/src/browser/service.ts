/**
 * The language service, without node.
 *
 * `server.ts` is a language server: a process, a JSON-RPC connection, a
 * workspace scan, a file watcher. None of that survives in a browser, but the
 * language knowledge underneath it does, because the features are plain
 * functions over (ServerData, TextDocument, position). This module assembles
 * exactly those pieces and hands back a small document-shaped API.
 *
 * What it deliberately is NOT: a workspace. There is no index of the game files
 * or of other mod files, so anything whose answer lives in a file you are not
 * editing is absent by construction rather than silently wrong. `capabilities`
 * says so field by field; hosts should surface it rather than imply full
 * fidelity.
 */
import type { CompletionItem, Diagnostic, Hover } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Definition } from "@px-lsp/protocol/types";
import { setActiveProfile, activeProfile } from "../games/active";
import { resolveProfile } from "../games/registry";
import { ServerData } from "../serverData";
import { loadSchema, type SchemaData } from "../schema/loader";
import { coerceFreqs, type FreqData } from "../schema/freqs";
import { classifyFile } from "../index/indexer";
import { extractDefinitions } from "../index/extract";
import { CompletionFeature } from "../features/completion";
import { provideHover } from "../features/hover";
import { computeScriptDiagnostics, type FileContext } from "../features/diagnostics";
import { computeScopeAt } from "../features/scopeAt";
import type { ScopeAtResult } from "@px-lsp/protocol/protocol";
import { getParse, evictParse } from "../parseCache";
import type { SchemaEntry } from "../schema/types";
import { assertVersion, toTokenData, type BakedDocs, type BakedTokens } from "./data";

/** What this build can and cannot answer. Honest by design: see the header. */
export interface BrowserCapabilities {
  /** Brace/encoding/folder-trap diagnostics over the open document. */
  diagnostics: true;
  /** Grammar- and scope-aware completion from the baked token tables. */
  completion: true;
  /** Scope inference at a position (the AD-5 annotate-never-hide ranking). */
  scopeInference: true;
  /** Hover prose. False until `attachDocs` supplies the prose payload. */
  hoverDocs: boolean;
  /**
   * Always false. Definitions from OTHER files (vanilla, other mod files) need
   * a workspace scan. Definitions in the open document itself DO resolve.
   */
  workspaceIndex: false;
  /** Always false: unknown-reference checks need the workspace index above. */
  referenceDiagnostics: false;
  /** Always false: .gui, DDS, datafunctions and the tiger runner are node-only. */
  guiAndAssets: false;
}

export interface BrowserServiceOptions {
  /** Game profile id; defaults to the profile the tokens were baked for. */
  gameId?: string;
  tokens: BakedTokens;
  /** Hover prose. Omit to start smaller and call `attachDocs` later. */
  docs?: BakedDocs;
  /** Parsed `freqs.json`, for completion ranking. Omit and ranking falls back. */
  freqs?: unknown;
  /**
   * The virtual mod root every document path is resolved against. It never
   * touches a disk; it exists so schema classification and the folder-trap
   * diagnostics see a mod-relative path. Defaults to "/mod".
   */
  modRoot?: string;
}

/** One open document. Holds its parse across edits, so keep it and `update`. */
export interface BrowserDocument {
  /** The mod-relative path this document was opened as. */
  readonly path: string;
  /**
   * Schema kind for the folder ("event", "scripted_effect", ...); null when the
   * folder is not one the schema knows, which is itself worth telling a user.
   */
  readonly kind: string | null;
  update(text: string): void;
  diagnostics(): Diagnostic[];
  completions(offset: number): CompletionItem[];
  hover(offset: number): Hover | null;
  scopeAt(offset: number): ScopeAtResult;
  dispose(): void;
}

export interface BrowserLanguageService {
  readonly capabilities: Readonly<BrowserCapabilities>;
  /** Supply the hover prose after startup; flips `capabilities.hoverDocs`. */
  attachDocs(docs: BakedDocs): void;
  openDocument(path: string, text: string): BrowserDocument;
}

/** The script language id; `paradox-gui` and `paradox-loc` are out of scope. */
const SCRIPT_LANGUAGE = "paradox";

/**
 * Distinguishes two open documents that share a path. The parse cache is keyed
 * by uri, so without this a second `openDocument("events/x.txt", …)` reads the
 * first one's parse and reports diagnostics for text that is no longer there.
 * The uri is a cache key and nothing else; schema classification uses `fsPath`.
 */
let documentSerial = 0;

export function createBrowserLanguageService(options: BrowserServiceOptions): BrowserLanguageService {
  assertVersion(options.tokens, "tokens");
  if (options.docs) assertVersion(options.docs, "docs");

  setActiveProfile(resolveProfile(options.gameId ?? options.tokens.gameId));
  const modRoot = options.modRoot ?? "/mod";

  const data = new ServerData();
  const schema: SchemaData = loadSchema(null);
  const getSchema = (): SchemaData => schema;

  let docs: BakedDocs | undefined = options.docs;
  const applyTokens = (): void => {
    data.setTokens(toTokenData(options.tokens, docs));
  };
  data.setModifierTemplates(options.tokens.templates);
  applyTokens();
  data.onActionScopes = new Map(Object.entries(options.tokens.onActionScopes));
  data.rootScopesForFile = (file) => rootScopesFor(entryFor(file));

  const freqs: FreqData = coerceFreqs(options.freqs);
  const completion = new CompletionFeature(data, getSchema, freqs);

  const capabilities: BrowserCapabilities = {
    diagnostics: true,
    completion: true,
    scopeInference: true,
    hoverDocs: docs !== undefined,
    workspaceIndex: false,
    referenceDiagnostics: false,
    guiAndAssets: false,
  };

  function absolute(relPath: string): string {
    const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    return modRoot + "/" + clean;
  }

  function entryFor(fsPath: string): SchemaEntry | null {
    return classifyFile(modRoot, fsPath, schema.entries);
  }

  function rootScopesFor(entry: SchemaEntry | null): Set<string> | null {
    if (!entry?.rootScopes || entry.rootScopes.length === 0) return null;
    return new Set(entry.rootScopes.map((s) => s.toLowerCase()));
  }

  function openDocument(relPath: string, text: string): BrowserDocument {
    const fsPath = absolute(relPath);
    // The parse cache is keyed by uri + version, so every edit must bump the
    // version or the second keystroke reads the first keystroke's parse.
    const uri = "inmemory://px/" + String(++documentSerial) + encodeURI(fsPath);
    const entry = entryFor(fsPath);
    const rootScopes = rootScopesFor(entry);
    let version = 0;
    let doc = TextDocument.create(uri, SCRIPT_LANGUAGE, version, text);

    const ctx: FileContext = { fsPath, modPath: modRoot, bomOnDisk: null };

    /**
     * Definitions declared in THIS document, the one part of the definition
     * index a browser can honestly fill. Rebuilt lazily after each edit: hover
     * only asks when the token tables had nothing for the word.
     */
    let localDefs: Map<string, Definition[]> | null = null;
    function documentDefinitions(word: string): Definition[] {
      if (!entry) return [];
      if (localDefs === null) {
        localDefs = new Map();
        // The BOM strip mirrors server.ts: a leading BOM would otherwise become
        // part of the first definition name.
        const defs = extractDefinitions(doc.getText().replace(/^﻿/, ""), entry, fsPath, "mod");
        for (const def of defs) {
          const list = localDefs.get(def.name);
          if (list) list.push(def);
          else localDefs.set(def.name, [def]);
        }
      }
      return localDefs.get(word) ?? [];
    }

    return {
      path: relPath,
      kind: entry?.kind ?? null,

      update(next: string): void {
        evictParse(uri);
        version += 1;
        doc = TextDocument.create(uri, SCRIPT_LANGUAGE, version, next);
        localDefs = null;
      },

      diagnostics(): Diagnostic[] {
        const { result, lineIndex } = getParse(doc);
        // Structural and folder-trap checks only. The index-backed
        // unknown-reference pass server.ts runs next needs a workspace scan,
        // and running it without one would report false unknowns.
        return computeScriptDiagnostics(result, lineIndex, ctx);
      },

      completions(offset: number): CompletionItem[] {
        return completion.provide(doc, offset, rootScopes, entry).items;
      },

      hover(offset: number): Hover | null {
        return provideHover(
          data,
          doc,
          doc.positionAt(offset),
          rootScopes,
          entry,
          getSchema,
          documentDefinitions
        );
      },

      scopeAt(offset: number): ScopeAtResult {
        return computeScopeAt(data, doc, doc.positionAt(offset), rootScopes, entry);
      },

      dispose(): void {
        evictParse(uri);
      },
    };
  }

  return {
    capabilities,
    attachDocs(next: BakedDocs): void {
      assertVersion(next, "docs");
      docs = next;
      applyTokens();
      capabilities.hoverDocs = true;
    },
    openDocument,
  };
}

/** The game profile the service is currently configured for. */
export function activeGameId(): string {
  return activeProfile().id;
}
