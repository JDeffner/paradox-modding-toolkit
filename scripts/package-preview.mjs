// Package a <version>-preview VSIX (without touching package.json) and install it into VS Code.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const preview = `${version}-preview`;
const vsix = `px-toolkit-${preview}.vsix`;
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run(
  `vsce package ${preview} --no-update-package-json --allow-missing-repository --no-dependencies -o ${vsix}`
);
run(`code --install-extension ${vsix} --force`);
console.log(`\nInstalled ${preview}. Reload open VS Code windows to pick it up.`);
