/**
 * paradox/dynastyTree: a dynasty as a family tree, read out of the game's own
 * files. `common/dynasties` and `common/dynasty_houses` give the names, and
 * `history/characters` gives the members with their parents, spouses and dates.
 *
 * Which keys a character block carries is MEASURED, not remembered. Counted
 * over the 207 vanilla files of `<game>/history/characters` on the install the
 * repo's dev-paths point at (2026-09-03, 71 142 blocks), keys at the
 * character's own level: name 71 138, culture 71 082, religion 70 078,
 * dynasty 56 738, father 55 961, trait 28 690, mother 14 911, female 12 520,
 * dynasty_house 10 426, then the four skill keys. `birth` (56 451) and `death`
 * (56 465) are NOT character-level keys: they sit inside a dated
 * `880.1.1 = { … }` block, which is also where `add_spouse` lives (6 811 of
 * 6 816). So the date of a birth is the KEY of the block that carries it.
 * Values: `name` is a quoted plain string (never a loc key), `female = yes`
 * (12 229) with `no` spelled out 68 times, `birth = yes` or `birth = "date"`,
 * `death` additionally as a block (`death = { death_reason = … }`).
 *
 * The whole character corpus is parsed ONCE per index revision, because a
 * dynasty's members cannot be found without reading every file: the link points
 * from the character to the dynasty, never back. Measured on that same install
 * (71 142 characters, 10 338 dynasties, 17.4 MB): 0.8 s for the first
 * request, 12 ms for the next, 1 ms for one dynasty, 62 MB retained.
 */
import * as fs from "fs";
import type {
  DynastyCharacter,
  DynastyHouse,
  DynastySummary,
  DynastyTreeParams,
  DynastyTreeResult,
} from "@px-lsp/protocol/protocol";
import type { DefSource, Definition } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import { activeProfile } from "../games/active";
import { decode, LineIndex, parseScript, type BlockNode, type Statement } from "../parser";

/** Definition kinds this view is built from; each must be in the profile schema. */
const DYNASTY_KIND = "dynasty";
const HOUSE_KIND = "dynasty_house";
const CHARACTER_KIND = "character";

/** Script is last-in-wins, and a mod's file beats a parent's beats vanilla's. */
const SOURCE_RANK: Record<DefSource, number> = { mod: 2, parent: 1, vanilla: 0 };

/** A dated block key: the game writes `880.1.1 = { birth = yes }`. */
const DATE_RE = /^-?\d+\.\d+\.\d+$/;

interface FileRef {
  file: string;
  source: DefSource;
}

interface DynastyRecord {
  id: string;
  nameKey: string;
  culture?: string;
  source: DefSource;
  file: string;
  line: number;
}

interface HouseRecord extends DynastyRecord {
  dynasty: string;
}

/** A character exactly as its block spells it; `external` is added per request. */
type CharacterRecord = Omit<DynastyCharacter, "external">;

/**
 * Vanilla holds 71 142 characters, and the model is kept for as long as the
 * index revision lasts, so the repeated scalars are shared instead of stored
 * 71 142 times: 71 082 `culture` values are drawn from ~130 cultures, and the
 * empty trait and spouse lists are one array between them. Measured on the
 * vanilla install, this is the difference between 73 MB and 62 MB retained.
 */
const NONE: readonly string[] = [];
type Intern = (value: string) => string;
function interner(): Intern {
  const pool = new Map<string, string>();
  return (value) => {
    const known = pool.get(value);
    if (known !== undefined) return known;
    pool.set(value, value);
    return value;
  };
}

interface DynastyModel {
  revision: number;
  dynasties: Map<string, DynastyRecord>;
  houses: Map<string, HouseRecord>;
  characters: Map<string, CharacterRecord>;
  /** Dynasty id -> member ids, in file order. Houses resolve to their dynasty. */
  members: Map<string, string[]>;
  nextCharacterId: string;
  nextDynastyId: string;
}

let cached: DynastyModel | null = null;

