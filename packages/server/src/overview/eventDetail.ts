/**
 * paradox/eventDetail: everything the graph inspector shows about one event —
 * localized title/desc/options (with their editable loc sites), section
 * summaries, and every referenced saved scope / variable / scripted
 * effect/trigger / script value / chained event WITH its definition site so
 * the webview can jump straight to it.
 */
import * as fs from "fs";
import type {
  EventDetail,
  EventLocField,
  EventOptionInfo,
  EventRefInfo,
  EventSectionInfo,
} from "@paradox-lsp/protocol/protocol";
import type { ServerData } from "../serverData";
import { decode, LineIndex, parseScript, type BlockNode, type Statement } from "../parser";

const SECTION_KEYS = new Set(["trigger", "immediate", "after", "on_trigger_fail"]);
const OPTION_META_KEYS = new Set([
  "name",
  "trigger",
  "ai_chance",
  "show_as_unavailable",
  "flag",
  "custom_tooltip",
]);
const EVENT_ID = /^[A-Za-z][A-Za-z0-9_-]*\.\d+$/;
const SCOPE_PREFIX = /^(scope|var|local_var|global_var):([A-Za-z0-9_.-]+)$/;
const MAX_SECTION_KEYS = 12;
const MAX_REFS = 200;

export function computeEventDetail(data: ServerData, id: string): EventDetail | null {
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
    else if (SECTION_KEYS.has(key) && sub) detail.sections.push(section(child.key.text, sub, lineOf));
    else if (key === "option" && sub) detail.options.push(option(data, sub, lineOf));
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

function section(name: string, block: BlockNode, lineOf: (o: number) => number): EventSectionInfo {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const s of block.statements) {
    if (s.kind !== "assignment") continue;
    if (seen.has(s.key.text)) continue;
    seen.add(s.key.text);
    if (keys.length < MAX_SECTION_KEYS) keys.push(s.key.text);
  }
  return { name, line: lineOf(block.range.start), keys };
}

function option(data: ServerData, block: BlockNode, lineOf: (o: number) => number): EventOptionInfo {
  const info: EventOptionInfo = {
    line: lineOf(block.range.start),
    effectKeys: [],
    hasTrigger: false,
    hasAiChance: false,
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
