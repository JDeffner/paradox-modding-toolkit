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
 *   conditions                          the profile's condition table, resolved
 *                                       against the script_docs trigger entries
 *                                       and the same definition index
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
  DEFINITION_FORM_MAX_EXAMPLE,
  DEFINITION_FORM_MAX_SAMPLED,
  EVENT_VOCABULARY_MAX_VALUES,
  type DefinitionForm,
  type DefinitionFormKey,
  type DefinitionFormParams,
  type EventVocabularyItem,
  type OverviewDef,
} from "@px-lsp/protocol/protocol";
import { decode, parseScript, type BlockNode, type ValueNode } from "../parser";
import type { SchemaData } from "../schema/loader";
import type { KeySpec } from "../schema/types";
import type { ServerData } from "../serverData";
import { definitionsOfKind, short } from "../overview/eventVocabulary";
import { activeProfile } from "../games/active";
import type { ConditionValueSource } from "../games/profile";

/**
 * Same cap as the overview's per-kind definition list. It holds a whole game's
 * worth of a creator's kind with room for a mod's own (301 vanilla traits is
 * the largest of them, measured), and the mod's definitions are listed first,
 * so a list that did hit the cap would only lose vanilla entries from the end
 * of the alphabet.
 */
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
 * One script file's top-level `name = { ... }` blocks and its text, parsed once
 * per request. Read from disk, not from the index: the index records where a
 * definition is, a creator needs the bytes so an edit starts from what the file
 * actually says, and both the group key and the sampled values are read out of
 * the same parse.
 */
/** One definition: its parsed body, and its `name = { ... }` source verbatim. */
interface ParsedDef {
  block: BlockNode;
  source: string;
  /** Where `source` starts in the file, so a statement's range indexes into it. */
  start: number;
}
type FileCache = Map<string, Map<string, ParsedDef>>;

function parsedFile(file: string, cache: FileCache): Map<string, ParsedDef> {
  const seen = cache.get(file);
  if (seen) return seen;
  const defs = new Map<string, ParsedDef>();
  cache.set(file, defs);
  let text: string;
  try {
    text = decode(fs.readFileSync(file)).text;
  } catch {
    return defs;
  }
  for (const s of parseScript(text).root.statements) {
    if (s.kind !== "assignment" || s.value?.kind !== "block") continue;
    defs.set(s.key.text, {
      block: s.value,
      source: text.slice(s.key.range.start, s.value.range.end),
      start: s.key.range.start,
    });
  }
  return defs;
}

/** Every definition of `kind` the index holds, as (name, file) pairs. */
function definitionFiles(data: ServerData, kind: string): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const def of data.index.allDefinitions()) {
    if (def.kind === kind) out.push({ name: def.name, file: def.file });
  }
  return out;
}

/** The scalar `key = value` of a block, or null when it has none. */
function scalarOf(block: BlockNode, key: string): string | null {
  for (const s of block.statements) {
    if (s.kind === "assignment" && s.key.text === key && s.value?.kind === "scalar") return s.value.text;
  }
  return null;
}

/**
 * A value worth offering back: a bare name the game writes for this key. Numbers
 * are weights and coordinates, quoted text is prose, `scope:`/`@` are script
 * machinery - none of them is a value set a picker can show.
 */
function offerable(text: string): boolean {
  return text !== "" && !/^-?\d+(\.\d+)?$/.test(text) && !text.includes(":") && !text.startsWith("@");
}

/** The names a value writes: a scalar, or the entries of a one-level list. */
function namesIn(value: ValueNode, into: (name: string) => void): void {
  if (value.kind === "scalar") {
    if (!value.quoted && offerable(value.text)) into(value.text);
    return;
  }
  if (value.kind !== "block") return;
  for (const s of value.statements) {
    // `coa_gfx = { a b }` (bare entries) and `ethnicities = { 100 = arab }`
    // (weighted entries) both name things; a nested block is script, not a name.
    const inner = s.kind === "value" ? s.value : s.value;
    if (inner?.kind === "scalar" && !inner.quoted && offerable(inner.text)) into(inner.text);
  }
}

