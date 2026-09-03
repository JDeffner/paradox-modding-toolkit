/**
 * The trait form as data: which key belongs to which section, which widget it
 * gets, how a loaded block fills them, and what a save writes back.
 *
 * The KEYS are never listed here: they arrive from `paradox/definitionForm`,
 * which reads the harvest of `common/traits/_traits.info`. What is listed is
 * the LAYOUT - which of those keys a designed section shows, and in what
 * order - and the layout carries the source it was read from. A key the game
 * adds tomorrow still reaches the panel: it lands in "Advanced" with the
 * widget its own value hint asks for (AD-5: annotate, never hide).
 *
 * `_traits.info` ends its property list with "Any other unknown property is
 * read in as a modifier applied to anyone who holds the trait". That single
 * line is why the panel has a Modifiers section at all, and why `martial = 2`
 * is a modifier row rather than a documented property.
 *
 * Browser code, no DOM.
 */
import type { DefinitionForm, DefinitionFormKey } from "@px-lsp/protocol/protocol";
import type { ModifierRow } from "../../shared/fields";
import {
  innerOf,
  locKeyFor,
  parseBlock,
  quoteIfNeeded,
  readNumber,
  readNumberRows,
  readQuoted,
  readTokenList,
  scanItems,
  type BlockWrite,
  type ParsedBlock,
} from "../../shared/scriptBlock";

export type SectionId = "identity" | "skills" | "opinions" | "relations" | "advanced";

export type WidgetKind =
  "text" | "number" | "bool" | "enum" | "script" | "multiRef" | "refRows" | "chips" | "icon";

export interface TraitFieldSpec {
  key: string;
  section: SectionId;
  widget: WidgetKind;
  doc?: string;
  /** For `enum`: the values the key may take (a schema hint, or what the game writes). */
  values?: string[];
  /** For `multiRef` / `refRows`: the option list to pick from. */
  refKind?: string;
  /** The literal the game itself writes most often: an input's placeholder. */
  example?: string;
  /** Every value the indexed definitions write, when the form sampled them. */
  sampled?: string[];
}

/**
 * Identity: what the trait IS, in the order a modder answers it. The name and
 * the description are not here because they are not block keys at all: they
 * are the `trait_$` / `trait_$_desc` loc pair the panel writes separately.
 */
const IDENTITY = ["icon", "category"];

/**
 * The keys `_traits.info` documents as an integer or a 0-100 percentage
 * ("minimum_age = int", "birth = X # 0-100", "ruler_designer_cost = int"). A
 * key not in here keeps a text field, because a script value (`@my_value`) is
 * as legal as a literal and a number field would eat it.
 */
const NUMERIC = new Set([
  "minimum_age",
  "maximum_age",
  "level",
  "birth",
  "random_creation",
  "random_creation_weight",
  "inherit_chance",
  "both_parent_has_trait_inherit_chance",
  "ruler_designer_cost",
  "portrait_extremity_shift",
  "ugliness_portrait_extremity_shift",
]);

/**
 * The six skills, in the order `_traits.info` lists them under "### Modifiers"
 * ("diplomacy martial stewardship intrigue learning prowess = <int>"), and
 * verified as plain integers in `00_traits.txt` (brave: `martial = 2`,
 * `prowess = 3`). They are ordinary modifiers to the game, which is why the
 * preview prints them through the same formatter as a modifier row.
 */
const SKILLS = ["diplomacy", "martial", "stewardship", "intrigue", "learning", "prowess"];

/**
 * `_traits.info`'s "### Special opinion impacts" (`same_opinion`,
 * `same_opinion_if_same_faith`, `opposite_opinion`, `triggered_opinion`) plus
 * `attraction_opinion`, the one of the same shape vanilla writes most (brave:
 * `attraction_opinion = 10`, `same_opinion = 10`, `opposite_opinion = -10`).
 */
const OPINIONS = [
  "same_opinion",
  "same_opinion_if_same_faith",
  "opposite_opinion",
  "attraction_opinion",
  "triggered_opinion",
];

/** The one of them that is a block, so the section lays it out on its own row. */
export const TRIGGERED_OPINION_KEY = "triggered_opinion";

/** `_traits.info`'s "### Trait relations" plus the flag of "### Misc properties". */
const RELATIONS = ["opposites", "compatibility", "flag"];

