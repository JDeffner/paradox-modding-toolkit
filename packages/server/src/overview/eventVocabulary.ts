/**
 * paradox/eventVocabulary: what an event editor is allowed to offer.
 *
 * The graph inspector guides a new modder with dropdowns, and a dropdown is
 * only as honest as its source. So every list here is derived from data the
 * server already holds:
 *
 *   keys          the active profile's structure table (harvested `_*.info`),
 *                 ordered by the usage counts it carries
 *   value sets    a `values: "enum:a|b|c"` spec, or the schema's reference
 *                 fields resolved through the definition index (`theme` ->
 *                 every indexed event_theme, mod entries first)
 *   effects       script_docs tokens (the user's own logs, or the bundled
 *   triggers      wiki fallback), with the log's own description
 *   saved scopes  the mod's own `save_scope_as` sites, from the index
 *
 * Nothing is hand-written, so a game patch that adds a theme or renames an
 * effect changes the dropdown without a release. No `vscode` imports.
 */
import {
  EVENT_VOCABULARY_MAX_TOKENS,
  EVENT_VOCABULARY_MAX_VALUES,
  type EventVocabularyItem,
  type EventVocabularyResult,
} from "@px-lsp/protocol/protocol";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import type { KeySpec } from "../schema/types";

/** One line is what a menu row shows; the rest is noise at that size. */
const MAX_DOC = 220;

function short(doc: string | undefined): string | undefined {
  if (!doc) return undefined;
  const oneLine = doc.replace(/\s+/g, " ").trim();
  if (oneLine === "") return undefined;
  return oneLine.length > MAX_DOC ? oneLine.slice(0, MAX_DOC - 1) + "…" : oneLine;
}

/** Structure keys of one block, most used first (freq is the harvest's count). */
function keyItems(specs: Map<string, KeySpec> | undefined): EventVocabularyItem[] {
  if (!specs) return [];
  const out = [...specs.values()].sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0));
  return out.map((spec) => ({
    value: spec.key,
    doc: short(spec.doc),
    hint:
      spec.values === "block"
        ? "block"
        : spec.values === "bool"
          ? "yes/no"
          : spec.values === "loc"
            ? "loc"
            : undefined,
  }));
}

export function computeEventVocabulary(
  data: ServerData,
  schema: SchemaData,
  inFocus: (file: string) => boolean = () => true
): EventVocabularyResult {
  const blocks = schema.structures.keysByKindBlock.get("event");
  const eventKeys = keyItems(blocks?.get(""));
  const optionKeys = keyItems(blocks?.get("option"));

  // Value sets, for the keys that have one. Two sources, in this order: a
  // declared enumeration wins (it is the exact vocabulary), otherwise the
  // schema's reference field names the definition kinds the index can list.
  const values: Record<string, EventVocabularyItem[]> = {};
  const byKind = new Map<string, EventVocabularyItem[]>();
  const definitionsOf = (kind: string): EventVocabularyItem[] => {
    let cached = byKind.get(kind);
    if (cached) return cached;
    const seen = new Set<string>();
    const mod: EventVocabularyItem[] = [];
    const rest: EventVocabularyItem[] = [];
    for (const def of data.index.allDefinitions()) {
      if (def.kind !== kind || seen.has(def.name)) continue;
      if (def.source === "mod" && !inFocus(def.file)) continue;
      seen.add(def.name);
      (def.source === "mod" ? mod : rest).push({
        value: def.name,
        doc: short(def.doc),
        hint: def.source === "mod" ? "this mod" : def.source,
      });
    }
    mod.sort((a, b) => a.value.localeCompare(b.value));
    rest.sort((a, b) => a.value.localeCompare(b.value));
    cached = [...mod, ...rest].slice(0, EVENT_VOCABULARY_MAX_VALUES);
    byKind.set(kind, cached);
    return cached;
  };

  for (const specs of [blocks?.get(""), blocks?.get("option")]) {
    for (const spec of specs?.values() ?? []) {
      if (values[spec.key]) continue;
      if (spec.values?.startsWith("enum:")) {
        values[spec.key] = spec.values
          .slice(5)
          .split("|")
          .filter((v) => v !== "")
          .map((v) => ({ value: v }));
        continue;
      }
      if (spec.values === "bool") {
        values[spec.key] = [{ value: "yes" }, { value: "no" }];
        continue;
      }
      const field = schema.refFields.get(spec.key);
      if (!field) continue;
      const items: EventVocabularyItem[] = [];
      for (const kind of field.kinds) items.push(...definitionsOf(kind));
      if (items.length > 0) values[spec.key] = items.slice(0, EVENT_VOCABULARY_MAX_VALUES);
    }
  }

  // Engine tokens. `data.tokens` is the parsed script_docs (or the bundled wiki
  // baseline); the reference index's non-call usage counts order them, so the
  // effects a real corpus writes come first instead of the alphabet.
  const effects: EventVocabularyItem[] = [];
  const triggers: EventVocabularyItem[] = [];
  const seenToken = new Set<string>();
  const ranked = [...data.tokens].sort(
    (a, b) => data.refIndex.usageCount(b.name) - data.refIndex.usageCount(a.name)
  );
  for (const token of ranked) {
    const bucket = token.kind === "effect" ? effects : token.kind === "trigger" ? triggers : null;
    if (!bucket || bucket.length >= EVENT_VOCABULARY_MAX_TOKENS) continue;
    const key = `${token.kind}:${token.name}`;
    if (seenToken.has(key)) continue;
    seenToken.add(key);
    bucket.push({
      value: token.name,
      doc: short(token.doc),
      hint: token.scopes.length > 0 ? token.scopes.slice(0, 3).join(", ") : undefined,
    });
  }

  const savedScopes: EventVocabularyItem[] = [];
  const seenScope = new Set<string>();
  for (const def of data.index.allDefinitions()) {
    if (def.kind !== "saved_scope" || seenScope.has(def.name)) continue;
    if (!inFocus(def.file)) continue;
    seenScope.add(def.name);
    savedScopes.push({ value: def.name, hint: def.container });
  }
  savedScopes.sort((a, b) => a.value.localeCompare(b.value));

  return {
    eventKeys,
    optionKeys,
    values,
    effects,
    triggers,
    savedScopes: savedScopes.slice(0, EVENT_VOCABULARY_MAX_VALUES),
  };
}
