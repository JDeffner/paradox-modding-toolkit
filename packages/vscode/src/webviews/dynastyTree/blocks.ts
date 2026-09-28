/**
 * Character history uses the shapes in CK3's history/_characters.info and
 * history/characters (including death_reason and killer in english.txt).
 * Existing characters are edited by source span. Unmodelled statements,
 * comments, quotation marks and gaps remain in place.
 */
import { DYNASTY_SKILLS } from "@px-lsp/protocol/protocol";
import { isValidScriptDate, parseScriptDate } from "@px-lsp/protocol/calendar";
import { parseScript } from "@px-lsp/server/parser";
import { readCharacterBlock } from "@px-lsp/server/overview/dynastyTree";
import { parseBlock, readQuoted, type ScriptItem } from "../shared/scriptBlock";
import type { CharacterForm, CharacterQuotes, DynastyForm, HouseForm } from "./messages";

const DATE_RE = /^-?\d+\.\d+\.\d+$/;
const TOKEN = /^[^\s{}"#=<>!]+$/;
export const DEFAULT_CHARACTER_QUOTES: CharacterQuotes = { name: true, culture: true, religion: true };
export interface GeneratedBlock {
  text: string;
  notes: string[];
}
const quote = (value: string): string => `"${value}"`;
const scalar = (item: ScriptItem): string | undefined =>
  item.block ? undefined : (readQuoted(item.value) ?? item.value);

export function unquotableValue(form: object): string | null {
  return (
    (Object.values(form).find((v) => typeof v === "string" && /["\r\n]/.test(v)) as string | undefined) ??
    null
  );
}

/** Read the current editor block, not an older index record. */
export function characterForm(text: string): CharacterForm {
  const parsed = parseScript(text);
  const stmt = parsed.root.statements[0];
  if (
    parsed.errors.length ||
    parsed.root.statements.length !== 1 ||
    stmt?.kind !== "assignment" ||
    stmt.value?.kind !== "block"
  ) {
    throw new Error("Fix the character's script syntax before editing it in the Dynasty Tree.");
  }
  const {
    source: _source,
    file: _file,
    line: _line,
    ...form
  } = readCharacterBlock(stmt.key.text, stmt.value, { source: "mod", file: "", line: 0 });
  return { ...form, deathReason: form.deathReason ?? "" };
}

/** Validate form inputs before they become script. */
export function characterProblem(form: CharacterForm): string | null {
  if (!form.name.trim()) return "A character needs a name or localization key.";
  if (unquotableValue(form) !== null)
    return "Character values cannot contain quotation marks or line breaks.";
  for (const value of [
    form.id,
    form.culture,
    form.religion,
    form.house,
    form.dynasty,
    form.father,
    form.mother,
    form.deathReason,
    ...form.traits,
    ...form.spouses,
  ]) {
    if (value !== undefined && value !== "" && !TOKEN.test(value))
      return `${value} must be one script identifier.`;
  }
  if (!form.id) return "A character needs an id.";
  for (const value of [form.birth, form.death, form.marriageDate]) {
    if (!value) continue;
    const d = parseScriptDate(value);
    if (!d || !isValidScriptDate(d.y, d.m, d.d)) return `${value} is not a valid history date.`;
  }
  if (form.deathReason && !form.death) return "Set a death date before choosing a death reason.";
  if (Object.values(form.skills ?? {}).some((value) => !Number.isFinite(value)))
    return "Skills must be finite numbers.";
  return null;
}

/** Edits only the selected statement/value; the shared scanner owns syntax. */
class HistoryBlock {
  constructor(
    public text: string,
    private fallbackIndent = "\t"
  ) {}
  get parsed() {
    const parsed = parseBlock(this.text);
    if (!parsed) throw new Error("The character block could not be read. Reload it before saving.");
    return parsed;
  }
  get items(): ScriptItem[] {
    return this.parsed.items;
  }
  get indent(): string {
    const p = this.parsed;
    return /\n[ \t]+\S/.test(p.body) ? p.indent : this.fallbackIndent;
  }
  find(key: string): ScriptItem | undefined {
    return this.items.filter((i) => i.key === key).at(-1);
  }
  replace(start: number, end: number, value: string): void {
    const offset = this.parsed.head.length;
    this.text = this.text.slice(0, offset + start) + value + this.text.slice(offset + end);
  }
  value(item: ScriptItem, value: string): void {
    this.replace(item.end - item.value.length, item.end, value);
  }
  remove(item: ScriptItem): void {
    this.replace(item.start, item.end, "");
  }
  insert(statement: string, before?: ScriptItem): void {
    const p = this.parsed;
    const at = before?.start ?? p.body.length;
    const lead = p.body.slice(0, at);
    const line = lead.lastIndexOf("\n") + 1;
    if (/^[ \t]*$/.test(lead.slice(line))) {
      this.replace(line, line, this.indent + statement + p.eol);
    } else {
      this.replace(at, at, p.eol + this.indent + statement + p.eol);
    }
  }
  set(key: string, value: string | undefined, quoted?: boolean): void {
    const item = this.find(key);
    if (value === undefined || value === "") {
      for (const old of this.items.filter((i) => i.key === key).reverse()) this.remove(old);
      return;
    }
    if (item && scalar(item) === value && quoted === undefined) return;
    const useQuotes = quoted ?? (item ? readQuoted(item.value) !== null : false);
    const rendered = useQuotes || !TOKEN.test(value) ? quote(value) : value;
    if (item) {
      if (item.value !== rendered) this.value(item, rendered);
    } else
      this.insert(
        `${key} = ${rendered}`,
        this.items.find((i) => DATE_RE.test(i.key ?? ""))
      );
  }
  child(item: ScriptItem): HistoryBlock {
    return new HistoryBlock(
      `${item.key} = ${item.value}`,
      this.indent + (this.indent.includes("\t") ? "\t" : " ".repeat(this.indent.length || 4))
    );
  }
  putChild(item: ScriptItem, child: HistoryBlock): void {
    const parsed = child.parsed;
    this.value(item, `{${parsed.body}${parsed.tail}`);
  }
  addDated(date: string, statement: string): void {
    const existing = this.items.find((i) => i.key === date && i.block);
    if (existing) {
      const child = this.child(existing);
      child.insert(statement);
      this.putChild(existing, child);
    } else {
      const eol = this.parsed.eol;
      const unit = this.indent.includes("\t") ? "\t" : " ".repeat(this.indent.length || 4);
      this.insert(
        `${date} = {${eol}${this.indent}${unit}${statement}${eol}${this.indent}}`,
        this.items.find((i) => DATE_RE.test(i.key ?? "") && dateOrder(i.key!) > dateOrder(date))
      );
    }
  }
}

function dateOrder(date: string): number {
  const [y, m, d] = date.split(".").map(Number);
  return y * 10000 + m * 100 + d;
}

/** Update a birth/death without moving other events at that date. */
function updateLifeEvent(
  root: HistoryBlock,
  key: "birth" | "death",
  date: string | undefined,
  reason?: string
): void {
  const dated = root.items.find((i) => i.block && DATE_RE.test(i.key ?? "") && root.child(i).find(key));
  if (!dated) {
    if (date)
      root.addDated(date, `${key} = ${key === "death" && reason ? `{ death_reason = ${reason} }` : "yes"}`);
    return;
  }
  const child = root.child(dated);
  const event = child.items.find((i) => i.key === key)!;
  let value = event.value;
  if (key === "death" && reason !== undefined) {
    if (event.block) {
      const death = child.child(event);
      const oldReason = death.find("death_reason");
      if ((oldReason ? scalar(oldReason) : "") !== reason) {
        if (reason) {
          death.set("death_reason", reason);
          value = `{${death.parsed.body}${death.parsed.tail}`;
        } else {
          const rest = death.parsed.body.replace(/#[^\r\n]*/g, "");
          if (death.items.some((i) => i.key !== "death_reason") || rest !== death.parsed.body) {
            throw new Error(
              "This death block has other details or comments. Choose a reason, or edit the block in the source file before clearing it."
            );
          }
          value = "yes";
        }
      }
    } else if (reason) value = `{ death_reason = ${reason} }`;
  }
  if (date === dated.key) {
    if (value !== event.value) {
      child.value(event, value);
      root.putChild(dated, child);
    }
    return;
  }
  // A literal date in birth/death must move with the event's date.
  if (date && DATE_RE.test(scalar(event) ?? ""))
    value = readQuoted(event.value) !== null ? quote(date) : date;
  child.remove(event);
  if (child.items.length === 0 && !child.parsed.body.includes("#")) root.remove(dated);
  else root.putChild(dated, child);
  if (date) root.addDated(date, `${key} = ${value}`);
}

function updateTraits(root: HistoryBlock, traits: string[]): void {
  const remaining = [...traits];
  const remove: ScriptItem[] = [];
  for (const item of root.items.filter((i) => i.key === "trait" && !i.block)) {
    const at = remaining.indexOf(scalar(item)!);
    if (at < 0) remove.push(item);
    else remaining.splice(at, 1);
  }
  for (const item of remove.reverse()) root.remove(item);
  for (const trait of remaining) {
    const items = root.items;
    const last = items.indexOf(items.filter((i) => i.key === "trait").at(-1)!);
    root.insert(
      `trait = ${trait}`,
      last >= 0 ? items[last + 1] : items.find((i) => DATE_RE.test(i.key ?? ""))
    );
  }
}

function updateSpouses(root: HistoryBlock, form: CharacterForm): void {
  const found = new Set<string>();
  for (const item of root.items.slice().reverse()) {
    if (item.key === "add_spouse" && !item.block) {
      const spouse = scalar(item)!;
      if (form.spouses.includes(spouse)) found.add(spouse);
      else root.remove(item);
    } else if (item.block && DATE_RE.test(item.key ?? "")) {
      const child = root.child(item);
      const original = child.text;
      for (const spouse of child.items.filter((i) => i.key === "add_spouse" && !i.block).reverse()) {
        const id = scalar(spouse)!;
        if (form.spouses.includes(id)) found.add(id);
        else child.remove(spouse);
      }
      if (child.text === original) continue;
      if (child.items.length === 0 && !child.parsed.body.includes("#")) root.remove(item);
      else root.putChild(item, child);
    }
  }
  for (const spouse of form.spouses) {
    if (found.has(spouse)) continue;
    const date = form.marriageDate ?? form.birth;
    if (!date) throw new Error(`${spouse} needs a marriage date before it can be written.`);
    root.addDated(date, `add_spouse = ${spouse}`);
    found.add(spouse);
  }
}

export function characterBlock(
  form: CharacterForm,
  previous?: string,
  defaults: CharacterQuotes = DEFAULT_CHARACTER_QUOTES
): GeneratedBlock {
  const problem = characterProblem(form);
  if (problem) throw new Error(problem);
  if (!previous) return { text: newCharacter(form, defaults), notes: [] };
  const before = characterForm(previous);
  if (before.id !== form.id) throw new Error("The character id changed. Reload the character before saving.");
  const root = new HistoryBlock(previous);
  for (const key of ["name", "culture", "religion"] as const) {
    const explicit = form.quotes?.[key];
    if (!root.find(key) && form[key] === before[key] && explicit === undefined) continue;
    root.set(key, form[key], explicit ?? (root.find(key) ? undefined : defaults[key]));
  }
  if (form.female !== before.female) root.set("female", form.female ? "yes" : "no");
  for (const [key, value, was] of [
    ["dynasty", form.dynasty, before.dynasty],
    ["dynasty_house", form.house, before.house],
    ["father", form.father, before.father],
    ["mother", form.mother, before.mother],
    ["dna", form.dna, before.dna],
  ] as const) {
    if (value !== was) root.set(key, value);
  }
  for (const skill of DYNASTY_SKILLS) {
    if (form.skills?.[skill] !== before.skills?.[skill]) root.set(skill, form.skills?.[skill]?.toString());
  }
  updateTraits(root, form.traits);
  updateLifeEvent(root, "birth", form.birth);
  updateLifeEvent(root, "death", form.death, form.deathReason);
  updateSpouses(root, form);
  return { text: root.text, notes: [] };
}

function newCharacter(form: CharacterForm, defaults: CharacterQuotes): string {
  const quoted = (key: keyof CharacterQuotes, value: string): string =>
    (form.quotes?.[key] ?? defaults[key]) || !TOKEN.test(value) ? quote(value) : value;
  const groups: string[][] = [
    [
      `name = ${quoted("name", form.name)}`,
      ...(form.dna ? [`dna = ${TOKEN.test(form.dna) ? form.dna : quote(form.dna)}`] : []),
      ...(form.female ? ["female = yes"] : []),
    ],
    [
      form.house ? `dynasty_house = ${form.house}` : form.dynasty ? `dynasty = ${form.dynasty}` : "",
      form.religion ? `religion = ${quoted("religion", form.religion)}` : "",
      form.culture ? `culture = ${quoted("culture", form.culture)}` : "",
    ],
    [form.father ? `father = ${form.father}` : "", form.mother ? `mother = ${form.mother}` : ""],
    DYNASTY_SKILLS.flatMap((s) => (form.skills?.[s] !== undefined ? [`${s} = ${form.skills[s]}`] : [])),
    form.traits.map((t) => `trait = ${t}`),
  ];
  const dates = new Map<string, string[]>();
  const add = (date: string, value: string): void => {
    dates.set(date, [...(dates.get(date) ?? []), value]);
  };
  if (form.birth) add(form.birth, "birth = yes");
  if (form.death)
    add(form.death, form.deathReason ? `death = { death_reason = ${form.deathReason} }` : "death = yes");
  for (const spouse of new Set(form.spouses)) {
    const date = form.marriageDate ?? form.birth;
    if (!date) throw new Error(`${spouse} needs a marriage date before it can be written.`);
    add(date, `add_spouse = ${spouse}`);
  }
  for (const [date, statements] of [...dates].sort(([a], [b]) => dateOrder(a) - dateOrder(b))) {
    groups.push([`${date} = {`, ...statements.map((s) => `\t${s}`), "}"]);
  }
  const body = groups
    .map((g) => g.filter(Boolean))
    .filter((g) => g.length)
    .map((g) => g.map((s) => `\t${s}`).join("\n"))
    .join("\n\n");
  return `${form.id} = {\n${body}\n}\n`;
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
