/**
 * Shared mutable state for the language server: parsed script_docs tokens and
 * the definition index, plus a plain change-listener list so features can
 * invalidate caches. The vscode EventEmitter of the old in-process design is
 * replaced by a minimal callback registry (no vscode imports server-side).
 */
import type { TokenData } from "@px-lsp/protocol/types";
import { compileModifierTemplates, type ModifierTemplate } from "./data/modifierTemplates";
import { emptyDataTypes, type DataTypesData } from "./data/dataTypes";
import { emptyUsage, type DataFnUsage } from "./data/dataFnUsage";
import { DefinesIndex } from "./data/defines";
import { TextFormattingIndex } from "./data/textFormatting";
import { DefinitionIndex } from "./index/indexer";
import { ReferenceIndex } from "./index/references";
import { ScopeModel } from "./scopes/model";

export class ServerData {
  tokens: TokenData[] = [];
  /** name -> all tokens with that name (a name can be both trigger and effect). */
  tokenMap = new Map<string, TokenData[]>();
  /** Templated modifier tags ($CULTURE$_opinion), compiled for lazy expansion. */
  modifierTemplates: ModifierTemplate[] = [];
  /** [ ... ] datafunction tables (bundled wiki baseline / user's DumpDataTypes output). */
  dataTypes: DataTypesData = emptyDataTypes();
  /** Vanilla [ ... ] usage harvest: counts, literals, examples (dataFnUsage.ts). */
  dataFnUsage: DataFnUsage = emptyUsage();
  /** `define:NS|CONST` constants harvested from engine/game/mod defines. */
  defines = new DefinesIndex();
  /** `#tag` loc text-formatting definitions harvested from gui textformatting blocks. */
  textFormatting = new TextFormattingIndex();
  index = new DefinitionIndex();
  /** Usage sites, mod files only (vanilla references are computed on demand). */
  refIndex = new ReferenceIndex();
  /** Event namespaces declared by mod files (for conservative unknown-event checks). */
  modNamespaces = new Set<string>();
  /** Definition kinds that appear in completion lists (from the schema). */
  completableKinds = new Set<string>();
  /** Scope link table derived from the token data (AD-5); rebuilt with tokens. */
  scopeModel = new ScopeModel([]);
  /** on_action name → expected root scope, parsed from the user's on_actions.log. */
  onActionScopes = new Map<string, string>();
  /** Schema root scopes for an absolute file path (set by the host; used for
   *  static variable-type resolution — see scopes/varTypes.ts). */
  rootScopesForFile: (file: string) => Set<string> | null = () => null;
  /** Origin label for a definition: the owning mod's descriptor name instead of
   *  the generic "mod"/"parent" (set by the host from the configured roots —
   *  see index/modOrigin.ts). Default: the raw source tag. */
  originLabel: (def: { file: string; source: string }) => string = (def) => def.source;
  /** The mod root a file lives under (set by the host; used to scope the
   *  overview views to one workspace mod). Default: unknown. */
  modRootOf: (file: string) => string | null = () => null;

  private listeners: Array<() => void> = [];

  onDidChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  setTokens(tokens: TokenData[]): void {
    this.tokens = tokens;
    this.tokenMap.clear();
    for (const t of tokens) {
      const list = this.tokenMap.get(t.name);
      if (list) list.push(t);
      else this.tokenMap.set(t.name, [t]);
    }
    this.scopeModel = new ScopeModel(tokens);
    this.applyScriptedLists();
    this.fire();
  }

  setModifierTemplates(raw: TokenData[]): void {
    this.modifierTemplates = compileModifierTemplates(raw);
    this.fire();
  }

  notifyIndexChanged(): void {
    this.applyScriptedLists();
    this.fire();
  }

  /** Feed scripted-list definitions (name + base) into the scope model so their
   *  generated every_/any_/random_/ordered_ iterators resolve target scopes. */
  private applyScriptedLists(): void {
    const lists: Array<{ name: string; base?: string }> = [];
    // index.scriptedLists() is the incremental form of
    // entries(d => d.kind === "scripted_list") — same result, without the
    // full-name walk this used to pay on every index change (§B2).
    for (const d of this.index.scriptedLists()) {
      lists.push({ name: d.name, base: d.value });
    }
    this.scopeModel.setScriptedLists(lists);
  }

  private fire(): void {
    for (const l of this.listeners) l();
  }
}
