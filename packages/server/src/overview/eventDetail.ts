/**
 * paradox/eventDetail: everything the graph inspector and the event simulator
 * show about one event: localized title/desc/options (with their editable loc
 * sites), each block rendered back as readable pseudo-script, the events and
 * on_actions each block hands control to, and every referenced saved scope /
 * variable / scripted effect/trigger / script value / chained event WITH its
 * definition site so the webview can jump straight to it.
 */
import * as fs from "fs";
import type {
  EventDetail,
  EventLocField,
  EventOptionInfo,
  EventRefInfo,
  EventScriptLine,
  EventSectionInfo,
  EventStepTarget,
} from "@px-lsp/protocol/protocol";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import { decode, LineIndex, parseScript, type BlockNode, type Statement } from "../parser";

/**
 * Blocks rendered as a step of their own: the union across game profiles,
 * which is safe because the names do not collide — `on_trigger_fail` and
 * `cancellation_trigger` each exist in exactly one supported game (measured
 * against both vanilla event trees: 1074 sites for the latter, 0 in the
 * other), and a key the game does not have simply never matches.
 */
const SECTION_KEYS = new Set(["trigger", "immediate", "after", "on_trigger_fail", "cancellation_trigger"]);
/**
 * Keys that gate or label an option instead of describing what it does, so
 * `effectKeys` stays a summary of effects. The union across game profiles
 * again; `default_option` (2138 vanilla sites) and `highlighted_option` (225)
 * belong to the game the last four do not. Like `custom_tooltip` these still
 * RENDER — only the summary drops them.
 */
const OPTION_META_KEYS = new Set([
  "name",
  "trigger",
  "ai_chance",
  "show_as_unavailable",
  "flag",
  "custom_tooltip",
  "default_option",
  "highlighted_option",
]);
/** Not rendered as an option effect: these gate or label the option. */
const OPTION_NON_EFFECT_KEYS = new Set(["name", "trigger", "ai_chance", "ai_value"]);
const EVENT_ID = /^[A-Za-z][A-Za-z0-9_-]*\.\d+$/;
/** A step-into target has to look like a name, not a weight or a `$PARAM$`. */
const TARGET_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SCOPE_PREFIX = /^(scope|var|local_var|global_var):([A-Za-z0-9_.-]+)$/;
const MAX_SECTION_KEYS = 12;
const MAX_REFS = 200;
/** Per-block line cap: the same budget the Studio's simulator uses. */
const MAX_BLOCK_LINES = 60;
const MAX_TARGETS = 40;
const MAX_FIRES = 24;

export function computeEventDetail(data: ServerData, schema: SchemaData, id: string): EventDetail | null {
  const def = data.index.lookup(id).find((d) => d.kind === "event");
  if (!def) return null;
  let text: string;
  try {
    text = decode(fs.readFileSync(def.file)).text;
  } catch {
    return null;
  }
  const parse = parseScript(text);
  const li = new LineIndex(text);
  const stmt = parse.root.statements.find(
    (s): s is Statement & { kind: "assignment" } =>
      s.kind === "assignment" && s.key.text === id && childBlock(s) !== null
  );
  if (!stmt) return null;
  const block = childBlock(stmt)!;
  const lineOf = (offset: number) => li.positionAt(offset).line;

  const detail: EventDetail = {
    id,
    file: def.file,
    line: lineOf(stmt.key.range.start),
    endLine: block.closeBrace !== null ? lineOf(block.closeBrace) : lineOf(block.range.end),
    sections: [],
    options: [],
    refs: [],
  };

  for (const child of block.statements) {
    if (child.kind !== "assignment") continue;
    const key = child.key.text.toLowerCase();
    const scalar = child.value?.kind === "scalar" ? child.value.text : null;
    const sub = childBlock(child);
    if (key === "type" && scalar) detail.type = scalar;
    else if (key === "hidden" && scalar) detail.hidden = scalar === "yes";
    else if (key === "theme" && scalar) detail.theme = scalar;
    else if (key === "title") detail.title = scalar ? locField(data, scalar) : { key: "", dynamic: true };
    else if (key === "desc") detail.desc = scalar ? locField(data, scalar) : { key: "", dynamic: true };
    // The third event-level string, where the game has one. Read at the
    // event's TOP level only: as an option key the same word labels the
    // option instead, and that is not the event's own text.
    else if (key === "flavor") detail.flavor = scalar ? locField(data, scalar) : { key: "", dynamic: true };
    else if (SECTION_KEYS.has(key) && sub)
      detail.sections.push(section(data, schema, child.key.text, sub, lineOf));
    else if (key === "option" && sub) detail.options.push(option(data, schema, sub, lineOf));
  }

  detail.refs = collectRefs(data, id, block, lineOf);
  return detail;
}

function childBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

/** Resolved loc: mod entry (editable in place) or the shadow-resolved value. */
function locField(data: ServerData, key: string): EventLocField {
  const field: EventLocField = { key };
  const locs = data.index.lookup(key).filter((d) => d.kind === "loc_key");
  const best = locs[0];
  if (best) {
    field.text = best.value;
    if (best.source === "mod") {
      field.file = best.file;
      field.line = best.line;
    }
  }
  return field;
}

function section(
  data: ServerData,
  schema: SchemaData,
  name: string,
  block: BlockNode,
  lineOf: (o: number) => number
): EventSectionInfo {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const s of block.statements) {
    if (s.kind !== "assignment") continue;
    if (seen.has(s.key.text)) continue;
    seen.add(s.key.text);
    if (keys.length < MAX_SECTION_KEYS) keys.push(s.key.text);
  }
  const rendered = renderBlock(block, lineOf);
  const targets = collectTargets(data, schema, block, lineOf);
  return {
    name,
    line: lineOf(block.range.start),
    keys,
    lines: rendered.lines,
    totalLines: rendered.totalLines,
    targets: targets.targets,
    targetsTotal: targets.total,
  };
}

function option(
  data: ServerData,
  schema: SchemaData,
  block: BlockNode,
  lineOf: (o: number) => number
): EventOptionInfo {
  const rendered = renderBlock(block, lineOf, OPTION_NON_EFFECT_KEYS);
  const targets = collectTargets(data, schema, block, lineOf);
  const info: EventOptionInfo = {
    line: lineOf(block.range.start),
    effectKeys: [],
    hasTrigger: false,
    hasAiChance: false,
    lines: rendered.lines,
    totalLines: rendered.totalLines,
    targets: targets.targets,
    targetsTotal: targets.total,
  };
  const seen = new Set<string>();
  for (const s of block.statements) {
    if (s.kind !== "assignment") continue;
    const key = s.key.text.toLowerCase();
    if (key === "name") {
      if (s.value?.kind === "scalar") info.name = locField(data, s.value.text);
      else if (!info.name) info.name = { key: "", dynamic: true };
      continue;
    }
    if (key === "trigger") info.hasTrigger = true;
    if (key === "ai_chance") info.hasAiChance = true;
    if (OPTION_META_KEYS.has(key) || seen.has(s.key.text)) continue;
    seen.add(s.key.text);
    if (info.effectKeys.length < MAX_SECTION_KEYS) info.effectKeys.push(s.key.text);
  }
  return info;
}

/**
 * Flatten a block back into indented pseudo-script. `totalLines` counts every
 * line the block would produce, so a capped render can say how much it hid
 * instead of silently truncating.
 */
function renderBlock(
  block: BlockNode,
  lineOf: (o: number) => number,
  skipTopLevel?: Set<string>
): { lines: EventScriptLine[]; totalLines: number } {
  const lines: EventScriptLine[] = [];
  let totalLines = 0;
  const push = (depth: number, text: string, offset: number) => {
    totalLines++;
    if (lines.length < MAX_BLOCK_LINES) lines.push({ depth, text, line: lineOf(offset) });
  };

  const flatten = (b: BlockNode, depth: number): void => {
    for (const s of b.statements) {
      if (s.kind === "value") {
        if (s.value.kind === "scalar") {
          push(depth, s.value.text, s.value.range.start);
          continue;
        }
        const inner = s.value.kind === "block" ? s.value : s.value.block;
        push(depth, "{", inner.range.start);
        flatten(inner, depth + 1);
        push(depth, "}", inner.closeBrace ?? inner.range.end);
        continue;
      }
      if (depth === 0 && skipTopLevel?.has(s.key.text.toLowerCase())) continue;
      const head = s.op ? `${s.key.text} ${s.op}` : s.key.text;
      const v = s.value;
      if (!v) {
        push(depth, head, s.key.range.start);
        continue;
      }
      if (v.kind === "scalar") {
        push(depth, `${head} ${v.quoted ? `"${v.text}"` : v.text}`, s.key.range.start);
        continue;
      }
      const inner = v.kind === "block" ? v : v.block;
      const tag = v.kind === "tagged-block" ? `${v.tag.text} ` : "";
      push(depth, `${head} ${tag}{`, s.key.range.start);
      flatten(inner, depth + 1);
      push(depth, "}", inner.closeBrace ?? inner.range.end);
    }
  };
  flatten(block, 0);
  return { lines, totalLines };
}

