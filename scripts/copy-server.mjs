// Copy the server bundle and its runtime data into the vscode package so the
// .vsix (and F5 dev host) are self-contained. Paths are relative to this file,
// not the cwd.
//
// `node scripts/copy-server.mjs --list` prints the discovered game ids instead
// of copying (used by the packaging regression test).
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = join(root, "packages", "server");
const vscode = join(root, "packages", "vscode");

/**
 * Every bundled game gets its data/<gameId>/ folder, discovered rather than
 * listed: hardcoding "ck3" here would silently drop the next game's data from
 * the .vsix (the other tables are inlined into the bundle by esbuild; only
 * these disk assets — wiki mirror, freqs, bundled dumps — are read at runtime).
 */
function discoverGameDataDirs(serverDataRoot) {
  if (!existsSync(serverDataRoot)) return [];
  return readdirSync(serverDataRoot)
    .filter((gameId) => statSync(join(serverDataRoot, gameId)).isDirectory())
    .sort();
}

function copyServer() {
  mkdirSync(join(vscode, "dist"), { recursive: true });
  cpSync(join(server, "dist", "server.js"), join(vscode, "dist", "server.js"));
  // MIT attributions for the imported CWT config data must ship in the .vsix.
  cpSync(join(root, "THIRD-PARTY-NOTICES.md"), join(vscode, "THIRD-PARTY-NOTICES.md"));

  const dataRoot = join(server, "data");
  for (const gameId of discoverGameDataDirs(dataRoot)) {
    mkdirSync(join(vscode, "data", gameId), { recursive: true });
    for (const asset of ["freqs.json", "wikidocs", "script_docs", "data_types"]) {
      const from = join(dataRoot, gameId, asset);
      if (!existsSync(from)) continue;
      cpSync(from, join(vscode, "data", gameId, asset), { recursive: true });
    }
  }
}

if (process.argv.includes("--list")) {
  console.log(discoverGameDataDirs(join(server, "data")).join("\n"));
} else {
  copyServer();
}
