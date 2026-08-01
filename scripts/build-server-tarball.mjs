// Build the standalone server tarball (M1.5): everything a non-VSCode editor
// needs to run the language server over --stdio. The payload comes from
// scripts/server-package.mjs, shared with the Windows zip.
//
// Run after `pnpm run compile`:  node scripts/build-server-tarball.mjs
// Output: px-lsp-server-<version>.tar.gz at the repo root.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repoRoot, serverVersion, stageServerPayload } from "./server-package.mjs";

const name = `px-lsp-server-${serverVersion()}`;
const stage = join(tmpdir(), `px-lsp-tarball-${process.pid}`);
const pkgDir = join(stage, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });

stageServerPayload(pkgDir);

// Relative paths + cwd: GNU tar on Windows reads "F:" in an absolute path as
// a remote host. The staged tarball is copied over (temp may be another drive).
const out = join(repoRoot, `${name}.tar.gz`);
rmSync(out, { force: true });
execFileSync("tar", ["-czf", `${name}.tar.gz`, name], { cwd: stage, stdio: "inherit" });
cpSync(join(stage, `${name}.tar.gz`), out);
rmSync(stage, { recursive: true, force: true });
console.log(`packed ${out}`);
