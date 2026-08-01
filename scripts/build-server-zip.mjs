// Build the self-contained Windows release artifact: ONE zip that an embedder
// (or the Studio's installer) unpacks and runs, with no Node hunting on the
// target machine. It is the tarball payload (scripts/server-package.mjs) plus
// an unmodified official node.exe, Node's own LICENSE, and a px-lsp.cmd
// launcher that resolves everything relative to itself.
//
// Run after `pnpm run compile`:  node scripts/build-server-zip.mjs
// Output: px-lsp-win-x64-<version>.zip at the repo root.
//
// Node binary: pinned below, downloaded from nodejs.org, verified against the
// release's own SHASUMS256.txt, and cached under .cache/ (gitignored) so
// re-runs need no network. `--local-node` swaps in this machine's node so the
// file list can be asserted without a download (what CI does); a release build
// must never use it.
//
// Zip mechanism: adm-zip, a zero-dependency devDependency at the workspace
// root. No zip CLI exists on both a Windows dev box and the ubuntu runner:
// GNU tar cannot write zip, bsdtar's `-a` can but only ships on Windows, `zip`
// is the reverse, and Compress-Archive is PowerShell-only. Nothing is added to
// the server package's runtime dependencies.
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { repoRoot, serverVersion, stageServerPayload } from "./server-package.mjs";

// Node 24 "Krypton", the Active LTS line as of 2026-08-01. The exact binary an
// embedder ends up running is part of this artifact's contract, so bump it
// deliberately: re-verify the checksum and re-run the round-trip smoke.
const NODE_VERSION = "v24.18.1";
const NODE_DIST = "https://nodejs.org/dist";
const NODE_ARCHIVE = `node-${NODE_VERSION}-win-x64.zip`;

// %~dp0 keeps the launcher correct wherever the zip was unpacked, which is the
// whole point of the artifact. cmd.exe files get CRLF.
const LAUNCHER = '@"%~dp0node.exe" "%~dp0dist\\server.js" --stdio %*\r\n';

const localNode = process.argv.includes("--local-node");
const cacheDir = join(repoRoot, ".cache", "node-dist", NODE_VERSION);

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The official win-x64 dist zip, cached and checksum-verified on every run. */
async function nodeDistArchive() {
  const archive = join(cacheDir, NODE_ARCHIVE);
  const sumsFile = join(cacheDir, "SHASUMS256.txt");
  if (!existsSync(archive) || !existsSync(sumsFile)) {
    mkdirSync(cacheDir, { recursive: true });
    console.log(`downloading ${NODE_ARCHIVE} from nodejs.org (cached in .cache/ for offline re-runs)`);
    writeFileSync(sumsFile, await get(`${NODE_DIST}/${NODE_VERSION}/SHASUMS256.txt`));
    writeFileSync(archive, await get(`${NODE_DIST}/${NODE_VERSION}/${NODE_ARCHIVE}`));
  }
  const bytes = readFileSync(archive);
  const published = readFileSync(sumsFile, "utf8")
    .split(/\r?\n/)
    .find((line) => line.endsWith(` ${NODE_ARCHIVE}`))
    ?.split(/\s+/)[0];
  if (!published) throw new Error(`SHASUMS256.txt carries no entry for ${NODE_ARCHIVE}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== published) {
    throw new Error(
      `${NODE_ARCHIVE} sha256 ${actual} != published ${published}. Delete .cache/node-dist and retry.`
    );
  }
  return bytes;
}

const name = `px-lsp-win-x64-${serverVersion()}`;
const stage = join(tmpdir(), `px-lsp-zip-${process.pid}`);
const pkgDir = join(stage, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });

stageServerPayload(pkgDir);

if (localNode) {
  // FOR LOCAL TESTING ONLY: proves the layout without the 30 MB download. A
  // release build must run without the flag, so the shipped node.exe is the
  // pinned, checksum-verified official one.
  console.warn(
    `--local-node: copying ${process.execPath} instead of the pinned ${NODE_VERSION}. ` +
      "The result is a layout check, not a releasable artifact."
  );
  writeFileSync(join(pkgDir, "node.exe"), readFileSync(process.execPath));
  const beside = join(dirname(process.execPath), "LICENSE");
  writeFileSync(
    join(pkgDir, "NODE-LICENSE"),
    existsSync(beside)
      ? readFileSync(beside)
      : "Placeholder for a --local-node build. The released zip carries Node's own LICENSE here.\n"
  );
} else {
  const dist = new AdmZip(await nodeDistArchive());
  for (const [from, to] of [
    ["node.exe", "node.exe"],
    ["LICENSE", "NODE-LICENSE"], // renamed: the payload already has our GPL LICENSE
  ]) {
    const entry = dist.getEntry(`node-${NODE_VERSION}-win-x64/${from}`);
    if (!entry) throw new Error(`${NODE_ARCHIVE} carries no ${from}`);
    writeFileSync(join(pkgDir, to), entry.getData());
  }
}

writeFileSync(join(pkgDir, "px-lsp.cmd"), LAUNCHER);

// Entry names come from paths relative to pkgDir under the `name` prefix, so
// no absolute drive path can leak into the archive (the tar version of that
// trap is documented in build-server-tarball.mjs).
const out = join(repoRoot, `${name}.zip`);
rmSync(out, { force: true });
const zip = new AdmZip();
zip.addLocalFolder(pkgDir, name);
zip.writeZip(out);
rmSync(stage, { recursive: true, force: true });
console.log(`packed ${out}`);
