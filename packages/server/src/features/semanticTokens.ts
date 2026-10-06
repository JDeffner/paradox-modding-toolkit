/** CST-based highlighting. Grammar selects identities before engine names or indexed definitions. */
import type { SemanticTokens } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TokenKind } from "@px-lsp/protocol/types";
import { isLocProperty } from "@px-lsp/protocol/locProperties";
import type { SchemaEntry, RefField, KeySpec } from "../schema/types";
import {
  dynamicRefKinds,
  VAR_PREFIX_KINDS,
  VARIABLE_SET_KINDS,
  VARIABLE_LIST_SET_KINDS,
} from "../games/jomini/variables";
import { activeProfile } from "../games/active";
import type { StructureIndex, SchemaData } from "../schema/loader";
import type { ServerData } from "../serverData";
import {
  walkStatements,
  type AssignmentNode,
  type BlockNode,
  type ScalarNode,
  type Statement,
} from "../parser";
import { getParse } from "../parseCache";
import { contextFromStatements, inlineKind, type BlockContext } from "../context";
import { classifyKeyword } from "../contextKeywords";
import { scopeWordDoc } from "../data/keywordDocs";
import {
  EVENT_ID,
  nestedDefinitionKind,
  normalizeDeclarationName,
  topLevelDefinitionKind,
} from "../index/extract";
import { implicitKindsForField } from "../index/references";
import { datafunctionExpressionRanges, provideDatafunctionSemanticSpans } from "./datafunctionSemanticTokens";
import {
  definitionTokenType,
  encodeSemanticSpans,
  type SemanticSpan,
  type TokenType,
  type TokenModifier,
} from "./semanticTokenTypes";

export { SEMANTIC_LEGEND } from "./semanticTokenTypes";

const ENGINE_TYPE: Record<TokenKind, TokenType> = {
  effect: "method",
  trigger: "function",
  event_target: "property",
  modifier: "property",
};

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const IDENTIFIER_START = /^[A-Za-z_]/;

interface Classification {
  type: TokenType;
  modifiers: TokenModifier[];
}

function kindModifiers(kind: string): TokenModifier[] {
  if (kind === "scripted_effect" || kind === "effect") return ["pxEffect"];
  if (kind === "scripted_trigger" || kind === "trigger") return ["pxTrigger"];
  if (kind === "saved_scope" || kind === "event_target") return ["pxScope"];
  return [];
}

export function provideSemanticTokens(
  data: ServerData,
  document: TextDocument,
  refFields?: Map<string, RefField>,
  entry?: SchemaEntry | null,
  structures?: StructureIndex,
  schema?: SchemaData
): SemanticTokens {
  const script =
    document.languageId === "paradox-loc"
      ? []
      : provideScriptSemanticSpans(data, document, refFields, entry, structures, schema);
  return encodeSemanticSpans(document, [...script, ...provideDatafunctionSemanticSpans(data, document)]);
}

