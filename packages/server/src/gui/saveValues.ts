/**
 * Preview values read from a real save game, so the GUI designer can draw
 * `[GetPlayer.GetName]` as "Great Britain" instead of a placeholder chip.
 *
 * A save is Jomini script text, but a big one (a Victoria 3 campaign is ~115 MB
 * and 6.5 million lines), so nothing here parses the file: it STREAMS the file
 * line by line, cuts out the handful of blocks a preview needs (`meta_data`,
 * the played country, its ruler and heir, its capital state) and parses only
 * those with the ordinary tolerant parser. Reading stops as soon as the last
 * needed block has gone by.
 *
 * What comes back is the `previewValues` map a layout request already takes:
 * datafunction chains WITHOUT brackets -> display text. A field the save does
 * not carry is simply absent — a preview shows what is knowable and never
 * invents a value.
 *
 * Ironman and binary saves are not supported and say so; melting them is a
 * different tool.
 *
 * fs only (the save path); the loc lookup is injected. No vscode.
 */
import * as fs from "fs";
import * as readline from "readline";
import type { GuiSaveValuesResult } from "@px-lsp/protocol/protocol";
import { parseScript, type BlockNode, type Statement } from "../parser";

export interface SaveValuesOptions {
  /** The active profile's id; only `vic3` has an entity mapping today. */
  gameId: string;
  /** The configured language's value for a loc key, or undefined. */
  loc: (key: string) => string | undefined;
}

export const IRONMAN_ERROR =
  "ironman or binary save: save a normal (non-ironman) game to use it for previews";

// ---------------------------------------------------------------------------
// The mapping table: the one place that says which chain shows which field.
// ---------------------------------------------------------------------------

/** Everything the readers may look at. An absent field means the save had none. */
interface SaveContext {
  /** `meta_data`, parsed. */
  meta?: BlockNode;
  /** The played country's entry (`country_manager.database.<id>`). */
  country?: BlockNode;
  /** `character_manager.database.<ruler id>`. */
  ruler?: BlockNode;
  heir?: BlockNode;
  /** `states.database.<capital id>`. */
  capital?: BlockNode;
  /** The country's tag (`definition`), e.g. `GBR`. */
  tag?: string;
  /** `meta_data.game_date`, formatted. */
  date?: string;
  loc: (key: string) => string | undefined;
}

interface ValueMapping {
  /** Every chain (bracket-free) that shows this value. */
  chains: string[];
  read: (ctx: SaveContext) => string | undefined;
}

/**
 * Vic3-shaped today. Every reader tolerates absence, so a game whose save gives
 * no country or character context still answers the meta-only rows.
 */
const MAPPINGS: ValueMapping[] = [
  {
    chains: ["GetPlayer.GetName", "GetPlayer.GetCountry.GetName"],
    read: (ctx) => scalar(ctx.meta, "name"),
  },
  {
    chains: ["GetPlayer.GetAdjective"],
    read: (ctx) => (ctx.tag ? ctx.loc(`${ctx.tag}_ADJ`) : undefined),
  },
  {
    chains: ["GetPlayer.GetRank", "GetPlayer.GetCountryRank.GetName"],
    read: (ctx) => {
      const rank = scalar(ctx.meta, "rank");
      return rank ? (ctx.loc(rank) ?? rank) : undefined;
    },
  },
  {
    // A character's `GetName` and `GetFullName` both render the whole name;
    // only `GetFirstName` is narrower.
    chains: ["GetPlayer.GetRuler.GetName", "GetPlayer.GetRuler.GetFullName"],
    read: (ctx) => characterName(ctx, ctx.ruler),
  },
  {
    chains: ["GetPlayer.GetRuler.GetFirstName"],
    read: (ctx) => named(ctx, scalar(ctx.ruler, "first_name")),
  },
  {
    chains: ["GetPlayer.GetHeir.GetName"],
    read: (ctx) => characterName(ctx, ctx.heir),
  },
  {
    chains: ["GetPlayer.GetCapital.GetName"],
    read: (ctx) => {
      const region = scalar(ctx.capital, "region");
      return region ? (ctx.loc(region) ?? region) : undefined;
    },
  },
  {
    chains: ["GetPlayer.GetGold", "GetPlayer.GetBudget.GetGold"],
    read: (ctx) => thousands(scalar(block(ctx.country, "budget"), "money")),
  },
  {
    chains: ["GetCurrentDate", "GetGameDate"],
    read: (ctx) => ctx.date,
  },
];

/** `first_name` + `last_name`, each resolved through loc when it is a key. */
function characterName(ctx: SaveContext, character: BlockNode | undefined): string | undefined {
  const parts = [scalar(character, "first_name"), scalar(character, "last_name")]
    .map((p) => named(ctx, p))
    .filter((p): p is string => !!p);
  return parts.length ? parts.join(" ") : undefined;
}

