/**
 * Mod syntax-coverage audit: every unquoted scalar in every script file of a
 * mod is checked against the three layers the user actually sees in the editor:
 *
 *   1. TextMate grammar (paradox.tmLanguage.json, simulated in pattern order)
 *   2. semantic tokens (the real provider, script_docs + wiki tokens + index)
 *   3. hover (the real provider)
 *
 * Reports, grouped by word with counts and a sample location:
 *   - PLAIN:    no grammar rule and no semantic token → renders as plain text
 *               (the "ROOT had no highlighting" class of bug)
 *   - NO HOVER: hover returns nothing → no tooltip
 *               (the "reference in override_background" class of bug)
 *
 * Run (see AGENTS.md "Regenerating bundled data"):
 *   npx esbuild scripts/audit-mod-coverage.ts --bundle --platform=node \
 *     --outfile=dist/audit-mod-coverage.cjs
 *   node dist/audit-mod-coverage.cjs <modPath> [gamePath] [logsPath]
 */
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildEvalEnv } from "../packages/server/test/rankEvalCore";
import { loadTokenDataFromLogs } from "../packages/server/src/data/docsParser";
import { loadWikiTokens, mergeWikiTokens } from "../packages/server/src/data/wikiDocs";
import { classifyFile } from "../packages/server/src/index/indexer";
import { provideHover } from "../packages/server/src/features/hover";
import { provideGuiHover } from "../packages/server/src/features/guiLanguage";
import { provideSemanticTokens } from "../packages/server/src/features/semanticTokens";
import {
  walkStatements,
  decode,
  LineIndex,
  type ScalarNode,
  type Statement,
} from "../packages/server/src/parser";
import { getParse } from "../packages/server/src/parseCache";
import type { Scope } from "../packages/server/src/scopes/model";
import grammar from "../packages/vscode/syntaxes/paradox.tmLanguage.json";
import guiGrammar from "../packages/vscode/syntaxes/paradox-gui.tmLanguage.json";
import { devPath, requireDevPath } from "./devPaths";

const modPath = process.argv[2] ?? requireDevPath("modPath", "audit-mod-coverage");
const gamePath = process.argv[3] ?? requireDevPath("gamePath", "audit-mod-coverage");
const logsPath = process.argv[4] ?? devPath("logsPath") ?? "";

// ---------------------------------------------------------------------------
// Grammar simulation: the shipped patterns, evaluated per line in order.
// Not a full TM engine (begin/end rules are approximated), but faithful enough
// to find scalars that no rule would color.
// ---------------------------------------------------------------------------

interface Painted {
  start: number;
  end: number;
  rule: string;
}

interface GrammarJson {
  repository: Record<string, { match?: string }>;
  patterns: Array<{ include: string }>;
}

function grammarRules(g: GrammarJson = grammar as GrammarJson): Array<{ name: string; re: RegExp }> {
  const repo = g.repository;
  const rules: Array<{ name: string; re: RegExp }> = [];
  for (const p of g.patterns) {
    // Cross-grammar include (paradox-gui pulls in source.paradox): inline it in place.
    if (p.include === "source.paradox") {
      rules.push(...grammarRules());
      continue;
    }
    const name = p.include.slice(1);
    // begin/end rules approximated as single-line spans:
    if (name === "string") {
      rules.push({ name, re: /"[^"]*"/g });
      continue;
    }
    if (name === "inline-math") {
      rules.push({ name, re: /@\[[^\]]*\]/g });
      continue;
    }
    if (name === "braces") {
      rules.push({ name, re: /[{}[\]]/g });
      continue;
    }
    const match = repo[name]?.match;
    if (match) rules.push({ name, re: new RegExp(match, "g") });
  }
  return rules;
}

function paintLine(line: string, rules: Array<{ name: string; re: RegExp }>): Painted[] {
  const painted: Painted[] = [];
  const overlaps = (s: number, e: number) => painted.some((p) => s < p.end && e > p.start);
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(line)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (!overlaps(m.index, m.index + m[0].length)) {
        painted.push({ start: m.index, end: m.index + m[0].length, rule: rule.name });
      }
    }
  }
  return painted;
}

// ---------------------------------------------------------------------------

/** Scalars that are legitimately plain / not identifier-like: skip. */
function skippable(text: string): boolean {
  if (/^-?\d+(\.\d+)?$/.test(text)) return true; // numbers (grammar-colored anyway)
  if (/^\d{1,4}\.\d{1,2}\.\d{1,2}$/.test(text)) return true; // dates
  if (text === "yes" || text === "no" || text === "none") return true;
  if (text.startsWith("@")) return true; // script constants / inline math
  if (text.includes("$")) return true; // macro params
  if (!/^[A-Za-z_]/.test(text)) return true;
  return false;
}

interface Gap {
  count: number;
  sample: string;
  roles: Set<string>;
}

function record(map: Map<string, Gap>, word: string, role: string, sample: string): void {
  const g = map.get(word);
  if (g) {
    g.count++;
    g.roles.add(role);
  } else {
    map.set(word, { count: 1, sample, roles: new Set([role]) });
  }
}

