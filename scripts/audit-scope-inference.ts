/**
 * Scope/variable-inference audit: runs the REAL scope engine (ScopeModel +
 * inferScopeAt + collectSavedScopeTypes) and the REAL completion provider over
 * every script file of a mod, and reports where the extension's understanding
 * of scopes and variables diverges from ground truth:
 *
 *   1. ROOT SCOPES  — events with `scope = X` overrides the schema ignores;
 *                     file kinds whose blocks infer from no root at all.
 *   2. scope:NAME   — every saved-scope reference, resolved against ambient +
 *                     file-local saves + mod-wide saves; unresolved names are
 *                     ambient-scope schema gaps.
 *   3. VARIABLES    — set-sites by namespace (var / local_var / global_var /
 *                     *_variable_list) vs. usages by prefix; namespace
 *                     mismatches and un-indexed variable-list names.
 *   4. SCOPE MISMATCH — engine triggers/effects used where the inferred scope
 *                     set is disjoint from their supported input scopes
 *                     (either a mod bug or an inference bug — both matter).
 *   5. UNKNOWN CAUSES — histogram of which chain segment kills inference.
 *
 * Run:
 *   npx esbuild scripts/audit-scope-inference.ts --bundle --platform=node \
 *     --outfile=dist/audit-scope-inference.cjs
 *   node dist/audit-scope-inference.cjs <modPath> [gamePath] [logsPath]
 */
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildEvalEnv } from "../packages/server/test/rankEvalCore";
import { loadTokenDataFromLogs } from "../packages/server/src/data/docsParser";
import { loadWikiTokens, mergeWikiTokens } from "../packages/server/src/data/wikiDocs";
import { classifyFile } from "../packages/server/src/index/indexer";
import {
  walkStatements,
  decode,
  LineIndex,
  type ScalarNode,
  type Statement,
} from "../packages/server/src/parser";
import { getParse, getSavedScopes } from "../packages/server/src/parseCache";
import { inferScopeAt } from "../packages/server/src/scopes/inference";
import { inferenceContextFor } from "../packages/server/src/scopes/varTypes";
import { parseOnActionsLog } from "../packages/server/src/data/docsParser";
import type { Scope } from "../packages/server/src/scopes/model";
import { devPath, requireDevPath } from "./devPaths";

const modPath = process.argv[2] ?? requireDevPath("modPath", "audit-scope-inference");
const gamePath = process.argv[3] ?? requireDevPath("gamePath", "audit-scope-inference");
const logsPath = process.argv[4] ?? devPath("logsPath") ?? "";

// --------------------------------------------------------------------------
// Variable namespaces (ground truth: effects.log / triggers.log vocabulary).
// --------------------------------------------------------------------------

type VarNs = "var" | "local_var" | "global_var" | "list" | "local_list" | "global_list";

const SET_KEYS: Record<string, VarNs> = {
  set_variable: "var",
  change_variable: "var",
  clamp_variable: "var",
  round_variable: "var",
  set_local_variable: "local_var",
  change_local_variable: "local_var",
  clamp_local_variable: "local_var",
  round_local_variable: "local_var",
  set_global_variable: "global_var",
  change_global_variable: "global_var",
  clamp_global_variable: "global_var",
  round_global_variable: "global_var",
  add_to_variable_list: "list",
  add_to_local_variable_list: "local_list",
  add_to_global_variable_list: "global_list",
};

/** Triggers/effects that READ a variable/list by name (scalar or { name = X }). */
const READ_KEYS: Record<string, VarNs> = {
  has_variable: "var",
  remove_variable: "var",
  has_local_variable: "local_var",
  remove_local_variable: "local_var",
  has_global_variable: "global_var",
  remove_global_variable: "global_var",
  has_variable_list: "list",
  clear_variable_list: "list",
  variable_list_size: "list",
  is_target_in_variable_list: "list",
  remove_list_variable: "list",
  has_local_variable_list: "local_list",
  clear_local_variable_list: "local_list",
  local_variable_list_size: "local_list",
  is_target_in_local_variable_list: "local_list",
  remove_list_local_variable: "local_list",
  has_global_variable_list: "global_list",
  clear_global_variable_list: "global_list",
  global_variable_list_size: "global_list",
  is_target_in_global_variable_list: "global_list",
  remove_list_global_variable: "global_list",
};

