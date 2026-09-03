/**
 * Reading and writing one `name = { ... }` definition block, for the Dynasty
 * Legacy Creator's app.
 *
 * The rule the whole panel hangs off: a form must never cost a modder the
 * parts of their file it does not understand. So a block is read as an ordered
 * list of statements, each carrying its own raw value text, the comment and
 * blank lines in front of it and the comment behind it; the form edits the
 * statements it models and everything else is written back where it was. A
 * block opened and saved with nothing touched comes out byte-identical, and
 * changing one modifier's number changes exactly that one line.
 *
 * The scanner is `../shared/scriptBlock`: it reports every statement with its
 * source span, so the comments and blank lines are the GAPS between the spans.
 * This file turns those gaps into the `before` / `after` a form row carries,
 * which is what a nested modifier block needs and a span rewrite cannot give.
 *
 * The one normalization: CRLF is read as LF and a block is written with LF.
 * `paradox/definitionEdit` retypes the block into the file's own newline
 * before it lands (definitionEdit.ts `toFileNewline`), so nothing here has to
 * carry a file's line ending around.
 *
 * Browser code. No DOM, no host, no game knowledge: which keys exist and what
 * they mean arrives from `paradox/definitionForm`.
 */
import {
  changedProperties as diffValues,
  parseBlock,
  scanItems,
  type ScriptItem,
} from "../../shared/scriptBlock";

export { locKeyFor } from "../../shared/scriptBlock";

/** One `key = value` of a definition body. */
export interface Statement {
  /** Comment and blank source lines directly in front of it, verbatim. */
  before: string[];
  key: string;
  /** The value's source text: `yes`, `blood_legacy_track`, `{ … }`, `"x"`. */
  value: string;
  /** A comment behind the value on the same line, verbatim, or "". */
  after: string;
}

export interface DefBlock {
  name: string;
  /** A comment behind the opening brace (`blood_legacy_1 = { # Noble Veins`). */
  head: string;
  statements: Statement[];
  /** Comment and blank lines between the last statement and the closing brace. */
  tail: string[];
}

/** A value the form contributes; `null` leaves the key out of the block. */
export interface FieldValue {
  key: string;
  value: string | null;
}

type Body = Omit<DefBlock, "name">;

/**
 * A gap between two spans: what is left of the line the previous span ended
 * on, then the whole lines before the next one. The final fragment is the next
 * statement's own indentation, which the writer puts back itself.
 */
function splitGap(gap: string): { rest: string; lines: string[] } {
  const parts = gap.split("\n");
  return { rest: parts[0], lines: parts.slice(1, -1) };
}

/** The comment a line ends on, verbatim from its `#`, or "". */
function commentOf(rest: string): string {
  const text = rest.trimStart();
  return text.startsWith("#") ? text : "";
}

/**
 * The statements of a block body, with the lines around them attached.
 *
 * Null when the body holds something that is not `key = value` (a bare token,
 * a stray brace): the form has nowhere to put that back, so it declines the
 * whole block rather than dropping part of it.
 */
function readBody(body: string, items: readonly ScriptItem[]): Body | null {
  const statements: Statement[] = [];
  let head = "";
  let cursor = 0;
  for (const item of items) {
    if (item.key === null || item.op !== "=") return null;
    const gap = splitGap(body.slice(cursor, item.start));
    if (statements.length === 0) head = commentOf(gap.rest);
    else statements[statements.length - 1].after = commentOf(gap.rest);
    statements.push({ before: gap.lines, key: item.key, value: item.value, after: "" });
    cursor = item.end;
  }
  const end = splitGap(body.slice(cursor));
  if (statements.length === 0) head = commentOf(end.rest);
  else statements[statements.length - 1].after = commentOf(end.rest);
  return { head, statements, tail: end.lines };
}

/**
 * The block `name = { … }` in `text`, or null when the text is not one. The
 * form request answers with exactly this shape (`DefinitionForm.current.text`).
 */
export function parseDefBlock(source: string): DefBlock | null {
  const block = parseBlock(source.replace(/\r\n/g, "\n"));
  if (!block) return null;
  const body = readBody(block.body, block.items);
  return body === null ? null : { name: block.name, ...body };
}