/** The one key of the Identity section that is a picture rather than a value. */
const ICON_KEY = "icon";

/** The key whose value the game reads as the trait's category. */
const CATEGORY_KEY = "category";

/** `enum:all|male|female` -> the values, or undefined. */
function enumValues(hint: string | undefined): string[] | undefined {
  if (!hint?.startsWith("enum:")) return undefined;
  return hint.slice(5).split("|").filter(Boolean);
}

/**
 * The values a one-of picker offers. `category` has no enum hint in the
 * harvest (the game documents it as free text), so the honest list is the one
 * the indexed traits actually write, which `sampled` measured; a game patch
 * that adds a category adds it to the picker with no code change.
 */
function pickValues(key: DefinitionFormKey): string[] | undefined {
  return enumValues(key.values) ?? (key.key === CATEGORY_KEY ? key.sampled : undefined);
}

function widgetFor(key: DefinitionFormKey, section: SectionId): WidgetKind {
  if (key.key === ICON_KEY) return "icon";
  if (key.key === "opposites") return "multiRef";
  if (key.key === "compatibility") return "refRows";
  if (key.key === "flag") return "chips";
  if (pickValues(key)?.length) return "enum";
  if (key.values === "bool") return "bool";
  // The block check comes before the section one: `triggered_opinion` sits
  // under "Special opinion impacts" in `_traits.info` but is a block, not the
  // plain number its four neighbours are.
  if (key.values === "block") return "script";
  if (section === "skills" || section === "opinions" || NUMERIC.has(key.key)) return "number";
  return "text";
}

function sectionFor(key: string): SectionId {
  if (IDENTITY.includes(key)) return "identity";
  if (SKILLS.includes(key)) return "skills";
  if (OPINIONS.includes(key)) return "opinions";
  if (RELATIONS.includes(key)) return "relations";
  return "advanced";
}

/** Every key the form answered, placed and given a widget. Nothing is dropped. */
export function traitFieldSpecs(form: DefinitionForm): TraitFieldSpec[] {
  const byKey = new Map(form.keys.map((key) => [key.key, key]));
  const ordered: DefinitionFormKey[] = [];
  // The designed sections read in their own order; the rest keep the harvest's
  // (most used first), which is the order the form arrived in.
  for (const key of [...IDENTITY, ...SKILLS, ...OPINIONS, ...RELATIONS]) {
    const spec = byKey.get(key);
    if (spec) {
      ordered.push(spec);
      byKey.delete(key);
    }
  }
  for (const key of form.keys) if (byKey.has(key.key)) ordered.push(key);

  return ordered.map((key) => {
    const section = sectionFor(key.key);
    const widget = widgetFor(key, section);
    return {
      key: key.key,
      section,
      widget,
      ...(key.doc ? { doc: key.doc } : {}),
      ...(pickValues(key)?.length ? { values: pickValues(key) } : {}),
      ...(key.example ? { example: key.example } : {}),
      ...(key.sampled?.length ? { sampled: key.sampled } : {}),
      ...(key.refKinds?.[0] ? { refKind: key.refKinds[0] } : {}),
      // compatibility names traits too, but the harvest has no ref row for it
      // (it is `trait = number`, not a list); the panel passes the trait list.
      ...(key.key === "compatibility" ? { refKind: "trait" } : {}),
    };
  });
}

export type FieldValue = string | number | boolean | null | string[] | ModifierRow[];

export interface TraitState {
  /** Per spec key. `null` / `""` / `[]` mean the key is not written. */
  values: Record<string, FieldValue>;
  /** Modifier statements no spec owns (`glory_hound_opinion = 10`). */
  modifiers: ModifierRow[];
}

export interface LoadedTrait {
  block: ParsedBlock;
  /**
   * The specs the form must draw for THIS file. A key whose statement its
   * designed widget cannot stand for (a `desc = { first_valid … }`, a
   * `triggered_opinion` written five times) is promoted to the script widget,
   * which holds one raw value per statement: the modder edits the game's own
   * text instead of reading "kept as the file writes it" over a dead field.
   */
  specs: TraitFieldSpec[];
  state: TraitState;
}

/** The value a widget starts at when the block says nothing about its key. */
export function emptyValue(widget: WidgetKind): FieldValue {
  switch (widget) {
    case "number":
      return null;
    case "bool":
      return null;
    case "multiRef":
    case "chips":
    case "script":
      return [];
    case "refRows":
      return [];
    default:
      return "";
  }
}