/**
 * Label each option with the family its definition belongs to, for a kind whose
 * schema entry names the key that says so: one folder holds all five culture
 * pillars and only `type = ethos` inside a block tells an ethos from a language,
 * so a creator drawing five pickers has no other way to split the one list.
 */
function groupOptions(
  data: ServerData,
  schema: SchemaData,
  kind: string,
  items: EventVocabularyItem[],
  cache: FileCache
): void {
  const groupKey = schema.entries.find((e) => e.kind === kind)?.groupKey;
  if (!groupKey) return;
  const groups = new Map<string, string>();
  for (const { name, file } of definitionFiles(data, kind)) {
    const def = parsedFile(file, cache).get(name);
    const group = def ? scalarOf(def.block, groupKey) : null;
    if (group !== null) groups.set(name, group);
  }
  for (const item of items) {
    const group = groups.get(item.value);
    if (group !== undefined) item.group = group;
  }
}

/**
 * What the game itself writes for the keys no definition index can answer: a
 * culture's `clothing_gfx` names an art set and `ethnicities` names a portrait
 * ethnicity, neither of which is an indexed definition, so the only honest
 * source is the files. Measured here rather than stored, so a game patch or a
 * dependency mod changes the offer without a release.
 *
 * A key whose values are different in every definition (a `desc` loc key) has
 * no value set at all: past the cap it is dropped rather than offered as a list
 * of everything.
 */
function sampledValues(data: ServerData, kind: string, keys: DefinitionFormKey[], cache: FileCache): void {
  // Bools and enums are in: their value SET is known already, but the value the
  // game writes most often for the key is still the honest thing a form shows
  // in an empty control, and a dropdown reading only "not set" tells a modder
  // nothing. A key answered by the definition index stays out: its options are
  // the index's, and its widget has no placeholder slot to fill.
  const wanted = keys.filter((k) => !k.refKinds?.length);
  if (wanted.length === 0) return;
  const counts = new Map<string, Map<string, number>>();
  // Read in the same pass, but counted separately: an example is ONE literal
  // the game writes (a number, a loc key, a quoted line), and those are exactly
  // the values `offerable` refuses as a value SET.
  const literals = new Map<string, Map<string, number>>();
  // A block key has no scalar literal at all, so its example is the BODY the
  // game writes most often for it: what a script field shows as a placeholder.
  const bodies = new Map<string, Map<string, number>>();
  for (const key of wanted) {
    counts.set(key.key, new Map());
    literals.set(key.key, new Map());
    bodies.set(key.key, new Map());
  }
  let read = 0;
  for (const { name, file } of definitionFiles(data, kind)) {
    if (read >= EVENT_VOCABULARY_MAX_VALUES) break;
    const def = parsedFile(file, cache).get(name);
    if (!def) continue;
    read++;
    for (const s of def.block.statements) {
      if (s.kind !== "assignment" || !s.value) continue;
      const bucket = counts.get(s.key.text);
      if (!bucket) continue;
      namesIn(s.value, (v) => bucket.set(v, (bucket.get(v) ?? 0) + 1));
      if (s.value.kind === "scalar" && s.value.text !== "") {
        const seen = literals.get(s.key.text)!;
        seen.set(s.value.text, (seen.get(s.value.text) ?? 0) + 1);
      } else if (s.value.kind === "block") {
        const body = oneLineBody(
          def.source.slice(s.value.range.start - def.start, s.value.range.end - def.start)
        );
        if (body !== "") {
          const seen = bodies.get(s.key.text)!;
          seen.set(body, (seen.get(body) ?? 0) + 1);
        }
      }
    }
  }
  const mostUsed = (bucket: Map<string, number>): [string, number][] =>
    [...bucket.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const key of wanted) {
    const bucket = counts.get(key.key)!;
    // A key whose value set the schema or the doc already states (`bool`,
    // `enum:`) gets no measured one: two lists of the same thing, one of them
    // only as complete as the files happen to be.
    const stated = key.values === "bool" || key.values?.startsWith("enum:") === true;
    if (!stated && bucket.size > 0 && bucket.size <= DEFINITION_FORM_MAX_SAMPLED) {
      key.sampled = mostUsed(bucket).map(([value]) => value);
    }
    // Kept even when the value set was dropped for being past the cap: a key
    // whose value differs in every definition is exactly the one a form has to
    // show an example for.
    // A scalar literal first: it is what most keys are. A key the game only
    // ever writes as a block falls back to its most written body, so a script
    // field is never the one field with no example on it.
    const example = mostUsed(literals.get(key.key)!)[0] ?? mostUsed(bodies.get(key.key)!)[0];
    if (example) key.example = example[0];
  }
}

