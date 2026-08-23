// Build a test vsix named after the version and install it into VS Code:
//   pnpm run package:test          (from packages/vscode, or via the root script)
// Runs the full compile first: `vsce package` alone does not rebuild the
// server bundle. The vsix is gitignored (*.vsix).
import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "packages", "vscode");
const { version } = JSON.parse(readFileSync(path.join(ext, "package.json"), "utf8"));
const out = `px-toolkit-test-${version}.vsix`;
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit", shell: true });

run("pnpm run compile", ext);
run(
  `npx vsce package --no-dependencies --githubBranch main --baseImagesUrl https://github.com/JDeffner/paradox-modding-toolkit/raw/main/packages/vscode -o "${out}"`,
  ext
);
run(`code --install-extension "${out}" --force`, ext);
console.log(`\nInstalled ${out}. Reload VS Code (Developer: Reload Window) to pick it up.`);