/** Ref-field kinds that mean "control moves here". */
function stepKind(kinds: string[]): "event" | "on_action" | null {
  if (kinds.includes("event")) return "event";
  if (kinds.includes("on_action")) return "on_action";
  return null;
}

/**
 * Every event/on_action a block hands control to, in source order. Driven by
 * the profile's reference fields rather than a hard-coded key list, so
 * `trigger_event`, `on_action(s)`, `events`, `random_events`, `first_valid`
 * and any per-game equivalent are all covered by the same walk.
 *
 * The block form `trigger_event = { id = X … }` is the one special case: `id`
 * is too generic to be a schema ref field of its own (see REF_FIELDS), so it
 * counts only inside a block whose owning key already references events or
 * on_actions, and it keeps that key as its `via`.
 */
function collectTargets(
  data: ServerData,
  schema: SchemaData,
  block: BlockNode,
  lineOf: (o: number) => number,
  resolveOnActions = true
): { targets: EventStepTarget[]; total: number } {
  const out: EventStepTarget[] = [];
  const seen = new Set<string>();
  // Counted past the cap: a capped list that reported its own length as the
  // total would understate what the block really does.
  let total = 0;

  const add = (via: string, name: string, offset: number, wanted: "event" | "on_action") => {
    // `random_events = { 800 = 0 }` weights "no event" as a literal 0.
    if (!TARGET_NAME.test(name)) return;
    const key = `${via}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    total++;
    if (out.length >= MAX_TARGETS) return;
    const target: EventStepTarget = { via, name, kind: "unknown", line: lineOf(offset) };
    const defs = data.index.lookup(name).filter((d) => d.kind === wanted);
    const def = defs[0];
    if (def) {
      target.kind = wanted;
      target.file = def.file;
      target.defLine = def.line;
      if (defs.length > 1) target.defCount = defs.length;
      if (wanted === "on_action" && resolveOnActions) {
        const fired = resolveOnAction(data, schema, def.file, name);
        if (fired) {
          target.firesTotal = fired.total;
          target.fires = fired.targets.slice(0, MAX_FIRES);
        }
      }
    }
    out.push(target);
  };

  /** The enclosing reference field, so entries inside its block keep its name. */
  type Field = { via: string; kind: "event" | "on_action" };

  const walk = (b: BlockNode, inherited: Field | null): void => {
    for (const s of b.statements) {
      if (s.kind === "value") {
        // A bare list entry inherits the enclosing field (`events = { a b }`).
        if (inherited && s.value.kind === "scalar" && !s.value.quoted)
          add(inherited.via, s.value.text, s.value.range.start, inherited.kind);
        else if (s.value.kind === "block") walk(s.value, null);
        else if (s.value.kind === "tagged-block") walk(s.value.block, null);
        continue;
      }
      const key = s.key.quoted ? "" : s.key.text.toLowerCase();
      const kind = stepKind(schema.refFields.get(key)?.kinds ?? []);
      const own: Field | null = kind ? { via: key, kind } : null;
      const v = s.value;
      if (own && v?.kind === "scalar" && !v.quoted) {
        add(own.via, v.text, v.range.start, own.kind);
        continue;
      }
      // `random_events = { 100 = evt.1 }`: the weight is the key, the event the
      // value; `trigger_event = { id = evt.1 … }` names the event under `id`.
      if (inherited && v?.kind === "scalar" && !v.quoted && (/^\d+(\.\d+)?$/.test(key) || key === "id"))
        add(inherited.via, v.text, v.range.start, inherited.kind);
      const sub = childBlock(s);
      if (sub) walk(sub, own);
    }
  };
  walk(block, null);
  return { targets: out, total };
}

/**
 * What an on_action fires, read from its own definition one level deep. Null
 * when the definition cannot be read; an empty list is the honest "its
 * definition names no events" answer.
 */
function resolveOnAction(
  data: ServerData,
  schema: SchemaData,
  file: string,
  name: string
): { targets: EventStepTarget[]; total: number } | null {
  let text: string;
  try {
    text = decode(fs.readFileSync(file)).text;
  } catch {
    return null;
  }
  const parse = parseScript(text);
  const li = new LineIndex(text);
  const stmt = parse.root.statements.find(
    (s): s is Statement & { kind: "assignment" } =>
      s.kind === "assignment" && s.key.text === name && childBlock(s) !== null
  );
  if (!stmt) return null;
  // resolveOnActions=false: one level only, so a self-chaining on_action pair
  // cannot recurse.
  return collectTargets(data, schema, childBlock(stmt)!, (o) => li.positionAt(o).line, false);
}

/**
 * Every reference inside the event body, deduped by kind+name, each with its
 * definition/save site from the index: scope:/var: prefixed names, keys that
 * resolve to scripted effects/triggers, values that resolve to script values,
 * and chained event ids.
 */
function collectRefs(
  data: ServerData,
  selfId: string,
  block: BlockNode,
  lineOf: (o: number) => number
): EventRefInfo[] {
  const refs = new Map<string, EventRefInfo>();

  const add = (kind: EventRefInfo["kind"], name: string, offset: number, defKinds: string[]) => {
    const mapKey = `${kind}:${name}`;
    if (refs.has(mapKey) || refs.size >= MAX_REFS) return;
    const ref: EventRefInfo = { name, kind, line: lineOf(offset) };
    const defs = data.index.lookupAll(name).filter((d) => defKinds.includes(d.kind));
    if (defs.length > 0) {
      // Prefer mod sites (the ones the user can edit).
      const best = defs.find((d) => d.source === "mod") ?? defs[0];
      ref.defFile = best.file;
      ref.defLine = best.line;
      ref.defCount = defs.length;
    }
    refs.set(mapKey, ref);
  };

  const scanScalar = (textValue: string, offset: number, isKey: boolean) => {
    const prefixed = SCOPE_PREFIX.exec(textValue);
    if (prefixed) {
      const bare = prefixed[2].split(".")[0]; // scope:x.culture → x
      if (prefixed[1] === "scope") add("saved_scope", bare, offset, ["saved_scope"]);
      else add("variable", bare, offset, ["variable"]);
      return;
    }
    if (!isKey && EVENT_ID.test(textValue) && textValue !== selfId) {
      if (data.index.lookup(textValue).some((d) => d.kind === "event"))
        add("event", textValue, offset, ["event"]);
      return;
    }
    const defs = data.index.lookup(textValue);
    if (defs.length === 0) return;
    if (isKey) {
      const scripted = defs.find((d) => d.kind === "scripted_effect" || d.kind === "scripted_trigger");
      if (scripted) {
        add(scripted.kind as "scripted_effect" | "scripted_trigger", textValue, offset, [scripted.kind]);
      }
    } else if (defs.some((d) => d.kind === "script_value")) {
      add("script_value", textValue, offset, ["script_value"]);
    }
  };

  const walk = (b: BlockNode) => {
    for (const s of b.statements) {
      if (s.kind === "assignment") {
        if (!s.key.quoted) scanScalar(s.key.text, s.key.range.start, true);
        if (s.value?.kind === "scalar" && !s.value.quoted)
          scanScalar(s.value.text, s.value.range.start, false);
        const sub = childBlock(s);
        if (sub) walk(sub);
      } else if (s.value.kind === "scalar" && !s.value.quoted) {
        scanScalar(s.value.text, s.value.range.start, false);
      } else if (s.value.kind === "block") {
        walk(s.value);
      } else if (s.value.kind === "tagged-block") {
        walk(s.value.block);
      }
    }
  };
  walk(block);
  return [...refs.values()];
}