/**
 * A `{ … }` body as a placeholder can be: one line, inner runs of whitespace
 * collapsed, cut with an ellipsis rather than dropped when it is long. The
 * braces stay, because they are what the modder has to type.
 */
function oneLineBody(text: string): string {
  const flat = text
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > DEFINITION_FORM_MAX_EXAMPLE
    ? `${flat.slice(0, DEFINITION_FORM_MAX_EXAMPLE - 1).trimEnd()}…`
    : flat;
}

/**
 * The values a `Valid …:` metadata line of a script_docs entry enumerates.
 *
 * The line is stored with its own label in front of it, because the docs
 * parser keeps the label it matched ("Traits: Valid Features: a, b, and c",
 * measured on the trigger dump of the profile that names one). A value never
 * holds a colon, so the list is what follows the LAST one; the last entry
 * carries the prose "and". A token whose traits hold several metadata lines is
 * read line by line, and the first line that enumerates anything wins.
 */
function docListValues(traits: string): string[] {
  for (const line of traits.split("\n")) {
    const names = line
      .slice(line.lastIndexOf(":") + 1)
      .split(",")
      .map((part) =>
        part
          .trim()
          .replace(/^and\s+/i, "")
          .replace(/\.$/, "")
      )
      .filter((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name));
    if (names.length > 0) return [...new Set(names)];
  }
  return [];
}

/** The inner block keys of every definition of a kind (a game rule's settings). */
function innerKeysOf(data: ServerData, kind: string, except: readonly string[], cache: FileCache): string[] {
  const skip = new Set(except);
  const names: string[] = [];
  for (const { name, file } of definitionFiles(data, kind)) {
    const def = parsedFile(file, cache).get(name);
    if (!def) continue;
    for (const s of def.block.statements) {
      if (s.kind !== "assignment" || s.value?.kind !== "block") continue;
      if (skip.has(s.key.text) || names.includes(s.key.text)) continue;
      names.push(s.key.text);
    }
  }
  return names;
}

/**
 * The value list one trigger of the profile's condition table resolves to, or
 * an empty list when this workspace has no source for it (no script_docs dump,
 * no game folder): the answer is then the trigger's ABSENCE from `conditions`,
 * which a creator draws as a free input rather than an empty picker.
 */
function conditionItems(
  data: ServerData,
  source: ConditionValueSource,
  trigger: string,
  inFocus: (file: string) => boolean,
  cache: FileCache
): EventVocabularyItem[] {
  if (source.from === "kind") return definitionsOfKind(data, source.kind, inFocus);
  const values =
    source.from === "docList"
      ? docListValues(data.tokenMap.get(trigger)?.find((token) => token.traits)?.traits ?? "")
      : innerKeysOf(data, source.kind, source.except ?? [], cache);
  return values.slice(0, EVENT_VOCABULARY_MAX_VALUES).map((value) => ({ value }));
}

/**
 * The name the PLAYER reads for a definition. The loc key is the schema's own
 * pattern for the kind with `$` replaced by the name; a kind whose entry names
 * none gets the two shapes the games write for a bare definition, and a name
 * nothing resolves for keeps no label at all rather than a made-up one.
 */
