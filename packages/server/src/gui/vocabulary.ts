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
 * `container` is derived the same way: a type is one when the vanilla tree ever
 * wrote a WIDGET block inside it (the harvest counts child keys among a type's
 * props), with the engine's own attribute-block set excluded so `size` and
 * `background` do not make everything a container.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type { GuiVocabularyEntry, GuiVocabularyResult } from "@px-lsp/protocol/protocol";
import { collectGuiDefs } from "./guiDefs";
import { PROPERTY_BLOCKS } from "./layoutEngine";

/** The slice of `guiSchema.json` a palette needs. */
interface GuiSchemaTypes {
  types?: Record<string, { count: number; props?: Record<string, number> }>;
}

/**
 * How many harvested types a palette gets. The tail is single-use vanilla
 * types; `total` reports what was left out rather than pretending the list is
 * everything. A UI budget, not a measurement.
 */
export const VOCABULARY_LIMIT = 300;

export function computeGuiVocabulary(text: string, schema: unknown): GuiVocabularyResult {
  const types = (schema as GuiSchemaTypes | undefined)?.types ?? {};
  const known = new Set(Object.keys(types));
  const entries: GuiVocabularyEntry[] = [];

  // The document's own declarations first, and never capped: they are the ones
  // its author reaches for, and no harvest can know them.
  const own = collectGuiDefs(text);
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
  return { entries, total: declared.size + harvested.length };
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
