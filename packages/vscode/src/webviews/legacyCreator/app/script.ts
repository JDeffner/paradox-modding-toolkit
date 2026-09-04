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
import { parseBlock, scanItems, type ScriptItem } from "../../shared/scriptBlock";

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
 * EVERY value written for `key`, in file order.
 *
 * Most keys are last-in-wins, but a few are a list the engine reads whole:
 * `doctrine_character_modifier` is written once per doctrine, and the game's
 * own erudition_legacy_4 carries three of them
 * (00_dynasty_perks.txt, measured). `valueOf` would show a modder one.
 */
export function valuesOf(def: DefBlock, key: string): string[] {
  return def.statements.filter((st) => st.key === key).map((st) => st.value);
}

/**
 * Put a repeated key's whole list back. The occurrences the block already has
 * keep their place and their comments; extra ones are appended right after the
 * last of them (or at `order`'s rank when the block had none), and occurrences
 * the form no longer has are removed the way `applyValues` removes a key.
 */
export function applyRepeated(
  def: DefBlock,
  key: string,
  values: readonly string[],
  order: readonly string[]
): DefBlock {
  const statements = def.statements.map((st) => ({ ...st, before: [...st.before] }));
  let tail = [...def.tail];
  const at = statements.flatMap((st, i) => (st.key === key ? [i] : []));

  // The ones the block already has, rewritten in place.
  const kept = Math.min(at.length, values.length);
  for (let i = 0; i < kept; i++) statements[at[i]] = { ...statements[at[i]], value: values[i] };

  // The ones it no longer has, removed from the back so the indexes hold.
  for (let i = at.length - 1; i >= kept; i--) {
    const index = at[i];
    const orphan = statements[index].before;
    statements.splice(index, 1);
    if (orphan.length > 0) {
      if (index < statements.length) statements[index].before = [...orphan, ...statements[index].before];
      else tail = [...orphan, ...tail];
    }
  }

  // The new ones, after the last that was kept, else where the key belongs.
  if (values.length > kept) {
    const rank = (k: string): number => {
      const found = order.indexOf(k);
      return found < 0 ? order.length : found;
    };
    let insert = kept > 0 ? at[kept - 1] + 1 : statements.length;
    if (kept === 0) {
      for (let i = 0; i < statements.length; i++) {
        if (rank(statements[i].key) > rank(key)) {
          insert = i;
          break;
        }
      }
    }
    const fresh = values.slice(kept).map((value) => ({ before: [], key, value, after: "" }));
    statements.splice(insert, 0, ...fresh);
  }
  return { ...def, statements, tail };
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
 * Two values that say the same thing to the game.
 *
 * A builder writes the block its own way: a file's one-line
 * `is_shown = { has_dlc_feature = x }` comes back out of the condition builder
 * as three indented lines. That is a change in the text and none in the
 * script, and reporting it made a save rewrite a line the modder never
 * touched. A value carrying a `#` is compared verbatim instead, because a
 * newline ENDS a comment and folding it away would read the line behind it as
 * part of the comment.
 */
function sameScript(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.includes("#") || b.includes("#")) return false;
  const flat = (text: string): string => text.replace(/\s+/g, " ").trim();
  return flat(a) === flat(b);
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
  const out: { key: string; value: string | null }[] = [];
  for (const key of new Set(keys)) {
    const value = valueOf(next, key);
    if (!sameScript(valueOf(original, key), value)) out.push({ key, value });
  }
  return out;
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

/**
 * What a modifier block contributes to the save: the block the rows write, or
 * the one the file already had when the rows write nothing.
 *
 * An empty block is not a missing key. `tgp_chinese_legacy_3` and
 * `tgp_chinese_legacy_4` both carry `character_modifier = { }` with a tab-only
 * line inside (08_tgp_dynasty_perks.txt, measured 2026-09-04), and dropping the
 * key on save would be an edit the modder never made.
 */
export function modifierBlockValue(
  entries: readonly ModifierEntry[],
  rows: readonly { name: string; value: number }[],
  previous: string | null
): string | null {
  return writeModifierBlock(updateModifierRows(entries, rows)) ?? previous;
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
  return withLine(entries, "doctrine", value);
}

/**
 * The other line a modifier block carries that is not a modifier: `name =`,
 * the loc key the game heads the modifier group with. Measured in
 * 00_dynasty_perks.txt: erudition_legacy_2 and erudition_legacy_4 write
 * `name = <perk>_modifier_name` on every one of their doctrine blocks.
 */
export function modifierNameOf(entries: readonly ModifierEntry[]): string {
  for (const entry of entries) {
    if (entry.kind !== "raw") continue;
    const match = /^name\s*=\s*([^\s#]+)/.exec(entry.text);
    if (match) return match[1].replace(/^"|"$/g, "");
  }
  return "";
}

/** The entries with their `name =` line set, added at the top, or removed. */
export function withModifierName(entries: readonly ModifierEntry[], value: string): ModifierEntry[] {
  return withLine(entries, "name", value);
}

/** One `key = value` line of a modifier block, replaced where it is or put first. */
function withLine(entries: readonly ModifierEntry[], key: string, value: string): ModifierEntry[] {
  const trimmed = value.trim();
  const test = new RegExp(`^${key}\\s*=`);
  const out: ModifierEntry[] = [];
  let replaced = false;
  for (const entry of entries) {
    if (!(entry.kind === "raw" && test.test(entry.text))) {
      out.push(entry);
      continue;
    }
    if (trimmed !== "" && !replaced) {
      out.push({ kind: "raw", text: `${key} = ${trimmed}` });
      replaced = true;
    }
  }
  if (trimmed !== "" && !replaced) out.unshift({ kind: "raw", text: `${key} = ${trimmed}` });
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

/**
 * The statements of a `{ … }` value, or null when it is not a statement list.
 *
 * Empty is not "not a block": a field the modder never filled in, and a script
 * area they cleared, both read as a body with no statements. Without that an
 * empty "Advanced: script" area could never go back to its builder, since
 * every builder asks this first.
 */
export function bodyOf(value: string): Body | null {
  const text = value.replace(/\r\n/g, "\n");
  if (text.trim() === "") return { head: "", statements: [], tail: [] };
  if (!text.startsWith("{")) return null;
  const inner = text.slice(1, text.lastIndexOf("}"));
  return readBody(inner, scanItems(inner));
}

/**
 * What a builder's reader answers: the rows, or the first source line it could
 * not read. The line is what the note under the script area shows, because
 * "this block does more than the rows can show" without naming the line leaves
 * a modder hunting through their own script.
 */
export type ReadResult<T> = { ok: true; value: T } | { ok: false; line: string };

/** The first line of a text that says something, trimmed, for a note. */
function firstLine(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/** One statement as a note shows it: its own line, never the whole block. */
function statementLine(st: Statement): string {
  const value = firstLine(st.value);
  return `${st.key} = ${st.value.includes("\n") ? `${value} …` : value}`;
}

/** The first line of a body that carries prose no builder can put back. */
function proseLine(body: Body): string {
  if (body.head !== "") return body.head;
  for (const st of body.statements) {
    const before = st.before.find((line) => line.trim() !== "");
    if (before) return before.trim();
    if (st.after !== "") return `${st.key} = ${firstLine(st.value)} ${st.after}`;
  }
  return body.tail.find((line) => line.trim() !== "")?.trim() ?? "";
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
  const read = readConditions(value);
  return read.ok ? read.value : null;
}

/** `parseConditions` with the line it stopped on, for the note under the area. */
export function readConditions(value: string): ReadResult<Condition[]> {
  const body = bodyOf(value);
  if (!body) return { ok: false, line: firstLine(value) };
  if (hasProse(body)) return { ok: false, line: proseLine(body) };
  const rows: Condition[] = [];
  for (const st of body.statements) {
    const row = conditionOf(st);
    if (!row) return { ok: false, line: statementLine(st) };
    rows.push(row);
  }
  return { ok: true, value: rows };
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
  const read = readEffectLines(value);
  return read.ok ? read.value : null;
}

/** `parseEffectLines` with the line it stopped on. */
export function readEffectLines(value: string): ReadResult<string[]> {
  const body = bodyOf(value);
  if (!body) return { ok: false, line: firstLine(value) };
  if (hasProse(body)) return { ok: false, line: proseLine(body) };
  const keys: string[] = [];
  for (const st of body.statements) {
    if (st.key !== TOOLTIP_KEY) return { ok: false, line: statementLine(st) };
    const inner = bodyOf(st.value);
    if (!inner || hasProse(inner) || inner.statements.length !== 1) {
      return { ok: false, line: statementLine(st) };
    }
    const only = inner.statements[0];
    if (only.key !== "text" || only.value.startsWith("{")) {
      return { ok: false, line: statementLine(only) };
    }
    keys.push(only.value.replace(/^"|"$/g, ""));
  }
  return { ok: true, value: keys };
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
  const read = readChanceValue(value);
  return read.ok ? read.value : null;
}

/** `parseChanceValue` with the line it stopped on. */
export function readChanceValue(value: string): ReadResult<number | null> {
  const body = bodyOf(value);
  if (!body) return { ok: false, line: firstLine(value) };
  if (hasProse(body)) return { ok: false, line: proseLine(body) };
  if (body.statements.length === 0) return { ok: true, value: null };
  if (body.statements.length > 1) return { ok: false, line: statementLine(body.statements[1]) };
  const only = body.statements[0];
  const number = Number(only.value);
  if (only.key !== "value" || only.value === "" || !Number.isFinite(number)) {
    return { ok: false, line: statementLine(only) };
  }
  return { ok: true, value: number };
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

/**
 * The name a NEW perk gets: the first number of the track's own series that no
 * perk on the track uses.
 *
 * Numbering off the perk COUNT handed a five-perk track whose third perk had
 * been removed a fifth named `<stem>_5`, which the track already had, and the
 * modder had to rename it by hand before the form would save.
 */
export function freePerkName(track: string, taken: readonly string[]): string {
  const used = new Set(taken);
  for (let index = 0; ; index++) {
    const name = perkNameFor(track, index);
    if (!used.has(name)) return name;
  }
}