const IN_LIST_ITERATORS = /^(?:every|any|random|ordered)_in_(?:global_|local_)?list$/;

const VAR_PREFIX_NS: Record<string, VarNs> = { var: "var", local_var: "local_var", global_var: "global_var" };

interface Site {
  file: string;
  line: number;
}

class NameTable {
  /** namespace -> name -> sites */
  data = new Map<VarNs, Map<string, Site[]>>();
  add(ns: VarNs, name: string, site: Site): void {
    let byName = this.data.get(ns);
    if (!byName) this.data.set(ns, (byName = new Map()));
    let sites = byName.get(name);
    if (!sites) byName.set(name, (sites = []));
    sites.push(site);
  }
  has(ns: VarNs, name: string): boolean {
    return this.data.get(ns)?.has(name) ?? false;
  }
  namespacesOf(name: string): VarNs[] {
    const out: VarNs[] = [];
    for (const [ns, byName] of this.data) if (byName.has(name)) out.push(ns);
    return out;
  }
}

/** Fast regex harvest of variable set-sites from raw text (vanilla-scale). */
function harvestVarSets(text: string, file: string, into: NameTable): void {
  const lineOf = mkLineOf(text);
  for (const [key, ns] of Object.entries(SET_KEYS)) {
    // scalar form: set_variable = X   |   block form: set_variable = { name = X
    const re = new RegExp(
      `\\b${key}\\s*=\\s*(?:([A-Za-z0-9_.\\-]+)|\\{[^{}]*?name\\s*=\\s*([A-Za-z0-9_.\\-]+))`,
      "g"
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1] ?? m[2];
      if (!name || name.includes(":") || name.includes("$")) continue;
      into.add(ns, name, { file, line: lineOf(m.index) });
    }
  }
}

function mkLineOf(text: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

function collectFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // .claude worktrees, .git …
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, out);
    else if (e.name.toLowerCase().endsWith(".txt") && !e.name.endsWith(".info")) out.push(full);
  }
}

// --------------------------------------------------------------------------

interface Tally {
  count: number;
  sites: string[];
  extra?: string;
}

function tally(map: Map<string, Tally>, key: string, site: string, extra?: string): void {
  const t = map.get(key);
  if (t) {
    t.count++;
    if (t.sites.length < 3) t.sites.push(site);
  } else {
    map.set(key, { count: 1, sites: [site], extra });
  }
}

function printTallies(title: string, map: Map<string, Tally>, cap = 200): void {
  console.log(`\n== ${title} (${map.size} distinct) ==`);
  const rows = [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, cap);
  for (const [key, t] of rows) {
    console.log(`${key.padEnd(56)} ${String(t.count).padStart(5)}  ${t.extra ?? ""}  ${t.sites[0]}`);
  }
  if (map.size === 0) console.log("(none)");
  if (map.size > cap) console.log(`... ${map.size - cap} more`);
}

