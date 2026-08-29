// Copy the steamworks.js package (native Steam Workshop binding) into the
// vscode package's dist/ so the .vsix is self-contained: node_modules never
// ships (vsce --no-dependencies) and esbuild cannot bundle .node binaries.
// dist/steamBridge.js loads it from dist/steamworks at runtime.
//
// The whole dist/ of the package goes along (win64 + linux64 + osx, ~7 MB):
// one .vsix serves every platform, matching how the rest of the extension is
// packaged.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vscode = join(root, "packages", "vscode");
// Resolve through the vscode package so pnpm's symlinked layout is followed.
const require = createRequire(join(vscode, "package.json"));
const source = dirname(require.resolve("steamworks.js/package.json"));

const target = join(vscode, "dist", "steamworks");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["package.json", "index.js", "dist"]) {
  cpSync(join(source, entry), join(target, entry), { recursive: true, dereference: true });
}
