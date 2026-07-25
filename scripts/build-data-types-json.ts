/**
 * Build-time harvest of data types (for [ ... ] datafunction completion) from
 * the bundled wiki page wikidocs/Data_types.md: the Global Promotes and
 * Global Functions tables plus each `### TypeName` member table under
 * `## Types`. Output: packages/server/data/ck3/dataTypes.json (bundled baseline; the
 * user's own data_types.log upgrades it at runtime — see
 * server/src/data/dataTypes.ts).
 *
 * Run:
 *   npx esbuild scripts/build-data-types-json.ts --bundle --platform=node \
 *     --outfile=dist/build-data-types-json.cjs && node dist/build-data-types-json.cjs
 */
import * as fs from "fs";
import * as path from "path";

const root = path.join(__dirname, "..");
const input = path.join(root, "packages", "server", "data", "ck3", "wikidocs", "Data_types.md");
const output = path.join(root, "packages", "server", "data", "ck3", "dataTypes.json");

const text = fs.readFileSync(input, "utf8");

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `[Character](#character)` → `Character`; `[unregistered]` → null. */
function cleanRet(cell: string): string | null {
  const linked = /^\[([^\]]+)\]\([^)]*\)$/.exec(cell);
  const value = (linked ? linked[1] : cell).trim();
  if (value.length === 0 || value === "[unregistered]" || value === "unregistered" || value === "void")
    return null;
  return NAME.test(value) ? value : null;
}

/** Table rows `| Name | Ret | ... |` in `lines`, skipping header/separator rows. */
function tableRows(lines: string[]): Array<[string, string | null]> {
  const rows: Array<[string, string | null]> = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // split("|") yields "" before the first and after the last pipe.
    if (cells.length < 4) continue;
    const name = cells[1].replace(/\*/g, "").trim();
    if (!NAME.test(name)) continue; // header row (**Promote**), separators (---)
    rows.push([name, cleanRet(cells[2].replace(/\*/g, ""))]);
  }
  return rows;
}

/** Slice the page into `heading -> body lines` at the given heading level. */
function sections(lines: string[], prefix: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (current !== null) out.set(current, body);
    body = [];
  };
  for (const line of lines) {
    if (line.startsWith(prefix) && !line.startsWith(prefix + "#")) {
      flush();
      current = line.slice(prefix.length).trim();
    } else if (/^#{1,6} /.test(line) && current !== null && line.indexOf(" ") < prefix.length) {
      // A shallower heading ends the section run.
      flush();
      current = null;
    } else {
      body.push(line);
    }
  }
  flush();
  return out;
}

const lines = text.split(/\r?\n/);
const h2 = sections(lines, "## ");

const globalPromotes: Record<string, string | null> = {};
const globalFunctions: Record<string, string | null> = {};
const types: Record<string, Record<string, string | null>> = {};

/** Sections carry several tables; a known return type never loses to [unregistered]. */
function put(into: Record<string, string | null>, name: string, ret: string | null): void {
  if (!(name in into) || into[name] === null) into[name] = ret;
}

for (const [name, ret] of tableRows(h2.get("List of Global Promotes") ?? [])) put(globalPromotes, name, ret);
for (const [name, ret] of tableRows(h2.get("List of Global Functions") ?? []))
  put(globalFunctions, name, ret);

const typesBody = h2.get("Types") ?? [];
for (const [typeName, body] of sections(typesBody, "### ")) {
  if (!NAME.test(typeName)) continue;
  const members: Record<string, string | null> = {};
  for (const [name, ret] of tableRows(body)) put(members, name, ret);
  if (Object.keys(members).length > 0) types[typeName] = members;
}

const counts = {
  globalPromotes: Object.keys(globalPromotes).length,
  globalFunctions: Object.keys(globalFunctions).length,
  types: Object.keys(types).length,
  members: Object.values(types).reduce((n, m) => n + Object.keys(m).length, 0),
};
if (counts.globalPromotes < 50 || counts.types < 15 || counts.members < 500) {
  console.error("harvest looks too small — wiki page layout changed?", counts);
  process.exit(1);
}

fs.writeFileSync(output, JSON.stringify({ globalPromotes, globalFunctions, types }, null, 1) + "\n");
console.log(
  `wrote ${path.relative(root, output)}: ${counts.globalPromotes} global promotes, ` +
    `${counts.globalFunctions} global functions, ${counts.types} types with ${counts.members} members`
);
