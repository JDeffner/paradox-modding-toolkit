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
 * The one exception is the grammar vocabulary (keywords, scope words), which
 * the game documents nowhere. Those rows read the SAME table the hover reads
 * (data/keywordDocs.ts), so a hover and its article can never disagree, and
 * their articles say in words that the description is the toolkit's own.
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
  ExampleWikiFromScope,
  ExampleWikiIndex,
  ExampleWikiKind,
  ExampleWikiSite,
} from "@px-lsp/protocol/protocol";
import type { TokenData } from "@px-lsp/protocol/types";
import { exampleWikiVariableKinds } from "@px-lsp/protocol/protocol";
import { listFiles } from "@px-lsp/protocol/fsWalk";
import { keywordArticle, keywordArticleNames, SCOPE_WORD_DOCS, scopeWordDoc } from "../data/keywordDocs";
import { membersOf, producersOf, type DataTypeMember, type DataTypesData } from "../data/dataTypes";
import type { DataFnUsage } from "../data/dataFnUsage";

/** One indexed place a variable is set or read. Lines are 0-based, as the
 *  definition and reference indexes store them. */
export interface WikiVariableSite {
  file: string;
  line: number;
  /** Top-level definition the site sits in, when the index recorded one. */
  container?: string;
}

/**
 * One variable or list the definition index knows about, gathered by the host
 * (server.ts) from the definition index, the reference index and the set-site
 * type analysis. The builder below never touches an index itself.
 */
export interface WikiVariable {
  name: string;
  kind: ExampleWikiKind;
  /** Set sites: `set_variable` / `add_to_*_list` declarations, capped. */
  sets: WikiVariableSite[];
  /** Set sites found before the list was capped. */
  setsTotal: number;
  /** Read sites: `has_variable`, `var:` uses, iterator `variable =` keys, capped. */
  reads: WikiVariableSite[];
  /** Read sites found before the list was capped. */
  readsTotal: number;
  /**
   * Scope types the set sites resolve to. `null` when a set site is anchored at
   * runtime and nothing can be said about it (AD-5: annotate, never guess);
   * empty when no set site carried a value expression at all.
   */
  types: string[] | null;
  /** Origin labels of the set sites ("My Mod", "vanilla"). */
  origins: string[];
}

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
  /** Variables and lists the definition index knows, keyed `kind:name`. */
  variables: ReadonlyMap<string, WikiVariable>;
}

const SHORT_DOC_MAX = 140;
const LITERAL_CAP = 12;
const MEMBER_CAP = 60;
const PRODUCER_CAP = 20;
const SITE_CAP = 6;
/** Safety cap per "usable from this scope" list; the true total ships beside it. */
const FROM_SCOPE_CAP = 2000;
const SITE_TEXT_MAX = 160;
const CONTAINER_CAP = 8;
/** Lines kept on each side of a site's own line. */
const SITE_CONTEXT_LINES = 3;
/** Total characters one site's context may cost, trimmed from the far edges. */
const SITE_CONTEXT_CHARS = 600;

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
  for (const variable of src.variables.values()) {
    entries.push({
      name: variable.name,
      kind: variable.kind,
      shortDoc: variableShortDoc(variable),
      count: variable.setsTotal + variable.readsTotal,
    });
  }
  // Script grammar: the words the hover documents that no dump ever names.
  // Same table the hover reads, so the two can never disagree.
  for (const name of keywordArticleNames()) {
    entries.push({
      name,
      kind: "keyword",
      shortDoc: shortDoc(keywordArticle(name)?.doc ?? ""),
      count: src.counts[name] ?? 0,
    });
  }
  for (const [name, doc] of Object.entries(SCOPE_WORD_DOCS)) {
    entries.push({ name, kind: "scope_word", shortDoc: shortDoc(doc), count: src.counts[name] ?? 0 });
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
  if (src.variables.size > 0) {
    sources.push(
      `The ${src.variables.size} variable and list names come from the indexed script itself, from the places that set them.`
    );
  }
  sources.push(
    "The keywords and scope words are described by the toolkit: the game documents its triggers and effects, never the grammar that holds them together."
  );
  return { entries, sources, needsScriptDocs: src.needsScriptDocs };
}

