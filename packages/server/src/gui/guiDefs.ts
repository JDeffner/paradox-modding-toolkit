/**
 * PdxGui reuse-vocabulary store: `template` / `local_template` property
 * snippets (spliced via `using = Name`) and `types Group { type name = base
 * {...} }` widget classes, collected across files with the gui/ override
 * rule: FIOS, the FIRST definition wins (opposite of script's LIOS; see
 * AGENTS.md).
 *
 * The layout engine consumes this store to expand instances; collection is
 * separate so callers control the file set and order (vanilla + mod).
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import { LineIndex, parseScript, type BlockNode, type Statement } from "../parser";

export interface GuiTypeDef {
  /** The base widget/type key after `=`, e.g. `textbox` in `type text_single = textbox {}`. */
  base: string;
  block: BlockNode;
  /** Declaration site, present when the collector was given a file path. */
  file?: string;
  line?: number;
}

export interface GuiTemplateDef {
  block: BlockNode;
  /** local_template: valid only inside its defining file; mergeGuiDefs skips it. */
  local: boolean;
  /** Declaration site, present when the collector was given a file path. */
  file?: string;
  line?: number;
}

export interface GuiDefs {
  types: Map<string, GuiTypeDef>;
  templates: Map<string, GuiTemplateDef>;
}

export function emptyGuiDefs(): GuiDefs {
  return { types: new Map(), templates: new Map() };
}

const DECL_MARKERS = new Set(["template", "local_template", "types", "type"]);

/**
 * Collect one file's declarations (including its local_templates). Pass `file`
 * to record each declaration's site (file + line) for navigation features.
 */
export function collectGuiDefs(text: string, into?: GuiDefs, file?: string): GuiDefs {
  const lines = file !== undefined ? new LineIndex(text) : null;
  return collectGuiDefsParsed(parseScript(text).root.statements, into, file, lines);
}

/** Same as collectGuiDefs but over an already-parsed tree (parseCache reuse). */
export function collectGuiDefsParsed(
  statements: Statement[],
  into?: GuiDefs,
  file?: string,
  lines?: LineIndex | null
): GuiDefs {
  const defs = into ?? emptyGuiDefs();
  collectFrom(statements, defs, false, file, lines);
  return defs;
}

function collectFrom(
  statements: Statement[],
  defs: GuiDefs,
  insideTypes: boolean,
  file?: string,
  lines?: LineIndex | null
): void {
  let pending: string | null = null;
  const siteOf = (offset: number): { file?: string; line?: number } =>
    file !== undefined && lines ? { file, line: lines.positionAt(offset).line } : {};
  for (const stmt of statements) {
    if (stmt.kind === "value") {
      if (stmt.value.kind === "scalar" && DECL_MARKERS.has(stmt.value.text.toLowerCase())) {
        pending = stmt.value.text.toLowerCase();
      } else {
        pending = null;
      }
      continue;
    }
    // assignment
    const marker = pending;
    pending = null;
    if (!marker && !insideTypes) continue;
    const name = stmt.key.text;
    if (marker === "template" || marker === "local_template") {
      if (stmt.value?.kind === "block" && !defs.templates.has(name)) {
        defs.templates.set(name, {
          block: stmt.value,
          local: marker === "local_template",
          ...siteOf(stmt.key.range.start),
        });
      }
    } else if (marker === "types") {
      if (stmt.value?.kind === "block") {
        collectFrom(stmt.value.statements, defs, true, file, lines);
      }
    } else if (marker === "type" || insideTypes) {
      // `type name = base { ... }` parses as name = tagged-block(base).
      // Type names are stored lowercase (widget keys are matched
      // case-insensitively); template names stay exact-case like `using` refs.
      const lower = name.toLowerCase();
      if (stmt.value?.kind === "tagged-block" && !defs.types.has(lower)) {
        defs.types.set(lower, {
          base: stmt.value.tag.text,
          block: stmt.value.block,
          ...siteOf(stmt.key.range.start),
        });
      }
    }
  }
}

/**
 * Merge `source` into `target` under FIOS: existing (earlier-file) entries
 * win, and local_templates never cross files. Call in game load order
 * (path-sorted file list).
 */
