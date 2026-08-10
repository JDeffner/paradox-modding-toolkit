/**
 * The GUI-to-script dependency surface, both directions over one link.
 *
 * PdxGui reaches script through exactly one door, `GetScriptedGui('name')`
 * (see guiLinks.ts), so both questions the designer asks are the same walk read
 * from opposite ends:
 *
 *   forward  — this widget calls scripted_gui X, which fires event E directly
 *              or via effect_a -> effect_b  (`paradox/guiDependencies`)
 *   reverse  — event E is reached from these .gui files, through X
 *              (`paradox/dependencies` with `guiUses`)
 *
 * `reachFrom` is that shared walk. It is driven by the active profile's
 * event/on_action reference fields, never a hard-coded key list, and it follows
 * scripted-effect calls a bounded number of hops, which is what turns a flat
 * reference list into a chain a human can read.
 *
 * The loc side is a plain index question: the `text` / `tooltip` keys the
 * document names, each flagged against the loc index.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import type {
  GuiDependenciesResult,
  GuiEventChain,
  GuiLocRow,
  GuiScriptedGuiRow,
  GuiUseSite,
} from "@px-lsp/protocol/protocol";
import type { Definition } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import { decode, LineIndex, parseScript, type BlockNode, type Statement } from "../parser";
import { findScriptedGuiCalls, type GuiScriptLinks } from "./guiLinks";
import { findWidgetAtLine, parseGuiSource } from "./sourceModel";

/**
 * How many scripted-effect hops a chain follows. Three is what the readout
 * ("via effect_a -> effect_b") stays legible at, and it bounds the file reads
 * a single request can trigger.
 */
const MAX_HOPS = 3;

/** Caps, so one pathological definition cannot return an unbounded payload. */
const MAX_REACHED = 60;
const MAX_LOC_ROWS = 100;
const MAX_GUI_USES = 100;

/** Guard against a malformed document nesting without end. */
const MAX_BLOCK_DEPTH = 32;

/** `.gui` properties whose bare value is a localization key. `raw_text` /
 *  `raw_tooltip` are literal strings by definition and are NOT keys. */
const LOC_PROPS = new Set(["text", "tooltip"]);

/** The charset a loc key uses; anything else (a `[datafunction]`) is not one. */
const LOC_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// ---- forward: a .gui document -> script ------------------------------------

export function computeGuiDependencies(
  data: ServerData,
  schema: SchemaData,
  text: string,
  line: number | undefined,
  links: GuiScriptLinks
): GuiDependenciesResult {
  const file = parseGuiSource(text);
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  let widget: GuiDependenciesResult["widget"];

  if (line !== undefined) {
    const target = findWidgetAtLine(file, line);
    if (!target || target.kind !== "widget") return { scriptedGuis: [], locKeys: [] };
    // The widget's SOURCE subtree: what THIS document says it does. A property
    // inherited from a template lives in another file and is that file's row.
    from = target.line;
    to = target.endLine;
    widget = { key: target.key, name: nameOfWidget(target.block), line: target.line };
  }

  const inScope = (at: number): boolean => at >= from && at <= to;
  const byName = new Map<string, number[]>();
  for (const call of findScriptedGuiCalls(text)) {
    if (!inScope(call.line)) continue;
    const lines = byName.get(call.name);
    if (lines) lines.push(call.line);
    else byName.set(call.name, [call.line]);
  }

  const reads = new Map<string, ParsedFile | null>();
  const scriptedGuis: GuiScriptedGuiRow[] = [];
  for (const [name, callLines] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const def = scriptedGuiDef(data, name);
    scriptedGuis.push({
      name,
      file: def?.file,
      line: def?.line,
      callLines,
      // The store's count is the whole gui tree's; without a store (no game
      // path configured, an unsaved buffer) this document is all there is.
      uses: Math.max(links.calls.get(name)?.length ?? 0, callLines.length),
      chains: def ? chainsOf(data, schema, def, reads) : [],
    });
  }

  return { widget, scriptedGuis, locKeys: locRowsIn(data, file, inScope) };
}

/** The `name = "..."` a widget block carries, without expanding anything. */
function nameOfWidget(block: BlockNode | null): string | undefined {
  if (!block) return undefined;
  let found: string | undefined;
  for (const stmt of block.statements) {
    if (stmt.kind !== "assignment" || stmt.value?.kind !== "scalar") continue;
    if (stmt.key.text.toLowerCase() === "name") found = stmt.value.text;
  }
  return found;
}