/** A variable row's one line: how much of the script leans on this name. */
function variableShortDoc(variable: WikiVariable): string {
  const sets = variable.setsTotal;
  const reads = variable.readsTotal;
  const readPart = reads === 0 ? "never read" : reads === 1 ? "read in 1 place" : `read in ${reads} places`;
  if (sets === 0) return `${readPart[0].toUpperCase()}${readPart.slice(1)}.`;
  return `Set in ${sets === 1 ? "1 place" : `${sets} places`}, ${readPart}.`;
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
  const lines = new LineCache();
  if (params.kind === "data_type") return dataTypeDetail(src, name, lines);
  if (params.kind === "datafn_global" || params.kind === "datafn_member") {
    return dataFnDetail(src, name, params.kind, lines);
  }
  if (VARIABLE_KINDS.has(params.kind)) return variableDetail(src, name, params.kind, lines);
  if (params.kind === "keyword" || params.kind === "scope_word") {
    return vocabularyDetail(src, name, params.kind, sites);
  }
  return tokenDetail(src, name, params.kind, sites);
}

const VARIABLE_KINDS = new Set<ExampleWikiKind>(exampleWikiVariableKinds);

/**
 * One keyword or scope-word article: the description the hover shows, and the
 * places the game's own files write the word.
 *
 * The description is the only thing here that is not read out of a file, and
 * it is single-sourced with the hover (data/keywordDocs.ts) so the two cannot
 * drift. The provenance line says so plainly.
 */
async function vocabularyDetail(
  src: ExampleWikiSources,
  name: string,
  kind: "keyword" | "scope_word",
  sites: SiteFinder
): Promise<ExampleWikiDetail | null> {
  const article = kind === "keyword" ? keywordArticle(name) : scopeWordDoc(name);
  if (!article) return null;
  const detail = emptyDetail(article.name, kind, src.counts[article.name] ?? 0);
  detail.doc = article.doc;
  detail.provenance =
    kind === "keyword"
      ? "Written by the toolkit. The game's script_docs dumps document triggers and effects, never the grammar around them, so this description ships with the extension. The examples below are read from the game's own files."
      : "Written by the toolkit. A scope word is engine grammar, not a documented token, so this description ships with the extension. The examples below are read from the game's own files.";
  const found = await sites.find(article.name);
  detail.examples = found.sites;
  detail.examplesNote = found.note;
  return detail;
}

/**
 * One variable or list article: what the set sites say it holds, which
 * definitions set it, and every place the indexed files set or read it.
 *
 * Nothing here is engine vocabulary. The name exists because the user's own
 * script wrote it, so the article is entirely a report of the index.
 */
function variableDetail(
  src: ExampleWikiSources,
  name: string,
  kind: ExampleWikiKind,
  lines: LineCache
): ExampleWikiDetail | null {
  const variable = src.variables.get(`${kind}:${name}`);
  if (!variable) return null;
  const detail = emptyDetail(name, kind, variable.setsTotal + variable.readsTotal);
  detail.doc =
    `A ${kind.replace(/_/g, " ")} the indexed script files create. No engine name declares it: ` +
    `the toolkit knows it because the files below set it.`;
  detail.valueType = valueTypeWord(variable);

  const containers = topCounted(
    variable.sets.map((site) => site.container).filter((c): c is string => c !== undefined)
  );
  detail.containers = containers.list.slice(0, CONTAINER_CAP);
  detail.containersTotal = containers.list.length;

  const sets = variable.sets.slice(0, SITE_CAP).map((site) => indexedSite(site, "set", lines));
  const reads = variable.reads.slice(0, SITE_CAP).map((site) => indexedSite(site, "read", lines));
  detail.examples = [...sets, ...reads];
  const shown = sets.length + reads.length;
  const total = variable.setsTotal + variable.readsTotal;
  if (shown < total) detail.examplesNote = `The first ${shown} of ${total} places; the script has more.`;

  detail.provenance =
    variable.origins.length > 0
      ? `Read from the indexed files of ${variable.origins.join(", ")}.`
      : "Read from the indexed script files.";
  return detail;
}

