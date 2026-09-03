/**
 * The script the Dynasty Tree writes: one character, dynasty or house block,
 * generated from the form the app filled in. Pure text in, pure text out (no
 * vscode, no fs), so it is unit-tested directly.
 *
 * The key set and its spelling are MEASURED from the vanilla files, not
 * remembered (counts in packages/server/src/overview/dynastyTree.ts): a
 * character's own level carries `name` (quoted plain text, never a loc key),
 * `female = yes`, `dynasty` or `dynasty_house`, `culture`, `religion`,
 * `father`, `mother` and one `trait = X` per trait, while `birth`, `death` and
 * `add_spouse` sit inside a dated `880.1.1 = { … }` block whose KEY is the
 * date. A dynasty is `<id> = { name = "dynn_X" culture = "y" }` and a house is
 * `house_x = { name = "dynn_X" dynasty = <id> }`
 * (game/common/dynasties/00_dynasties.txt, game/common/dynasty_houses/00_dynasty_houses.txt).
 *
 * Editing an existing block regenerates the keys the form owns and keeps
 * everything else exactly as written, comments included, by copying the source
 * LINES of the statements the form does not model.
 */
import { parseScript, type BlockNode, type Statement } from "@px-lsp/server/parser";
import type { CharacterForm, DynastyForm, HouseForm } from "./messages";

/** Character-level keys the form owns; everything else is kept as written. */
const OWNED_KEYS = new Set([
  "name",
  "female",
  "dynasty",
  "dynasty_house",
  "culture",
  "religion",
  "father",
  "mother",
  "trait",
]);

/** Statements inside a dated block the form owns. */
const OWNED_DATED = new Set(["birth", "death", "add_spouse"]);

const DATE_RE = /^-?\d+\.\d+\.\d+$/;

export interface GeneratedBlock {
  text: string;
  /** What the generator could not do, for the panel to say out loud. */
  notes: string[];
}

function quote(value: string): string {
  return `"${value}"`;
}

/**
 * The first value of a form that carries a `"` itself, or null.
 *
 * Paradox script has no escape for a quote inside a quoted value, and dropping
 * it would rename the character silently, so the caller refuses the save.
 */
export function unquotableValue(form: object): string | null {
  for (const value of Object.values(form)) {
    if (typeof value === "string" && value.includes('"')) return value;
  }
  return null;
}

/** `1050.3.4` as a sortable number; the game reads dates, not file order. */
function dateOrder(date: string): number {
  const [y, m, d] = date.split(".").map((p) => Number(p) || 0);
  return y * 10000 + m * 100 + d;
}

function blockOf(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (v?.kind === "block") return v;
  if (v?.kind === "tagged-block") return v.block;
  return null;
}

/**
 * The source lines a statement occupies, with the comment lines directly above
 * it and any trailing comment on its own last line. Copying lines rather than
 * the statement's own span is what keeps a `# AKA: …` note attached to the key
 * it explains.
 */
function statementLines(lines: string[], starts: number[], stmt: Statement): string[] {
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  let first = lineAt(stmt.range.start);
  const last = lineAt(stmt.range.end);
  while (first > 0 && lines[first - 1].trim().startsWith("#")) first--;
  return lines.slice(first, last + 1);
}

interface Previous {
  /** Verbatim lines of the statements the form does not own. */
  plain: string[][];
  /** Dated blocks kept as written, by their date. */
  keptDates: Map<string, string[]>;
  /** Spouse ids already married inside a KEPT dated block. */
  keptSpouses: Set<string>;
  /** Marriage date per spouse, read from the blocks that ARE regenerated: the
   *  date is the one fact the form does not carry, and a rewrite must not
   *  invent a new one. */
  marriedAt: Map<string, string>;
}

/**
 * Split a previous character block into what the form regenerates and what is
 * copied. A dated block whose statements are all `birth`/`death`/`add_spouse`
 * is regenerated; a dated block carrying anything else (an effect, a nickname,
 * a death with a reason) is kept whole, because rewriting half of it would
 * change what the game does.
 */
