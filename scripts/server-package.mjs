// What a released standalone-server package contains, in one place: the
// tarball (scripts/build-server-tarball.mjs) and the Windows zip
// (scripts/build-server-zip.mjs) stage the exact same payload, so the two
// artifacts cannot drift apart.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const serverDir = join(repoRoot, "packages", "server");

/** Version of @px-lsp/server, which every artifact name carries. */
export function serverVersion() {
  return JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8")).version;
}

/**
 * Copy the shipped payload into `dest`: dist/server.js next to data/<gameId>/,
 * which is what the server's bundle-relative data fallback expects, plus the
 * three text files. Exits when the bundle has not been compiled.
 */
export function stageServerPayload(dest) {
  const bundle = join(serverDir, "dist", "server.js");
  if (!existsSync(bundle)) {
    console.error("packages/server/dist/server.js missing. Run `pnpm run compile` first.");
    process.exit(1);
  }

  mkdirSync(join(dest, "dist"), { recursive: true });
  cpSync(bundle, join(dest, "dist", "server.js"));

  // Every bundled game gets its data/<gameId>/ folder, discovered rather than
  // listed: hardcoding "ck3" here would silently ship the wrong data for the
  // next game (the other tables are inlined into the bundle by esbuild; only
  // these two are read from disk at runtime).
  const dataRoot = join(serverDir, "data");
  for (const gameId of readdirSync(dataRoot)) {
    if (!statSync(join(dataRoot, gameId)).isDirectory()) continue;
    for (const asset of ["freqs.json", "wikidocs"]) {
      const from = join(dataRoot, gameId, asset);
      if (!existsSync(from)) continue;
      cpSync(from, join(dest, "data", gameId, asset), { recursive: true });
    }
    // Build-time input only; not shipped (same as the .vsix).
    rmSync(join(dest, "data", gameId, "wikidocs", "Data_types.md"), { force: true });
  }

  cpSync(join(repoRoot, "LICENSE"), join(dest, "LICENSE"));
  cpSync(join(serverDir, "README.md"), join(dest, "README.md"));
  cpSync(join(repoRoot, "THIRD-PARTY-NOTICES.md"), join(dest, "THIRD-PARTY-NOTICES.md"));
}
