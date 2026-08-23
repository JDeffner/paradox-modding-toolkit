/**
 * Preview values read from a real save game, so the GUI designer can draw
 * `[GetPlayer.GetName]` as "Great Britain" instead of a placeholder chip.
 *
 * A save is Jomini script text, but a big one can run ~115 MB and 6.5 million
 * lines, so nothing here parses the file: it STREAMS the file line by line,
 * cuts out the handful of blocks a preview needs (the meta block, the played
 * country, its ruler and heir, its capital) and parses only those with the
 * ordinary tolerant parser. Reading stops as soon as the last needed block has
 * gone by.
 *
 * Which blocks those are, and where they sit, is the active profile's
 * `saveSchema` (gui/saveSchema.ts, built per game under games/<id>/): this
 * module knows two save shapes and no game. A save may keep its entities in
 * id-keyed registries answered in one pass, or name the played character at the
 * very END of the file, which costs one cheap chunk scan for the id before the
 * streaming pass. A packed save keeps its script in a zip entry (`saveZip.ts`
 * finds it) and is inflated on the way through.
 *
 * What comes back is the `previewValues` map a layout request already takes:
 * datafunction chains WITHOUT brackets -> display text. A field the save does
 * not carry is simply absent — a preview shows what is knowable and never
 * invents a value.
 *
 * Ironman and binary saves are not supported and say so; melting them is a
 * different tool.
 *
 * fs/zlib only (the save path); the loc lookup is injected. No vscode.
 */
import * as fs from "fs";
import * as readline from "readline";
import * as zlib from "zlib";
import type { Readable } from "stream";
import type { GuiSaveValuesResult } from "@px-lsp/protocol/protocol";
import { parseScript, type BlockNode } from "../parser";
import { findZipEntry, ZIP_HEAD_BYTES, type ZipEntry } from "./saveZip";
import {
  DEFAULT_SAVE_SCHEMA,
  formatDate,
  scalar,
  type SaveContext,
  type SaveEntities,
  type SaveSchema,
  type SaveSlot,
} from "./saveSchema";

export interface SaveValuesOptions {
  /** The active profile's id; goes back on the wire as `source.game`. */
  gameId: string;
  /** How the profile's saves are read. Absent = the meta-only default. */
  schema?: SaveSchema;
  /** The configured language's value for a loc key, or undefined. */
  loc: (key: string) => string | undefined;
}

export const IRONMAN_ERROR =
  "ironman or binary save: save a normal (non-ironman) game to use it for previews";

/** The block every Jomini save opens with, and the key that refuses it. */
const META_BLOCK = "meta_data";
const IRONMAN_KEY = "ironman";
const DEFAULT_DATE_KEY = "game_date";
const DEFAULT_NAME_KEY = "name";

/** The entry a packed save keeps its script in. */
const PACKED_ENTRY = "gamestate";

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

