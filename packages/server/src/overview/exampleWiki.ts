/**
 * The Examples Wiki: one searchable catalog of every name the toolkit knows,
 * and, per name, everything it can say about it.
 *
 * Nothing here is hand-written knowledge. The rows come from the same derived
 * data the language features use - the user's script_docs tokens (or the
 * bundled snapshot / wiki tables behind them), the datafunction tables, and
 * the vanilla usage harvest - and the example sites are read out of the game
 * files at the moment they are asked for.
 *
 * Two requests, because the shapes differ by three orders of magnitude: the
 * index is thousands of tiny rows a client filters locally, the detail is one
 * row with its prose, its usage block and its vanilla sites.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type {
  ExampleWikiDetail,
  ExampleWikiEntry,
  ExampleWikiEntryParams,
  ExampleWikiIndex,
  ExampleWikiKind,
  ExampleWikiSite,
} from "@px-lsp/protocol/protocol";
import type { TokenData } from "@px-lsp/protocol/types";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { membersOf, producersOf, type DataTypeMember, type DataTypesData } from "../data/dataTypes";
import type { DataFnUsage } from "../data/dataFnUsage";

/** Everything the two computations read. Passed in, so tests can synthesize it. */
export interface ExampleWikiSources {
  /** Engine tokens (trigger / effect / event_target / modifier). */
  tokens: TokenData[];
  /** `[ ... ]` globals, type members and data types. */
  dataTypes: DataTypesData;
  /** Vanilla `[ ... ]` harvest: counts, literals, example sites. */
  usage: DataFnUsage;
  /** name -> vanilla occurrence count (the bundled freqs table). */
  counts: Record<string, number>;
  /** One sentence naming where the engine tokens came from. */
  tokenSource: string;
  /** True when the tokens are wiki-only, i.e. no script_docs dump was read. */
  needsScriptDocs: boolean;
  /** Game root, for resolving example sites; null = no game folder configured. */
  gamePath: string | null;
}

const SHORT_DOC_MAX = 140;
const LITERAL_CAP = 12;
const MEMBER_CAP = 60;
const PRODUCER_CAP = 20;
const SITE_CAP = 6;
const SITE_TEXT_MAX = 160;

// ---------------------------------------------------------------- index -----

/** First sentence of `doc`, capped: what a search row can show on one line. */
function shortDoc(doc: string): string {
  const flat = doc.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const stop = flat.search(/\.\s/);
  const first = stop > 0 ? flat.slice(0, stop + 1) : flat;
  return first.length > SHORT_DOC_MAX ? first.slice(0, SHORT_DOC_MAX - 1) + "…" : first;
}

/** The count a datafunction member is ranked by: its uses inside this owner's
 *  chains when vanilla writes them that way, else its uses anywhere. */
function memberCount(usage: DataFnUsage, owner: string, member: string): number {
  return usage.pairs.get(owner)?.get(member) ?? usage.memberPool.get(member) ?? 0;
}

/**
 * Every row the search box filters. Sorted by vanilla usage, most-used first,
 * then by name: a newcomer typing "add_" should meet `add_gold` before
 * `add_hook_no_effect`.
 */
export function buildExampleWikiIndex(src: ExampleWikiSources): ExampleWikiIndex {
  const entries: ExampleWikiEntry[] = [];
  for (const token of src.tokens) {
    entries.push({
      name: token.name,
      kind: token.kind,
      shortDoc: shortDoc(token.doc),
      count: src.counts[token.name] ?? 0,
    });
  }
  for (const [name, member] of src.dataTypes.globals) {
    entries.push({
      name,
      kind: "datafn_global",
      shortDoc: shortDoc(member.desc ?? ""),
      count: src.usage.starts.get(name) ?? 0,
    });
  }
  for (const [type, members] of src.dataTypes.types) {
    entries.push({
      name: type,
      kind: "data_type",
      shortDoc: `Data type with ${members.size} member${members.size === 1 ? "" : "s"}.`,
      count: src.usage.starts.get(type) ?? 0,
    });
    for (const [member, spec] of members) {
      entries.push({
        name: `${type}.${member}`,
        kind: "datafn_member",
        owner: type,
        shortDoc: shortDoc(spec.desc ?? ""),
        count: memberCount(src.usage, type, member),
      });
    }
  }
  entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const sources = [`Triggers, effects, event targets and modifiers come from ${src.tokenSource}.`];
  sources.push(
    src.dataTypes.source === "data_types.log"
      ? "Datafunctions and data types come from your own DumpDataTypes output."
      : "Datafunctions and data types come from the bundled wiki tables. Run DumpDataTypes in the game console for the list your game version really has."
  );
  sources.push(
    src.gamePath
      ? "Usage counts come from the bundled count tables, and the examples are read from your game files."
      : "Usage counts come from the bundled count tables. Set the game folder to see where the game itself uses a name."
  );
  return { entries, sources, needsScriptDocs: src.needsScriptDocs };
}