/** What a variable holds, in words. Unknown is a real answer: a value set from
 *  a runtime scope cannot be typed statically (AD-5). */
function valueTypeWord(variable: WikiVariable): string {
  const isList = variable.kind === "list" || variable.kind.endsWith("_list");
  const types = variable.types;
  if (!types || types.length === 0) return isList ? "a list of something unknown" : "unknown";
  const joined = [...types].sort().join(" or ");
  return isList ? `a list of ${joined}` : joined;
}

/** Distinct values, most frequent first. */
function topCounted(values: string[]): { list: string[] } {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { list: sorted.map(([k]) => k) };
}

/** An index site (0-based line) as a wiki site (1-based), with its context. */
function indexedSite(site: WikiVariableSite, label: string, lines: LineCache): ExampleWikiSite {
  const line = site.line + 1;
  const out: ExampleWikiSite = { text: "", file: site.file, line, label };
  const text = lines.lines(site.file);
  if (text) {
    out.text = capText((text[site.line] ?? "").trim());
    attachContext(out, text);
  }
  return out;
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
  const fromScope = usableFromScopes(src, token.scopes);
  if (fromScope.length > 0) detail.fromScope = fromScope;
  const found = await sites.find(name);
  detail.examples = found.sites;
  detail.examplesNote = found.note;
  return detail;
}

/**
 * What can be written once this token has moved the scope somewhere else.
 *
 * The whole answer is the declared scopes of the other catalog rows, matched
 * word for word: a trigger or effect names the scopes it works in, a target
 * names its `input:`. A token that declares nothing is simply absent, which is
 * the honest answer - the docs are the only source, and nothing here closes
 * over a scope model or reads "no scopes" as "everywhere" (AD-5).
 */
function usableFromScopes(src: ExampleWikiSources, scopes: string[]): ExampleWikiFromScope[] {
  const out: ExampleWikiFromScope[] = [];
  for (const scope of scopes) {
    if (!scope.startsWith("output: ")) continue;
    const word = scope.slice("output: ".length).toLowerCase();
    if (word === "" || out.some((e) => e.scope.toLowerCase() === word)) continue;
    const triggers: string[] = [];
    const effects: string[] = [];
    const targets: string[] = [];
    for (const token of src.tokens) {
      if (token.kind === "trigger" || token.kind === "effect") {
        if (!token.scopes.some((s) => s.toLowerCase() === word)) continue;
        (token.kind === "trigger" ? triggers : effects).push(token.name);
      } else if (token.kind === "event_target") {
        if (token.scopes.some((s) => s.toLowerCase() === `input: ${word}`)) targets.push(token.name);
      }
    }
    out.push({
      scope: scope.slice("output: ".length),
      triggers: byCount(src, triggers).slice(0, FROM_SCOPE_CAP),
      triggersTotal: triggers.length,
      effects: byCount(src, effects).slice(0, FROM_SCOPE_CAP),
      effectsTotal: effects.length,
      targets: byCount(src, targets).slice(0, FROM_SCOPE_CAP),
      targetsTotal: targets.length,
    });
  }
  return out;
}

/** Names ordered by how often the game's own files write them, most first. */
function byCount(src: ExampleWikiSources, names: string[]): string[] {
  return names.sort((a, b) => (src.counts[b] ?? 0) - (src.counts[a] ?? 0) || a.localeCompare(b));
}