function readPrevious(previous: string): Previous {
  const out: Previous = {
    plain: [],
    keptDates: new Map(),
    keptSpouses: new Set(),
    marriedAt: new Map(),
  };
  const { root } = parseScript(previous);
  const lines = previous.split(/\r?\n/);
  const starts: number[] = [0];
  for (let i = 0; i < previous.length; i++) {
    if (previous.charCodeAt(i) === 10) starts.push(i + 1);
  }
  const block = root.statements.length === 1 ? blockOf(root.statements[0]) : null;
  if (!block) return out;
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment") {
      out.plain.push(statementLines(lines, starts, stmt));
      continue;
    }
    const key = stmt.key.text;
    if (DATE_RE.test(key)) {
      const dated = blockOf(stmt);
      const simple =
        dated !== null &&
        dated.statements.every((s) => s.kind === "assignment" && OWNED_DATED.has(s.key.text));
      if (simple) {
        for (const inner of dated.statements) {
          if (inner.kind !== "assignment" || inner.key.text !== "add_spouse") continue;
          if (inner.value?.kind === "scalar") out.marriedAt.set(inner.value.text, key);
        }
        continue;
      }
      out.keptDates.set(key, statementLines(lines, starts, stmt));
      for (const inner of dated?.statements ?? []) {
        if (inner.kind !== "assignment" || inner.key.text !== "add_spouse") continue;
        if (inner.value?.kind === "scalar") out.keptSpouses.add(inner.value.text);
      }
      continue;
    }
    if (OWNED_KEYS.has(key)) continue;
    out.plain.push(statementLines(lines, starts, stmt));
  }
  return out;
}

/**
 * The character's block. `previous` is the exact source of the block being
 * edited; without it a fresh block is written.
 */
export function characterBlock(form: CharacterForm, previous?: string): GeneratedBlock {
  const notes: string[] = [];
  const prev = previous ? readPrevious(previous) : null;
  const body: string[] = [];
  body.push(`\tname = ${quote(form.name)}`);
  if (form.female) body.push(`\tfemale = yes`);
  if (form.house) body.push(`\tdynasty_house = ${form.house}`);
  else if (form.dynasty) body.push(`\tdynasty = ${form.dynasty}`);
  if (form.culture) body.push(`\tculture = ${quote(form.culture)}`);
  if (form.religion) body.push(`\treligion = ${quote(form.religion)}`);
  if (form.father) body.push(`\tfather = ${form.father}`);
  if (form.mother) body.push(`\tmother = ${form.mother}`);
  for (const trait of form.traits) body.push(`\ttrait = ${trait}`);
  for (const kept of prev?.plain ?? []) body.push(...kept);

  const dated: Array<{ date: string; lines: string[] }> = [];
  const keptDates = prev?.keptDates ?? new Map<string, string[]>();
  for (const [date, lines] of keptDates) dated.push({ date, lines });
  const simpleDated = (date: string, statement: string): void => {
    if (keptDates.has(date)) {
      notes.push(`${date} was kept as written, so ${statement} was not moved there.`);
      return;
    }
    dated.push({ date, lines: [`\t${date} = {`, `\t\t${statement}`, `\t}`] });
  };
  if (form.birth) simpleDated(form.birth, "birth = yes");
  if (form.death) simpleDated(form.death, "death = yes");
  // A marriage the previous block already dated keeps that date; a new one gets
  // the form's, and failing that the character's own birth date.
  const marriages = new Map<string, string[]>();
  for (const spouse of form.spouses) {
    if (prev?.keptSpouses.has(spouse)) continue;
    const date = prev?.marriedAt.get(spouse) ?? form.marriageDate ?? form.birth;
    if (!date) {
      notes.push(`${spouse} needs a marriage date before it can be written.`);
      continue;
    }
    const list = marriages.get(date);
    if (list) list.push(spouse);
    else marriages.set(date, [spouse]);
  }
  for (const [date, ids] of marriages) {
    dated.push({
      date,
      lines: [`\t${date} = {`, ...ids.map((id) => `\t\tadd_spouse = ${id}`), `\t}`],
    });
  }
  dated.sort((a, b) => dateOrder(a.date) - dateOrder(b.date));
  for (const entry of dated) body.push(...entry.lines);

  return { text: `${form.id} = {\n${body.join("\n")}\n}\n`, notes };
}

/** `<id> = { name = "dynn_X" culture = "y" }`. */
export function dynastyBlock(form: DynastyForm): string {
  const body = [`\tname = ${quote(form.nameKey)}`];
  if (form.culture) body.push(`\tculture = ${quote(form.culture)}`);
  return `${form.id} = {\n${body.join("\n")}\n}\n`;
}

/** `house_x = { name = "dynn_X" dynasty = <id> }`. */
export function houseBlock(form: HouseForm): string {
  return `${form.id} = {\n\tname = ${quote(form.nameKey)}\n\tdynasty = ${form.dynasty}\n}\n`;
}