/** An empty definition of `name`, ready for the form's answers. */
export function newDefBlock(name: string): DefBlock {
  return { name, head: "", statements: [], tail: [] };
}

/** The block's source: one tab per body line, LF, the closing brace unindented. */
export function writeDefBlock(def: DefBlock): string {
  const lines: string[] = [`${def.name} = {${def.head ? " " + def.head : ""}`];
  for (const st of def.statements) {
    for (const line of st.before) lines.push(line);
    lines.push(`\t${st.key} = ${st.value}${st.after ? " " + st.after : ""}`);
  }
  for (const line of def.tail) lines.push(line);
  lines.push("}");
  return lines.join("\n");
}

/** The last value written for `key` (the engine's own last-in-wins), or null. */
export function valueOf(def: DefBlock, key: string): string | null {
  for (let i = def.statements.length - 1; i >= 0; i--) {
    if (def.statements[i].key === key) return def.statements[i].value;
  }
  return null;
}

/**
 * Put the form's answers into a block. A key the block already has keeps its
 * place, its comments and its trailing comment; a key it does not have is
 * inserted where `order` (the harvest's own key order) puts it; a `null` value
 * removes the key and hands its leading comment lines to whatever followed it.
 */
export function applyValues(
  def: DefBlock,
  values: readonly FieldValue[],
  order: readonly string[]
): DefBlock {
  const statements = def.statements.map((st) => ({ ...st, before: [...st.before] }));
  let tail = [...def.tail];
  const rank = (key: string): number => {
    const at = order.indexOf(key);
    return at < 0 ? order.length : at;
  };
  for (const { key, value } of values) {
    let at = -1;
    for (let i = statements.length - 1; i >= 0; i--) {
      if (statements[i].key === key) {
        at = i;
        break;
      }
    }
    if (value === null) {
      if (at < 0) continue;
      const orphan = statements[at].before;
      statements.splice(at, 1);
      if (orphan.length > 0) {
        if (at < statements.length) statements[at].before = [...orphan, ...statements[at].before];
        else tail = [...orphan, ...tail];
      }
      continue;
    }
    if (at >= 0) {
      statements[at] = { ...statements[at], value };
      continue;
    }
    let insert = statements.length;
    for (let i = 0; i < statements.length; i++) {
      if (rank(statements[i].key) > rank(key)) {
        insert = i;
        break;
      }
    }
    statements.splice(insert, 0, { before: [], key, value, after: "" });
  }
  return { ...def, statements, tail };
}

/**
 * The `setProperties` list for an edit: only the keys whose value actually
 * moved, so a save of an untouched form writes nothing at all.
 */
export function changedProperties(
  original: DefBlock,
  next: DefBlock,
  keys: readonly string[]
): { key: string; value: string | null }[] {
  const valuesOf = (def: DefBlock): Map<string, string | null> =>
    new Map(keys.map((key) => [key, valueOf(def, key)]));
  return diffValues(valuesOf(original), valuesOf(next));
}

// ---------------------------------------------------------------------------
// name = number blocks (character_modifier, doctrine_character_modifier, traits)
// ---------------------------------------------------------------------------

/**
 * One entry of a `name = number` block. `raw` is the number's source text, so
 * a block read and written untouched keeps `0.30` instead of turning it into
 * `0.3`. Anything the row form cannot hold (`name = blood_legacy_1_modifier`,
 * `doctrine = …`, a comment) stays a `raw` entry in its own place.
 */
export type ModifierEntry =
  { kind: "row"; name: string; value: number; raw: string } | { kind: "raw"; text: string };

