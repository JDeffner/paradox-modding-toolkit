/** Harvest graphics property paths from vanilla .asset files. No binaries are read.
 * Run the bundled script with --game <id>; paths come from dev-paths.json. */
import * as fs from "fs";
import * as path from "path";
import { listFiles } from "../packages/protocol/src/fsWalk";
import { parseScript, walkStatements } from "../packages/server/src/parser";
import { parseGameArg, requireDevPath } from "./devPaths";

const { gameId } = parseGameArg(process.argv.slice(2));
const game = requireDevPath("gamePath", "build-asset-vocabulary", gameId);
const contexts: Record<string, Record<string, number>> = {};
const files = listFiles(path.join(game, "gfx"), ".asset").sort();
for (const file of files) {
  walkStatements(parseScript(fs.readFileSync(file, "utf8")).root, (s, ancestors) => {
    if (s.kind !== "assignment" || s.key.quoted || !/^[a-zA-Z_][\w]*$/.test(s.key.text)) return;
    const chain = ancestors.filter((a) => a.kind === "assignment").map((a) => a.key.text);
    if (chain.some((key) => !/^[a-zA-Z_][\w]*$/.test(key))) return;
    const context = chain.join("/");
    // These blocks use dynamic locator/attachment names as keys.
    if (context === "entity/attach" || context === "entity/state/propagate_state") return;
    const keys = (contexts[context] ??= {});
    keys[s.key.text] = (keys[s.key.text] ?? 0) + 1;
  });
}
const output = Object.fromEntries(
  Object.keys(contexts)
    .sort()
    .map((key) => [
      key,
      Object.fromEntries(Object.entries(contexts[key]).sort(([a], [b]) => a.localeCompare(b))),
    ])
);
const target = path.join("packages/server/data", gameId, "assetVocabulary.json");
fs.writeFileSync(target, JSON.stringify(output, null, 2) + "\n");
console.log(`${gameId}: ${files.length} assets, ${Object.keys(output).length} contexts -> ${target}`);
