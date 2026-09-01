/**
 * Schema-driven definition extraction: given a file's content and its schema
 * entry, produce the definitions it contains. This is what the per-entry
 * schema fixture tests exercise.
 *
 * No `vscode` imports here: unit-tested in plain Node.
 */
import type { Definition, DefSource } from "@px-lsp/protocol/types";
import type { SchemaEntry } from "../schema/types";
import { LineIndex, parseLoc, parseScript, walkStatements, type RootNode, type Statement } from "../parser";
import { docForDefinition } from "./docComments";
import { shareDefinitionStrings } from "./intern";
import { activeProfile } from "../games/active";

/** Max loc value length kept in memory; the edit flow re-reads the yml from disk. */
export const LOC_VALUE_LIMIT = 200;

const DEF_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export const EVENT_ID = /^[A-Za-z0-9_-]+\.\d+$/;
const TITLE_KEY = /^[ekdcb]_[A-Za-z0-9_-]+$/;

export function extractDefinitions(
  content: string,
  entry: SchemaEntry,
  file: string,
  source: DefSource
): Definition[] {
  const extraction = entry.extraction ?? "top-level-key";
  if (extraction === "loc-key") return extractLocDefinitions(content, file, source);
  const { root } = parseScript(content);
  return extractDefinitionsParsed(content, root, new LineIndex(content), entry, file, source);
}

/**
 * The body of `extractDefinitions` over a CST the caller already has.
 *
 * The mod scan reads and parses each script file ONCE and feeds the same parse
 * to this and to `extractReferencesParsed`; parsing every mod file twice was
 * the largest single cost of a cold index build. `extractDefinitions` above is
 * the same function with the parse in front, and stays the entry point for the
 * incremental rescan and for callers holding only text.
 *
 * Callers must pass the `content` the CST was parsed from: offsets index into it.
 */