/**
 * How long a model outlives the last request that used it. The panel is opened
 * for a while and then closed, and 62 MB is too much to hold for the life of
 * the server for a view nobody is looking at; a rebuild is a second's work.
 */
const IDLE_RELEASE_MS = 10 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Test hook: forget the cached model (the server invalidates by revision). */
export function clearDynastyModel(): void {
  cached = null;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** True while a model is held; the release path is what a test watches. */
export function hasDynastyModel(): boolean {
  return cached !== null;
}

/** Restart the idle clock: the model lives ten minutes past its last reader. */
function keepAlive(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(clearDynastyModel, IDLE_RELEASE_MS);
  // A pending release must never hold the process open.
  idleTimer.unref?.();
}

function blockOf(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (v?.kind === "block") return v;
  if (v?.kind === "tagged-block") return v.block;
  return null;
}

function scalarOf(stmt: Statement): string | null {
  if (stmt.kind !== "assignment") return null;
  return stmt.value?.kind === "scalar" ? stmt.value.text : null;
}

/**
 * One character block into a record. Keys the form does not model (the four
 * skills, dna, nicknames, effects) are left where they are: this view reads,
 * and the writer preserves them from the source span.
 */
export function readCharacterBlock(
  id: string,
  block: BlockNode,
  where: { source: DefSource; file: string; line: number },
  intern: Intern = (v) => v
): CharacterRecord {
  const traits: string[] = [];
  const spouses: string[] = [];
  const out: CharacterRecord = { id, name: id, female: false, traits, spouses, ...where };
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment") continue;
    const key = stmt.key.text;
    if (DATE_RE.test(key)) {
      const dated = blockOf(stmt);
      if (!dated) continue;
      for (const inner of dated.statements) {
        if (inner.kind !== "assignment") continue;
        const ikey = inner.key.text;
        // A dated block dates its own statements: `birth`/`death` may say `yes`
        // or repeat the date, and `death = { … }` carries a reason.
        if (ikey === "birth") out.birth ??= key;
        else if (ikey === "death") out.death ??= key;
        else if (ikey === "add_spouse") {
          const spouse = scalarOf(inner);
          if (spouse) spouses.push(intern(spouse));
        }
      }
      continue;
    }
    const value = scalarOf(stmt);
    if (value === null) continue;
    switch (key) {
      case "name":
        out.name = value;
        break;
      case "female":
        out.female = value === "yes";
        break;
      case "dynasty":
        out.dynasty = intern(value);
        break;
      case "dynasty_house":
        out.house = intern(value);
        break;
      case "father":
        out.father = value;
        break;
      case "mother":
        out.mother = value;
        break;
      case "culture":
        out.culture = intern(value);
        break;
      case "religion":
        out.religion = intern(value);
        break;
      case "trait":
        traits.push(intern(value));
        break;
      case "add_spouse":
        // Rare (5 of 6 816) but legal at the character's own level.
        spouses.push(intern(value));
        break;
    }
  }
  if (traits.length === 0) out.traits = NONE as string[];
  if (spouses.length === 0) out.spouses = NONE as string[];
  return out;
}

/** `common/dynasties` and `common/dynasty_houses` share a block shape. */
function readDefinitionBlock(
  id: string,
  block: BlockNode,
  where: { source: DefSource; file: string; line: number }
): HouseRecord {
  const out: HouseRecord = { id, nameKey: "", dynasty: "", ...where };
  for (const stmt of block.statements) {
    const value = scalarOf(stmt);
    if (value === null || stmt.kind !== "assignment") continue;
    if (stmt.key.text === "name") out.nameKey = value;
    else if (stmt.key.text === "culture") out.culture = value;
    else if (stmt.key.text === "dynasty") out.dynasty = value;
  }
  return out;
}

