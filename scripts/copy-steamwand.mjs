// Copy the steamwand.js package (koffi-based Steam Workshop binding)
// into the vscode package's dist/ so the .vsix is self-contained: node_modules
// never ships (vsce --no-dependencies) and the Steam redistributables cannot
// be bundled by esbuild. dist/steamBridge.js loads it from dist/steamwand at
// runtime.
//
// koffi ships prebuilds for ~17 platforms (~28 MB); only the ones the
// extension serves are copied (~8 MB), matching the old steamworks.js payload.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOFFI_PLATFORMS = new Set(["win32_x64", "linux_x64", "linux_arm64", "darwin_x64", "darwin_arm64"]);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vscode = join(root, "packages", "vscode");
// Resolve through the vscode package so pnpm's symlinked layout is followed.
const require = createRequire(join(vscode, "package.json"));
const source = dirname(require.resolve("steamwand.js/package.json"));

const target = join(vscode, "dist", "steamwand");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["package.json", "dist", "runtime"]) {
  cpSync(join(source, entry), join(target, entry), { recursive: true, dereference: true });
}

// koffi goes to dist/steamwand/node_modules/koffi so require() finds it.
const koffiSource = dirname(createRequire(join(source, "package.json")).resolve("koffi/package.json"));
const koffiTarget = join(target, "node_modules", "koffi");
cpSync(koffiSource, koffiTarget, { recursive: true, dereference: true });
for (const dir of readdirSync(join(koffiTarget, "build", "koffi"))) {
  if (!KOFFI_PLATFORMS.has(dir)) rmSync(join(koffiTarget, "build", "koffi", dir), { recursive: true, force: true });
}
