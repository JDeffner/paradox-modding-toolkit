/**
 * Diagnostic: what does the user ACTUALLY see in the suggest widget?
 *
 * Builds the real completion environment (vanilla + mod index, freqs), runs the
 * real provider at synthetic-but-representative cursor positions, and replays
 * VS Code's own filter/sort pipeline (test/vscodeFuzzy.ts) over the result for a
 * series of typed prefixes. Also reports list sizes and JSON payload bytes —
 * the transport cost VS Code pays per completion request.
 *
 * Run:
 *   npx esbuild scripts/fuzzy-diag.ts --bundle --platform=node --outfile=dist/fuzzy-diag.cjs \
 *     && node dist/fuzzy-diag.cjs <modPath> [gamePath]
 */
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildEvalEnv } from "../packages/server/test/rankEvalCore";
import { simulateSuggest } from "../packages/server/test/vscodeFuzzy";
import { classifyFile } from "../packages/server/src/index/indexer";
import { devPath, requireDevPath } from "./devPaths";

const modPath = process.argv[2] ?? requireDevPath("corpusPath", "fuzzy-diag");
const gamePath = process.argv[3] ?? devPath("gamePath");

const wikidocsDir = path.join(__dirname, "..", "packages", "server", "data", "ck3", "wikidocs");
const freqsDir = path.join(__dirname, "..", "packages", "server", "data", "ck3");

const t0 = Date.now();
const env = buildEvalEnv({ wikidocsDir, freqsDir, gamePath, modPath });
console.log(
  `index: ${env.data.index.stats().total} defs, ${env.data.tokens.length} tokens (${Date.now() - t0} ms)\n`
);

interface Scenario {
  name: string;
  /** File path (decides the schema entry), text with a `|` cursor marker. */
  file: string;
  text: string;
  prefixes: string[];
}

const EV = path.join(modPath!, "events", "diag_events.txt");
const IA = path.join(modPath!, "common", "character_interactions", "diag_interactions.txt");

const scenarios: Scenario[] = [
  {
    name: "event immediate (effect block, character scope)",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\ttype = character_event\n\timmediate = {\n\t\t|\n\t}\n}\n`,
    prefixes: ["", "ad", "add_", "add_p", "sav", "tra", "se"],
  },
  {
    name: "event trigger block",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\ttype = character_event\n\ttrigger = {\n\t\t|\n\t}\n}\n`,
    prefixes: ["", "ha", "has_t", "is_", "ag"],
  },
  {
    name: "event top level (structure keys)",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\t|\n}\n`,
    prefixes: ["", "de", "op", "tr"],
  },
  {
    name: "option block",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\ttype = character_event\n\toption = {\n\t\t|\n\t}\n}\n`,
    prefixes: ["", "na", "ai"],
  },
  {
    name: "value position: has_trait = ",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\ttype = character_event\n\ttrigger = {\n\t\thas_trait = |\n\t}\n}\n`,
    prefixes: ["", "b", "brav"],
  },
  {
    name: "value position: add_gold = (numeric, no ref field)",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\ttype = character_event\n\timmediate = {\n\t\tadd_gold = |\n\t}\n}\n`,
    prefixes: ["", "m"],
  },
  {
    name: "value position: culture = culture:… prefix",
    file: EV,
    text: `namespace = diag\ndiag.1 = {\n\ttype = character_event\n\ttrigger = {\n\t\tculture = culture:|\n\t}\n}\n`,
    prefixes: [""],
  },
  {
    name: "scope: prefix in interaction",
    file: IA,
    text: `diag_interaction = {\n\tis_shown = {\n\t\tscope:|\n\t}\n}\n`,
    prefixes: [""],
  },
  {
    name: "interaction top level",
    file: IA,
    text: `diag_interaction = {\n\t|\n}\n`,
    prefixes: ["", "is", "on"],
  },
];

for (const sc of scenarios) {
  const cursor = sc.text.indexOf("|");
  const text = sc.text.slice(0, cursor) + sc.text.slice(cursor + 1);
  const entry = classifyFile(modPath!, sc.file, env.schema.entries);
  const rootScopes = entry?.rootScopes?.length
    ? new Set(entry.rootScopes.map((s: string) => s.toLowerCase()))
    : null;

  console.log(`\n=== ${sc.name} (entry: ${entry?.kind ?? "none"}) ===`);
  for (const prefix of sc.prefixes) {
    const withPrefix = text.slice(0, cursor) + prefix + text.slice(cursor);
    // Unique URI per scenario+prefix: the server parse cache is keyed by uri+version.
    const uri = `file:///${sc.file.replace(/\\/g, "/")}?${encodeURIComponent(sc.name + prefix)}`;
    const doc = TextDocument.create(uri, "paradox", 1, withPrefix);
    const t = Date.now();
    const { items, isIncomplete } = env.completion.provide(doc, cursor + prefix.length, rootScopes, entry);
    const ms = Date.now() - t;
    const payload = Buffer.byteLength(JSON.stringify(items), "utf8");
    const shown = simulateSuggest(
      items.map((i) => ({ label: i.label, sortText: i.sortText, filterText: i.filterText })),
      prefix
    );
    const top = shown.slice(0, 12).map((r) => r.item.label);
    console.log(
      `  "${prefix}": ${items.length} items${isIncomplete ? " (incomplete)" : ""}, ${(payload / 1024).toFixed(0)} KB, ${ms} ms → ${shown.length} match` +
        `\n      top: ${top.join(", ")}`
    );
  }
}