async function main(): Promise<void> {
  console.log(`mod:   ${modPath}\ngame:  ${gamePath}\nlogs:  ${logsPath}\n`);
  const t0 = Date.now();
  const env = buildEvalEnv({
    wikidocsDir: path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs"),
    freqsDir: path.join(__dirname, "..", "packages", "server", "data", "ck3"),
    gamePath,
    modPath,
  });
  const logTokens = loadTokenDataFromLogs(logsPath);
  if (logTokens.tokens.length > 0) {
    env.data.setTokens(
      mergeWikiTokens(
        logTokens.tokens,
        loadWikiTokens(path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs"))
      )
    );
  }
  console.log(`env ready in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${env.data.tokens.length} tokens`);

  // Ground truth: per-on_action expected scopes from the user's on_actions.log.
  // Mirrors the live server: the same map feeds inference via ctx.
  const onActionScopes = parseOnActionsLog(logsPath);
  env.data.onActionScopes = onActionScopes;
  env.data.rootScopesForFile = (file: string) => {
    const e =
      classifyFile(modPath, file, env.schema.entries) ?? classifyFile(gamePath, file, env.schema.entries);
    return e?.rootScopes?.length ? new Set(e.rootScopes.map((x) => x.toLowerCase())) : null;
  };

  // Pre-pass 1: variable set-sites, mod-wide (CST-accurate) + vanilla (regex).
  const modVars = new NameTable();
  const vanillaVars = new NameTable();
  const modFiles: string[] = [];
  collectFiles(path.join(modPath, "common"), modFiles);
  collectFiles(path.join(modPath, "events"), modFiles);
  const relOf = (f: string) => path.relative(modPath, f).split(path.sep).join("/");

  const vanillaFiles: string[] = [];
  collectFiles(path.join(gamePath, "common"), vanillaFiles);
  collectFiles(path.join(gamePath, "events"), vanillaFiles);
  for (const f of vanillaFiles) {
    try {
      harvestVarSets(decode(fs.readFileSync(f)).text, path.relative(gamePath, f), vanillaVars);
    } catch {
      /* skip */
    }
  }
  console.log(`vanilla var namespaces harvested from ${vanillaFiles.length} files`);

  // Pre-pass 2: mod variable set-sites and save_scope_value_as names (whole mod
  // BEFORE the audit pass, so read-before-set file ordering can't false-positive).
  const modValueSaves = new Set<string>();
  for (const file of modFiles) {
    let text: string;
    try {
      text = decode(fs.readFileSync(file)).text;
    } catch {
      continue;
    }
    const rel = relOf(file);
    harvestVarSets(text, rel, modVars);
    const re = /save_(?:temporary_)?scope_value_as\s*=\s*\{[^{}]*?name\s*=\s*([A-Za-z0-9_\-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) modValueSaves.add(m[1]);
  }

  // Report structures.
  const eventScopeOverrides = new Map<string, Tally>(); // events using scope = X
  const scopeRefs = new Map<string, Tally>(); // scope:NAME -> resolution
  const varMismatch = new Map<string, Tally>();
  const varUnknown = new Map<string, Tally>();
  const listRefUnindexed = new Map<string, Tally>();
  const scopeMismatch = new Map<string, Tally>();
  const unknownCauses = new Map<string, Tally>();
  const unknownRootKinds = new Map<string, Tally>();
  let inferSites = 0;
  let unknownSites = 0;

  // Saved-scope names known mod-wide (implicit defs picked up by buildEvalEnv).
  const modWideSaved = new Set<string>();
  for (const d of env.data.index.entries((def) => def.kind === "saved_scope")) modWideSaved.add(d.name);

  for (const file of modFiles) {
    let text: string;
    try {
      text = decode(fs.readFileSync(file)).text;
    } catch {
      continue;
    }
    const rel = relOf(file);
    const entry = classifyFile(modPath, file, env.schema.entries);
    const rootScopes = entry?.rootScopes?.length
      ? new Set<Scope>(entry.rootScopes.map((s) => s.toLowerCase()))
      : null;
    const doc = TextDocument.create(`file:///${file.replace(/\\/g, "/")}`, "paradox", 1, text);
    const { result } = getParse(doc);
    const lineIndex = new LineIndex(text);
    const ictx = inferenceContextFor(env.data, entry);
    const saved = getSavedScopes(doc, env.data.scopeModel, rootScopes, entry?.ambientScopes, ictx);
    const ambientNames = new Set((entry?.ambientScopes ?? []).map((a) => a.name));

    // Event `scope = X` root overrides (ground truth the schema ignores).
    if (entry?.kind === "event") {
      for (const stmt of result.root.statements) {
        if (stmt.kind !== "assignment" || stmt.value?.kind !== "block") continue;
        for (const s of stmt.value.statements) {
          if (
            s.kind === "assignment" &&
            !s.key.quoted &&
            s.key.text === "scope" &&
            s.value?.kind === "scalar"
          ) {
            tally(
              eventScopeOverrides,
              s.value.text,
              `${rel}:${lineIndex.positionAt(s.key.range.start).line + 1} (${stmt.key.text})`
            );
          }
        }
      }
    }

    const siteOf = (offset: number): string => `${rel}:${lineIndex.positionAt(offset).line + 1}`;

    // scope:NAME occurrences in any scalar (keys and values), incl. dot chains.
    const scanScopeRefs = (scalar: ScalarNode) => {
      if (scalar.quoted) return;
      const re = /scope:([A-Za-z0-9_\-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(scalar.text)) !== null) {
        const name = m[1];
        const crossFile = ictx.savedScopeTypes?.get(name);
        const status = ambientNames.has(name)
          ? "ambient"
          : saved.has(name)
            ? saved.get(name)
              ? `file-saved → ${[...(saved.get(name) as Set<string>)].join("|")}`
              : crossFile
                ? `file-saved unknown, cross-file → ${[...crossFile].join("|")}`
                : "file-saved → UNKNOWN TYPE"
            : modWideSaved.has(name)
              ? crossFile
                ? `cross-file → ${[...crossFile].join("|")}`
                : "cross-file → UNKNOWN TYPE"
              : modValueSaves.has(name)
                ? "VALUE-SAVED (not indexed?)"
                : "UNRESOLVED";
        tally(scopeRefs, `${name} [${status}]`, siteOf(scalar.range.start));
      }
    };

    // var-prefix usages in scalars.
    const scanVarRefs = (scalar: ScalarNode) => {
      if (scalar.quoted) return;
      const re = /(?:^|\.)((?:local_|global_)?var):([A-Za-z0-9_\-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(scalar.text)) !== null) {
        const ns = VAR_PREFIX_NS[m[1]];
        const name = m[2];
        if (name.includes("$") || scalar.text[m.index + m[0].length] === "$") continue;
        if (modVars.has(ns, name) || vanillaVars.has(ns, name)) continue;
        const others = [...new Set([...modVars.namespacesOf(name), ...vanillaVars.namespacesOf(name)])];
        if (others.length > 0) {
          tally(varMismatch, `${m[1]}:${name} — set as [${others.join(", ")}]`, siteOf(scalar.range.start));
        } else {
          tally(varUnknown, `${m[1]}:${name}`, siteOf(scalar.range.start));
        }
      }
    };

    walkStatements(result.root, (stmt: Statement) => {
      if (stmt.kind === "value") {
        if (stmt.value.kind === "scalar") {
          scanScopeRefs(stmt.value);
          scanVarRefs(stmt.value);
        }
        return;
      }
      const key = stmt.key.quoted ? null : stmt.key.text;
      scanScopeRefs(stmt.key);
      scanVarRefs(stmt.key);
      if (stmt.value?.kind === "scalar") {
        scanScopeRefs(stmt.value);
        scanVarRefs(stmt.value);
      }
      if (key === null) return;

      // Mod-side variable set/read sites (CST-accurate).
      const setNs = SET_KEYS[key];
      const readNs = READ_KEYS[key];
      if ((setNs || readNs) && stmt.value) {
        let nameScalar: ScalarNode | null = null;
        if (stmt.value.kind === "scalar" && !stmt.value.quoted) nameScalar = stmt.value;
        else if (stmt.value.kind === "block") {
          for (const s of stmt.value.statements) {
            if (
              s.kind === "assignment" &&
              !s.key.quoted &&
              s.key.text === "name" &&
              s.value?.kind === "scalar"
            ) {
              nameScalar = s.value;
              break;
            }
          }
        }
        if (nameScalar && !nameScalar.text.includes("$") && !nameScalar.text.includes(":")) {
          if (setNs)
            modVars.add(setNs, nameScalar.text, {
              file: rel,
              line: lineIndex.positionAt(nameScalar.range.start).line,
            });
          else if (readNs) {
            const ok = modVars.has(readNs, nameScalar.text) || vanillaVars.has(readNs, nameScalar.text);
            if (!ok) {
              const others = [
                ...new Set([
                  ...modVars.namespacesOf(nameScalar.text),
                  ...vanillaVars.namespacesOf(nameScalar.text),
                ]),
              ];
              const label =
                others.length > 0
                  ? `${key} = ${nameScalar.text} — set as [${others.join(", ")}]`
                  : `${key} = ${nameScalar.text}`;
              tally(others.length > 0 ? varMismatch : varUnknown, label, siteOf(nameScalar.range.start));
            }
          }
        }
      }

      // every_in_list = { variable = X } — is X indexed for completion?
      if (IN_LIST_ITERATORS.test(key) && stmt.value?.kind === "block") {
        for (const s of stmt.value.statements) {
          if (
            s.kind === "assignment" &&
            !s.key.quoted &&
            s.key.text === "variable" &&
            s.value?.kind === "scalar"
          ) {
            const name = s.value.text;
            if (name.includes("$") || name.includes(":")) continue;
            const indexed = env.data.index
              .lookup(name)
              .some((d) => d.kind.endsWith("_list") || d.kind === "variable");
            if (!indexed) tally(listRefUnindexed, `${key} variable = ${name}`, siteOf(s.value.range.start));
          }
        }
      }

      // Scope inference at each engine trigger/effect key.
      const toks = env.data.tokenMap.get(key);
      const tok = toks?.find((t) => t.kind === "trigger" || t.kind === "effect");
      if (!tok) return;
      inferSites++;
      const inference = inferScopeAt(
        result,
        stmt.key.range.start,
        env.data.scopeModel,
        rootScopes,
        saved,
        ictx
      );
      if (!inference.scopes || inference.scopes.size === 0) {
        unknownSites++;
        // Attribute: last chain element that produced "unknown", else the root.
        const cause = [...inference.chain].reverse().find((c) => c.endsWith("unknown"));
        const causeKey = cause
          ? cause
              .replace(/scope:[A-Za-z0-9_\-]+/, "scope:*")
              .replace(/(?:local_|global_)?var:[A-Za-z0-9_\-]+/, "var:*")
          : "(no root scope)";
        tally(unknownCauses, causeKey, siteOf(stmt.key.range.start));
        if (!rootScopes)
          tally(
            unknownRootKinds,
            entry?.kind ?? `(unclassified: ${rel.split("/").slice(0, 2).join("/")})`,
            siteOf(stmt.key.range.start)
          );
        return;
      }
      const supported = env.data.scopeModel.inputScopesOf(tok.kind as "trigger" | "effect", key);
      if (supported && ![...supported].some((s) => inference.scopes!.has(s))) {
        tally(
          scopeMismatch,
          `${key} [wants ${[...supported].join("|")}]`,
          `${siteOf(stmt.key.range.start)}  chain: ${inference.chain.join(" ▸ ")}`
        );
      }
    });
  }

  console.log(
    `\naudited ${modFiles.length} files; ${inferSites} trigger/effect sites, ${unknownSites} unknown-scope (${((unknownSites / Math.max(1, inferSites)) * 100).toFixed(1)}%)`
  );
  printTallies("EVENT `scope = X` ROOT OVERRIDES the schema ignores", eventScopeOverrides);
  printTallies("UNKNOWN-ROOT sites by file kind (schema has no rootScopes)", unknownRootKinds);
  printTallies("UNKNOWN-SCOPE causes (chain segment that lost the type)", unknownCauses, 40);
  printTallies("scope:NAME resolution", scopeRefs, 250);
  printTallies("VARIABLE namespace MISMATCHES (used with prefix ≠ set namespace)", varMismatch);
  printTallies("VARIABLE reads with NO set-site found (mod+vanilla)", varUnknown);
  printTallies("VARIABLE-LIST names NOT in the index (no completion)", listRefUnindexed);
  printTallies("TRIGGER/EFFECT used outside supported scopes (mod bug OR model bug)", scopeMismatch, 60);
  console.log(`\non_actions.log expected-scope entries available as ground truth: ${onActionScopes.size}`);
}

void main();
