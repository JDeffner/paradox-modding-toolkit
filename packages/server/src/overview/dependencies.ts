/**
 * paradox/dependencies: a generic dependency explorer for any indexed definition.
 *
 * Dependents  — mod sites that reference the definition, grouped by the kind
 *   of their containing top-level definition (else by file). Schema-captured
 *   references come from the reference index (find-references semantics); bare
 *   `name = …` invocations of scripted effects/triggers, which the reference
 *   extractor does not record (they are keys, not schema field values), are
 *   found by a targeted scan of the mod's definition files. Vanilla references
 *   are not indexed (rework plan AD-4), so vanilla callers never appear here.
 *
 * Dependencies — named definitions referenced inside the definition's own block
 *   span, grouped by the referenced definition's kind. The file is parsed on
 *   demand: extractReferences (schema fields, prefixed values, loc keys) is
 *   filtered to the block's lines, then a scalar walk adds the bare scripted
 *   effect/trigger calls and script-value scalars the extractor misses.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type { DependenciesResult, DependencyGroup, DependencyItem } from "@px-lsp/protocol/protocol";
import type { Definition } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import { extractReferences } from "../index/references";
import { decode, LineIndex, parseScript, walkStatements, type BlockNode, type Statement } from "../parser";

/** Definition kinds invoked as a bare `name = …` key (not captured as references). */
const CALL_KINDS = new Set(["scripted_effect", "scripted_trigger"]);

export function computeDependencies(
  data: ServerData,
  schema: SchemaData,
  name: string,
  kind?: string
): DependenciesResult {
  const resolved = data.index.lookup(name);
  const candidates = resolved.length > 0 ? resolved : data.index.lookupAll(name);
  const def = (kind ? candidates.find((d) => d.kind === kind) : undefined) ?? candidates[0] ?? null;
  if (!def) return { def: null, dependents: [], dependencies: [] };

  return {
    def: { name: def.name, kind: def.kind, file: def.file, line: def.line },
    dependents: collectDependents(data, def),
    dependencies: collectDependencies(data, schema, def),
  };
}

// ---- dependents -------------------------------------------------------------

interface Site {
  file: string;
  line: number;
}

function collectDependents(data: ServerData, def: Definition): DependencyGroup[] {
  const sites: Site[] = data.refIndex.lookup(def.name).map((r) => ({ file: r.file, line: r.line }));
  if (CALL_KINDS.has(def.kind)) sites.push(...scanCallSites(data, def));

  const groups = new Map<string, Map<string, DependencyItem>>();
  for (const site of sites) {
    const container = containingDef(data, site.file, site.line);
    const groupKind = container ? container.kind : "file";
    const itemName = container ? container.name : path.basename(site.file);
    const dedupe = `${itemName} ${site.file}`;
    let byItem = groups.get(groupKind);
    if (!byItem) groups.set(groupKind, (byItem = new Map()));
    // First site wins the jump target: the actual usage line.
    if (!byItem.has(dedupe)) byItem.set(dedupe, { name: itemName, file: site.file, line: site.line });
  }
  return toGroups(groups);
}

/**
 * Bare `name = …` invocations across the mod's definition files. These are the
 * scripted effect/trigger calls the reference extractor cannot record (the name
 * is a key, and the extractor does not know which keys resolve to definitions).
 * The definition's own site is excluded.
 */
