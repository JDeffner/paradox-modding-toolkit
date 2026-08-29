/**
 * Data types for [ ... ] data-function expressions in .gui and localization
 * files: global promotes/functions (GetPlayer, …) and per-type members
 * (Character.IsAlive, …).
 *
 * Two sources, script_docs-style:
 *  - bundled baseline harvested from the modding wiki's Data types page
 *    (packages/server/data/<game>/dataTypes.json, built by scripts/build-data-types-json.ts);
 *  - the user's own `data_types.log`, written by the game's `DumpDataTypes`
 *    console command — complete and version-exact, so its entries win.
 *
 * No vscode imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import { activeProfile } from "../games/active";

export interface DataTypeMember {
  /** Return type name; null when unknown (wiki lists some as [unregistered]). */
  ret: string | null;
  /** Argument type names from the dump header; null when unknown/none recorded. */
  args: string[] | null;
  kind: "promote" | "function";
  /** Description prose from the dump, when the entry carries one. */
  desc?: string;
  /** Which source produced this entry (provenance shown in hovers). */
  src?: "wiki" | "dump" | "macro";
}

export interface DataTypesData {
  /** Chain-start names: global promotes and global functions. */
  globals: Map<string, DataTypeMember>;
  /** Type name -> member name -> member. */
  types: Map<string, Map<string, DataTypeMember>>;
  /** Lowercased type name -> canonical casing (tolerant hover/completion). */
  typeNamesLower: Map<string, string>;
  /** Where the (majority of the) data came from. */
  source: "bundled wiki" | "data_types.log";
  /** Total member count, for the status log line. */
  count: number;
}

interface BundledShape {
  globalPromotes: Record<string, string | null>;
  globalFunctions: Record<string, string | null>;
  types: Record<string, Record<string, string | null>>;
}

export function emptyDataTypes(): DataTypesData {
  return {
    globals: new Map(),
    types: new Map(),
    typeNamesLower: new Map(),
    source: "bundled wiki",
    count: 0,
  };
}

function typeMembers(data: DataTypesData, type: string): Map<string, DataTypeMember> {
  let members = data.types.get(type);
  if (!members) {
    data.types.set(type, (members = new Map()));
    data.typeNamesLower.set(type.toLowerCase(), type);
  }
  return members;
}

export function loadBundledDataTypes(): DataTypesData {
  const data = emptyDataTypes();
  const bundled = activeProfile().bundledDataTypes as BundledShape | undefined;
  if (!bundled) return data;
  for (const [name, ret] of Object.entries(bundled.globalPromotes)) {
    data.globals.set(name, { ret, args: null, kind: "promote", src: "wiki" });
    data.count++;
  }
  for (const [name, ret] of Object.entries(bundled.globalFunctions)) {
    if (!data.globals.has(name)) data.globals.set(name, { ret, args: null, kind: "function", src: "wiki" });
    data.count++;
  }
  for (const [type, members] of Object.entries(bundled.types)) {
    const map = typeMembers(data, type);
    for (const [name, ret] of Object.entries(members)) {
      map.set(name, { ret, args: null, kind: "function", src: "wiki" });
      data.count++;
    }
  }
  return data;
}

/**
 * Parse the game's DumpDataTypes output. Entries are separated by dashed
 * lines; each entry is a header (`Name`, `Type.Name`, or `Name( arg, arg )`)
 * followed by `Definition type: <Global promote|Global function|Promote|
 * Function|Type|Global macro>` and `Return type: <name>` lines. Tolerant: an
 * entry missing any expected part is skipped.
 */