/** Loc keys the document names, deduped by key, first site winning. */
function locRowsIn(
  data: ServerData,
  file: ReturnType<typeof parseGuiSource>,
  inScope: (line: number) => boolean
): GuiLocRow[] {
  const out: GuiLocRow[] = [];
  const seen = new Set<string>();
  for (const entry of file.entries) {
    if (out.length >= MAX_LOC_ROWS) break;
    if (entry.valueKind !== "scalar" || entry.value === null) continue;
    if (!LOC_PROPS.has(entry.keyLower) || !inScope(entry.line)) continue;
    const key = entry.value;
    if (!LOC_KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    const def = data.index.lookup(key).find((d) => d.kind === "loc_key");
    out.push({ key, prop: entry.key, line: entry.line, missing: !def, value: def?.value });
  }
  return out;
}

// ---- reverse: a script definition -> the .gui files reaching it -------------

/**
 * Every `.gui` call site that reaches `name`. Only the scripted_guis some .gui
 * file actually calls are walked (the link index is the filter), so the cost is
 * set by the gui tree's real script surface, not by the definition count.
 */
export function computeGuiUses(
  data: ServerData,
  schema: SchemaData,
  links: GuiScriptLinks,
  name: string
): GuiUseSite[] {
  const reads = new Map<string, ParsedFile | null>();
  const out: GuiUseSite[] = [];
  for (const [scriptedGui, sites] of links.calls) {
    let via: string[] | null = null;
    if (scriptedGui === name) {
      via = [];
    } else {
      const def = scriptedGuiDef(data, scriptedGui);
      if (!def) continue;
      via = reachFrom(data, schema, def, reads).get(name)?.via ?? null;
    }
    if (via === null) continue;
    for (const site of sites) out.push({ file: site.file, line: site.line, scriptedGui, via });
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return out.slice(0, MAX_GUI_USES);
}

// ---- the shared walk --------------------------------------------------------

/** What kind of thing a walk step found, and how the walk got to it. */
interface Reached {
  kind: "event" | "on_action" | "scripted_effect";
  /** The scripted effects traversed to get here, outermost first. */
  via: string[];
  file?: string;
  line?: number;
}

interface ParsedFile {
  root: ReturnType<typeof parseScript>["root"];
  lineOf: (offset: number) => number;
}

function chainsOf(
  data: ServerData,
  schema: SchemaData,
  def: Definition,
  reads: Map<string, ParsedFile | null>
): GuiEventChain[] {
  const out: GuiEventChain[] = [];
  for (const [name, hit] of reachFrom(data, schema, def, reads)) {
    if (hit.kind === "scripted_effect") continue;
    out.push({ name, kind: hit.kind, file: hit.file, line: hit.line, via: hit.via });
  }
  // Directly-reached first, then by name: "directly" is the row a reader wants
  // at the top of the list.
  out.sort((a, b) => a.via.length - b.via.length || a.name.localeCompare(b.name));
  return out;
}

/**
 * Every event, on_action and scripted effect a definition's block reaches, each
 * mapped to the scripted effects traversed to get there. One walk serves both
 * directions; it widens hop by hop, so the first path recorded to a name is the
 * shortest one.
 */
export function reachFrom(
  data: ServerData,
  schema: SchemaData,
  def: Definition,
  reads: Map<string, ParsedFile | null>
): Map<string, Reached> {
  const out = new Map<string, Reached>();
  const visitedEffects = new Set<string>([def.name]);
  const refKinds = (key: string): string[] => schema.refFields.get(key)?.kinds ?? [];
  let frontier: { def: Definition; via: string[] }[] = [{ def, via: [] }];

  for (let hop = 0; hop <= MAX_HOPS && frontier.length > 0; hop++) {
    const next: { def: Definition; via: string[] }[] = [];
    for (const step of frontier) {
      const parsed = blockOfDefinition(step.def, reads);
      if (!parsed) continue;
      walkScriptBlock(parsed.block, refKinds, (kind, name, offset) => {
        if (out.size >= MAX_REACHED) return;
        if (kind === "call") {
          if (visitedEffects.has(name)) return;
          const target = data.index.lookup(name).find((d) => d.kind === "scripted_effect");
          if (!target) return;
          visitedEffects.add(name);
          out.set(name, { kind: "scripted_effect", via: step.via, file: target.file, line: target.line });
          if (hop < MAX_HOPS) next.push({ def: target, via: [...step.via, name] });
          return;
        }
        if (out.has(name)) return;
        const target = data.index.lookup(name).find((d) => d.kind === kind);
        out.set(name, {
          kind,
          via: step.via,
          file: target?.file,
          // Unindexed target (a vanilla event a mod fires without defining):
          // the reference's own line is the only site there is.
          line: target?.line ?? parsed.lineOf(offset),
        });
      });
    }
    frontier = next;
  }
  return out;
}

/** The parsed block of a top-level definition, file reads memoized per request. */
function blockOfDefinition(
  def: Definition,
  reads: Map<string, ParsedFile | null>
): { block: BlockNode; lineOf: (offset: number) => number } | null {
  let parsed: ParsedFile | null | undefined = reads.get(def.file);
  if (parsed === undefined) {
    parsed = null;
    try {
      const text = decode(fs.readFileSync(def.file)).text;
      const li = new LineIndex(text);
      parsed = { root: parseScript(text).root, lineOf: (o) => li.positionAt(o).line };
    } catch {
      /* unreadable: memoized as a miss so it is attempted once */
    }
    reads.set(def.file, parsed);
  }
  if (!parsed) return null;
  const lineOf = parsed.lineOf;
  const stmt = parsed.root.statements.find(
    (s): s is Statement & { kind: "assignment" } =>
      s.kind === "assignment" && s.key.text === def.name && lineOf(s.key.range.start) === def.line
  );
  const block = stmt ? childBlock(stmt) : null;
  return block ? { block, lineOf } : null;
}

/** Ref-field kinds that mean "control moves here" (eventDetail's own rule). */
function stepKind(kinds: string[]): "event" | "on_action" | null {
  if (kinds.includes("event")) return "event";
  if (kinds.includes("on_action")) return "on_action";
  return null;
}

/**
 * Walk one block, reporting every event/on_action reference and every
 * key-position call. Same shape as eventDetail's target walk: the profile's
 * reference fields drive it, and `trigger_event = { id = X }` /
 * `random_events = { 100 = X }` inherit the enclosing field. A key in call
 * position is reported as `"call"`; only the caller's index decides whether it
 * really names a scripted effect.
 */
function walkScriptBlock(
  block: BlockNode,
  refKinds: (key: string) => string[],
  emit: (kind: "event" | "on_action" | "call", name: string, offset: number) => void,
  inherited: { via: string; kind: "event" | "on_action" } | null = null,
  depth = 0
): void {
  if (depth > MAX_BLOCK_DEPTH) return;
  for (const s of block.statements) {
    if (s.kind === "value") {
      // A bare list entry inherits the enclosing field (`events = { a b }`).
      if (inherited && s.value.kind === "scalar" && !s.value.quoted) {
        emit(inherited.kind, s.value.text, s.value.range.start);
      } else if (s.value.kind === "block") {
        walkScriptBlock(s.value, refKinds, emit, null, depth + 1);
      } else if (s.value.kind === "tagged-block") {
        walkScriptBlock(s.value.block, refKinds, emit, null, depth + 1);
      }
      continue;
    }
    const key = s.key.quoted ? "" : s.key.text.toLowerCase();
    const own = stepKind(refKinds(key));
    const field = own ? { via: key, kind: own } : null;
    const v = s.value;
    if (field && v?.kind === "scalar" && !v.quoted) {
      emit(field.kind, v.text, v.range.start);
      continue;
    }
    if (inherited && v?.kind === "scalar" && !v.quoted && (/^\d+(\.\d+)?$/.test(key) || key === "id")) {
      emit(inherited.kind, v.text, v.range.start);
    }
    // A scripted effect is invoked as a bare key, either `name = yes` or
    // `name = { PARAM = … }`; both spellings reach here.
    if (!field && key !== "" && (v === null || v.kind !== "scalar" || v.text.toLowerCase() === "yes")) {
      emit("call", s.key.text, s.key.range.start);
    }
    const sub = childBlock(s);
    if (sub) walkScriptBlock(sub, refKinds, emit, field, depth + 1);
  }
}

function childBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

function scriptedGuiDef(data: ServerData, name: string): Definition | null {
  return data.index.lookup(name).find((d) => d.kind === "scripted_gui") ?? null;
}