/** Read a file and hand every top-level `name = { … }` block to `onBlock`. */
function eachTopLevelBlock(
  file: string,
  onBlock: (name: string, block: BlockNode, line: number) => void
): void {
  let text: string;
  try {
    text = decode(fs.readFileSync(file)).text;
  } catch {
    return; // deleted between the index scan and this read
  }
  const { root } = parseScript(text);
  const li = new LineIndex(text);
  for (const stmt of root.statements) {
    if (stmt.kind !== "assignment") continue;
    const block = blockOf(stmt);
    if (!block) continue;
    onBlock(stmt.key.text, block, li.positionAt(stmt.key.range.start).line);
  }
}

/** Files holding definitions of each kind, plus the largest numeric id seen. */
function scanIndex(data: ServerData): {
  files: Map<string, FileRef[]>;
  maxCharacterId: number;
  maxDynastyId: number;
} {
  const files = new Map<string, FileRef[]>([
    [DYNASTY_KIND, []],
    [HOUSE_KIND, []],
    [CHARACTER_KIND, []],
  ]);
  const seen = new Set<string>();
  let maxCharacterId = 0;
  let maxDynastyId = 0;
  const bump = (def: Definition): void => {
    const n = Number(def.name);
    if (!Number.isInteger(n)) return;
    if (def.kind === CHARACTER_KIND) maxCharacterId = Math.max(maxCharacterId, n);
    else maxDynastyId = Math.max(maxDynastyId, n);
  };
  for (const def of data.index.allDefinitions()) {
    const bucket = files.get(def.kind);
    if (!bucket) continue;
    bump(def);
    const key = `${def.kind} ${def.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.push({ file: def.file, source: def.source });
  }
  return { files, maxCharacterId, maxDynastyId };
}

/** Later definitions win, and a higher source rank wins over any earlier one. */
function keep<T extends { source: DefSource }>(map: Map<string, T>, id: string, rec: T): void {
  const prev = map.get(id);
  if (prev && SOURCE_RANK[prev.source] > SOURCE_RANK[rec.source]) return;
  map.set(id, rec);
}

function buildModel(data: ServerData): DynastyModel {
  const { files, maxCharacterId, maxDynastyId } = scanIndex(data);
  const dynasties = new Map<string, DynastyRecord>();
  const houses = new Map<string, HouseRecord>();
  const characters = new Map<string, CharacterRecord>();

  // Vanilla shadows first so a mod's redefinition of the same id replaces it.
  const ordered = (kind: string): FileRef[] =>
    [...(files.get(kind) ?? [])].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);

  for (const ref of ordered(DYNASTY_KIND)) {
    eachTopLevelBlock(ref.file, (id, block, line) => {
      keep(dynasties, id, readDefinitionBlock(id, block, { source: ref.source, file: ref.file, line }));
    });
  }
  for (const ref of ordered(HOUSE_KIND)) {
    eachTopLevelBlock(ref.file, (id, block, line) => {
      keep(houses, id, readDefinitionBlock(id, block, { source: ref.source, file: ref.file, line }));
    });
  }
  const intern = interner();
  for (const ref of ordered(CHARACTER_KIND)) {
    eachTopLevelBlock(ref.file, (id, block, line) => {
      keep(
        characters,
        id,
        readCharacterBlock(id, block, { source: ref.source, file: ref.file, line }, intern)
      );
    });
  }

  const members = new Map<string, string[]>();
  for (const char of characters.values()) {
    const dynasty = char.dynasty ?? (char.house ? houses.get(char.house)?.dynasty : undefined);
    if (!dynasty) continue;
    const list = members.get(dynasty);
    if (list) list.push(char.id);
    else members.set(dynasty, [char.id]);
  }

  return {
    revision: data.index.revision,
    dynasties,
    houses,
    characters,
    members,
    nextCharacterId: String(maxCharacterId + 1),
    nextDynastyId: String(maxDynastyId + 1),
  };
}

/**
 * The model for the current index revision, built on first use and reused
 * until the index moves on or nothing has asked for it in {@link IDLE_RELEASE_MS}.
 */
function modelFor(data: ServerData): DynastyModel {
  keepAlive();
  if (cached && cached.revision === data.index.revision) return cached;
  cached = buildModel(data);
  return cached;
}

/** Loc text for a key, or the key itself: the panel shows what it can resolve. */
function locText(data: ServerData, key: string): string {
  if (key === "") return "";
  return data.index.lookup(key).find((d) => d.kind === "loc_key" && d.value !== undefined)?.value ?? key;
}

function summaryOf(
  data: ServerData,
  model: DynastyModel,
  rec: DynastyRecord,
  houseCount: number
): DynastySummary {
  return {
    id: rec.id,
    nameKey: rec.nameKey,
    name: locText(data, rec.nameKey),
    culture: rec.culture,
    source: rec.source,
    file: rec.file,
    line: rec.line,
    characterCount: model.members.get(rec.id)?.length ?? 0,
    houseCount,
  };
}

export function computeDynastyTree(
  data: ServerData,
  params: DynastyTreeParams,
  inFocus: (file: string) => boolean = () => true
): DynastyTreeResult {
  // Gate on profile DATA: a game whose schema has no dynasties has no tree.
  const supported = activeProfile().schema.some((entry) => entry.kind === DYNASTY_KIND);
  if (!supported) return { supported: false, dynasties: [] };

  const model = modelFor(data);
  const visible = (rec: { source: DefSource; file: string }): boolean =>
    rec.source !== "mod" || inFocus(rec.file);

  const houseCounts = new Map<string, number>();
  for (const house of model.houses.values()) {
    if (!visible(house)) continue;
    houseCounts.set(house.dynasty, (houseCounts.get(house.dynasty) ?? 0) + 1);
  }

  const wanted = params.dynasty;
  if (wanted === undefined) {
    const mod: DynastySummary[] = [];
    const rest: DynastySummary[] = [];
    for (const rec of model.dynasties.values()) {
      if (!visible(rec)) continue;
      const summary = summaryOf(data, model, rec, houseCounts.get(rec.id) ?? 0);
      (rec.source === "mod" ? mod : rest).push(summary);
    }
    const byName = (a: DynastySummary, b: DynastySummary): number => a.name.localeCompare(b.name);
    mod.sort(byName);
    rest.sort(byName);
    return {
      supported: true,
      dynasties: [...mod, ...rest],
      nextCharacterId: model.nextCharacterId,
      nextDynastyId: model.nextDynastyId,
    };
  }

  const rec = model.dynasties.get(wanted);
  if (!rec) {
    return {
      supported: true,
      dynasties: [],
      nextCharacterId: model.nextCharacterId,
      nextDynastyId: model.nextDynastyId,
    };
  }
  const houses: DynastyHouse[] = [];
  for (const house of model.houses.values()) {
    if (house.dynasty !== wanted || !visible(house)) continue;
    houses.push({
      id: house.id,
      nameKey: house.nameKey,
      name: locText(data, house.nameKey),
      dynasty: house.dynasty,
      source: house.source,
      file: house.file,
      line: house.line,
    });
  }
  houses.sort((a, b) => a.name.localeCompare(b.name));

  const characters: DynastyCharacter[] = [];
  const taken = new Set<string>();
  for (const id of model.members.get(wanted) ?? []) {
    const char = model.characters.get(id);
    if (!char || !visible(char) || taken.has(id)) continue;
    taken.add(id);
    characters.push(char);
  }
  // A parent or a spouse from another dynasty is drawn, but the tree is not
  // theirs: without them a marriage renders as a node married to nothing.
  for (const char of [...characters]) {
    for (const other of [char.father, char.mother, ...char.spouses]) {
      if (!other || taken.has(other)) continue;
      const rel = model.characters.get(other);
      if (!rel) continue;
      taken.add(other);
      characters.push({ ...rel, external: true });
    }
  }

  return {
    supported: true,
    dynasties: [],
    dynasty: summaryOf(data, model, rec, houses.length),
    houses,
    characters,
    nextCharacterId: model.nextCharacterId,
    nextDynastyId: model.nextDynastyId,
  };
}
