// Build the standalone server tarball (M1.5): everything a non-VSCode editor
// needs to run the language server over --stdio. Layout inside the tarball
// mirrors the repo/vsix (dist/server.js next to data/ck3/), which is what the
// server's bundle-relative data fallback expects.
//
// Run after `pnpm run compile`:  node scripts/build-server-tarball.mjs
// Output: px-lsp-server-<version>.tar.gz at the repo root.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = join(root, "packages", "server");
const bundle = join(server, "dist", "server.js");
if (!existsSync(bundle)) {
  console.error(
    "build-server-tarball: packages/server/dist/server.js missing — run `pnpm run compile` first."
  );
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(server, "package.json"), "utf8"));
const name = `px-lsp-server-${version}`;
const stage = join(tmpdir(), `px-lsp-tarball-${process.pid}`);
const pkgDir = join(stage, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(pkgDir, "dist"), { recursive: true });

cpSync(bundle, join(pkgDir, "dist", "server.js"));

// Every bundled game gets its data/<gameId>/ folder, discovered rather than
// listed: hardcoding "ck3" here would silently ship the wrong data for the
// next game (the other tables are inlined into the bundle by esbuild; only
// these two are read from disk at runtime).
const dataRoot = join(server, "data");
for (const gameId of readdirSync(dataRoot)) {
  if (!statSync(join(dataRoot, gameId)).isDirectory()) continue;
  for (const asset of ["freqs.json", "wikidocs"]) {
    const from = join(dataRoot, gameId, asset);
    if (!existsSync(from)) continue;
    cpSync(from, join(pkgDir, "data", gameId, asset), { recursive: true });
  }
  // Build-time input only; not shipped (same as the .vsix).
  rmSync(join(pkgDir, "data", gameId, "wikidocs", "Data_types.md"), { force: true });
}
cpSync(join(root, "LICENSE"), join(pkgDir, "LICENSE"));
cpSync(join(server, "README.md"), join(pkgDir, "README.md"));

// Relative paths + cwd: GNU tar on Windows reads "F:" in an absolute path as
// a remote host. The staged tarball is copied over (temp may be another drive).
const out = join(root, `${name}.tar.gz`);
rmSync(out, { force: true });
execFileSync("tar", ["-czf", `${name}.tar.gz`, name], { cwd: stage, stdio: "inherit" });
cpSync(join(stage, `${name}.tar.gz`), out);
rmSync(stage, { recursive: true, force: true });
console.log(`packed ${out}`);
