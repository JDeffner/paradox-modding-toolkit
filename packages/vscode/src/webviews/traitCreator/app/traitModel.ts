/**
 * The trait form as data: which key belongs to which section, which widget it
 * gets, how a loaded block fills them, and what a save writes back.
 *
 * The KEYS are never listed here: they arrive from `paradox/definitionForm`,
 * which reads the harvest of `common/traits/_traits.info`. What is listed is
 * the LAYOUT - which of those keys a designed section shows, and in what
 * order - and the layout carries the source it was read from. A key the game
 * adds tomorrow still reaches the panel: it lands in "Other keys" with the
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
  parseBlock,
  quoteIfNeeded,
  readNumber,
  readNumberRows,
  readQuoted,
  readTokenList,
  type BlockWrite,
  type ParsedBlock,
} from "./script";

export type SectionId = "identity" | "look" | "stats" | "relations" | "ai" | "other";

export type WidgetKind =
  "text" | "number" | "bool" | "enum" | "script" | "multiRef" | "refRows" | "chips" | "icon";

export interface TraitFieldSpec {
  key: string;
  section: SectionId;
  widget: WidgetKind;
  doc?: string;
  /** For `enum`: the values the schema's hint carries. */
  values?: string[];
  /** For `multiRef` / `refRows`: the option list to pick from. */
  refKind?: string;
}

/**
 * Identity: `_traits.info`'s "=== Trait Properties ===", "### Trait
 * validation", "### Trait generation", "### Groups" and "### Misc properties",
 * in the order a modder answers them (what it is, who may have it, how it is
 * handed out).
 */
const IDENTITY = [
  "category",
  "valid_sex",
  "minimum_age",
  "maximum_age",
  "group",
  "level",
  "physical",
  "genetic",
  "good",
  "birth",
  "random_creation",
  "inherit_chance",
  "shown_in_ruler_designer",
  "ruler_designer_cost",
];

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
 * Stats and opinions: the modifier-shaped keys vanilla traits use most.
 * `same_opinion`, `same_opinion_if_same_faith` and `opposite_opinion` are
 * `_traits.info`'s "### Special opinion impacts"; the six skills, `health` and
 * `attraction_opinion` are the catch-all modifiers of the same file, verified
 * as plain integers in `00_traits.txt` (brave: `martial = 2`, `prowess = 3`,
 * `attraction_opinion = 10`, `same_opinion = 10`, `opposite_opinion = -10`).
 */
const STATS = [
  "diplomacy",
  "martial",
  "stewardship",
  "intrigue",
  "learning",
  "prowess",
  "health",
  "same_opinion",
  "same_opinion_if_same_faith",
  "opposite_opinion",
  "attraction_opinion",
];

/** `_traits.info`'s "### Trait relations" plus the flag of "### Misc properties". */
const RELATIONS = ["opposites", "compatibility", "flag"];

/** The one key of the Look section that lives in the block (the rest is loc). */
const ICON_KEY = "icon";

/** `enum:all|male|female` -> the values, or undefined. */
function enumValues(hint: string | undefined): string[] | undefined {
  if (!hint?.startsWith("enum:")) return undefined;
  return hint.slice(5).split("|").filter(Boolean);
}

function widgetFor(key: DefinitionFormKey, section: SectionId): WidgetKind {
  if (key.key === ICON_KEY) return "icon";
  if (key.key === "opposites") return "multiRef";
  if (key.key === "compatibility") return "refRows";
  if (key.key === "flag") return "chips";
  if (enumValues(key.values)) return "enum";
  if (key.values === "bool") return "bool";
  if (section === "stats" || NUMERIC.has(key.key)) return "number";
  if (key.values === "block") return "script";
  return "text";
}

function sectionFor(key: string): SectionId {
  if (key === ICON_KEY) return "look";
  if (IDENTITY.includes(key)) return "identity";
  if (STATS.includes(key)) return "stats";
  if (RELATIONS.includes(key)) return "relations";
  if (key.startsWith("ai_")) return "ai";
  return "other";
}

/** Every key the form answered, placed and given a widget. Nothing is dropped. */
export function traitFieldSpecs(form: DefinitionForm): TraitFieldSpec[] {
  const byKey = new Map(form.keys.map((key) => [key.key, key]));
  const ordered: DefinitionFormKey[] = [];
  // The designed sections read in their own order; the rest keep the harvest's
  // (most used first), which is the order the form arrived in.
  for (const key of [...IDENTITY, ICON_KEY, ...STATS, ...RELATIONS]) {
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
      ...(enumValues(key.values) ? { values: enumValues(key.values) } : {}),
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
  state: TraitState;
  /**
   * Keys whose statement no widget can stand for, so the file keeps the last
   * word: they are written back byte for byte and the panel says so rather
   * than showing an empty field that would silently add a second statement.
   */
  verbatim: Set<string>;
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
      return [];
    case "refRows":
      return [];
    default:
      return "";
  }
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
      return spec.values?.includes(value) ? value : null;
    case "multiRef":
      return block ? readTokenList(value) : null;
    case "refRows":
      return block ? readNumberRows(value) : null;
    case "chips":
      return block ? null : [value];
    case "icon":
      return block ? null : (readQuoted(value) ?? value);
    case "script":
      return value;
    default:
      return block ? null : (readQuoted(value) ?? value);
  }
}

/**
 * Fill the form from a definition's own text. A statement a widget cannot
 * stand for is not forced into one: its key goes to `verbatim` and the source
 * span is what a save writes back.
 */
export function loadTrait(
  specs: readonly TraitFieldSpec[],
  text: string,
  modifierNames: ReadonlySet<string>
): LoadedTrait | null {
  const block = parseBlock(text);
  if (!block) return null;
  const bySpec = new Map(specs.map((spec) => [spec.key, spec]));
  const state = emptyState(specs);
  const verbatim = new Set<string>();
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
    if (read === null) {
      verbatim.add(item.key);
      continue;
    }
    if (spec.widget === "chips" && seen.has(item.key)) {
      // `flag` is written once per flag; every one joins the same chip list.
      (state.values[item.key] as string[]).push(...(read as string[]));
    } else {
      state.values[item.key] = read;
    }
    seen.add(item.key);
  }
  // A key that appears twice but is not repeatable cannot be edited as one
  // field without losing the other statement: keep both, verbatim.
  for (const key of countedTwice(block, bySpec)) {
    const spec = bySpec.get(key)!;
    if (spec.widget === "chips") continue;
    verbatim.add(key);
    state.values[key] = emptyValue(spec.widget);
  }
  for (const key of verbatim) state.values[key] = emptyValue(bySpec.get(key)!.widget);
  return { block, state, verbatim };
}

function countedTwice(block: ParsedBlock, bySpec: Map<string, TraitFieldSpec>): string[] {
  const counts = new Map<string, number>();
  for (const item of block.items) {
    if (item.key === null || !bySpec.has(item.key)) continue;
    counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([key]) => key);
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
    case "script": {
      const text = String(value).trim();
      return text === "" ? [] : [`${spec.key} = ${text}`];
    }
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
  baseline: TraitState | null,
  verbatim: ReadonlySet<string> = new Set()
): BlockWrite[] {
  const writes: BlockWrite[] = [];
  for (const spec of specs) {
    if (verbatim.has(spec.key)) continue;
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

/** The loc pairs a save writes: `locPatterns` with `$` replaced by the name. */
export function locKeys(form: DefinitionForm, name: string): string[] {
  return form.locPatterns.map((pattern) => pattern.replace("$", name));
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