/** Read a `{ name = number … }` value. A value that is not a block reads empty. */
export function parseModifierBlock(value: string): ModifierEntry[] {
  const text = value.replace(/\r\n/g, "\n");
  if (!text.startsWith("{")) return [];
  const inner = text.slice(1, text.lastIndexOf("}"));
  const body = readBody(inner, scanItems(inner));
  // Not a statement list: hold the source as one uneditable entry rather than
  // dropping what the modder wrote.
  if (body === null) return [{ kind: "raw", text: inner.trim() }];
  const entries: ModifierEntry[] = [];
  const keep = (lines: readonly string[]): void => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed !== "") entries.push({ kind: "raw", text: trimmed });
    }
  };
  if (body.head !== "") entries.push({ kind: "raw", text: body.head });
  for (const st of body.statements) {
    keep(st.before);
    const number = Number(st.value);
    if (st.value !== "" && Number.isFinite(number) && st.after === "") {
      entries.push({ kind: "row", name: st.key, value: number, raw: st.value });
    } else {
      entries.push({ kind: "raw", text: `${st.key} = ${st.value}${st.after ? " " + st.after : ""}` });
    }
  }
  keep(body.tail);
  return entries;
}

/** The rows a modifier field shows, in block order. */
export function modifierRows(entries: readonly ModifierEntry[]): { name: string; value: number }[] {
  return entries
    .filter((e): e is Extract<ModifierEntry, { kind: "row" }> => e.kind === "row")
    .map((e) => ({ name: e.name, value: e.value }));
}

/**
 * The field's rows back into the block, keeping every `raw` entry where it
 * was. A row whose name and number did not move keeps its source text.
 */
export function updateModifierRows(
  entries: readonly ModifierEntry[],
  rows: readonly { name: string; value: number }[]
): ModifierEntry[] {
  const out: ModifierEntry[] = [];
  let next = 0;
  for (const entry of entries) {
    if (entry.kind === "raw") {
      out.push(entry);
      continue;
    }
    const row = rows[next++];
    if (!row) continue;
    out.push(
      row.name === entry.name && row.value === entry.value
        ? entry
        : { kind: "row", name: row.name, value: row.value, raw: String(row.value) }
    );
  }
  for (; next < rows.length; next++) {
    out.push({ kind: "row", name: rows[next].name, value: rows[next].value, raw: String(rows[next].value) });
  }
  return out;
}

/** The block source for a modifier block, or null when it holds nothing. */
export function writeModifierBlock(entries: readonly ModifierEntry[]): string | null {
  const lines = entries
    .filter((e) => e.kind === "raw" || e.name.trim() !== "")
    .map((e) => (e.kind === "raw" ? e.text : `${e.name} = ${e.raw}`));
  if (lines.length === 0) return null;
  return `{\n${lines.map((l) => `\t\t${l}`).join("\n")}\n\t}`;
}

/**
 * What a script text area contributes: the modder's own braces when they wrote
 * them, ours around their body when they did not, and null when it is empty.
 * Not validation — the shape only, so a typed `has_trait = brave` does not
 * land as `is_shown = has_trait = brave`.
 */
export function wrapBlockValue(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("{")) return trimmed.replace(/\r\n/g, "\n");
  const body = trimmed
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `\t\t${line.trim()}`)
    .join("\n");
  return `{\n${body}\n\t}`;
}

// ---------------------------------------------------------------------------
// The two lines a modifier block carries that are not modifiers
// ---------------------------------------------------------------------------

/**
 * `_dynasty_perks.info`: a `doctrine_character_modifier` block opens with
 * `doctrine = doctrine_theocracy_lay_clergy`, which is the CONDITION and not a
 * modifier. It comes out of the entry list so the form can offer it as its own
 * picker, and goes back into the same place on save.
 */