/** The widgets that hold one entry per statement, so a repeat is not a clash. */
function repeatable(widget: WidgetKind): boolean {
  return widget === "chips" || widget === "script";
}

export function emptyState(specs: readonly TraitFieldSpec[]): TraitState {
  const values: Record<string, FieldValue> = {};
  for (const spec of specs) values[spec.key] = emptyValue(spec.widget);
  return { values, modifiers: [] };
}

/** What a widget can make of one statement's value text, or null when it cannot. */
function readValue(spec: TraitFieldSpec, value: string, block: boolean): FieldValue | null {
  switch (spec.widget) {
    case "number":
      return block ? null : readNumber(value);
    case "bool":
      return value === "yes" ? true : value === "no" ? false : null;
    case "enum":
      // A value no list carries is still the file's value: it loads, and the
      // picker widens to include it (AD-5, annotate never hide). Only a BLOCK
      // is refused, because no one-of picker can stand for one.
      return block ? null : value;
    case "multiRef":
      return block ? readTokenList(value) : null;
    case "refRows":
      return block ? readNumberRows(value) : null;
    case "chips":
      return block ? null : [value];
    case "icon":
      return block ? null : (readQuoted(value) ?? value);
    case "script":
      // The value's own source text, block or not: what makes the script
      // widget the one every other widget can fall back to.
      return [value];
    default:
      return block ? null : (readQuoted(value) ?? value);
  }
}

/**
 * Which keys of this file their designed widget cannot stand for: a value of
 * the wrong shape (`desc = { first_valid … }` where a loc key was expected),
 * or a second statement of a key that holds one value. Both are promoted to
 * the script widget, which takes any value and any number of them.
 */
function promoted(block: ParsedBlock, bySpec: Map<string, TraitFieldSpec>): Set<string> {
  const out = new Set<string>();
  const counts = new Map<string, number>();
  for (const item of block.items) {
    if (item.key === null || item.op !== "=") continue;
    const spec = bySpec.get(item.key);
    if (!spec) continue;
    counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
    if (readValue(spec, item.value, item.block) === null) out.add(item.key);
  }
  for (const [key, n] of counts) {
    if (n > 1 && !repeatable(bySpec.get(key)!.widget)) out.add(key);
  }
  return out;
}

/**
 * Fill the form from a definition's own text. Nothing is left out of the form:
 * a statement no designed widget fits promotes its key to the script widget,
 * so every line of the file has a control that writes it back.
 */
export function loadTrait(
  specs: readonly TraitFieldSpec[],
  text: string,
  modifierNames: ReadonlySet<string>
): LoadedTrait | null {
  const block = parseBlock(text);
  if (!block) return null;
  const designed = new Map(specs.map((spec) => [spec.key, spec]));
  const promotions = promoted(block, designed);
  const ownSpecs = specs.map((spec) =>
    promotions.has(spec.key) ? { ...spec, widget: "script" as const } : spec
  );
  const bySpec = new Map(ownSpecs.map((spec) => [spec.key, spec]));
  const state = emptyState(ownSpecs);
  const seen = new Set<string>();

  for (const item of block.items) {
    if (item.key === null || item.op !== "=") continue;
    const spec = bySpec.get(item.key);
    if (!spec) {
      // Unknown property = modifier (_traits.info, "### Modifiers").
      const value = readNumber(item.value);
      if (!item.block && value !== null && modifierNames.has(item.key)) {
        state.modifiers.push({ name: item.key, value });
      }
      continue;
    }
    const read = readValue(spec, item.value, item.block);
    if (read === null) continue;
    if (repeatable(spec.widget) && seen.has(item.key)) {
      // `flag` is written once per flag, `triggered_opinion` once per block;
      // every one joins the same list.
      (state.values[item.key] as string[]).push(...(read as string[]));
    } else {
      state.values[item.key] = read;
    }
    seen.add(item.key);
  }
  return { block, specs: ownSpecs, state };
}

