/**
 * Dev-time harvest for the block-schema `structure` layer (update plan v1.1 §B2).
 *
 * Parses a game `_*.info` file and prints candidate KeySpec arrays for the
 * top-level block and each named sub-block, pairing every key with the doc prose
 * the game ships (leading `#` comment block and/or trailing inline comment).
 *
 * The OUTPUT IS NOT SHIPPED. It is a first pass for a human to check and curate
 * into packages/server/src/games/ck3/structures.ts — the shipped data must be static
 * TypeScript, because users may not have gamePath set. Regenerate per patch.
 *
 * Run: npx esbuild scripts/build-structure.ts --bundle --platform=node \
 *        --outfile=dist/build-structure.cjs && node dist/build-structure.cjs <infoFile>
 *   or: node --experimental-strip-types scripts/build-structure.ts <infoFile>
 */
import * as fs from "fs";

interface KeySpec {
  key: string;
  doc?: string;
  values?: string;
  freq?: number;
}

/** Guess a KeySpec `values` tag from the RHS of a `key = <sample>` line. */
function guessValues(rhs: string): string | undefined {
  const r = rhs.trim();
  if (/^\{/.test(r)) return "block";
  if (/\byes\/no\b|\bbool\b|^yes$|^no$/i.test(r)) return "bool";
  if (/\bloc_key\b|\bkey\b|<key>/.test(r)) return "loc";
  if (/\btrigger\b|\beffect\b|\bmtth\b|<scripted value>|<script value>/.test(r)) return "block";
  return undefined;
}

/**
 * Harvest top-level keys and one level of named sub-blocks from an `.info` file.
 * The `.info` grammar is CK3-ish but comment-heavy; a line walker is enough and
 * more tolerant of the prose than the real parser.
 */
function harvest(text: string): { topLevel: KeySpec[]; blocks: Record<string, KeySpec[]> } {
  const lines = text.split(/\r?\n/);
  const topLevel: KeySpec[] = [];
  const blocks: Record<string, KeySpec[]> = {};

  // Depth 0 = outside the definition body; 1 = inside my_x = { ... }; 2 = a named sub-block.
  let depth = 0;
  let subBlockName: string | null = null;
  let pending: string[] = []; // accumulated leading `#` comment lines

  const KEY_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) {
      pending.push(trimmed.replace(/^#+\s?/, "").trim());
      continue;
    }
    if (trimmed === "") {
      pending = [];
      continue;
    }

    const opens = (trimmed.match(/\{/g) ?? []).length;
    const closes = (trimmed.match(/\}/g) ?? []).length;

    const m = KEY_LINE.exec(line);
    if (m && depth <= 2) {
      const key = m[1];
      let rhs = m[2];
      let inlineDoc = "";
      const hash = rhs.indexOf("#");
      if (hash >= 0) {
        inlineDoc = rhs
          .slice(hash + 1)
          .replace(/^#+\s?/, "")
          .trim();
        rhs = rhs.slice(0, hash);
      }
      const docParts = [...pending, inlineDoc].filter(Boolean);
      const doc = docParts.join(" ").replace(/\s+/g, " ").trim();
      const spec: KeySpec = { key };
      if (doc) spec.doc = doc;
      const values = guessValues(rhs);
      if (values) spec.values = values;

      const bodyOpensSubBlock = opens > closes && depth === 1;
      if (depth === 1) topLevel.push(spec);
      else if (depth === 2 && subBlockName) (blocks[subBlockName] ??= []).push(spec);

      if (bodyOpensSubBlock) {
        subBlockName = key;
        blocks[subBlockName] ??= [];
      }
      pending = [];
    }

    // Track brace depth after processing the line's own key.
    depth += opens - closes;
    if (depth <= 1) subBlockName = null;
    if (depth < 0) depth = 0;
    pending = [];
  }

  return { topLevel, blocks };
}

function emit(specs: KeySpec[]): void {
  for (const s of specs) {
    const parts = [`{ key: ${JSON.stringify(s.key)}`];
    if (s.values) parts.push(`values: ${JSON.stringify(s.values)}`);
    if (s.doc) parts.push(`doc: ${JSON.stringify(s.doc)}`);
    console.log("  " + parts.join(", ") + " },");
  }
}

const file = process.argv[2];
if (!file) {
  console.error("usage: build-structure <_*.info file>");
  process.exit(1);
}
const raw = fs.readFileSync(file, "utf8");
const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
const { topLevel, blocks } = harvest(text);

console.log(`// topLevel (${topLevel.length} keys) from ${file}`);
emit(topLevel);
for (const [name, specs] of Object.entries(blocks)) {
  console.log(`\n// block "${name}" (${specs.length} keys)`);
  emit(specs);
}
