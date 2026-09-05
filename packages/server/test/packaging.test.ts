/**
 * Packaging regression: the .vsix copy step must discover every game's runtime
 * data folder, not a hardcoded list. Adding packages/server/data/<newGame>/
 * without touching scripts/copy-server.mjs used to silently ship a .vsix with
 * no data for that game; this suite fails instead.
 *
 * `node scripts/copy-server.mjs --list` is the dry run: it prints the game ids
 * the real copy would iterate over, one per line, and copies nothing.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const server = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(dirname(server));
const dataRoot = join(server, "data");

const listed = execFileSync("node", [join(root, "scripts", "copy-server.mjs"), "--list"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter((line) => line.length > 0);

const onDisk = readdirSync(dataRoot)
  .filter((entry) => statSync(join(dataRoot, entry)).isDirectory())
  .sort();

describe("copy-server data discovery", () => {
  it("reports every game data directory on disk", () => {
    expect(listed).toEqual(onDisk);
  });
});