function dataFnDetail(
  src: ExampleWikiSources,
  name: string,
  kind: ExampleWikiKind,
  lines: LineCache
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
  detail.examples = resolveHarvestedSites(src, src.usage.examples.get(short) ?? [], lines);
  if (detail.examples.length === 0) {
    detail.examplesNote = src.gamePath
      ? "No use of this name was found in the game's gui and localization files."
      : "Set the game folder to see where the game itself uses this.";
  }
  detail.provenance = memberProvenance(member);
  return detail;
}

function dataTypeDetail(src: ExampleWikiSources, name: string, lines: LineCache): ExampleWikiDetail | null {
  const members = membersOf(src.dataTypes, name);
  if (!members) return null;
  const detail = emptyDetail(name, "data_type", src.usage.starts.get(name) ?? 0);
  detail.doc = `A data type. Reach one, then ask it for any of its ${members.size} members.`;
  detail.members = [...members.keys()].sort().slice(0, MEMBER_CAP);
  detail.membersTotal = members.size;
  const producers = producersOf(src.dataTypes, name);
  detail.producers = producers.slice(0, PRODUCER_CAP);
  detail.producersTotal = producers.length;
  detail.examples = resolveHarvestedSites(src, src.usage.examples.get(name) ?? [], lines);
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
  found: ReadonlyArray<{ text: string; file: string; line: number }>,
  lines: LineCache
): ExampleWikiSite[] {
  if (!src.gamePath) return [];
  return found.map((e) => {
    const site: ExampleWikiSite = {
      text: e.text,
      file: path.join(src.gamePath as string, e.file),
      line: e.line,
    };
    const text = lines.lines(site.file);
    if (text) attachContext(site, text);
    return site;
  });
}

// -------------------------------------------------------- inline context ----

/**
 * File lines by path, remembered for one request.
 *
 * A name's sites cluster: the six examples of a variable usually sit in two or
 * three files, and the detail is computed per click.
 */
class LineCache {
  private files = new Map<string, string[] | null>();

  lines(file: string): string[] | null {
    let hit = this.files.get(file);
    if (hit === undefined) {
      try {
        hit = fs.readFileSync(file, "utf8").split(/\r?\n/);
      } catch {
        hit = null;
      }
      this.files.set(file, hit);
    }
    return hit;
  }
}

function capText(text: string): string {
  return text.length > SITE_TEXT_MAX ? text.slice(0, SITE_TEXT_MAX - 1) + "…" : text;
}

/** Give a site the lines around its own, so a reader sees the block it sits in
 *  instead of one line torn out of it. No-op when the line is out of range. */
export function attachContext(site: ExampleWikiSite, lines: string[]): void {
  const at = site.line - 1;
  if (at < 0 || at >= lines.length) return;
  let from = Math.max(0, at - SITE_CONTEXT_LINES);
  let to = Math.min(lines.length - 1, at + SITE_CONTEXT_LINES);
  // A blank edge line teaches nothing; drop it before the character cap does.
  while (from < at && lines[from].trim() === "") from++;
  while (to > at && lines[to].trim() === "") to--;
  let block = lines.slice(from, to + 1).map(capText);
  while (block.length > 1 && block.join("\n").length > SITE_CONTEXT_CHARS) {
    if (to > at && to - at >= at - from) to--;
    else if (from < at) from++;
    else break;
    block = lines.slice(from, to + 1).map(capText);
  }
  site.context = dedent(block);
  site.contextStart = from + 1;
}

/** Drop the indentation every line of the block shares: game script nests deep,
 *  and a reading pane is not as wide as an editor. */
function dedent(block: string[]): string[] {
  let common: string | null = null;
  for (const line of block) {
    if (line.trim() === "") continue;
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (common === null) {
      common = indent;
      continue;
    }
    let i = 0;
    while (i < common.length && i < indent.length && common[i] === indent[i]) i++;
    common = common.slice(0, i);
  }
  if (common === null || common === "") return block;
  const prefix = common;
  return block.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line.trimStart()));
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
    const site: ExampleWikiSite = { text: capText(line.trim()), file, line: i + 1 };
    attachContext(site, lines);
    out.push(site);
  }
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