export function parseDataTypesDump(text: string, into?: DataTypesData): DataTypesData {
  const data = into ?? emptyDataTypes();
  for (const rawEntry of text.split(/\r?\n-{4,}\r?\n/)) {
    const entry = rawEntry.trim();
    if (entry.length === 0) continue;
    const lines = entry.split(/\r?\n/);
    const header = lines[0].trim();
    let defType: string | null = null;
    let ret: string | null = null;
    const descLines: string[] = [];
    for (const line of lines.slice(1)) {
      const def = /^Definition type:\s*(.+)$/.exec(line.trim());
      if (def) {
        defType = def[1].trim();
        continue;
      }
      const rt = /^Return type:\s*(.+)$/.exec(line.trim());
      if (rt) {
        ret = rt[1].trim();
        continue;
      }
      // Descriptions come as "Description: ..." lines; older dumps used bare
      // prose. Either way, strip the prefix and keep the text. A dash run is
      // a separator (reachable here when the file lacks a trailing newline).
      const prose = line.trim().replace(/^Description:\s*/, "");
      if (prose.length > 0 && !/^-{4,}$/.test(prose)) descLines.push(prose);
    }
    if (!defType) continue;
    const kind = /promote/i.test(defType) ? "promote" : "function";
    if (!/^(Global promote|Global function|Promote|Function)$/i.test(defType)) continue;

    // Header: strip an argument list, split an owning type off the name.
    let signature = header;
    let args: string[] | null = null;
    const paren = signature.indexOf("(");
    if (paren >= 0) {
      const argText = signature.slice(
        paren + 1,
        signature.lastIndexOf(")") >= 0 ? signature.lastIndexOf(")") : undefined
      );
      args = argText
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      signature = signature.slice(0, paren).trim();
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(signature)) continue;

    // "[unregistered]" is the dump's "no registered return type" marker — a
    // null ret (fallback completion) beats a bogus type name (dead chain).
    const member: DataTypeMember = {
      ret: ret === "void" || ret === "[unregistered]" ? null : ret,
      args,
      kind,
      src: "dump",
    };
    const desc = descLines.join(" ").slice(0, 300);
    // "Jomini Script System" is per-entry boilerplate, not a description.
    if (desc.length > 0 && desc !== "Jomini Script System") member.desc = desc;
    const isGlobal = /^Global/i.test(defType);
    const dot = signature.indexOf(".");
    if (!isGlobal && dot > 0) {
      const owner = signature.slice(0, dot);
      const name = signature.slice(dot + 1);
      if (name.length === 0 || name.includes(".")) continue;
      insertMember(data, typeMembers(data, owner), name, member);
    } else if (isGlobal && dot < 0) {
      insertMember(data, data.globals, signature, member);
    }
  }
  return data;
}

/**
 * Insert a dump entry without losing information: the dump lists some members
 * twice (e.g. `Character.GetFather` once as a Promote with a real return type
 * and once as a Function returning "[unregistered]"), and the wiki baseline
 * may already hold a typed entry. An entry with a known return type is never
 * clobbered by one without; desc/args fill in whichever survivor lacks them.
 */
function insertMember(
  data: DataTypesData,
  map: Map<string, DataTypeMember>,
  name: string,
  member: DataTypeMember
): void {
  const prev = map.get(name);
  if (!prev) {
    map.set(name, member);
    data.count++;
    return;
  }
  const keep = prev.ret !== null && member.ret === null ? prev : member;
  const other = keep === prev ? member : prev;
  if (!keep.desc && other.desc) keep.desc = other.desc;
  if (!keep.args && other.args) keep.args = other.args;
  map.set(name, keep);
}

/** The dump files a directory holds, in any of the three shapes different
 * game versions have written: `data_types.log`, `data_type*.txt` files, and a
 * `data_types/` subfolder of per-category files. */
function dumpFilesIn(dir: string): string[] {
  const files: string[] = [];
  const logFile = path.join(dir, "data_types.log");
  if (fs.existsSync(logFile)) files.push(logFile);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/^data_type.*\.txt$/i.test(name)) files.push(path.join(dir, name));
    }
  } catch {
    /* dir unreadable */
  }
  const dumpDir = path.join(dir, "data_types");
  try {
    for (const name of fs.readdirSync(dumpDir)) {
      const file = path.join(dumpDir, name);
      if (fs.statSync(file).isFile()) files.push(file);
    }
  } catch {
    /* no data_types/ subfolder */
  }
  return files;
}

/**
 * Bundled baseline upgraded by dumps. `dirs` are searched in order and later
 * directories win on conflicts, so callers list them lowest priority first
 * (bundled dump, then the user's folders). A single string is accepted for
 * convenience. Games whose script_docs live outside logs/ (newer Jomini
 * titles) dump data types to logs/ anyway, so callers pass both folders.
 */