/** Separate collection lets the host merge bracket-expression spans before encoding once. */
export function provideScriptSemanticSpans(
  data: ServerData,
  document: TextDocument,
  refFields?: Map<string, RefField>,
  entry?: SchemaEntry | null,
  structures?: StructureIndex,
  schema?: SchemaData
): SemanticSpan[] {
  const { result } = getParse(document);
  const spans: SemanticSpan[] = [];
  const profile = activeProfile();
  const fields = schema?.refFields ?? refFields;
  const prefixes = schema?.prefixRefs ?? profile.prefixRefs;
  const byBlock = entry?.kind
    ? (schema?.structures ?? structures)?.keysByKindBlock.get(entry.kind)
    : undefined;
  const gui = entry?.extraction === "gui-type";
  const guiDeclarations = new Map<ScalarNode, TokenType>();
  const guiNames = new Set<string>();
  const guiTypeNames = new Set<string>();
  if (gui) {
    // Same adjacent-marker representation and types wrappers as extractDefinitionsParsed.
    const scan = (statements: readonly Statement[]) => {
      for (let i = 0; i < statements.length - 1; i++) {
        const marker = statements[i];
        if (marker.kind !== "value" || marker.value.kind !== "scalar" || marker.value.quoted) continue;
        const keyword = marker.value.text.toLowerCase();
        if (!["type", "template", "local_template", "types"].includes(keyword)) continue;
        const next = statements[i + 1];
        if (next.kind !== "assignment" || next.key.quoted || !NAME.test(next.key.text)) continue;
        guiDeclarations.set(marker.value, "keyword");
        guiDeclarations.set(next.key, keyword === "types" ? "namespace" : "type");
        if (keyword !== "types") guiNames.add(next.key.text);
        if (keyword === "type") guiTypeNames.add(next.key.text.toLowerCase());
        if (keyword === "types" && next.value?.kind === "block") scan(next.value.statements);
      }
    };
    scan(result.root.statements);
  }

  const push = (offset: number, length: number, classified: Classification) => {
    spans.push({ offset, length, ...classified });
  };
  const pushAs = (scalar: ScalarNode, type: TokenType, modifiers: TokenModifier[] = []) => {
    push(scalar.range.start + (scalar.quoted ? 1 : 0), scalar.text.length, { type, modifiers });
  };

  const pushPreprocessor = (scalar: ScalarNode, declaration = false): boolean => {
    if (scalar.quoted) return false;
    // Names match atConstants and extractDefinitionsParsed's parameter harvest.
    if (/^@[A-Za-z0-9_]+$/.test(scalar.text)) {
      pushAs(scalar, "variable", declaration ? ["readonly", "declaration"] : ["readonly"]);
      return true;
    }
    const parameters = /\$([A-Za-z0-9_]+)(?:\|[^$\n]*)?\$/g;
    let found = false;
    for (const match of scalar.text.matchAll(parameters)) {
      push(scalar.range.start + match.index + 1, match[1].length, { type: "parameter", modifiers: [] });
      found = true;
    }
    return found;
  };

  const definition = (word: string, kinds?: readonly string[], required = false): Classification | null => {
    const def = data.index.lookup(word).find((d) => !kinds || kinds.includes(d.kind));
    if (def)
      return {
        type: definitionTokenType(def.kind),
        modifiers: [...kindModifiers(def.kind), ...(def.source === "mod" ? [] : ["defaultLibrary" as const])],
      };
    // Explicit reference grammar keeps its role even before indexing finishes.
    return required && kinds?.length
      ? { type: definitionTokenType(kinds[0]), modifiers: kindModifiers(kinds[0]) }
      : null;
  };

  const classify = (
    word: string,
    kinds?: readonly string[],
    context?: BlockContext
  ): Classification | null => {
    if (context === undefined) {
      const value = definition(word, kinds) ?? definition(word);
      if (value) return value;
    }
    if (kinds) {
      const known = definition(word, kinds);
      if (known) return known;
    }
    const tokens = data.tokenMap.get(word);
    const token =
      context === undefined
        ? tokens?.find((t) => t.kind === "event_target" || t.kind === "modifier")
        : (tokens?.find((t) => t.kind === context) ?? tokens?.[0]);
    if (token)
      return { type: ENGINE_TYPE[token.kind], modifiers: ["defaultLibrary", ...kindModifiers(token.kind)] };
    return definition(word, kinds);
  };

  const navigation = (word: string): Classification | null =>
    scopeWordDoc(word) || data.scopeModel.links.has(word.toLowerCase())
      ? { type: "property", modifiers: ["defaultLibrary", "pxScope"] }
      : null;

  const pushScalar = (scalar: ScalarNode, kinds?: string[], required = false, context?: BlockContext) => {
    if (pushPreprocessor(scalar)) return;
    if (scalar.quoted && (!required || !NAME.test(scalar.text))) return;
    const word = scalar.text;
    if (!IDENTIFIER_START.test(word) || !/^[A-Za-z0-9_.:-]+$/.test(word)) return;
    const offset = scalar.range.start + (scalar.quoted ? 1 : 0);
    const prefixed = word.includes(":");
    const parts = word.split(".");
    const indexed = definition(word, kinds);
    const navigationSyntax =
      !scalar.quoted &&
      !indexed &&
      (context === undefined || parts.length > 1) &&
      parts.some((part) => navigation(part));
    const classified =
      prefixed || navigationSyntax
        ? null
        : required
          ? (indexed ?? definition(word, kinds, true))
          : scopeWordDoc(word)
            ? navigation(word)
            : classify(word, kinds, context);
    // An indexed dotted name (notably an event ID) is one identity, not navigation.
    if (classified && (required || !word.includes(".") || data.index.lookup(word).length)) {
      push(offset, word.length, classified);
      return;
    }
    if (prefixed || parts.length > 1 || navigation(word)) {
      let partOffset = offset;
      for (const part of parts) {
        const colon = part.indexOf(":");
        const prefix = colon > 0 ? part.slice(0, colon) : null;
        const prefixKinds =
          prefix === "scope"
            ? ["saved_scope"]
            : prefix
              ? (VAR_PREFIX_KINDS[prefix] ?? prefixes[prefix])
              : undefined;
        if (prefix && prefixKinds) {
          push(partOffset, prefix.length + 1, { type: "keyword", modifiers: [] });
          const name = part.slice(colon + 1);
          if (name) push(partOffset + colon + 1, name.length, definition(name, prefixKinds, true)!);
        } else {
          // A documented parameterized scope link can lack a database namespace.
          const link = navigation(prefix ?? part);
          if (link) push(partOffset, (prefix ?? part).length, link);
        }
        partOffset += part.length + 1;
      }
    }
  };

  const keySpec = (
    key: ScalarNode,
    ancestors: readonly (AssignmentNode | BlockNode)[]
  ): KeySpec | undefined => {
    if (!byBlock || key.quoted) return undefined;
    const named = ancestors.filter((a): a is AssignmentNode => a.kind === "assignment" && !a.key.quoted);
    if (!named.length) return undefined;
    const keys = named.length === 1 ? byBlock.get("") : byBlock.get(named.at(-1)!.key.text.toLowerCase());
    return keys?.get(key.text);
  };

  const fieldKinds = (
    key: ScalarNode,
    form: "scalar" | "list",
    parent?: AssignmentNode,
    spec?: KeySpec
  ): string[] | undefined => {
    if (key.quoted) return undefined;
    if (form === "scalar") {
      const weighted = parent && !parent.key.quoted && fields?.get(parent.key.text);
      if (weighted && weighted.weighted && weighted.form !== "scalar" && /^\d+$/.test(key.text)) {
        return weighted.kinds;
      }
      const implicit = implicitKindsForField(key.text, parent?.key.text);
      if (implicit) return implicit;
    }
    if (spec?.refKinds) return spec.refKinds;
    const field = fields?.get(key.text);
    if (field) return field.form !== (form === "scalar" ? "list" : "scalar") ? field.kinds : undefined;
    if (form !== "scalar") return undefined;
    return (
      (parent && profile.blockRefFields[parent.key.text.toLowerCase()]?.[key.text]) ??
      dynamicRefKinds(key.text) ??
      (isLocProperty(key.text) || spec?.values === "loc" ? ["loc_key"] : undefined)
    );
  };

  walkStatements(result.root, (stmt, ancestors) => {
    if (stmt.kind === "assignment") {
      const named = ancestors.filter((a): a is AssignmentNode => a.kind === "assignment");
      const parent = named.at(-1);
      const spec = keySpec(stmt.key, ancestors);
      const context = contextFromStatements(result.root, ancestors, entry?.kind).context;
      if (pushPreprocessor(stmt.key, true)) {
        // Preprocessor declarations are file-local, not schema database names.
      } else if (gui) {
        const declared = guiDeclarations.get(stmt.key);
        if (declared) pushAs(stmt.key, declared, ["declaration"]);
        else if (!stmt.key.quoted) {
          const use = definition(stmt.key.text, [entry!.kind]);
          pushAs(
            stmt.key,
            guiNames.has(stmt.key.text) || guiTypeNames.has(stmt.key.text.toLowerCase())
              ? "type"
              : (use?.type ?? "property"),
            use?.modifiers
          );
        }
      } else if (entry?.extraction === "named-block") {
        if (!stmt.key.quoted) pushAs(stmt.key, "property");
      } else {
        const extraction = entry?.extraction ?? "top-level-key";
        const declaration =
          !stmt.key.quoted && !ancestors.length && extraction === "top-level-key"
            ? normalizeDeclarationName(stmt.key.text)
            : null;
        const declared =
          (!stmt.key.quoted && NAME.test(stmt.key.text) ? inlineKind(result.root, stmt) : undefined) ??
          (entry && nestedDefinitionKind(entry, [...named, stmt])) ??
          (entry &&
          !stmt.key.quoted &&
          (NAME.test(stmt.key.text) || declaration) &&
          (stmt.op === "=" || stmt.op === "?=") &&
          ((extraction === "top-level-key" && !ancestors.length && stmt.key.text !== "namespace") ||
            (extraction === "event-id" && !ancestors.length && EVENT_ID.test(stmt.key.text)) ||
            (extraction === "nested-title" &&
              stmt.value?.kind === "block" &&
              /^[ekdcb]_/.test(stmt.key.text)))
            ? topLevelDefinitionKind(entry, stmt)
            : undefined);
        if (declared) {
          if (declaration?.entryMode) {
            push(stmt.key.range.start, declaration.offset - 1, {
              type: "keyword",
              modifiers: ["defaultLibrary"],
            });
            push(stmt.key.range.start + declaration.offset, declaration.name.length, {
              type: definitionTokenType(declared),
              modifiers: ["declaration", ...kindModifiers(declared)],
            });
          } else pushAs(stmt.key, definitionTokenType(declared), ["declaration", ...kindModifiers(declared)]);
        } else
          pushScalar(
            stmt.key,
            context === "trigger"
              ? ["scripted_trigger"]
              : context === "effect"
                ? ["scripted_effect"]
                : undefined,
            false,
            context
          );
      }
      if (stmt.value?.kind === "scalar") {
        const value = stmt.value;
        if (gui) {
          if (pushPreprocessor(value)) return;
          // guiLanguage completion uses these fields for template/type names.
          if (!stmt.key.quoted && ["using", "template"].includes(stmt.key.text.toLowerCase()))
            pushScalar(value, [entry!.kind], true);
          return;
        }
        if (entry?.extraction === "named-block") {
          if (stmt.key.text === "name" && named.length === 1 && NAME.test(value.text))
            pushAs(value, "type", ["declaration"]);
          else {
            const context = named.map((a) => a.key.text).join("/");
            const rule =
              entry.assetFields?.[`${context}/${stmt.key.text}`] ?? entry.assetFields?.[`${context}/*`];
            if (rule?.target && !rule.target.owner) pushScalar(value, [rule.target.kind ?? entry.kind], true);
          }
          return;
        }
        const kinds = fieldKinds(stmt.key, "scalar", parent, spec);
        const implicit = !stmt.key.quoted && implicitKindsForField(stmt.key.text, parent?.key.text);
        const owner = stmt.key.text === "name" ? parent?.key.text : stmt.key.text;
        const variableSet = owner && (VARIABLE_SET_KINDS[owner] ?? VARIABLE_LIST_SET_KINDS[owner]);
        if (
          !stmt.key.quoted &&
          stmt.key.text === "namespace" &&
          !ancestors.length &&
          profile.eventNamespaces &&
          !value.quoted
        ) {
          pushAs(value, "namespace", ["declaration"]);
        } else if (
          spec?.values?.startsWith("enum:") &&
          !value.quoted &&
          spec.values.slice(5).split("|").includes(value.text)
        ) {
          pushAs(value, "enumMember", ["defaultLibrary", "readonly"]);
        } else if (
          implicit &&
          !value.quoted &&
          NAME.test(value.text) &&
          (implicit[0] === "saved_scope" || variableSet || implicit[0] === "flag" || implicit[0] === "list")
        ) {
          pushAs(value, definitionTokenType(implicit[0]), [
            owner?.startsWith("change_") ? "modification" : "declaration",
            ...kindModifiers(implicit[0]),
          ]);
        } else if (
          kinds?.[0] === "loc_key" &&
          isLocProperty(stmt.key.text) === "broad" &&
          spec?.values !== "loc" &&
          !fields?.has(stmt.key.text) &&
          !definition(value.text, kinds) &&
          !value.text.includes(":")
        ) {
          // Broad loc properties also carry ordinary text and non-localization names.
          return;
        } else
          pushScalar(
            value,
            kinds ??
              (context === "value" || classifyKeyword(stmt.key.text) === "value"
                ? ["script_value"]
                : undefined),
            !!kinds
          );
      }
      if (stmt.value?.kind === "tagged-block")
        pushScalar(stmt.value.tag, gui ? [entry!.kind] : undefined, gui);
    } else if (stmt.value.kind === "scalar") {
      if (gui) {
        const declared = guiDeclarations.get(stmt.value);
        if (declared) pushAs(stmt.value, declared);
        return;
      }
      const parent = ancestors.length >= 2 ? ancestors[ancestors.length - 2] : undefined;
      const kinds = parent?.kind === "assignment" ? fieldKinds(parent.key, "list") : undefined;
      pushScalar(stmt.value, kinds, !!kinds);
    } else if (stmt.value.kind === "tagged-block") pushScalar(stmt.value.tag);
  });
  if (!gui) return spans;
  const expressions = datafunctionExpressionRanges(document);
  let expression = 0;
  return spans
    .sort((a, b) => a.offset - b.offset)
    .filter((span) => {
      while (expression < expressions.length && expressions[expression].end <= span.offset) expression++;
      const range = expressions[expression];
      return !range || span.offset + span.length <= range.start;
    });
}