function scanCallSites(data: ServerData, def: Definition): Site[] {
  const sites: Site[] = [];
  const seen = new Set<string>();
  for (const file of modFiles(data)) {
    let text: string;
    try {
      text = decode(fs.readFileSync(file)).text;
    } catch {
      continue;
    }
    if (!text.includes(def.name)) continue;
    const parse = parseScript(text);
    const li = new LineIndex(text);
    walkStatements(parse.root, (stmt: Statement) => {
      if (stmt.kind !== "assignment" || stmt.key.quoted || stmt.key.text !== def.name) return;
      const line = li.positionAt(stmt.key.range.start).line;
      if (file === def.file && line === def.line) return; // the definition itself
      const key = `${file} ${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      sites.push({ file, line });
    });
  }
  return sites;
}

/** Unique mod definition files (where realistic caller sites live). */
function modFiles(data: ServerData): string[] {
  const files = new Set<string>();
  for (const d of data.index.allDefinitions()) {
    if (d.source === "mod" && d.file.toLowerCase().endsWith(".txt")) files.add(d.file);
  }
  return [...files];
}

/**
 * The top-level definition in `file` whose block encloses `line`: the one with
 * the greatest start line at or before it. Implicit/nested sites (save_scope_as
 * etc., which carry a container) are skipped so the real container is found.
 */
function containingDef(data: ServerData, file: string, line: number): Definition | null {
  let best: Definition | null = null;
  for (const d of data.index.inFile(file)) {
    if (d.container !== undefined) continue;
    if (d.line <= line && (!best || d.line > best.line)) best = d;
  }
  return best;
}

// ---- dependencies -----------------------------------------------------------

function collectDependencies(data: ServerData, schema: SchemaData, def: Definition): DependencyGroup[] {
  let text: string;
  try {
    text = decode(fs.readFileSync(def.file)).text;
  } catch {
    return [];
  }
  const parse = parseScript(text);
  const li = new LineIndex(text);
  const lineOf = (offset: number) => li.positionAt(offset).line;
  const stmt = parse.root.statements.find(
    (s): s is Statement & { kind: "assignment" } =>
      s.kind === "assignment" && s.key.text === def.name && lineOf(s.key.range.start) === def.line
  );
  const block = stmt ? childBlock(stmt) : null;
  if (!block) return [];
  const startLine = lineOf(block.range.start);
  const endLine = block.closeBrace !== null ? lineOf(block.closeBrace) : lineOf(block.range.end);

  const groups = new Map<string, Map<string, DependencyItem>>();
  const addTarget = (target: Definition) => {
    const dedupe = `${target.kind} ${target.name}`;
    let byItem = groups.get(target.kind);
    if (!byItem) groups.set(target.kind, (byItem = new Map()));
    if (!byItem.has(dedupe)) {
      byItem.set(dedupe, { name: target.name, file: target.file, line: target.line });
    }
  };

  // (a) Schema-captured references within the block: traits (has_trait), events
  //     (trigger_event), cultures/faiths, loc keys, variables/flags/scopes.
  for (const ref of extractReferences(text, def.file, def.source, schema).references) {
    if (ref.line < startLine || ref.line > endLine || ref.name === def.name) continue;
    const target = resolveTarget(data, ref.name, ref.kinds);
    if (target) addTarget(target);
  }

  // (b) Bare `name = …` calls to scripted effects/triggers and script-value
  //     scalars, which the reference extractor does not record. Same resolution
  //     as the event inspector (eventDetail.collectRefs); the group map dedupes
  //     any overlap with (a).
  walkScalars(block, (word, isKey) => {
    if (word === def.name) return;
    const defs = data.index.lookup(word);
    if (defs.length === 0) return;
    const target = isKey
      ? defs.find((d) => d.kind === "scripted_effect" || d.kind === "scripted_trigger")
      : defs.find((d) => d.kind === "script_value");
    if (target) addTarget(target);
  });

  return toGroups(groups);
}

/** Visit every unquoted scalar in a block: keys (isKey=true) and values. */
function walkScalars(block: BlockNode, cb: (word: string, isKey: boolean) => void): void {
  for (const stmt of block.statements) {
    if (stmt.kind === "assignment") {
      if (!stmt.key.quoted) cb(stmt.key.text, true);
      const v = stmt.value;
      if (v?.kind === "scalar" && !v.quoted) cb(v.text, false);
      const sub = childBlock(stmt);
      if (sub) walkScalars(sub, cb);
    } else if (stmt.value.kind === "scalar" && !stmt.value.quoted) {
      cb(stmt.value.text, false);
    } else if (stmt.value.kind === "block") {
      walkScalars(stmt.value, cb);
    } else if (stmt.value.kind === "tagged-block") {
      walkScalars(stmt.value.block, cb);
    }
  }
}

/** Best index match for a reference: prefer a def whose kind the ref allows. */
function resolveTarget(data: ServerData, name: string, kinds: string[]): Definition | null {
  const defs = data.index.lookup(name);
  if (defs.length === 0) return null;
  return defs.find((d) => kinds.includes(d.kind)) ?? defs[0];
}

// ---- shared -----------------------------------------------------------------

function childBlock(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment") return null;
  const v = stmt.value;
  if (!v) return null;
  if (v.kind === "block") return v;
  if (v.kind === "tagged-block") return v.block;
  return null;
}

function toGroups(groups: Map<string, Map<string, DependencyItem>>): DependencyGroup[] {
  return [...groups.entries()]
    .map(([kind, byItem]) => ({
      kind,
      items: [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}
