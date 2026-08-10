/**
 * paradox/guiVocabulary backend: which widgets a designer palette may offer.
 *
 * Every name comes from something the project already harvested, never from a
 * list typed here: the bundled `data/<game>/guiSchema.json` (600+ widget types
 * with their vanilla usage counts, built by `scripts/build-gui-schema.ts`) plus
 * the requested document's own `template` / `type` declarations. A palette that
 * offered a name from memory would write a widget the game does not know, which
 * is exactly the failure AGENTS.md's one design idea exists to prevent.
 *
 * The same harvest answers the other half of a designer's vocabulary: which
 * PROPERTIES a widget type carries, for an inspector that offers to add one.
 * Ranked by vanilla usage, scoped to the types this document names, with the
 * tree-wide ranking as the fallback for a type the harvest does not know.
 *
 * `container` is derived the same way: a type is one when the vanilla tree ever
 * wrote a WIDGET block inside it (the harvest counts child keys among a type's
 * props), with the engine's own attribute-block set excluded so `size` and
 * `background` do not make everything a container.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { GuiVocabularyEntry, GuiVocabularyResult } from "@px-lsp/protocol/protocol";
import { parseScript, type Statement } from "../parser";
import { collectGuiDefsParsed } from "./guiDefs";
import { PROPERTY_BLOCKS } from "./layoutEngine";

/** The slice of `guiSchema.json` a palette needs. */
interface GuiSchemaTypes {
  types?: Record<string, { count: number; props?: Record<string, number> }>;
  globalProps?: Record<string, number>;
}

/**
 * How many harvested types a palette gets. The tail is single-use vanilla
 * types; `total` reports what was left out rather than pretending the list is
 * everything. A UI budget, not a measurement.
 */
export const VOCABULARY_LIMIT = 300;

/**
 * How many property names one type offers, and how long the tree-wide fallback
 * ranking is. Both are UI budgets: the harvest keeps up to 100 properties per
 * type and 200 overall, and a completion list nobody scrolls past the twentieth
 * row of does not need to carry the tail across the wire on every layout.
 */
export const TYPE_PROPERTY_LIMIT = 60;
export const COMMON_PROPERTY_LIMIT = 80;

export function computeGuiVocabulary(text: string, schema: unknown): GuiVocabularyResult {
  const types = (schema as GuiSchemaTypes | undefined)?.types ?? {};
  const known = new Set(Object.keys(types));
  const entries: GuiVocabularyEntry[] = [];

  // The document's own declarations first, and never capped: they are the ones
  // its author reaches for, and no harvest can know them.
  const statements = parseScript(text).root.statements;
  const own = collectGuiDefsParsed(statements);
  for (const [name, def] of own.types) {
    entries.push({ name, kind: "type", local: true, base: def.base, container: true });
  }
  for (const [name] of own.templates) {
    entries.push({ name, kind: "template", local: true });
  }
  const declared = new Set(entries.map((e) => e.name));

  const harvested = [...known]
    .filter((name) => !declared.has(name))
    .sort((a, b) => types[b].count - types[a].count || a.localeCompare(b));
  for (const name of harvested.slice(0, VOCABULARY_LIMIT)) {
    entries.push({
      name,
      kind: "builtin",
      count: types[name].count,
      container: holdsWidgets(types[name].props, known),
    });
  }
  return {
    entries,
    total: declared.size + harvested.length,
    properties: propertiesFor(statements, own.types, types),
    commonProperties: rank((schema as GuiSchemaTypes | undefined)?.globalProps, COMMON_PROPERTY_LIMIT),
  };
}

/**
 * The property names the harvest saw on the widget types THIS DOCUMENT names,
 * which is what an inspector's add-property row completes from. Scoped to the
 * document rather than sent whole because the harvest holds 556 types and an
 * open panel re-asks after every layout; the types a file actually writes are a
 * couple of dozen, and `commonProperties` covers the rest.
 *
 * "Names" is the union of the keys it writes blocks under and the bases of its
 * own `type X = base` declarations: a derived type's properties live under its
 * base in the harvest, which is also where the widget's type chain ends.
 */
function propertiesFor(
  statements: readonly Statement[],
  localTypes: ReadonlyMap<string, { base: string }>,
  types: Record<string, { count: number; props?: Record<string, number> }>
): Record<string, string[]> {
  const named = new Set<string>();
  collectBlockKeys(statements, named);
  for (const def of localTypes.values()) named.add(def.base.toLowerCase());

  const out: Record<string, string[]> = {};
  for (const name of named) {
    const props = types[name]?.props;
    if (props) out[name] = rank(props, TYPE_PROPERTY_LIMIT);
  }
  return out;
}

/** Every key the document writes a block under, lowercased, at any depth. */
function collectBlockKeys(statements: readonly Statement[], into: Set<string>): void {
  for (const stmt of statements) {
    if (stmt.kind === "value") {
      if (stmt.value.kind === "block") collectBlockKeys(stmt.value.statements, into);
      continue;
    }
    const value = stmt.value;
    if (!value) continue;
    const block = value.kind === "block" ? value : value.kind === "tagged-block" ? value.block : null;
    if (!block) continue;
    if (!stmt.key.quoted) into.add(stmt.key.text.toLowerCase());
    collectBlockKeys(block.statements, into);
  }
}

/** Usage counts to names, most used first, capped. */
function rank(counts: Record<string, number> | undefined, limit: number): string[] {
  return Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

/**
 * A type the vanilla tree ever wrote another widget inside. The harvest counts
 * child widget keys among a type's props, so the test is "does any prop name a
 * known widget type", with the engine's attribute blocks (`size`, `background`,
 * `state`, …) taken out — those are data, not children.
 */
function holdsWidgets(props: Record<string, number> | undefined, known: ReadonlySet<string>): boolean {
  for (const prop of Object.keys(props ?? {})) {
    if (!PROPERTY_BLOCKS.has(prop) && known.has(prop)) return true;
  }
  return false;
}