/** A name is either literal text or a loc key; a key that resolves wins. */
function named(ctx: SaveContext, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return /^[A-Za-z0-9_.]+$/.test(raw) ? (ctx.loc(raw) ?? raw) : raw;
}

/** `1247181.89015` -> `1,247,182`: money shows whole and grouped. */
function thousands(raw: string | undefined): string | undefined {
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

/** `1836.1.21` -> `21 January 1836`; anything else comes back verbatim. */
function formatDate(raw: string | undefined): string {
  if (!raw) return "";
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!m) return raw;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : raw;
}

// ---------------------------------------------------------------------------
// Reading the small blocks
// ---------------------------------------------------------------------------

function statements(node: BlockNode | undefined): Statement[] {
  return node?.statements ?? [];
}

/** The scalar value of `key` in a block. */
function scalar(node: BlockNode | undefined, key: string): string | undefined {
  for (const s of statements(node)) {
    if (s.kind === "assignment" && s.key.text === key && s.value?.kind === "scalar") {
      return s.value.text;
    }
  }
  return undefined;
}

/** The block value of `key` in a block. */
function block(node: BlockNode | undefined, key: string): BlockNode | undefined {
  for (const s of statements(node)) {
    if (s.kind === "assignment" && s.key.text === key && s.value?.kind === "block") {
      return s.value;
    }
  }
  return undefined;
}

/**
 * Parse one cut-out `{ ... }` chunk. The chunk may be truncated (a capture cap
 * hit), which the tolerant parser reports as an unclosed brace while still
 * giving back the statements it did read — exactly what is wanted here.
 */
function parseBlock(text: string): BlockNode | undefined {
  if (!text) return undefined;
  const { root } = parseScript(`x=${text}`);
  const first = root.statements[0];
  if (first?.kind === "assignment" && first.value?.kind === "block") return first.value;
  return undefined;
}

// ---------------------------------------------------------------------------
// The streaming pass
// ---------------------------------------------------------------------------

/**
 * Lines kept per cut-out block. A country entry runs a few hundred lines and
 * everything read from one sits near its top; the cap only bounds what a
 * pathological save could cost.
 */
const MAX_CAPTURE_LINES = 4000;

/** A block being cut out of the stream. */
interface Capture {
  /** Where it sits, outermost key first: `["country_manager","database","1"]`. */
  path: string[];
  lines: string[];
}

interface SaveEntities {
  meta?: BlockNode;
  country?: BlockNode;
  ruler?: BlockNode;
  heir?: BlockNode;
  capital?: BlockNode;
}

/** Read a save's preview values. Never throws: a failure comes back as `error`. */
export async function readSaveValues(file: string, options: SaveValuesOptions): Promise<GuiSaveValuesResult> {
  const blank = { values: {}, source: { name: "", date: "", game: options.gameId } };
  let entities: SaveEntities;
  try {
    entities = await streamSave(file, options);
  } catch (e) {
    return { ...blank, error: `cannot read save: ${(e as Error).message}` };
  }
  if (!entities.meta) return { ...blank, error: IRONMAN_ERROR };

  const date = formatDate(scalar(entities.meta, "game_date"));
  const source = { name: scalar(entities.meta, "name") ?? "", date, game: options.gameId };
  if (scalar(entities.meta, "ironman") === "yes") {
    return { values: {}, source, error: IRONMAN_ERROR };
  }

  const ctx: SaveContext = {
    ...entities,
    tag: scalar(entities.country, "definition"),
    date,
    loc: options.loc,
  };
  const values: Record<string, string> = {};
  for (const mapping of MAPPINGS) {
    const value = mapping.read(ctx);
    if (!value) continue;
    for (const chain of mapping.chains) values[chain] = value;
  }
  return { values, source };
}

/**
 * A text save's header line is short and printable. An ironman or compressed
 * body is neither, and there is nothing here to read out of it.
 */
function looksBinary(line: string): boolean {
  if (line.length > 200) return true;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32)) return true;
  }
  return false;
}

/**
 * One pass over the file. The blocks come in the order a Vic3 save writes them
 * (`meta_data`, `country_manager`, `states`, `character_manager`), which is why
 * the country's capital and ruler ids are already known when their own blocks
 * go by.
 */