function labeller(data: ServerData, schema: SchemaData): (kind: string, name: string) => string | undefined {
  const patterns = new Map<string, string[]>();
  const patternsFor = (kind: string): string[] => {
    let list = patterns.get(kind);
    if (!list) {
      const entry = schema.entries.find((e) => e.kind === kind);
      const own = entry?.locPatterns ?? entry?.requiredLoc ?? [];
      list = own.length > 0 ? [own[0]] : ["$_name", "$"];
      patterns.set(kind, list);
    }
    return list;
  };
  const locValue = (key: string): string | undefined =>
    data.index.lookup(key).find((d) => d.kind === "loc_key" && d.value !== undefined)?.value;
  return (kind, name) => {
    for (const pattern of patternsFor(kind)) {
      const value = locValue(pattern.replace("$", name));
      if (value === undefined || value === "") continue;
      // A value that is only another key (`tradition_hird_name:0
      // "$innovation_hird$"`, 10 of ~200 vanilla traditions) reads as that
      // key's text; one hop, the way the game resolves it.
      const alias = /^\$([\w.-]+)\$$/.exec(value);
      const resolved = alias ? locValue(alias[1]) : undefined;
      return resolved !== undefined && resolved !== "" ? resolved : value;
    }
    return undefined;
  };
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

  const files: FileCache = new Map();
  const labelOf = labeller(data, schema);

  // One list per ref kind any key names, so several keys pointing at the same
  // kind share it instead of shipping the list twice.
  const options: Record<string, EventVocabularyItem[]> = {};
  for (const key of keys) {
    for (const refKind of key.refKinds ?? []) {
      if (options[refKind]) continue;
      options[refKind] = definitionsOfKind(data, refKind, inFocus);
      groupOptions(data, schema, refKind, options[refKind], files);
      // A picker reads better with the player's word for the definition than
      // with its key, and only the loc index knows it.
      for (const item of options[refKind]) {
        const label = labelOf(refKind, item.value);
        if (label !== undefined) item.label = label;
      }
    }
  }

  // Keys no index can answer (a culture's clothing_gfx, its ethnicities) get
  // what the indexed definitions of this kind actually write for them.
  sampledValues(data, kind, keys, files);

  // The trigger value lists a no-code condition builder needs. The profile
  // names the triggers and their sources; a trigger nothing resolves for stays
  // out, so a client can tell "no list" from "an empty list".
  const conditions: Record<string, EventVocabularyItem[]> = {};
  for (const [trigger, source] of Object.entries(activeProfile().conditionValues ?? {})) {
    const items = conditionItems(data, source, trigger, inFocus, files);
    if (items.length > 0) conditions[trigger] = items;
  }

  // What the Open menu offers: everything the index has of this kind, the
  // mod's own first. A creator opens a vanilla definition to duplicate or
  // override it, which is most of what a modder does with one, so a list of
  // only the mod's own definitions could never answer "start from the game's".
  const byName = new Map<string, OverviewDef>();
  for (const def of data.index.allDefinitions()) {
    if (def.kind !== kind) continue;
    if (def.source === "mod" && !inFocus(def.file)) continue;
    const seen = byName.get(def.name);
    // Last-in-wins: the mod's copy is the one a modder means by the name.
    if (seen && !(def.source === "mod" && seen.source !== "mod")) continue;
    const label = labelOf(kind, def.name);
    byName.set(def.name, {
      name: def.name,
      file: def.file,
      line: def.line,
      source: def.source,
      ...(label !== undefined ? { label } : {}),
    });
  }
  const existing = [...byName.values()]
    .sort((a, b) => Number(b.source === "mod") - Number(a.source === "mod") || a.name.localeCompare(b.name))
    .slice(0, EXISTING_CAP);

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
    ...(Object.keys(conditions).length > 0 ? { conditions } : {}),
    modifiers,
    existing,
  };

  const wanted = params.name?.trim();
  if (wanted) {
    // Mod first: editing "the trait called X" means the one this mod ships,
    // and the vanilla copy only when the mod has none (last-in-wins order).
    const defs = data.index.lookup(wanted).filter((d) => d.kind === kind);
    const def = defs.find((d) => d.source === "mod" && inFocus(d.file)) ?? defs[0];
    const parsed = def ? parsedFile(def.file, files).get(wanted) : undefined;
    if (def && parsed) {
      form.current = { file: def.file, line: def.line, source: def.source, text: parsed.source };
    }
  }
  return form;
}