function report(title: string, map: Map<string, Gap>): void {
  console.log(`\n== ${title} (${map.size} distinct words) ==`);
  const rows = [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [word, g] of rows) {
    console.log(
      `${word.padEnd(44)} ${String(g.count).padStart(5)}  ${[...g.roles].join("/").padEnd(11)} ${g.sample}`
    );
  }
  if (rows.length === 0) console.log("(none)");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`mod:   ${modPath}\ngame:  ${gamePath}\nlogs:  ${logsPath}\n`);

  const t0 = Date.now();
  const env = buildEvalEnv({
    wikidocsDir: path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs"),
    freqsDir: path.join(__dirname, "..", "packages", "server", "data", "ck3"),
    gamePath,
    modPath,
  });
  // Mirror the live server: script_docs logs are authoritative, wiki fills gaps.
  const logTokens = loadTokenDataFromLogs(logsPath);
  if (logTokens.tokens.length > 0) {
    env.data.setTokens(
      mergeWikiTokens(
        logTokens.tokens,
        loadWikiTokens(path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs"))
      )
    );
  }
  console.log(
    `env ready in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
      `${env.data.tokens.length} tokens (${logTokens.tokens.length} from script_docs), ` +
      `${env.data.index.stats().total} defs`
  );

  const rules = grammarRules();
  const guiRules = grammarRules(guiGrammar as GrammarJson);
  const files: string[] = [];
  collect(path.join(modPath, "common"), ".txt", files);
  collect(path.join(modPath, "events"), ".txt", files);
  collect(path.join(modPath, "gui"), ".gui", files);

  const plain = new Map<string, Gap>();
  const noHover = new Map<string, Gap>();
  const plainGui = new Map<string, Gap>();
  const noHoverGui = new Map<string, Gap>();
  let scalars = 0;

  for (const file of files) {
    const buf = fs.readFileSync(file);
    const { text } = decode(buf);
    const rel = path.relative(modPath, file).split(path.sep).join("/");
    const languageId = file.endsWith(".gui") ? "paradox-gui" : "paradox";
    const doc = TextDocument.create(`file:///${file.replace(/\\/g, "/")}`, languageId, 1, text);
    const { result } = getParse(doc);
    const lineIndex = new LineIndex(text);
    const lines = text.split(/\r?\n/);
    const paintedByLine = new Map<number, Painted[]>();
    const entry = classifyFile(modPath, file, env.schema.entries);
    const rootScopes = entry?.rootScopes?.length
      ? new Set<Scope>(entry.rootScopes.map((s) => s.toLowerCase()))
      : null;

    // Real semantic tokens, decoded into start positions.
    const semStarts = new Set<string>();
    {
      const data = provideSemanticTokens(
        env.data,
        doc,
        env.schema.refFields,
        entry,
        env.schema.structures
      ).data;
      let line = 0;
      let char = 0;
      for (let i = 0; i < data.length; i += 5) {
        line += data[i];
        char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
        semStarts.add(`${line}:${char}`);
      }
    }

    const isGui = languageId === "paradox-gui";
    const check = (scalar: ScalarNode, role: string) => {
      if (scalar.quoted || skippable(scalar.text)) return;
      scalars++;
      const pos = lineIndex.positionAt(scalar.range.start);
      const sample = `${rel}:${pos.line + 1}`;

      let painted = paintedByLine.get(pos.line);
      if (!painted)
        paintedByLine.set(pos.line, (painted = paintLine(lines[pos.line] ?? "", isGui ? guiRules : rules)));
      const grammarHit = painted.some((p) => p.start <= pos.character && pos.character < p.end);
      const semanticHit = semStarts.has(`${pos.line}:${pos.character}`);
      if (!grammarHit && !semanticHit) record(isGui ? plainGui : plain, scalar.text, role, sample);

      // Mirror the live server's routing: paradox-gui gets the gui hover.
      const at = { line: pos.line, character: pos.character + 1 };
      const hover = isGui
        ? provideGuiHover(env.data, doc, at)
        : provideHover(env.data, doc, at, rootScopes, entry, () => env.schema);
      if (!hover) record(isGui ? noHoverGui : noHover, scalar.text, role, sample);
    };

    walkStatements(result.root, (stmt: Statement) => {
      if (stmt.kind === "assignment") {
        check(stmt.key, "key");
        if (stmt.value?.kind === "scalar") check(stmt.value, "value");
        if (stmt.value?.kind === "tagged-block") check(stmt.value.tag, "tag");
      } else if (stmt.value.kind === "scalar") {
        check(stmt.value, "list");
      }
    });
  }

  console.log(`\naudited ${scalars} scalars across ${files.length} files`);
  report("SCRIPT PLAIN — no grammar rule, no semantic token", plain);
  report("SCRIPT NO HOVER", noHover);
  report("GUI PLAIN — no grammar rule, no semantic token", plainGui);
  report("GUI NO HOVER", noHoverGui);
}

function collect(dir: string, ext: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, ext, out);
    else if (e.name.toLowerCase().endsWith(ext)) out.push(full);
  }
}

void main();