async function streamSave(file: string, options: SaveValuesOptions): Promise<SaveEntities> {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out: SaveEntities = {};
  const vic3 = options.gameId === "vic3";

  // The block keys we are inside of, outermost first.
  const stack: string[] = [];
  let capture: Capture | null = null;
  /** The country entry going by right now; kept only if it is the player's. */
  let candidate: { tag?: string; main: boolean } | null = null;
  let playerCountry: string | null = null;
  let fallbackCountry: string | null = null;
  let capitalId: string | undefined;
  let rulerId: string | undefined;
  let heirId: string | undefined;
  let lineNo = 0;
  let done = false;

  for await (const raw of rl) {
    lineNo++;
    const line = lineNo === 1 && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

    // A binary or compressed body is not script: a text save's header line is
    // short and printable, and `meta_data` opens right after it.
    if (lineNo === 1 && looksBinary(line)) break;
    if (lineNo > 6 && !out.meta && !capture) break;

    let captureStart = capture ? 0 : -1;

    // Only a line carrying one of these can change the shape; the rest is
    // `key=value` noise, and skipping it is what keeps 6 million lines cheap.
    if (line.includes("{") || line.includes("}") || line.includes('"')) {
      let inString = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inString) {
          if (c === '"') inString = false;
          continue;
        }
        if (c === '"') inString = true;
        else if (c === "{") {
          stack.push(keyBefore(line, i));
          if (!capture && wanted()) {
            capture = { path: [...stack], lines: [] };
            captureStart = i;
            if (stack[0] === "country_manager") candidate = { main: false };
          }
        } else if (c === "}") {
          const closed = stack.pop();
          if (capture && stack.length === capture.path.length - 1) {
            const tail = line.slice(Math.max(captureStart, 0), i + 1);
            const { path, lines } = capture;
            capture = null;
            captureStart = -1;
            keep(path, [...lines, tail].join("\n"));
          } else if (!capture && stack.length === 0 && closed === "country_manager") {
            finishCountries();
          }
        }
      }
    }

    if (capture && captureStart >= 0) {
      if (capture.lines.length < MAX_CAPTURE_LINES) capture.lines.push(line.slice(captureStart));
      if (candidate) scanCountry(line);
    }
    if (done) break;
  }
  rl.close();
  stream.destroy();
  finishCountries();
  return out;

  /** Is the block we just entered one of the few worth cutting out? */
  function wanted(): boolean {
    if (stack.length === 1) return stack[0] === "meta_data";
    if (!vic3 || stack.length !== 3 || stack[1] !== "database") return false;
    const id = stack[2];
    switch (stack[0]) {
      case "country_manager":
        return !playerCountry;
      case "states":
        return id === capitalId;
      case "character_manager":
        return id === rulerId || id === heirId;
      default:
        return false;
    }
  }

  /** A country entry says who it is in two lines near its top. */
  function scanCountry(line: string): void {
    if (!candidate) return;
    const def = /^\s*definition="?([A-Za-z_0-9]+)"?/.exec(line);
    if (def) candidate.tag = def[1];
    else if (/^\s*is_main_tag=yes\b/.test(line)) candidate.main = true;
  }

  /** A cut-out block just closed: file it, and note what it points at. */
  function keep(path: string[], text: string): void {
    if (path[0] === "meta_data") {
      out.meta = parseBlock(text);
      // Only vic3 has an entity mapping; for any other game the meta is all of it.
      if (!vic3) done = true;
      return;
    }
    if (path[0] === "country_manager") {
      // The played country is the one whose tag localizes to the campaign name
      // the meta states (`player_manager` is empty in a single-player save).
      const name = scalar(out.meta, "name");
      const tag = candidate?.tag;
      if (tag && (options.loc(tag) === name || tag === name)) playerCountry = text;
      else if (candidate?.main && !fallbackCountry) fallbackCountry = text;
      candidate = null;
      return;
    }
    if (path[0] === "states") out.capital = parseBlock(text);
    if (path[0] === "character_manager") {
      if (path[2] === rulerId) out.ruler = parseBlock(text);
      if (path[2] === heirId) out.heir = parseBlock(text);
      // Characters are the last of the blocks we need that a save writes.
      if ((!rulerId || out.ruler) && (!heirId || out.heir)) done = true;
    }
  }

  /**
   * `country_manager` has gone by: settle on the played country (the tag match,
   * else the first main tag) and read the ids the later blocks are found by.
   */
  function finishCountries(): void {
    if (out.country || !(playerCountry ?? fallbackCountry)) return;
    out.country = parseBlock(playerCountry ?? fallbackCountry ?? "");
    capitalId = scalar(out.country, "capital");
    rulerId = scalar(out.country, "ruler");
    heirId = scalar(out.country, "heir");
  }
}

/** The key in `key = {`, from the text just before the brace. */
function keyBefore(line: string, brace: number): string {
  const m = /([A-Za-z_0-9.-]+)\s*=\s*$/.exec(line.slice(Math.max(0, brace - 64), brace));
  return m ? m[1] : "";
}