export function extractDefinitionsParsed(
  content: string,
  root: RootNode,
  lines: LineIndex,
  entry: SchemaEntry,
  file: string,
  source: DefSource
): Definition[] {
  const extraction = entry.extraction ?? "top-level-key";
  const defs: Definition[] = [];
  // Raw lines (split on \n; entries may keep a trailing \r) for encoding-safe
  // leading-comment capture (§E). Computed once per file, near-zero cost.
  const rawLines = content.split("\n");
  const push = (name: string, offset: number, container?: string) => {
    const line = lines.positionAt(offset).line;
    const def: Definition = { name, kind: entry.kind, file, line, source };
    if (container !== undefined) def.container = container;
    const block = docForDefinition(rawLines, line);
    if (block) {
      if (block.doc) def.doc = block.doc;
      if (block.tags.length > 0) def.tags = block.tags;
    }
    defs.push(def);
  };

  // Scripted effects/triggers/modifiers can declare $PARAM$ parameters in their body.
  const harvestParams =
    entry.kind === "scripted_effect" ||
    entry.kind === "scripted_trigger" ||
    entry.kind === "scripted_modifier";
  const PARAM = /\$([A-Za-z0-9_]+)(?:\|[^$\n]*)?\$/g;

  // Names declared INSIDE a definition body but referenced like definitions
  // elsewhere: trait `group = X` (has_trait accepts the group) and game-concept
  // `alias = { a b }` (loc [Concept] links). Deduped per file.
  const seenInnerNames = new Set<string>();

  // Database entry modes (`REPLACE:key = { ... }`), for games whose profile
  // declares them: index under the bare name, keep the mode on the Definition.
  const entryModes = activeProfile().entryModes;
  const modePrefix = entryModes?.length ? new RegExp(`^(${entryModes.join("|")}):`) : null;

  switch (extraction) {
    case "top-level-key":
      for (const stmt of root.statements) {
        if (stmt.kind !== "assignment" || stmt.key.quoted) continue;
        if (stmt.op !== "=" && stmt.op !== "?=") continue;
        let name = stmt.key.text;
        let entryMode: string | undefined;
        const mode = modePrefix?.exec(name);
        if (mode) {
          entryMode = mode[1];
          name = name.slice(mode[0].length);
        }
        if (!DEF_NAME.test(name) || name === "namespace") continue;
        push(name, stmt.key.range.start);
        if (entryMode) defs[defs.length - 1].entryMode = entryMode;
        if (harvestParams) {
          const body = content.slice(stmt.range.start, stmt.range.end);
          const params: string[] = [];
          PARAM.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = PARAM.exec(body)) !== null) {
            if (!params.includes(m[1])) params.push(m[1]);
          }
          if (params.length > 0) defs[defs.length - 1].params = params;
        }
        // Scripted lists generate every_/any_/random_/ordered_<name> iterators;
        // the `base` link decides the iterated scope (scopes/model.ts consumes it).
        if (entry.kind === "scripted_list" && stmt.value?.kind === "block") {
          for (const s of stmt.value.statements) {
            if (s.kind !== "assignment" || s.key.quoted || s.key.text !== "base") continue;
            if (s.value?.kind !== "scalar" || s.value.quoted) continue;
            defs[defs.length - 1].value = s.value.text;
            break;
          }
        }
        if (entry.kind === "trait" && stmt.value?.kind === "block") {
          for (const s of stmt.value.statements) {
            if (s.kind !== "assignment" || s.key.quoted || s.key.text !== "group") continue;
            if (s.value?.kind !== "scalar" || s.value.quoted || !DEF_NAME.test(s.value.text)) continue;
            if (seenInnerNames.has(s.value.text)) continue;
            seenInnerNames.add(s.value.text);
            defs.push({
              name: s.value.text,
              kind: "trait_group",
              file,
              line: lines.positionAt(s.value.range.start).line,
              source,
              container: name,
            });
          }
        }
        if (entry.kind === "game_concept" && stmt.value?.kind === "block") {
          for (const s of stmt.value.statements) {
            if (
              s.kind !== "assignment" ||
              s.key.quoted ||
              s.key.text !== "alias" ||
              s.value?.kind !== "block"
            )
              continue;
            for (const el of s.value.statements) {
              if (el.kind !== "value" || el.value.kind !== "scalar" || el.value.quoted) continue;
              if (!DEF_NAME.test(el.value.text) || seenInnerNames.has(el.value.text)) continue;
              seenInnerNames.add(el.value.text);
              defs.push({
                name: el.value.text,
                kind: "game_concept",
                file,
                line: lines.positionAt(el.value.range.start).line,
                source,
                container: name,
              });
            }
          }
        }
      }
      break;

    case "event-id": {
      // Event files may also declare `scripted_trigger NAME = { ... }` /
      // `scripted_effect NAME = { ... }` inline (file-local, but referenced
      // like their common/ counterparts). The tolerant parser reads the
      // keyword as a bare marker scalar followed by the NAME assignment.
      // Scanned at EVERY depth: one tolerant-parse hiccup earlier in a
      // thousand-line vanilla file nests everything after it inside a block,
      // and the declarations must survive that (#5). Event ids stay
      // top-level only — nested ids are option/trigger content, not events.
      const scanList = (statements: Statement[], depth: number) => {
        let inlineKind: "scripted_trigger" | "scripted_effect" | null = null;
        for (const stmt of statements) {
          if (stmt.kind === "value") {
            const text = stmt.value.kind === "scalar" && !stmt.value.quoted ? stmt.value.text : "";
            inlineKind = text === "scripted_trigger" || text === "scripted_effect" ? text : null;
            if (stmt.value.kind === "block") scanList(stmt.value.statements, depth + 1);
            else if (stmt.value.kind === "tagged-block") scanList(stmt.value.block.statements, depth + 1);
            continue;
          }
          const marker = inlineKind;
          inlineKind = null;
          if (stmt.key.quoted) continue;
          if (stmt.op === "=" || stmt.op === "?=") {
            if (marker && DEF_NAME.test(stmt.key.text)) {
              const line = lines.positionAt(stmt.key.range.start).line;
              const def: Definition = { name: stmt.key.text, kind: marker, file, line, source };
              const block = docForDefinition(rawLines, line);
              if (block) {
                if (block.doc) def.doc = block.doc;
                if (block.tags.length > 0) def.tags = block.tags;
              }
              const body = content.slice(stmt.range.start, stmt.range.end);
              const params: string[] = [];
              PARAM.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = PARAM.exec(body)) !== null) {
                if (!params.includes(m[1])) params.push(m[1]);
              }
              if (params.length > 0) def.params = params;
              defs.push(def);
            } else if (depth === 0 && EVENT_ID.test(stmt.key.text)) {
              push(stmt.key.text, stmt.key.range.start);
            }
          }
          if (stmt.value?.kind === "block") scanList(stmt.value.statements, depth + 1);
          else if (stmt.value?.kind === "tagged-block") scanList(stmt.value.block.statements, depth + 1);
        }
      };
      scanList(root.statements, 0);
      break;
    }

    case "nested-title":
      // Landed titles nest: e_empire { k_kingdom { d_duchy { c_county { b_barony } } } }
      walkStatements(root, (stmt: Statement, ancestors) => {
        if (stmt.kind !== "assignment" || stmt.key.quoted) return;
        if (!TITLE_KEY.test(stmt.key.text)) return;
        if (stmt.value?.kind !== "block") return;
        // Container: the nearest ancestor assignment that is itself a title.
        let container: string | undefined;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const a = ancestors[i];
          if (a.kind === "assignment" && TITLE_KEY.test(a.key.text)) {
            container = a.key.text;
            break;
          }
        }
        push(stmt.key.text, stmt.key.range.start, container);
      });
      break;

    case "gui-type": {
      // GUI: `type NAME = base { ... }`, `template NAME { ... }` and
      // `local_template NAME { ... }`. The tolerant parser reads these as a bare
      // marker scalar statement followed by an assignment whose key is the NAME.
      // `types Group { ... }` wraps the `type` pattern one level down.
      const scan = (statements: Statement[]) => {
        for (let i = 0; i < statements.length - 1; i++) {
          const marker = statements[i];
          if (marker.kind !== "value" || marker.value.kind !== "scalar" || marker.value.quoted) continue;
          const kw = marker.value.text.toLowerCase();
          if (kw !== "type" && kw !== "template" && kw !== "local_template" && kw !== "types") continue;
          const named = statements[i + 1];
          if (named.kind !== "assignment" || named.key.quoted) continue;
          if (kw === "types") {
            if (named.value?.kind === "block") scan(named.value.statements);
          } else if (DEF_NAME.test(named.key.text)) {
            push(named.key.text, named.key.range.start);
          }
        }
      };
      scan(root.statements);
      break;
    }
  }
  // Every string above is a slice of `content` and would pin the whole file for
  // as long as the index holds the definition (§C2).
  return shareDefinitionStrings(defs);
}

export function extractLocDefinitions(content: string, file: string, source: DefSource): Definition[] {
  const defs: Definition[] = [];
  for (const entry of parseLoc(content).entries) {
    let value = entry.value;
    if (value.length > LOC_VALUE_LIMIT) value = value.slice(0, LOC_VALUE_LIMIT);
    defs.push({ name: entry.key, kind: "loc_key", file, line: entry.line, source, value });
  }
  return shareDefinitionStrings(defs);
}
