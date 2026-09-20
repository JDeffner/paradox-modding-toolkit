/**
 * paradox/dependencies: a generic dependency explorer for any indexed definition.
 *
 * Dependents are typed reference sites in workspace mods, grouped by their
 * containing definition. Dependencies are typed references in the selected
 * definition's body plus unprefixed script-value expressions. Read-only roots
 * are not reference-indexed, so their callers do not appear here.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";
import type {
  DependenciesResult,
  DependencyGroup,
  DependencyItem,
  GuiUseSite,
} from "@px-lsp/protocol/protocol";
import type { Definition } from "@px-lsp/protocol/types";
import type { ServerData } from "../serverData";
import type { SchemaData } from "../schema/loader";
import { extractReferences } from "../index/references";
import { decode, LineIndex, parseScript, type BlockNode, type Statement } from "../parser";

export function computeDependencies(
  data: ServerData,
  schema: SchemaData,
  name: string,
  kind?: string,
  /** The GUI half of the answer, when the caller asked for it. Injected rather
   *  than imported so this module stays free of the gui store's file walk. */
  guiUses?: (name: string) => GuiUseSite[]
): DependenciesResult {
  const resolved = data.index.lookup(name);
  const candidates = resolved.length > 0 ? resolved : data.index.lookupAll(name);
  const def = (kind ? candidates.find((d) => d.kind === kind) : candidates[0]) ?? null;
  if (!def) return { def: null, dependents: [], dependencies: [], ...(guiUses ? { guiUses: [] } : {}) };

  return {
    def: { name: def.name, kind: def.kind, file: def.file, line: def.line },
    dependents: collectDependents(data, def),
    dependencies: collectDependencies(data, schema, def),
    ...(guiUses ? { guiUses: guiUses(def.name) } : {}),
  };
}

// ---- dependents -------------------------------------------------------------

interface Site {
  file: string;
  line: number;
}

function collectDependents(data: ServerData, def: Definition): DependencyGroup[] {
  const sites: Site[] = data.refIndex
    .lookup(def.name)
    .filter((r) => r.kinds.includes(def.kind))
    .map((r) => ({ file: r.file, line: r.line }));

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
  const refs = extractReferences(text, def.file, def.source, schema).references;
  const typedSites = new Set(refs.map((r) => `${r.line}:${r.startChar}`));
  for (const ref of refs) {
    if (ref.line < startLine || ref.line > endLine || ref.name === def.name) continue;
    const target = resolveTarget(data, ref.name, ref.kinds);
    if (target) addTarget(target);
  }

  // Unprefixed script-value expressions have no schema ref field. Typed
  // references above already determine the meaning of the other scalars.
  walkScalars(block, (word, isKey, offset) => {
    if (isKey || word === def.name) return;
    const pos = li.positionAt(offset);
    if (typedSites.has(`${pos.line}:${pos.character}`)) return;
    const target = data.index.lookup(word).find((d) => d.kind === "script_value");
    if (target) addTarget(target);
  });

  return toGroups(groups);
}

/** Visit every unquoted scalar in a block: keys (isKey=true) and values. */
function walkScalars(block: BlockNode, cb: (word: string, isKey: boolean, offset: number) => void): void {
  for (const stmt of block.statements) {
    if (stmt.kind === "assignment") {
      if (!stmt.key.quoted) cb(stmt.key.text, true, stmt.key.range.start);
      const v = stmt.value;
      if (v?.kind === "scalar" && !v.quoted) cb(v.text, false, v.range.start);
      const sub = childBlock(stmt);
      if (sub) walkScalars(sub, cb);
    } else if (stmt.value.kind === "scalar" && !stmt.value.quoted) {
      cb(stmt.value.text, false, stmt.value.range.start);
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
  return defs.find((d) => kinds.includes(d.kind)) ?? null;
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
