/** Shared data model. Keep this module free of `vscode` imports: it is used by unit-tested code. */

export interface IndexStats {
  total: number;
  files: number;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
}

export type TokenKind = "trigger" | "effect" | "event_target" | "modifier";

/** One engine token parsed from a script_docs log file. */
export interface TokenData {
  name: string;
  kind: TokenKind;
  /** Description text from the log; may be empty. */
  doc: string;
  /** Supported scopes as raw strings, display-only in v1. */
  scopes: string[];
  /** Extra metadata lines (targets, traits, categories...), display-only. */
  traits?: string;
  /** A syntax/usage example block (`add_hook = { type = X ... }`), preserved
   *  verbatim from a `usage:` section, an inline `name = …` line, or the wiki. */
  usage?: string;
}

/**
 * Definition kinds are open strings driven by the schema table
 * (packages/server/src/schema): "scripted_effect", "trait", "decision", ...
 */
export type DefKind = string;

/** Where a definition comes from; mod shadows parent shadows vanilla. */
export type DefSource = "vanilla" | "parent" | "mod";

/** One user-defined or vanilla definition found by the indexer. */
export interface Definition {
  name: string;
  kind: DefKind;
  /** Absolute path. */
  file: string;
  /** 0-based line number (VS Code convention). */
  line: number;
  source: DefSource;
  /** For loc_key: the localized text (truncated for memory; the edit flow re-reads the yml). */
  value?: string;
  /** Enclosing definition, when meaningful (e.g. the event a save_scope_as sits in). */
  container?: string;
  /** For scripted effects/triggers: $PARAM$ names in declaration order (signature help). */
  params?: string[];
  /** PdxDoc prose from a leading `#` comment block (§E); capped for memory. */
  doc?: string;
  /** PdxDoc structured tags (@scope, @param, @saves, @returns, @example, @deprecated, …). */
  tags?: DocTag[];
  /**
   * Database entry mode stripped from the declaration key (`REPLACE:name`),
   * for games whose profile declares entryModes. The definition is indexed
   * under the bare name; the mode is kept for override analysis.
   */
  entryMode?: string;
}

/** One structured PdxDoc tag line (§E1). Unknown tags render as prose, not stored here. */
export interface DocTag {
  /** Tag name without the leading `@` (lowercased). */
  tag: string;
  /** Text after the tag word. */
  text: string;
}

/** One usage site of a name, extracted schema-driven from mod files. */
export interface Reference {
  name: string;
  /** Candidate definition kinds this usage may refer to. */
  kinds: DefKind[];
  /** Absolute path. */
  file: string;
  /** 0-based line. */
  line: number;
  /** Character range of the name on the line (prefix like `scope:` excluded). */
  startChar: number;
  endChar: number;
  /** Key-position call site (`my_effect = yes`): shown by find-references and
   * rename, excluded from the usage-count completion ranking signal (§C2). */
  call?: boolean;
  /** Call sites only: enclosing key chain below the top-level definition
   * (dotted, outermost first) — input for call-site scope aggregation, which
   * types un-@scope'd scripted effects/triggers from where they are called. */
  chain?: string;
}