/** The statement(s) one field's value becomes, or [] when it writes nothing. */
export function fieldLines(spec: TraitFieldSpec, value: FieldValue): string[] {
  switch (spec.widget) {
    case "number":
      return value === null || value === "" ? [] : [`${spec.key} = ${value}`];
    case "bool":
      return value === null ? [] : [`${spec.key} = ${value ? "yes" : "no"}`];
    case "multiRef": {
      const list = value as string[];
      return list.length === 0 ? [] : [`${spec.key} = { ${list.join(" ")} }`];
    }
    case "chips":
      return (value as string[]).map((flag) => `${spec.key} = ${flag}`);
    case "refRows": {
      const rows = (value as ModifierRow[]).filter((row) => row.name.trim() !== "");
      if (rows.length === 0) return [];
      const body = rows.map((row) => `\t${row.name} = ${row.value}`).join("\n");
      return [`${spec.key} = {\n${body}\n}`];
    }
    case "script":
      // One statement per entry, so a repeated block key writes back the way
      // the file has it.
      return (value as string[])
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => `${spec.key} = ${entry}`);
    case "icon": {
      const text = String(value).trim();
      // Vanilla writes the bare file name (00_traits.txt: `icon = reveler.dds`).
      return text === "" ? [] : [`${spec.key} = ${quoteIfNeeded(text)}`];
    }
    default: {
      const text = String(value).trim();
      return text === "" ? [] : [`${spec.key} = ${quoteIfNeeded(text)}`];
    }
  }
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/**
 * What the block should say now. A field whose value still equals the one the
 * file was read with is reported unchanged, so `writeBlock` keeps its span and
 * a save touches only the lines the modder actually edited.
 */
export function traitWrites(
  specs: readonly TraitFieldSpec[],
  state: TraitState,
  baseline: TraitState | null
): BlockWrite[] {
  const writes: BlockWrite[] = [];
  for (const spec of specs) {
    const value = state.values[spec.key];
    const was = baseline ? baseline.values[spec.key] : undefined;
    writes.push({
      key: spec.key,
      lines: fieldLines(spec, value),
      changed: baseline === null || !sameValue(value, was as FieldValue),
    });
  }
  // Modifier rows are one statement each, so each is its own write; a row the
  // modder deleted becomes an empty write, which removes its line.
  const before = new Map((baseline?.modifiers ?? []).map((row) => [row.name, row.value]));
  const now = new Map<string, number>();
  for (const row of state.modifiers) {
    if (row.name.trim() !== "") now.set(row.name, row.value);
  }
  for (const [name, value] of now) {
    writes.push({ key: name, lines: [`${name} = ${value}`], changed: before.get(name) !== value });
  }
  for (const [name] of before) {
    if (!now.has(name)) writes.push({ key: name, lines: [], changed: true });
  }
  return writes;
}

/** One `triggered_opinion = { … }` block, as the preview reads it. */
export interface TriggeredOpinion {
  /** What `opinion_modifier = …` names; "" when the block names none yet. */
  modifier: string;
  /**
   * Every other statement of the block, as the file writes it. `_traits.info`
   * documents them as the conditions the opinion is applied under
   * (`parameter`, `same_faith`, `same_dynasty`, `male_only`, …), so they are
   * shown rather than interpreted.
   */
  conditions: string[];
}

const OPINION_MODIFIER_KEY = "opinion_modifier";

/** The blocks a `triggered_opinion` field holds, read for the preview. */
export function readTriggeredOpinions(values: readonly string[]): TriggeredOpinion[] {
  const out: TriggeredOpinion[] = [];
  for (const raw of values) {
    const inner = innerOf(raw);
    if (inner === null) continue;
    let modifier = "";
    const conditions: string[] = [];
    for (const item of scanItems(inner)) {
      if (item.key === null) continue;
      if (item.key === OPINION_MODIFIER_KEY) modifier = item.value;
      else conditions.push(`${item.key} ${item.op ?? "="} ${item.value}`);
    }
    out.push({ modifier, conditions });
  }
  return out;
}

/** The loc pairs a save writes: `locPatterns` with `$` replaced by the name. */
export function locKeys(form: DefinitionForm, name: string): string[] {
  return form.locPatterns.map((pattern) => locKeyFor(pattern, name));
}

/** The definition key rule: lowercase, digits and `_`, starting with a letter. */
export const NAME_RULE = /^[a-z][a-z0-9_]*$/;

export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "A trait needs a name.";
  if (!NAME_RULE.test(name)) {
    return "Use lowercase letters, digits and _, starting with a letter (e.g. px_stoic).";
  }
  return null;
}
