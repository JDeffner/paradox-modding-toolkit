/**
 * The shape of a save game, as data: which meta keys name the campaign and its
 * date, where the entities a preview needs sit, and which datafunction chain
 * shows which field. A game profile carries one (`GameProfile.saveSchema`,
 * built in games/<id>/saveSchema.ts); the reader (saveValues.ts) stays generic
 * over it and names no game.
 *
 * The small readers a mapping table needs live here too, so a profile's table
 * can be plain data sitting next to that game's other tables.
 *
 * Pure: parsed blocks in, display text out. No fs, no vscode.
 */
import type { BlockNode, Statement } from "../parser";

/** The blocks a preview reads, cut out of the save. */
export interface SaveEntities {
  /** The save's meta block. */
  meta?: BlockNode;
  /** The played country's entry, for a game whose player runs one. */
  country?: BlockNode;
  /** The played country's ruler. */
  ruler?: BlockNode;
  /** The played country's heir. */
  heir?: BlockNode;
  /** The played country's capital. */
  capital?: BlockNode;
  /** The played character's own record, for a game whose player IS a character. */
  character?: BlockNode;
}

/** Everything the readers may look at. An absent field means the save had none. */
export interface SaveContext extends SaveEntities {
  /** The country's tag (`GBR`), when the save names its entries by one. */
  tag?: string;
  /** The save's date, formatted. */
  date?: string;
  loc: (key: string) => string | undefined;
}

export interface ValueMapping {
  /** Every chain (bracket-free) that shows this value. */
  chains: string[];
  read: (ctx: SaveContext) => string | undefined;
}

/** The entity slots a country entry points at, filled from its own registry. */
export type SaveSlot = "ruler" | "heir" | "capital";

/** One id a country entry holds, and the registry that id is looked up in. */
export interface SaveLink {
  slot: SaveSlot;
  /** Key on the country entry holding the id. */
  key: string;
  /** Top-level registry block the entry lives in. */
  block: string;
}

/**
 * A save that keeps its entities in top-level registries, each an id-keyed
 * table under one sub-block (`<block>.<entries>.<id>`). The played country is
 * the entry whose tag localizes to the campaign name the meta states, and its
 * own fields say which ids the later registries are searched for — which is why
 * one pass in file order answers everything.
 */
export interface SaveRegistry {
  /** Sub-block each registry keeps its entries under (`database`). */
  entries: string;
  /** Registry holding the country entries, one of which is the player's. */
  countryBlock: string;
  /** Country-entry key naming it; matched, through loc, against the meta name. */
  tagKey: string;
  /** Country-entry key marking a playable country, used when no name matched. */
  mainKey: string;
  links: SaveLink[];
}

/**
 * A save whose player is a character named at the very END of the file, long
 * after the record a preview wants. Finding the id costs a cheap chunk scan for
 * the marker before the streaming pass that cuts the record out.
 */
export interface SavePlayerRecord {
  /** Line-start marker opening the block that names the played record. */
  marker: string;
  /** Key inside that block holding the record's id. */
  idKey: string;
  /** Top-level block whose `<id>` entry is the played record. */
  block: string;
}

/** How one game's saves are read. */
export interface SaveSchema {
  /** Meta key holding the save's date. Absent = `game_date`. */
  dateKey?: string;
  /** Meta key holding the campaign or player name. Absent = `name`. */
  nameKey?: string;
  /** The curated chain -> value table. */
  mappings: ValueMapping[];
  /**
   * Chains the save's own contents name rather than the table (a character's
   * stored variables), read per save. Absent = the table is all there is.
   */
  expand?: (ctx: SaveContext) => Record<string, string>;
  /** Set when the save keeps its entities in id-keyed registries. */
  registry?: SaveRegistry;
  /** Set when the played character is named at the end of the save. */
  record?: SavePlayerRecord;
}

// ---------------------------------------------------------------------------
// The readers a mapping table is written with
// ---------------------------------------------------------------------------

export function statements(node: BlockNode | undefined): Statement[] {
  return node?.statements ?? [];
}

/** The scalar value of `key` in a block. */
export function scalar(node: BlockNode | undefined, key: string): string | undefined {
  for (const s of statements(node)) {
    if (s.kind === "assignment" && s.key.text === key && s.value?.kind === "scalar") {
      return s.value.text;
    }
  }
  return undefined;
}

/** The block value of `key` in a block. */
export function block(node: BlockNode | undefined, key: string): BlockNode | undefined {
  for (const s of statements(node)) {
    if (s.kind === "assignment" && s.key.text === key && s.value?.kind === "block") {
      return s.value;
    }
  }
  return undefined;
}

/** A name is either literal text or a loc key; a key that resolves wins. */
export function named(ctx: SaveContext, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return /^[A-Za-z0-9_.]+$/.test(raw) ? (ctx.loc(raw) ?? raw) : raw;
}

/** `1247181.89015` -> `1,247,182`: money shows whole and grouped. */
export function thousands(raw: string | undefined): string | undefined {
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `1836.1.21` -> `[1836, 1, 21]`; anything else is not a date. */
function parseDate(raw: string | undefined): [number, number, number] | undefined {
  const m = raw === undefined ? null : /^(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** `1836.1.21` -> `21 January 1836`; anything else comes back verbatim. */
export function formatDate(raw: string | undefined): string {
  if (!raw) return "";
  const d = parseDate(raw);
  const month = d ? MONTHS[d[1] - 1] : undefined;
  return d && month ? `${d[2]} ${month} ${d[0]}` : raw;
}

/** Whole years between a birth date and the save's date. */
export function age(birth: string | undefined, today: string | undefined): string | undefined {
  const b = parseDate(birth);
  const t = parseDate(today);
  if (!b || !t) return undefined;
  const beforeBirthday = t[1] < b[1] || (t[1] === b[1] && t[2] < b[2]);
  const years = t[0] - b[0] - (beforeBirthday ? 1 : 0);
  return years >= 0 ? String(years) : undefined;
}

// ---------------------------------------------------------------------------
// The default schema
// ---------------------------------------------------------------------------

/**
 * What any Jomini save answers out of its meta block alone. Every reader
 * tolerates absence, so a game whose profile carries no schema of its own still
 * gets exactly these rows.
 */
export const META_MAPPINGS: ValueMapping[] = [
  {
    chains: ["GetPlayer.GetName", "GetPlayer.GetCountry.GetName"],
    read: (ctx) => scalar(ctx.meta, "name"),
  },
  {
    chains: ["GetPlayer.GetRank", "GetPlayer.GetCountryRank.GetName"],
    read: (ctx) => {
      const rank = scalar(ctx.meta, "rank");
      return rank ? (ctx.loc(rank) ?? rank) : undefined;
    },
  },
  {
    chains: ["GetCurrentDate", "GetGameDate"],
    read: (ctx) => ctx.date,
  },
];

/** The schema a profile that carries none of its own is read with. */
export const DEFAULT_SAVE_SCHEMA: SaveSchema = { mappings: META_MAPPINGS };