export function loadDataTypes(dirs: string | null | Array<string | null>): DataTypesData {
  const data = loadBundledDataTypes();
  const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d): d is string => d !== null);
  const dumpFiles = list.flatMap(dumpFilesIn);
  if (dumpFiles.length === 0) return data;
  const before = data.count;
  for (const file of dumpFiles) {
    try {
      parseDataTypesDump(fs.readFileSync(file, "utf8"), data);
    } catch {
      /* unreadable dump: keep what we have */
    }
  }
  if (data.count > before) data.source = "data_types.log";
  return data;
}

/** Member lookup on a type, exact first then case-insensitive canonicalization. */
export function membersOf(data: DataTypesData, typeName: string): Map<string, DataTypeMember> | null {
  const direct = data.types.get(typeName);
  if (direct) return direct;
  const canonical = data.typeNamesLower.get(typeName.toLowerCase());
  return canonical ? (data.types.get(canonical) ?? null) : null;
}

/**
 * Resolve a dotted chain (["Character","GetFather"]) to the type the NEXT
 * segment completes against. The first segment may be a data type name (the
 * datacontext style: Character.GetName) or a global promote/function. Returns
 * null when any segment is unknown.
 */
export function resolveChainType(data: DataTypesData, segments: string[]): string | null {
  if (segments.length === 0) return null;
  let current: string | null = null;
  const first = segments[0];
  if (membersOf(data, first)) {
    current = data.typeNamesLower.get(first.toLowerCase()) ?? first;
  } else {
    const global = data.globals.get(first);
    if (!global || !global.ret) return null;
    current = global.ret;
  }
  for (const segment of segments.slice(1)) {
    if (current === null) return null;
    const members = membersOf(data, current);
    const member = members?.get(segment);
    if (!member || !member.ret) return null;
    current = member.ret;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Reverse index: which functions produce a given type
// ---------------------------------------------------------------------------

/**
 * `Return type` -> the globals and members that yield it, so a hover on a data
 * type can answer "how do I get one of these here". The forward direction
 * (what does `Story` give me) is `membersOf`; this is the inverse, and it is
 * the only way to see that `Story` has exactly two producers while `bool` has
 * thousands.
 *
 * Built once per `DataTypesData` and cached against it, so reloading a
 * `data_types.log` produces a fresh object and a fresh index without any
 * explicit invalidation.
 */
interface ProducerIndex {
  /** Canonical return-type name -> qualified producer names, sorted. */
  byType: Map<string, string[]>;
  /** Lowercased return-type name -> canonical casing. */
  lower: Map<string, string>;
}

const producerIndex = new WeakMap<DataTypesData, ProducerIndex>();

function buildProducerIndex(data: DataTypesData): ProducerIndex {
  const byType = new Map<string, string[]>();
  const lower = new Map<string, string>();
  const add = (ret: string | null, qualified: string) => {
    if (!ret) return;
    let names = byType.get(ret);
    if (!names) {
      byType.set(ret, (names = []));
      lower.set(ret.toLowerCase(), ret);
    }
    names.push(qualified);
  };
  for (const [name, member] of data.globals) add(member.ret, name);
  for (const [type, members] of data.types) {
    for (const [name, member] of members) add(member.ret, `${type}.${name}`);
  }
  for (const names of byType.values()) names.sort();
  return { byType, lower };
}

/**
 * Every global or member whose return type is `typeName`, as qualified names
 * (`Scope.Story`, `GetPlayer`), sorted. Empty when nothing produces the type
 * or the name is unknown. Callers do their own ranking and capping.
 *
 * Case-tolerant against both the declared type names and the return-type names
 * seen in the dump: a type can be produced without ever being declared as a
 * `Definition type: Type`, and the wiki tables spell some names differently.
 */
export function producersOf(data: DataTypesData, typeName: string): string[] {
  let index = producerIndex.get(data);
  if (!index) producerIndex.set(data, (index = buildProducerIndex(data)));
  const key = typeName.toLowerCase();
  const canonical = data.typeNamesLower.get(key) ?? index.lower.get(key) ?? typeName;
  return index.byType.get(canonical) ?? [];
}
