// Test the actual tarball without a workspace node_modules tree.
import { execFileSync, execSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, access, copyFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const tarball = process.argv[2];
if (!tarball) throw new Error("Usage: node scripts/test-pxtk-package.mjs <cli.tgz>");
const root = path.resolve(import.meta.dirname, "..");
await mkdir(path.join(root, ".local/testing"), { recursive: true });
const scratch = await mkdtemp(path.join(root, ".local/testing/pxtk package ü "));
// Windows' system tar loses non-ASCII command-line paths. The process cwd is
// set through the native Unicode API, so keep tar's own arguments relative.
await copyFile(path.resolve(tarball), path.join(scratch, "payload.tgz"));
execFileSync("tar", ["-xzf", "payload.tgz"], { cwd: scratch });
const pkg = path.join(scratch, "package");
const manifest = JSON.parse(await readFile(path.join(pkg, "package.json"), "utf8"));
assert.equal(manifest.bin.pxtk, "dist/pxtk.cjs");
assert.deepEqual(
  Object.keys(manifest.dependencies ?? {}),
  ["sharp"],
  "Only the native image codec is installed separately."
);
for (const file of [
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "dist/lsp/server.js",
  "dist/licenses/dependencies.json",
  "dist/data/ck3/freqs.json",
  "dist/data/vic3/freqs.json",
  "dist/data/eu5/skeletons.json",
  "plugins/paradox-toolkit/.codex-plugin/plugin.json",
  "plugins/paradox-toolkit/.claude-plugin/plugin.json",
  "plugins/paradox-toolkit/.mcp.json",
  "plugins/paradox-toolkit/skills/paradox-toolkit/SKILL.md",
])
  await access(path.join(pkg, file));
const mod = path.join(scratch, "mod");
await mkdir(path.join(mod, ".px-toolkit"), { recursive: true });
await mkdir(path.join(mod, "common/scripted_effects"), { recursive: true });
await writeFile(path.join(mod, "descriptor.mod"), '\uFEFFname="Packed CLI test"\n');
await writeFile(
  path.join(mod, ".px-toolkit/pxtk.json"),
  JSON.stringify({ game: "ck3", gamePath: null, logsPath: null, tigerPath: null })
);
await writeFile(path.join(mod, "common/scripted_effects/probe.txt"), "\uFEFFpxtk_packed_probe = {}\n");
await writeFile(
  path.join(scratch, "package.json"),
  JSON.stringify({ private: true, dependencies: { "@px-lsp/cli": "file:./payload.tgz" } })
);
await writeFile(path.join(scratch, "pnpm-workspace.yaml"), "packages: []\n");
execSync("pnpm install --offline --ignore-scripts", { cwd: scratch, stdio: "pipe", windowsHide: true });
const command = path.join(scratch, "node_modules/@px-lsp/cli", manifest.bin.pxtk);
const result = JSON.parse(
  execFileSync(
    process.execPath,
    [command, "inspect", "pxtk_packed_probe", "--kind", "scripted_effect", "--json"],
    {
      cwd: mod,
      encoding: "utf8",
      timeout: 60_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PX_"))),
    }
  )
);
assert.equal(result.status, "ok");
assert.equal(result.data.definitions.items[0].name, "pxtk_packed_probe");
assert.equal(result.sources.documentation, "bundled");
const prepared = JSON.parse(
  execFileSync(
    process.execPath,
    [command, "create", "scripted_effect", "packed_effect", "--prefix", "packed", "--write", "--json"],
    {
      cwd: mod,
      encoding: "utf8",
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PX_"))),
    }
  )
);
assert.equal(prepared.data.mode, "written");
await writeFile(
  path.join(mod, "pixel.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
    "base64"
  )
);
const image = JSON.parse(
  execFileSync(process.execPath, [command, "image", "inspect", "pixel.png", "--json"], {
    cwd: mod,
    encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PX_"))),
  })
);
assert.equal(image.data.images.items[0].width, 1);
console.log(
  `Packed pxtk ${manifest.version}: executable, LSP, all games' data, licenses and plugin verified in ${scratch}`
);