// --------------------------------------------------------------- detail -----

function topKeys(map: Map<string, number> | undefined, cap: number): { list: string[]; total: number } {
  if (!map) return { list: [], total: 0 };
  const sorted = [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { list: sorted.slice(0, cap).map(([k]) => k), total: sorted.length };
}

/** One sentence saying where a datafunction entry's facts come from. */
function memberProvenance(member: DataTypeMember): string {
  if (member.src === "dump") return "Read from your DumpDataTypes output, so it matches your game version.";
  if (member.src === "macro") return "Read from a data_binding macro definition.";
  return "Read from the bundled wiki data type tables, which may lag your game version.";
}

/** The `usage:` block a token carries, or nothing. */
function usageBlock(token: TokenData): string | undefined {
  return token.usage && token.usage.trim() !== "" ? token.usage : undefined;
}

function emptyDetail(name: string, kind: ExampleWikiKind, count: number): ExampleWikiDetail {
  return {
    name,
    kind,
    count,
    doc: "",
    scopes: [],
    literals: [],
    literalsTotal: 0,
    members: [],
    membersTotal: 0,
    producers: [],
    producersTotal: 0,
    examples: [],
    provenance: "",
  };
}

/**
 * Everything known about one row. `null` when the name is not in the catalog.
 *
 * Async because the example sites for an engine token are a search of the game
 * files: it runs once per name and is then remembered (see {@link SiteFinder}).
 */
export async function computeExampleWikiEntry(
  src: ExampleWikiSources,
  params: ExampleWikiEntryParams,
  sites: SiteFinder
): Promise<ExampleWikiDetail | null> {
  const name = params?.name ?? "";
  if (name === "") return null;
  if (params.kind === "data_type") return dataTypeDetail(src, name);
  if (params.kind === "datafn_global" || params.kind === "datafn_member") {
    return dataFnDetail(src, name, params.kind);
  }
  return tokenDetail(src, name, params.kind, sites);
}

async function tokenDetail(
  src: ExampleWikiSources,
  name: string,
  kind: ExampleWikiKind,
  sites: SiteFinder
): Promise<ExampleWikiDetail | null> {
  const token = src.tokens.find((t) => t.name === name && t.kind === kind);
  if (!token) return null;
  const detail = emptyDetail(name, kind, src.counts[name] ?? 0);
  detail.doc = token.doc;
  detail.scopes = token.scopes;
  if (token.traits && token.traits.trim() !== "") detail.traits = token.traits;
  detail.usage = usageBlock(token);
  detail.provenance = src.tokenSource;
  const found = await sites.find(name);
  detail.examples = found.sites;
  detail.examplesNote = found.note;
  return detail;
}

function dataFnDetail(
  src: ExampleWikiSources,
  name: string,
  kind: ExampleWikiKind
): ExampleWikiDetail | null {
  const dot = name.lastIndexOf(".");
  const owner = kind === "datafn_member" && dot > 0 ? name.slice(0, dot) : null;
  const short = owner ? name.slice(dot + 1) : name;
  const member = owner ? membersOf(src.dataTypes, owner)?.get(short) : src.dataTypes.globals.get(short);
  if (!member) return null;

  const count = owner ? memberCount(src.usage, owner, short) : (src.usage.starts.get(short) ?? 0);
  const detail = emptyDetail(name, kind, count);
  if (owner) detail.owner = owner;
  detail.doc = member.desc ?? "";
  if (member.ret) detail.ret = member.ret;
  if (member.args && member.args.length > 0) detail.args = member.args;
  detail.callKind = member.kind;
  const literals = topKeys(src.usage.literals.get(short), LITERAL_CAP);
  detail.literals = literals.list;
  detail.literalsTotal = literals.total;
  // A member's return type is itself a data type: list what it can be asked
  // next, which is the whole point of a chain.
  const next = member.ret ? membersOf(src.dataTypes, member.ret) : null;
  if (next) {
    detail.members = [...next.keys()].sort().slice(0, MEMBER_CAP);
    detail.membersTotal = next.size;
  }
  detail.examples = resolveHarvestedSites(src, src.usage.examples.get(short) ?? []);
  if (detail.examples.length === 0) {
    detail.examplesNote = src.gamePath
      ? "No use of this name was found in the game's gui and localization files."
      : "Set the game folder to see where the game itself uses this.";
  }
  detail.provenance = memberProvenance(member);
  return detail;
}

function dataTypeDetail(src: ExampleWikiSources, name: string): ExampleWikiDetail | null {
  const members = membersOf(src.dataTypes, name);
  if (!members) return null;
  const detail = emptyDetail(name, "data_type", src.usage.starts.get(name) ?? 0);
  detail.doc = `A data type. Reach one, then ask it for any of its ${members.size} members.`;
  detail.members = [...members.keys()].sort().slice(0, MEMBER_CAP);
  detail.membersTotal = members.size;
  const producers = producersOf(src.dataTypes, name);
  detail.producers = producers.slice(0, PRODUCER_CAP);
  detail.producersTotal = producers.length;
  detail.examples = resolveHarvestedSites(src, src.usage.examples.get(name) ?? []);
  if (detail.examples.length === 0 && !src.gamePath) {
    detail.examplesNote = "Set the game folder to see where the game itself uses this.";
  }
  detail.provenance =
    src.dataTypes.source === "data_types.log"
      ? "Read from your DumpDataTypes output, so it matches your game version."
      : "Read from the bundled wiki data type tables, which may lag your game version.";
  return detail;
}

/** Harvest sites carry game-relative paths; a client needs absolute ones. */
function resolveHarvestedSites(
  src: ExampleWikiSources,
  found: ReadonlyArray<{ text: string; file: string; line: number }>
): ExampleWikiSite[] {
  if (!src.gamePath) return [];
  return found.map((e) => ({
    text: e.text,
    file: path.join(src.gamePath as string, e.file),
    line: e.line,
  }));
}

// ------------------------------------------------------- vanilla sites ------

/**
 * Where the game itself writes an engine token.
 *
 * There is no index to ask: engine tokens are deliberately kept OUT of the
 * reference index and out of the lazy reference scanner (they appear in nearly
 * every file, and holding their sites would cost more memory than the whole
 * mod index). So this reads the game's script folders until it has enough
 * sites, which for a token anyone browses is the first handful of files.
 *
 * Two guards keep that honest: the answer per name is remembered for as long
 * as the paths hold, and the walk yields to the event loop, so a search for a
 * name vanilla never uses does not block the server while it runs.
 */
export class SiteFinder {
  private folders: string[] = [];
  private gamePath: string | null = null;
  private files: string[] | null = null;
  private cache = new Map<string, Promise<{ sites: ExampleWikiSite[]; note?: string }>>();

  /** Point at a game root (or null). Drops everything remembered. */
  setRoots(gamePath: string | null, folders: string[]): void {
    this.gamePath = gamePath;
    this.folders = folders;
    this.files = null;
    this.cache.clear();
  }

  find(name: string): Promise<{ sites: ExampleWikiSite[]; note?: string }> {
    if (!this.gamePath || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return Promise.resolve({
        sites: [],
        note: this.gamePath ? undefined : "Set the game folder to see where the game itself uses this.",
      });
    }
    let pending = this.cache.get(name);
    if (!pending) {
      pending = this.scan(name);
      this.cache.set(name, pending);
    }
    return pending;
  }

  private fileList(): string[] {
    if (this.files) return this.files;
    const root = this.gamePath as string;
    const files: string[] = [];
    for (const folder of this.folders) files.push(...listFiles(path.join(root, folder), ".txt"));
    this.files = files;
    return files;
  }

  private async scan(name: string): Promise<{ sites: ExampleWikiSite[]; note?: string }> {
    const files = this.fileList();
    const sites: ExampleWikiSite[] = [];
    let read = 0;
    for (const file of files) {
      if (sites.length >= SITE_CAP) break;
      collectSites(file, name, sites);
      if (++read % 40 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (sites.length === 0) {
      return { sites, note: `Searched ${files.length} game files and found no use of this name.` };
    }
    return {
      sites,
      note: sites.length >= SITE_CAP ? `The first ${SITE_CAP} sites found; the game has more.` : undefined,
    };
  }
}

/** Lines of one file that use `name` as a key, appended until the cap. */
export function collectSites(file: string, name: string, out: ExampleWikiSite[]): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!text.includes(name)) return;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < SITE_CAP; i++) {
    const line = lines[i];
    const code = line.split("#")[0];
    // A key, not a mention: the name followed by an operator. That is how
    // every trigger, effect and modifier is written, and it keeps a comment
    // or a longer name that merely contains this one out of the answer.
    if (!new RegExp(`(^|[^A-Za-z0-9_.])${escapeName(name)}\\s*[=<>]`).test(code)) continue;
    const trimmed = line.trim();
    out.push({
      text: trimmed.length > SITE_TEXT_MAX ? trimmed.slice(0, SITE_TEXT_MAX - 1) + "…" : trimmed,
      file,
      line: i + 1,
    });
  }
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
