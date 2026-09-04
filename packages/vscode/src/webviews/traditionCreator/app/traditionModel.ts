/**
 * The tradition form as data: which key belongs to which section, which widget
 * it gets, how a loaded block fills them, and what a save writes back.
 *
 * The KEYS are never listed here: they arrive from `paradox/definitionForm`,
 * which for `culture_tradition` is the harvest of the game's own traditions
 * folder. What is listed is the LAYOUT - which of those keys a designed section
 * shows, and in what order - and the layout carries the source it was read
 * from. A key the game adds tomorrow still reaches the panel: it lands in
 * "Advanced" with the widget its own value hint asks for (AD-5: annotate,
 * never hide).
 *
 * `common/culture/_cultural_traits.info` documents the shape both cultural
 * pillars and traditions share (`cost`, the four modifier blocks, `can_pick`,
 * `is_shown`, `parameters`, `ai_will_do`); `common/culture/traditions/
 * _traditions.info` adds the two that are a tradition's own, `category` and
 * `layers`. That is why those two lead the form.
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
  scanItems,
  statementLines,
  type BlockWrite,
  type ParsedBlock,
} from "../../shared/scriptBlock";

export type SectionId = "identity" | "icon" | "cost" | "parameters" | "modifiers" | "rules" | "advanced";

export type WidgetKind =
  "text" | "number" | "bool" | "enum" | "script" | "layers" | "cost" | "parameters" | "modifierBlock";

export interface TraditionFieldSpec {
  key: string;
  section: SectionId;
  widget: WidgetKind;
  doc?: string;
  /** For `enum`: the values the key may take (a schema hint, or what the game writes). */
  values?: string[];
  /** The literal the game itself writes most often: an input's placeholder. */
  example?: string;
  /** Every value the indexed definitions write, when the form sampled them. */
  sampled?: string[];
}

/** `category` and `layers`: what `_traditions.info` adds on top of the shape. */
const IDENTITY = ["category"];
const LAYERS_KEY = "layers";
const COST_KEY = "cost";
const PARAMETERS_KEY = "parameters";

/**
 * The keys `_cultural_traits.info` documents as script blocks: a trigger, a
 * hybridization trigger, a visibility trigger and a weight. They are the form's
 * escape hatch, edited as script with a real vanilla body as the placeholder.
 */
const RULES = ["is_shown", "can_pick", "can_pick_for_hybridization", "ai_will_do"];

/**
 * The order the game itself writes these keys in, measured over every block of
 * game/common/culture/traditions (2026-09, by each key's mean position):
 * `category`, `layers`, the triggers, `parameters`, the modifier blocks,
 * `cost`, and `ai_will_do` last. A new tradition is written that way so it
 * reads like the file it lands in. The PANEL's order is a different question:
 * that one is the sections' (Identity, Icon, Cost, Parameters, …).
 */
const WRITE_FIRST = [
  ...IDENTITY,
  LAYERS_KEY,
  "is_shown",
  "can_pick",
  "can_pick_for_hybridization",
  PARAMETERS_KEY,
];
const WRITE_LAST = [COST_KEY, "ai_will_do"];

/** A modifier block is any key whose name ends this way; the .info documents
 *  character/province/county/doctrine_character and vanilla adds culture. */
const MODIFIER_SUFFIX = "_modifier";

export function isModifierBlockKey(key: string): boolean {
  return key.endsWith(MODIFIER_SUFFIX);
}

/** `enum:a|b` -> the values, or undefined. */
function enumValues(hint: string | undefined): string[] | undefined {
  if (!hint?.startsWith("enum:")) return undefined;
  return hint.slice(5).split("|").filter(Boolean);
}

/**
 * The values a one-of picker offers. `category` has no enum hint (the game
 * documents it as free text: "used for grouping in the Add Tradition view"), so
 * the honest list is the one the indexed traditions actually write, which
 * `sampled` measured; a game patch that adds a category adds it to the picker.
 */
function pickValues(key: DefinitionFormKey): string[] | undefined {
  return enumValues(key.values) ?? (IDENTITY.includes(key.key) ? key.sampled : undefined);
}

function sectionFor(key: string): SectionId {
  if (IDENTITY.includes(key)) return "identity";
  if (key === LAYERS_KEY) return "icon";
  if (key === COST_KEY) return "cost";
  if (key === PARAMETERS_KEY) return "parameters";
  if (isModifierBlockKey(key)) return "modifiers";
  if (RULES.includes(key)) return "rules";
  return "advanced";
}

