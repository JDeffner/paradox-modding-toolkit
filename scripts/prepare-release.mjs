// Shared by release preparation and manual publishing. Validate before any remote write.
import { readFileSync, writeFileSync } from "node:fs";

const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  throw new Error("RELEASE_TAG must be a version tag such as v0.4.4");
}
const version = tag.slice(1);
for (const file of ["packages/vscode/package.json", "package.json"]) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.version !== version) {
    throw new Error(`${tag} does not match ${file} version ${manifest.version}`);
  }
}

const file = `docs/release/${version}.md`;
const notes = readFileSync(file, "utf8")
  .replace(/^\uFEFF/, "")
  .replace(/^# [^\r\n]*\r?\n/, "")
  .replace(/^### Full changelog\b[\s\S]*/m, "")
  .trim();
if (!notes) throw new Error(`${file} must contain release notes`);
writeFileSync("release-body.md", `${notes}\n`);
console.log(`Validated ${tag} and collected ${file}`);