export function doctrineOf(entries: readonly ModifierEntry[]): string {
  for (const entry of entries) {
    if (entry.kind !== "raw") continue;
    const match = /^doctrine\s*=\s*([^\s#]+)/.exec(entry.text);
    if (match) return match[1];
  }
  return "";
}

/** The entries with their `doctrine =` line set, added at the top, or removed. */
export function withDoctrine(entries: readonly ModifierEntry[], value: string): ModifierEntry[] {
  const trimmed = value.trim();
  const out: ModifierEntry[] = [];
  let replaced = false;
  for (const entry of entries) {
    const isDoctrine = entry.kind === "raw" && /^doctrine\s*=/.test(entry.text);
    if (!isDoctrine) {
      out.push(entry);
      continue;
    }
    if (trimmed !== "" && !replaced) {
      out.push({ kind: "raw", text: `doctrine = ${trimmed}` });
      replaced = true;
    }
  }
  if (trimmed !== "" && !replaced) out.unshift({ kind: "raw", text: `doctrine = ${trimmed}` });
  return out;
}

/**
 * The loc key a perk's `effect` block prints, when it writes one.
 *
 * Measured in 00_dynasty_perks.txt: blood_legacy_4's effect is nothing but
 * `custom_description_no_bullet = { text = blood_legacy_4_effect }`, and that
 * loc value IS the sentence the game shows on the perk. Any
 * `custom_description*` wrapper reads the same way, so the prefix is matched
 * rather than the one name.
 */
export function effectLocKey(effect: string): string | null {
  const match = /custom_description[a-z_]*\s*=\s*\{[^{}]*?\btext\s*=\s*"?([A-Za-z0-9_.]+)"?/.exec(effect);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// The blocks a modder should not have to type: conditions, tooltips, chances
// ---------------------------------------------------------------------------

/**
 * The three trigger names the builders draw a row for. They are the game's own
 * words, but nothing here assumes they exist: a row is only offered for a
 * trigger `DefinitionForm.conditions` answered with a value list, and a block
 * the grammar below cannot hold stays raw script.
 *
 * Measured (CK3 1.19.0.6): all 14 `is_shown` blocks of the game's 21 dynasty
 * legacy tracks open with `has_dlc_feature`, 10 of them wrapping the rest in
 * `OR = { has_game_rule = … }`; of the 105 dynasty perks' 54 `can_be_picked`
 * blocks, 10 are `has_dlc_feature = <feature>` and 44 are
 * `<scripted trigger> = yes`.
 */
export const DLC_TRIGGER = "has_dlc_feature";
export const RULE_TRIGGER = "has_game_rule";
export const SCRIPTED_TRIGGERS = "scripted_trigger";

/** One row of a condition builder. */
export type Condition =
  /** `has_dlc_feature = <feature>`. */
  | { kind: "dlc"; value: string }
  /** `OR = { has_game_rule = a  has_game_rule = b }`: any one of the rules. */
  | { kind: "rules"; values: string[] }
  /** `<scripted trigger> = yes|no`. */
  | { kind: "trigger"; name: string; value: boolean };

/** The statements of a `{ … }` value, or null when it is not a statement list. */
function bodyOf(value: string): Body | null {
  const text = value.replace(/\r\n/g, "\n");
  if (!text.startsWith("{")) return null;
  const inner = text.slice(1, text.lastIndexOf("}"));
  return readBody(inner, scanItems(inner));
}

/** True when a body carries a comment or a stray line no builder can put back. */
function hasProse(body: Body): boolean {
  if (body.head !== "") return true;
  if (body.tail.some((line) => line.trim() !== "")) return true;
  return body.statements.some((st) => st.after !== "" || st.before.some((l) => l.trim() !== ""));
}

function conditionOf(st: Statement): Condition | null {
  if (st.key === DLC_TRIGGER && !st.value.startsWith("{")) return { kind: "dlc", value: st.value };
  if (st.key === "OR") {
    const inner = bodyOf(st.value);
    if (!inner || hasProse(inner) || inner.statements.length === 0) return null;
    if (inner.statements.some((s) => s.key !== RULE_TRIGGER || s.value.startsWith("{"))) return null;
    return { kind: "rules", values: inner.statements.map((s) => s.value) };
  }
  if (st.value === "yes" || st.value === "no") {
    return { kind: "trigger", name: st.key, value: st.value === "yes" };
  }
  return null;
}

/**
 * The rows a trigger block reads as, or null when it holds anything the
 * builder cannot show. Null is the honest answer, not a failure: the form then
 * keeps the block as script and says so (AD-5, nothing is hidden or dropped).
 */
export function parseConditions(value: string): Condition[] | null {
  const body = bodyOf(value);
  if (!body || hasProse(body)) return null;
  const rows: Condition[] = [];
  for (const st of body.statements) {
    const row = conditionOf(st);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
}

/** The block source for a condition list, or null when it says nothing. */
export function writeConditions(rows: readonly Condition[]): string | null {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.kind === "dlc") {
      if (row.value.trim() === "") continue;
      lines.push(`${DLC_TRIGGER} = ${row.value.trim()}`);
    } else if (row.kind === "rules") {
      const values = row.values.map((v) => v.trim()).filter((v) => v !== "");
      if (values.length === 0) continue;
      lines.push("OR = {");
      for (const value of values) lines.push(`\t${RULE_TRIGGER} = ${value}`);
      lines.push("}");
    } else {
      if (row.name.trim() === "") continue;
      lines.push(`${row.name.trim()} = ${row.value ? "yes" : "no"}`);
    }
  }
  if (lines.length === 0) return null;
  return `{\n${lines.map((l) => `\t\t${l}`).join("\n")}\n\t}`;
}

/**
 * The wrapper a perk's effect prints its sentence through. Measured over the
 * game's 105 dynasty perks: 74 of the 82 `effect` blocks are nothing BUT these
 * (113 of them in all, 110 written exactly `{ text = <loc key> }`), because the
 * perk's real work happens in an on_action and the effect only says so.
 */
export const TOOLTIP_KEY = "custom_description_no_bullet";

/** The loc keys an effect block prints, in order, or null when it does more. */
export function parseEffectLines(value: string): string[] | null {
  const body = bodyOf(value);
  if (!body || hasProse(body)) return null;
  const keys: string[] = [];
  for (const st of body.statements) {
    if (st.key !== TOOLTIP_KEY) return null;
    const inner = bodyOf(st.value);
    if (!inner || hasProse(inner) || inner.statements.length !== 1) return null;
    const only = inner.statements[0];
    if (only.key !== "text" || only.value.startsWith("{")) return null;
    keys.push(only.value.replace(/^"|"$/g, ""));
  }
  return keys;
}

/** The block source for a list of tooltip lines, or null when it has none. */
export function writeEffectLines(keys: readonly string[]): string | null {
  const wanted = keys.map((key) => key.trim()).filter((key) => key !== "");
  if (wanted.length === 0) return null;
  const lines = wanted.flatMap((key) => [`\t\t${TOOLTIP_KEY} = {`, `\t\t\ttext = ${key}`, "\t\t}"]);
  return `{\n${lines.join("\n")}\n\t}`;
}

/**
 * The number a plain `{ value = N }` chance block carries, or null when the
 * block does more. Measured: 12 of the game's 37 perk `ai_chance` blocks are
 * exactly that; the other 25 add `if = { limit = … multiply = … }` blocks,
 * which stay script.
 */
export function parseChanceValue(value: string): number | null {
  const body = bodyOf(value);
  if (!body || hasProse(body) || body.statements.length !== 1) return null;
  const only = body.statements[0];
  if (only.key !== "value") return null;
  const number = Number(only.value);
  return only.value !== "" && Number.isFinite(number) ? number : null;
}

/** The block source for a plain chance, or null when nothing was given. */
export function writeChanceValue(value: number | null): string | null {
  return value === null ? null : `{\n\t\tvalue = ${value}\n\t}`;
}

/** The loc key the nth tooltip line of a perk gets by default. */
export function effectKeyFor(perk: string, index: number): string {
  return index === 0 ? `${perk}_effect` : `${perk}_effect_${index + 1}`;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The name a track's nth perk gets by default.
 *
 * Measured over the 21 vanilla tracks (2026-09-03): every track key ends in
 * `_track` and 18 of them name their perks `<key without _track>_<n>`
 * (blood_legacy_track -> blood_legacy_1 … blood_legacy_5). The other three
 * shorten the stem (tgp_china_legacy_track -> tgp_chinese_legacy_1), which is
 * why this is a prefilled default and not a rule.
 */
export function perkNameFor(track: string, index: number): string {
  const stem = track.endsWith("_track") ? track.slice(0, -"_track".length) : track;
  return `${stem}_${index + 1}`;
}