export function mergeGuiDefs(target: GuiDefs, source: GuiDefs): void {
  for (const [name, def] of source.types) {
    if (!target.types.has(name)) target.types.set(name, def);
  }
  for (const [name, def] of source.templates) {
    if (!def.local && !target.templates.has(name)) target.templates.set(name, def);
  }
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/** Guards recursive templates/types (a self-referencing type hard-crashes the game). */
const MAX_DEPTH = 32;

/**
 * Resolve a widget key's type chain and produce the effective statement list:
 * base-most type first, derived types after, instance statements last (so
 * later statements override scalar props and draw on top). `using =`
 * template references are spliced inline at their position.
 */
export function expandWidget(
  key: string,
  instance: BlockNode,
  defs: GuiDefs,
  /** Skip the type chain (recursion guard) but still splice templates. */
  skipChain = false
): { baseKey: string; statements: Statement[] } {
  const chain: BlockNode[] = [];
  let base = key.toLowerCase();
  const seen = new Set<string>();
  while (!skipChain && defs.types.has(base) && !seen.has(base)) {
    seen.add(base);
    const def = defs.types.get(base)!;
    chain.unshift(def.block);
    base = def.base.toLowerCase();
  }
  const statements: Statement[] = [];
  for (const block of chain) spliceTemplates(block.statements, defs, statements, 0);
  spliceTemplates(instance.statements, defs, statements, 0);
  return { baseKey: base, statements };
}

function spliceTemplates(statements: Statement[], defs: GuiDefs, out: Statement[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const stmt of statements) {
    if (
      stmt.kind === "assignment" &&
      stmt.key.text.toLowerCase() === "using" &&
      stmt.value?.kind === "scalar"
    ) {
      const tpl = defs.templates.get(stmt.value.text);
      if (tpl) {
        spliceTemplates(tpl.block.statements, defs, out, depth + 1);
        continue;
      }
      // Unknown template: keep the statement (the game logs one error and
      // renders nothing for it; downstream treats it as an inert property).
    }
    out.push(stmt);
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers (go-to-definition, hover)
// ---------------------------------------------------------------------------

/** A resolved template/type declaration plus what it is. */
export interface ResolvedGuiDef {
  kind: "template" | "type";
  name: string;
  def: GuiTypeDef | GuiTemplateDef;
}

/**
 * Resolve a name against an ordered list of def stores (current document
 * first, then the cross-file FIOS store). Templates match exact-case (like
 * `using =` references); types match lowercased (like widget keys).
 */
export function resolveGuiDef(name: string, sources: GuiDefs[]): ResolvedGuiDef | null {
  for (const defs of sources) {
    const tpl = defs.templates.get(name);
    if (tpl) return { kind: "template", name, def: tpl };
  }
  const lower = name.toLowerCase();
  for (const defs of sources) {
    const type = defs.types.get(lower);
    if (type) return { kind: "type", name: lower, def: type };
  }
  return null;
}

/** A `block "name"` site inside a template/type body (offset is into `file`'s text). */
export interface GuiBlockSite {
  name: string;
  file?: string;
  offset: number;
}

/**
 * All block names a widget built from `root` can override with
 * `blockoverride "name"`: `block` declarations in the body itself, in
 * templates spliced via `using =` (recursively), and — for types — up the
 * base-type chain. First site found per name wins (derived-most, matching
 * FIOS spirit); `blockoverride` declarations inside templates re-expose the
 * same name and count too.
 */
export function collectOverridableBlocks(
  root: ResolvedGuiDef,
  sources: GuiDefs[]
): Map<string, GuiBlockSite> {
  const out = new Map<string, GuiBlockSite>();
  const seen = new Set<string>();
  const walk = (statements: Statement[], file: string | undefined, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let pending = false;
    for (const stmt of statements) {
      if (stmt.kind === "value") {
        pending =
          stmt.value.kind === "scalar" &&
          (stmt.value.text.toLowerCase() === "block" || stmt.value.text.toLowerCase() === "blockoverride");
        continue;
      }
      const wasBlockDecl = pending;
      pending = false;
      if (wasBlockDecl && stmt.value?.kind === "block") {
        if (!out.has(stmt.key.text)) {
          out.set(stmt.key.text, { name: stmt.key.text, file, offset: stmt.key.range.start });
        }
        // Blocks nest (a block's body can declare further blocks).
        walk(stmt.value.statements, file, depth + 1);
        continue;
      }
      if (
        stmt.kind === "assignment" &&
        stmt.key.text.toLowerCase() === "using" &&
        stmt.value?.kind === "scalar"
      ) {
        const tplName = stmt.value.text;
        if (!seen.has(`t:${tplName}`)) {
          seen.add(`t:${tplName}`);
          for (const defs of sources) {
            const tpl = defs.templates.get(tplName);
            if (tpl) {
              walk(tpl.block.statements, tpl.file, depth + 1);
              break;
            }
          }
        }
        continue;
      }
      const inner = stmt.value;
      if (inner?.kind === "block") walk(inner.statements, file, depth + 1);
      else if (inner?.kind === "tagged-block") walk(inner.block.statements, file, depth + 1);
    }
  };

  walk(root.def.block.statements, root.def.file, 0);
  if (root.kind === "type") {
    let base = (root.def as GuiTypeDef).base.toLowerCase();
    let depth = 0;
    while (depth++ < MAX_DEPTH && !seen.has(`y:${base}`)) {
      seen.add(`y:${base}`);
      let next: GuiTypeDef | null = null;
      for (const defs of sources) {
        const t = defs.types.get(base);
        if (t) {
          next = t;
          break;
        }
      }
      if (!next) break;
      walk(next.block.statements, next.file, 0);
      base = next.base.toLowerCase();
    }
  }
  return out;
}

/** The base-type chain of a type, derived-first (for hover display). */
export function typeBaseChain(name: string, sources: GuiDefs[]): string[] {
  const chain: string[] = [];
  let base = name.toLowerCase();
  const seen = new Set<string>();
  while (!seen.has(base) && chain.length <= MAX_DEPTH) {
    seen.add(base);
    let def: GuiTypeDef | null = null;
    for (const defs of sources) {
      const t = defs.types.get(base);
      if (t) {
        def = t;
        break;
      }
    }
    if (!def) break;
    chain.push(def.base);
    base = def.base.toLowerCase();
  }
  return chain;
}

/**
 * Scan an expanded statement list for `blockoverride "name" { ... }` pairs.
 * Later declarations win (instance statements come after type statements in
 * expandWidget order, so instance overrides beat type-internal ones).
 */
export function collectBlockOverrides(statements: Statement[]): Map<string, BlockNode> {
  const overrides = new Map<string, BlockNode>();
  let pending = false;
  for (const stmt of statements) {
    if (stmt.kind === "value") {
      pending = stmt.value.kind === "scalar" && stmt.value.text.toLowerCase() === "blockoverride";
      continue;
    }
    if (pending && stmt.value?.kind === "block") {
      overrides.set(stmt.key.text, stmt.value);
    }
    pending = false;
  }
  return overrides;
}