function widgetFor(key: DefinitionFormKey, section: SectionId): WidgetKind {
  if (key.key === LAYERS_KEY) return "layers";
  if (key.key === COST_KEY) return "cost";
  if (key.key === PARAMETERS_KEY) return "parameters";
  if (isModifierBlockKey(key.key)) return "modifierBlock";
  if (pickValues(key)?.length) return "enum";
  if (key.values === "bool") return "bool";
  if (section === "rules" || key.values === "block") return "script";
  return "text";
}

/** Every key the form answered, placed and given a widget. Nothing is dropped. */
export function traditionFieldSpecs(form: DefinitionForm): TraditionFieldSpec[] {
  const byKey = new Map(form.keys.map((key) => [key.key, key]));
  const ordered: DefinitionFormKey[] = [];
  const last: DefinitionFormKey[] = [];
  const take = (key: string, into: DefinitionFormKey[]): void => {
    const spec = byKey.get(key);
    if (!spec) return;
    into.push(spec);
    byKey.delete(key);
  };
  for (const key of WRITE_FIRST) take(key, ordered);
  for (const key of WRITE_LAST) take(key, last);
  // Everything the game's order says nothing about (the modifier blocks, and
  // any key a patch adds) keeps the harvest's own order, most used first.
  for (const key of form.keys) if (byKey.has(key.key)) ordered.push(key);
  ordered.push(...last);

  return ordered.map((key) => {
    const section = sectionFor(key.key);
    return {
      key: key.key,
      section,
      widget: widgetFor(key, section),
      ...(key.doc ? { doc: key.doc } : {}),
      ...(pickValues(key)?.length ? { values: pickValues(key) } : {}),
      ...(key.example ? { example: key.example } : {}),
      ...(key.sampled?.length ? { sampled: key.sampled } : {}),
    };
  });
}

/** Layer index (as the block writes it) -> the value picked, or "". */
export type LayerPicks = Record<string, string>;
/** Currency -> what the cost writes for it, as script text ("300", "@my_val"). */
export type CostValues = Record<string, string>;

export type FieldValue = string | number | boolean | null | string[] | ModifierRow[] | LayerPicks;

export interface TraditionState {
  /** Per spec key. `null` / `""` / `[]` / `{}` mean the key is not written. */
  values: Record<string, FieldValue>;
}

export interface LoadedTradition {
  block: ParsedBlock;
  state: TraditionState;
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
    case "bool":
      return null;
    case "parameters":
      return [];
    case "modifierBlock":
      return [];
    case "layers":
    case "cost":
      return {};
    default:
      return "";
  }
}

export function emptyState(specs: readonly TraditionFieldSpec[]): TraditionState {
  const values: Record<string, FieldValue> = {};
  for (const spec of specs) values[spec.key] = emptyValue(spec.widget);
  return { values };
}

/** `{ 0 = martial 1 = western }` -> the picks, or null when it is not that. */
function readIndexed(blockValue: string): LayerPicks | null {
  const inner = innerOf(blockValue);
  if (inner === null) return null;
  const picks: LayerPicks = {};
  for (const item of scanItems(inner)) {
    if (item.key === null || item.op !== "=" || item.block) return null;
    picks[item.key] = item.value;
  }
  return picks;
}

/**
 * `{ prestige = 300 }` -> the values. Every entry is kept as its SOURCE TEXT,
 * because vanilla writes a whole script-value block for a cost far more often
 * than a number (195 of 197, measured) and the form must not turn one into a
 * number field that would eat it. A block value refuses the widget instead.
 */
function readCost(blockValue: string): CostValues | null {
  const inner = innerOf(blockValue);
  if (inner === null) return null;
  const values: CostValues = {};
  for (const item of scanItems(inner)) {
    if (item.key === null || item.op !== "=" || item.block) return null;
    values[item.key] = item.value;
  }
  return values;
}

/**
 * `{ can_raid = yes }` -> the names. A parameter the game gives a NUMBER
 * (`number_of_spouses = 4`, 9 of 743 entries measured) is not a switch, so the
 * whole block refuses the widget and the file keeps it.
 */
function readParameters(blockValue: string): string[] | null {
  const inner = innerOf(blockValue);
  if (inner === null) return null;
  const names: string[] = [];
  for (const item of scanItems(inner)) {
    if (item.key === null || item.op !== "=" || item.block || item.value !== "yes") return null;
    names.push(item.key);
  }
  return names;
}

/** What a widget can make of one statement's value text, or null when it cannot. */
function readValue(spec: TraditionFieldSpec, value: string, block: boolean): FieldValue | null {
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
    case "layers":
      return block ? readIndexed(value) : null;
    case "cost":
      return block ? readCost(value) : null;
    case "parameters":
      return block ? readParameters(value) : null;
    case "modifierBlock":
      return block ? readNumberRows(value) : null;
    case "script":
      // A script field holds the value's own source, block braces included.
      return value;
    default:
      return block ? null : (readQuoted(value) ?? value);
  }
}

