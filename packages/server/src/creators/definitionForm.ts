/**
 * paradox/definitionForm: everything a visual creator needs to draw a form for
 * one definition kind, assembled from data the server already holds.
 *
 * The rule the creators are built on is the same one the event vocabulary
 * follows: a no-code editor is only as honest as its sources, so nothing here
 * is written for the creator.
 *
 *   folder / locPatterns / iconFolder   the schema table entry for the kind
 *   keys / blocks                       the profile's structure layer, which is
 *                                       the harvest of the game's own `_*.info`
 *                                       docs with the curated specs on top
 *   options                             the definition index, through the SAME
 *                                       resolver paradox/eventValueOptions uses
 *   modifiers                           the script_docs modifier tokens hover
 *                                       and completion already read
 *   existing                            the index walk paradox/modOverview does
 *   current                             the file on disk, verbatim
 *
 * A game patch that adds a key, a trait or a modifier changes the form without
 * a release, and a game whose schema has no such kind gets `null` rather than
 * an invented shape.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import {
  EVENT_VOCABULARY_MAX_VALUES,
  type DefinitionForm,
  type DefinitionFormKey,
  type DefinitionFormParams,
  type EventVocabularyItem,
  type OverviewDef,
} from "@px-lsp/protocol/protocol";
import { decode, parseScript, type Statement } from "../parser";
import type { SchemaData } from "../schema/loader";
import type { KeySpec } from "../schema/types";
import type { ServerData } from "../serverData";
import { definitionsOfKind, short } from "../overview/eventVocabulary";

/** Same cap as the overview's per-kind definition list. */
const EXISTING_CAP = 500;

function formKeys(specs: Map<string, KeySpec> | undefined): DefinitionFormKey[] {
  if (!specs) return [];
  // Insertion order IS the answer's order: schema/loader.ts fills the map from
  // StructureSpec.topLevel, which the profile already sorted (curated first,
  // then harvested by vanilla usage count).
  return [...specs.values()].map((spec) => ({
    key: spec.key,
    ...(short(spec.doc) ? { doc: short(spec.doc) } : {}),
    ...(spec.values ? { values: spec.values } : {}),
    ...(spec.freq !== undefined ? { freq: spec.freq } : {}),
    ...(spec.refKinds?.length ? { refKinds: spec.refKinds } : {}),
  }));
}

/**
 * The `name = { ... }` block of `name` in `file`, verbatim. Read from disk, not
 * from the index: the index records where a definition is, the creator needs
 * the bytes so an edit starts from what the file actually says.
 */
function blockSource(file: string, name: string): string | null {
  let text: string;
  try {
    text = decode(fs.readFileSync(file)).text;
  } catch {
    return null;
  }
  const stmt = parseScript(text).root.statements.find(
    (s): s is Statement & { kind: "assignment" } =>
      s.kind === "assignment" && s.key.text === name && s.value?.kind === "block"
  );
  return stmt ? text.slice(stmt.key.range.start, stmt.value!.range.end) : null;
}

export function computeDefinitionForm(
  data: ServerData,
  schema: SchemaData,
  params: DefinitionFormParams,
  inFocus: (file: string) => boolean = () => true
): DefinitionForm | null {
  const kind = params?.kind?.trim() ?? "";
  const entry = schema.entries.find((e) => e.kind === kind);
  if (kind === "" || !entry) return null;

  const blocks = schema.structures.keysByKindBlock.get(kind);
  const keys = formKeys(blocks?.get(""));
  const subBlocks: Record<string, DefinitionFormKey[]> = {};
  for (const [name, specs] of blocks ?? []) {
    if (name !== "") subBlocks[name] = formKeys(specs);
  }

  // One list per ref kind any key names, so several keys pointing at the same
  // kind share it instead of shipping the list twice.
  const options: Record<string, EventVocabularyItem[]> = {};
  for (const key of keys) {
    for (const refKind of key.refKinds ?? []) {
      if (!options[refKind]) options[refKind] = definitionsOfKind(data, refKind, inFocus);
    }
  }

  const existing: OverviewDef[] = [];
  for (const def of data.index.allDefinitions()) {
    if (def.kind !== kind || def.source !== "mod" || !inFocus(def.file)) continue;
    if (existing.length < EXISTING_CAP) existing.push({ name: def.name, file: def.file, line: def.line });
  }
  existing.sort((a, b) => a.name.localeCompare(b.name));

  // Modifier rows: the same token list hover documents, ranked by the reference
  // index's usage counts so the modifiers a real corpus writes come first.
  const modifiers = data.tokens
    .filter((t) => t.kind === "modifier")
    .sort((a, b) => data.refIndex.usageCount(b.name) - data.refIndex.usageCount(a.name))
    .slice(0, EVENT_VOCABULARY_MAX_VALUES)
    .map((t) => ({ name: t.name, ...(short(t.doc) ? { doc: short(t.doc) } : {}) }));

  const form: DefinitionForm = {
    kind,
    folder: entry.path,
    // The whole set the game generates, which is a superset of the
    // conservative requiredLoc a diagnostic is allowed to demand.
    locPatterns: entry.locPatterns ?? entry.requiredLoc ?? [],
    ...(entry.iconFolder ? { iconFolder: entry.iconFolder } : {}),
    keys,
    ...(Object.keys(subBlocks).length > 0 ? { blocks: subBlocks } : {}),
    options,
    modifiers,
    existing,
  };

  const wanted = params.name?.trim();
  if (wanted) {
    // Mod first: editing "the trait called X" means the one this mod ships,
    // and the vanilla copy only when the mod has none (last-in-wins order).
    const defs = data.index.lookup(wanted).filter((d) => d.kind === kind);
    const def = defs.find((d) => d.source === "mod" && inFocus(d.file)) ?? defs[0];
    const text = def ? blockSource(def.file, wanted) : null;
    if (def && text !== null) {
      form.current = { file: def.file, line: def.line, source: def.source, text };
    }
  }
  return form;
}
