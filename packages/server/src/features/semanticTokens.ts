/**
 * Semantic highlighting: colors identifiers by what they actually are, using the
 * script_docs/wiki token data and the definition index. Standard token types
 * only, so every theme colors them without configuration.
 *
 * Based on the CST (comments and quoted strings are simply never visited),
 * replacing the v0.3 per-line mask-and-regex scan.
 */
import { SemanticTokensBuilder } from "vscode-languageserver/node";
import type { SemanticTokens, SemanticTokensLegend } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TokenKind } from "@px-lsp/protocol/types";
import type { SchemaEntry, RefField } from "../schema/types";
import { dynamicRefKinds } from "../games/jomini/variables";
import type { StructureIndex } from "../schema/loader";
import type { ServerData } from "../serverData";
import { walkStatements, type AssignmentNode, type BlockNode, type ScalarNode } from "../parser";
import { getParse } from "../parseCache";

const TOKEN_TYPES = [
  "method", // engine effects
  "function", // engine triggers
  "variable", // event targets
  "property", // modifiers
  "macro", // scripted effects/triggers (reusable script)
  "event", // event IDs and on_actions
  "enumMember", // script values
  "string", // loc keys referenced from script
] as const;

const TOKEN_MODIFIERS = ["defaultLibrary"] as const; // vanilla/engine vs mod

export const SEMANTIC_LEGEND: SemanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

const TYPE_INDEX: Record<string, number> = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));
const VANILLA_BIT = 1 << 0;

const ENGINE_TYPE: Record<TokenKind, string> = {
  effect: "method",
  trigger: "function",
  event_target: "variable",
  modifier: "property",
};

// Schema-driven kinds are an open set; unlisted ones read as enumMember.
const DEF_TYPE: Record<string, string> = {
  scripted_effect: "macro",
  scripted_trigger: "macro",
  event: "event",
  on_action: "event",
  script_value: "enumMember",
  scripted_modifier: "property",
  loc_key: "string",
  saved_scope: "variable",
  variable: "variable",
  local_variable: "variable",
  global_variable: "variable",
  variable_list: "variable",
  local_variable_list: "variable",
  global_variable_list: "variable",
  flag: "variable",
  list: "variable",
};
const DEF_TYPE_FALLBACK = "enumMember";

const IDENTIFIER_START = /^[A-Za-z_]/;

export function provideSemanticTokens(
  data: ServerData,
  document: TextDocument,
  refFields?: Map<string, RefField>,
  entry?: SchemaEntry | null,
  structures?: StructureIndex
): SemanticTokens {
  const { result, lineIndex } = getParse(document);
  const builder = new SemanticTokensBuilder();
  const byBlock = entry?.kind && structures ? structures.keysByKindBlock.get(entry.kind) : undefined;

  const pushScalar = (scalar: ScalarNode, expectedKinds?: string[]) => {
    if (scalar.quoted) return;
    let word = scalar.text;
    if (!IDENTIFIER_START.test(word)) return;
    // For prefixed references (scope:x, culture:czech) classify the prefix only —
    // the grammar colors the whole reference, we refine the head word.
    const colon = word.indexOf(":");
    if (colon >= 0) word = word.slice(0, colon);
    if (word === "") return;
    const classified = classify(data, word, colon >= 0 ? undefined : expectedKinds);
    if (!classified) return;
    const pos = lineIndex.positionAt(scalar.range.start);
    builder.push(pos.line, pos.character, word.length, classified.type, classified.modifiers);
  };

  /** Kinds a ref field expects for values under `key` (scalar or list form). */
  const fieldKinds = (key: ScalarNode, form: "scalar" | "list"): string[] | undefined => {
    if (key.quoted) return undefined;
    const field = refFields?.get(key.text);
    if (!field) {
      // Pattern families (has_*_flag, is_in_list) — scalar form only.
      return refFields && form === "scalar" ? (dynamicRefKinds(key.text) ?? undefined) : undefined;
    }
    return field.form !== (form === "scalar" ? "list" : "scalar") ? field.kinds : undefined;
  };

  /** `type = character_event`: the value is a member of the key's structure enum. */
  const isEnumMember = (
    key: ScalarNode,
    value: ScalarNode,
    ancestors: readonly (AssignmentNode | BlockNode)[]
  ): boolean => {
    if (!byBlock || key.quoted || value.quoted) return false;
    const named = ancestors.filter((a): a is AssignmentNode => a.kind === "assignment" && !a.key.quoted);
    if (named.length === 0) return false;
    const keys =
      named.length === 1 ? byBlock.get("") : byBlock.get(named[named.length - 1].key.text.toLowerCase());
    const spec = keys?.get(key.text);
    if (!spec?.values?.startsWith("enum:")) return false;
    return spec.values.slice(5).split("|").includes(value.text);
  };

  const pushAs = (scalar: ScalarNode, type: string, modifiers: number) => {
    const pos = lineIndex.positionAt(scalar.range.start);
    builder.push(pos.line, pos.character, scalar.text.length, TYPE_INDEX[type], modifiers);
  };

  walkStatements(result.root, (stmt, ancestors) => {
    if (stmt.kind === "assignment") {
      pushScalar(stmt.key);
      if (stmt.value?.kind === "scalar") {
        const key = stmt.key;
        const value = stmt.value;
        if (!key.quoted && key.text === "namespace" && !value.quoted && IDENTIFIER_START.test(value.text)) {
          // Event namespaces read as the event family.
          pushAs(value, "event", 0);
        } else if (isEnumMember(key, value, ancestors)) {
          pushAs(value, "enumMember", VANILLA_BIT);
        } else {
          pushScalar(value, fieldKinds(key, "scalar"));
        }
      }
      if (stmt.value?.kind === "tagged-block") pushScalar(stmt.value.tag);
    } else if (stmt.value.kind === "scalar") {
      // Bare list element: the owning assignment is two frames up (assignment, block).
      const parent = ancestors.length >= 2 ? ancestors[ancestors.length - 2] : undefined;
      const kinds = parent?.kind === "assignment" ? fieldKinds(parent.key, "list") : undefined;
      pushScalar(stmt.value, kinds);
    } else if (stmt.value.kind === "tagged-block") {
      pushScalar(stmt.value.tag);
    }
  });

  return builder.build();
}

function classify(
  data: ServerData,
  word: string,
  expectedKinds?: string[]
): { type: number; modifiers: number } | null {
  // A ref-field value names a definition of a known kind — that reading wins
  // over a same-named engine token (`theme = faith` is an event theme, not the
  // faith event target).
  if (expectedKinds) {
    const match = data.index.lookup(word).find((d) => expectedKinds.includes(d.kind));
    if (match) {
      return {
        type: TYPE_INDEX[DEF_TYPE[match.kind] ?? DEF_TYPE_FALLBACK],
        modifiers: match.source === "mod" ? 0 : VANILLA_BIT,
      };
    }
  }
  const tokens = data.tokenMap.get(word);
  if (tokens && tokens.length > 0) {
    return { type: TYPE_INDEX[ENGINE_TYPE[tokens[0].kind]], modifiers: VANILLA_BIT };
  }
  const defs = data.index.lookup(word);
  if (defs.length > 0) {
    const def = defs[0];
    return {
      type: TYPE_INDEX[DEF_TYPE[def.kind] ?? DEF_TYPE_FALLBACK],
      modifiers: def.source === "mod" ? 0 : VANILLA_BIT,
    };
  }
  return null;
}