/**
 * Fill the form from a definition's own text. A statement a widget cannot
 * stand for is not forced into one: its key goes to `verbatim` and the source
 * span is what a save writes back. A key the form never heard of is left out
 * of both, so `writeBlock` copies its span untouched.
 */
export function loadTradition(specs: readonly TraditionFieldSpec[], text: string): LoadedTradition | null {
  const block = parseBlock(text);
  if (!block) return null;
  const bySpec = new Map(specs.map((spec) => [spec.key, spec]));
  const state = emptyState(specs);
  const verbatim = new Set<string>();

  for (const item of block.items) {
    if (item.key === null || item.op !== "=") continue;
    const spec = bySpec.get(item.key);
    if (!spec) continue; // not a key this form models; the file keeps it
    const read = readValue(spec, item.value, item.block);
    if (read === null) verbatim.add(item.key);
    else state.values[item.key] = read;
  }
  // A key written twice cannot be edited as one field without losing the other
  // statement: keep both, verbatim.
  for (const key of countedTwice(block, bySpec)) verbatim.add(key);
  for (const key of verbatim) state.values[key] = emptyValue(bySpec.get(key)!.widget);
  return { block, state, verbatim };
}

function countedTwice(block: ParsedBlock, bySpec: Map<string, TraditionFieldSpec>): string[] {
  const counts = new Map<string, number>();
  for (const item of block.items) {
    if (item.key === null || !bySpec.has(item.key)) continue;
    counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([key]) => key);
}

/** `key = { … }` with one statement per line, at the block's indentation. */
function nestedBlock(key: string, lines: readonly string[], indent = "\t"): string[] {
  if (lines.length === 0) return [];
  return [`${key} = {`, ...lines.map((line) => indent + line), `}`];
}

/** The statement(s) one field's value becomes, or [] when it writes nothing. */
export function fieldLines(spec: TraditionFieldSpec, value: FieldValue): string[] {
  switch (spec.widget) {
    case "number":
      return value === null || value === "" ? [] : [`${spec.key} = ${value}`];
    case "bool":
      return value === null ? [] : [`${spec.key} = ${value ? "yes" : "no"}`];
    case "layers": {
      const picks = value as LayerPicks;
      // Index order, as the engine reads them.
      const rows = Object.keys(picks)
        .filter((index) => picks[index] !== "")
        .sort((a, b) => Number(a) - Number(b))
        .map((index) => `${index} = ${picks[index]}`);
      return nestedBlock(spec.key, rows);
    }
    case "cost": {
      const costs = value as CostValues;
      const rows = Object.keys(costs)
        .filter((currency) => costs[currency].trim() !== "")
        .map((currency) => `${currency} = ${costs[currency].trim()}`);
      return nestedBlock(spec.key, rows);
    }
    case "parameters": {
      // `_cultural_traits.info`: "param_name = yes/no"; the switches a form
      // offers are the ones a tradition turns ON.
      const rows = (value as string[]).map((name) => `${name} = yes`);
      return nestedBlock(spec.key, rows);
    }
    case "modifierBlock": {
      const rows = (value as ModifierRow[])
        .filter((row) => row.name.trim() !== "")
        .map((row) => `${row.name} = ${row.value}`);
      return nestedBlock(spec.key, rows);
    }
    case "script": {
      // One statement over several lines. Handed to `writeBlock` as one string
      // it kept only its first line indented, so the body and the closing brace
      // landed at column 0; `statementLines` gives the writer the lines to
      // indent while keeping the shape the modder typed.
      const text = String(value).trim();
      return text === "" ? [] : statementLines(`${spec.key} = ${text}`);
    }
    default: {
      const text = String(value).trim();
      return text === "" ? [] : [`${spec.key} = ${quoteIfNeeded(text)}`];
    }
  }
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What the block should say now. A field whose value still equals the one the
 * file was read with is reported unchanged, so `writeBlock` keeps its span and
 * a save touches only the lines the modder actually edited.
 */
export function traditionWrites(
  specs: readonly TraditionFieldSpec[],
  state: TraditionState,
  baseline: TraditionState | null,
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
  return writes;
}

/** The loc pairs a save writes: `locPatterns` with `$` replaced by the name. */
export function locKeys(form: DefinitionForm, name: string): string[] {
  return form.locPatterns.map((pattern) => locKeyFor(pattern, name));
}

/** The definition key rule: lowercase, digits and `_`, starting with a letter. */
export const NAME_RULE = /^[a-z][a-z0-9_]*$/;

export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "A tradition needs a name.";
  if (!NAME_RULE.test(name)) {
    return "Use lowercase letters, digits and _, starting with a letter (e.g. tradition_px_seafarers).";
  }
  return null;
}