/** Read a save's preview values. Never throws: a failure comes back as `error`. */
export async function readSaveValues(file: string, options: SaveValuesOptions): Promise<GuiSaveValuesResult> {
  const blank = { values: {}, source: { name: "", date: "", game: options.gameId } };
  const schema = options.schema ?? DEFAULT_SAVE_SCHEMA;
  let entities: SaveEntities;
  try {
    entities = await streamSave(file, schema, options.loc);
  } catch (e) {
    return { ...blank, error: `cannot read save: ${(e as Error).message}` };
  }
  if (!entities.meta) return { ...blank, error: IRONMAN_ERROR };

  const date = formatDate(scalar(entities.meta, schema.dateKey ?? DEFAULT_DATE_KEY));
  const name = scalar(entities.meta, schema.nameKey ?? DEFAULT_NAME_KEY) ?? "";
  const source = { name, date, game: options.gameId };
  if (scalar(entities.meta, IRONMAN_KEY) === "yes") {
    return { values: {}, source, error: IRONMAN_ERROR };
  }

  const ctx: SaveContext = {
    ...entities,
    tag: schema.registry ? scalar(entities.country, schema.registry.tagKey) : undefined,
    date,
    loc: options.loc,
  };
  const values: Record<string, string> = {};
  for (const mapping of schema.mappings) {
    const value = mapping.read(ctx);
    if (!value) continue;
    for (const chain of mapping.chains) values[chain] = value;
  }
  if (schema.expand) Object.assign(values, schema.expand(ctx));
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

/** The first `ZIP_HEAD_BYTES` of the file, or fewer if it is shorter. */
async function readHead(file: string): Promise<Buffer> {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(ZIP_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, ZIP_HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The save's script as a byte stream: the file itself, or the packed entry
 * inflated out of it. `close()` tears the whole chain down, which `destroy()`
 * on the tail alone would not do.
 */
interface Body {
  input: Readable;
  close: () => void;
}

function openBody(file: string, entry: ZipEntry | undefined): Body {
  if (!entry) {
    const plain = fs.createReadStream(file);
    return { input: plain, close: () => plain.destroy() };
  }
  const end = entry.compressedSize === undefined ? undefined : entry.dataStart + entry.compressedSize - 1;
  const raw = fs.createReadStream(file, { start: entry.dataStart, end });
  if (entry.method === 0) return { input: raw, close: () => raw.destroy() };
  // Raw deflate ends itself at the end of the stream, so an unknown compressed
  // size (a data descriptor) costs nothing.
  const inflate = zlib.createInflateRaw();
  raw.on("error", (e) => inflate.destroy(e));
  raw.pipe(inflate);
  return {
    input: inflate,
    close: () => {
      raw.destroy();
      inflate.destroy();
    },
  };
}

/** The zip entry a packed save keeps its script in. */
async function packedGamestate(file: string): Promise<ZipEntry | undefined> {
  const entry = findZipEntry(await readHead(file));
  if (!entry || entry.name !== PACKED_ENTRY) return undefined;
  return entry.method === 0 || entry.method === 8 ? entry : undefined;
}

/**
 * The played record's id, for a save that names it near the END of the script.
 * A chunk scan for the marker costs a quarter of what a line-by-line pass would
 * (225 ms against 1.8 s on a 4.9-million-line save) and holds only a 2 KB
 * window.
 */
async function findPlayerId(
  file: string,
  entry: ZipEntry | undefined,
  marker: string,
  idKey: string
): Promise<string | undefined> {
  const { input, close } = openBody(file, entry);
  let window = "";
  let at = -1;
  try {
    for await (const chunk of input) {
      window += (chunk as Buffer).toString("latin1");
      if (at < 0) {
        at = window.indexOf(marker);
        if (at < 0) window = window.slice(-marker.length);
      }
      if (at >= 0 && window.length - at >= 2048) break;
    }
  } finally {
    close();
  }
  if (at < 0) return undefined;
  return new RegExp(`\\b${idKey}=(\\d+)`).exec(window.slice(at, at + 2048))?.[1];
}

/**
 * Read the blocks a preview needs. A registry save gets them all in one pass; a
 * record save needs the meta first (which also settles ironman/binary, so a
 * save with nothing to read costs one line), then the player's id, then the
 * pass that cuts out the record.
 */
async function streamSave(
  file: string,
  schema: SaveSchema,
  loc: (key: string) => string | undefined
): Promise<SaveEntities> {
  const entry = await packedGamestate(file);
  const out = await scanBody(file, entry, schema, loc, undefined);
  const record = schema.record;
  if (!record || !out.meta || scalar(out.meta, IRONMAN_KEY) === "yes") return out;

  const playerId = await findPlayerId(file, entry, record.marker, record.idKey);
  if (!playerId) return out;
  out.character = (await scanBody(file, entry, schema, loc, playerId)).character;
  return out;
}

/**
 * Lines kept per cut-out block. A country entry runs a few hundred lines and
 * everything read from one sits near its top; the cap only bounds what a
 * pathological save could cost. (A real character record measures 360 lines.)
 */
const MAX_CAPTURE_LINES = 4000;

/** A block being cut out of the stream. */
interface Capture {
  /** Where it sits, outermost key first: `["country_manager","database","1"]`. */
  path: string[];
  lines: string[];
}

/**
 * One pass over the script. A registry save writes its blocks in the order the
 * reader needs them (the meta, then the countries, then what a country points
 * at), which is why the played country's capital and ruler ids are already
 * known when their own blocks go by.
 */
async function scanBody(
  file: string,
  entry: ZipEntry | undefined,
  schema: SaveSchema,
  loc: (key: string) => string | undefined,
  playerId: string | undefined
): Promise<SaveEntities> {
  const { input, close } = openBody(file, entry);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const out: SaveEntities = {};
  const registry = schema.registry;
  const record = playerId === undefined ? undefined : schema.record;
  const tagLine = registry && new RegExp(`^\\s*${registry.tagKey}="?([A-Za-z_0-9]+)"?`);
  const mainLine = registry && new RegExp(`^\\s*${registry.mainKey}=yes\\b`);

  // The block keys we are inside of, outermost first.
  const stack: string[] = [];
  let capture: Capture | null = null;
  /** The country entry going by right now; kept only if it is the player's. */
  let candidate: { tag?: string; main: boolean } | null = null;
  let playerCountry: string | null = null;
  let fallbackCountry: string | null = null;
  const linkIds: Partial<Record<SaveSlot, string>> = {};
  let lineNo = 0;
  let done = false;

  for await (const raw of rl) {
    lineNo++;
    const line = lineNo === 1 && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

    // A binary or compressed body is not script: a text save's header line is
    // short and printable, and the meta block opens right after it.
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
            if (registry && stack[0] === registry.countryBlock) candidate = { main: false };
          }
        } else if (c === "}") {
          const closed = stack.pop();
          if (capture && stack.length === capture.path.length - 1) {
            const tail = line.slice(Math.max(captureStart, 0), i + 1);
            const { path, lines } = capture;
            capture = null;
            captureStart = -1;
            keep(path, [...lines, tail].join("\n"));
          } else if (!capture && stack.length === 0 && registry && closed === registry.countryBlock) {
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
  close();
  finishCountries();
  return out;

  /** Is the block we just entered one of the few worth cutting out? */
  function wanted(): boolean {
    if (stack.length === 1) return stack[0] === META_BLOCK;
    if (record) return stack.length === 2 && stack[0] === record.block && stack[1] === playerId;
    if (!registry || stack.length !== 3 || stack[1] !== registry.entries) return false;
    if (stack[0] === registry.countryBlock) return !playerCountry;
    return registry.links.some((l) => l.block === stack[0] && linkIds[l.slot] === stack[2]);
  }

  /** A country entry says who it is in two lines near its top. */
  function scanCountry(line: string): void {
    if (!candidate || !tagLine || !mainLine) return;
    const def = tagLine.exec(line);
    if (def) candidate.tag = def[1];
    else if (mainLine.test(line)) candidate.main = true;
  }

  /** A cut-out block just closed: file it, and note what it points at. */
  function keep(path: string[], text: string): void {
    if (path[0] === META_BLOCK) {
      out.meta = parseBlock(text);
      // Only a registry save reads on from the meta in this same pass; a record
      // save that has no player id yet, or a game with no schema, is finished.
      if (!registry && !record) done = true;
      return;
    }
    if (record && path[0] === record.block) {
      out.character = parseBlock(text);
      done = true;
      return;
    }
    if (!registry) return;
    if (path[0] === registry.countryBlock) {
      // The played country is the one whose tag localizes to the campaign name
      // the meta states (`player_manager` is empty in a single-player save).
      const name = scalar(out.meta, schema.nameKey ?? DEFAULT_NAME_KEY);
      const tag = candidate?.tag;
      if (tag && (loc(tag) === name || tag === name)) playerCountry = text;
      else if (candidate?.main && !fallbackCountry) fallbackCountry = text;
      candidate = null;
      return;
    }
    for (const link of registry.links) {
      if (link.block === path[0] && linkIds[link.slot] === path[2]) out[link.slot] = parseBlock(text);
    }
    // The linked entries are the last of the blocks we need that a save writes.
    if (registry.links.every((l) => !linkIds[l.slot] || out[l.slot])) done = true;
  }

  /**
   * The country registry has gone by: settle on the played country (the tag
   * match, else the first main tag) and read the ids the later blocks are
   * found by.
   */
  function finishCountries(): void {
    if (!registry || out.country || !(playerCountry ?? fallbackCountry)) return;
    out.country = parseBlock(playerCountry ?? fallbackCountry ?? "");
    for (const link of registry.links) linkIds[link.slot] = scalar(out.country, link.key);
  }
}

/** The key in `key = {`, from the text just before the brace. */
function keyBefore(line: string, brace: number): string {
  const m = /([A-Za-z_0-9.-]+)\s*=\s*$/.exec(line.slice(Math.max(0, brace - 64), brace));
  return m ? m[1] : "";
}
