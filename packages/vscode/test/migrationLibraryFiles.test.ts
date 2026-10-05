import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { discoverMigrationLibraryFiles } from "../src/compatch/migrationLibraryFiles";

let scratch: string;
beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "px-migration-discovery-"));
});
afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});
async function file(relative: string): Promise<string> {
  const filename = path.join(scratch, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, "discovery must not evaluate code");
  return filename;
}

describe("contribution file discovery", () => {
  it("skips descendant symlinks and junctions while allowing an explicitly selected folder alias", async () => {
    const selected = await file("selected/note.json");
    const outside = await file("outside/recipe.js");
    const root = path.dirname(selected);
    await fs.symlink(path.dirname(outside), path.join(root, "linked"), "junction");
    const alias = path.join(scratch, "alias");
    await fs.symlink(root, alias, "junction");
    const discovered = await discoverMigrationLibraryFiles([alias, root, selected]);
    expect(discovered.hasFolders).toBe(true);
    expect(discovered.files.map((candidate) => candidate.localPath)).toEqual([await fs.realpath(selected)]);
  });
  it.each([
    { entries: 1, files: 10, depth: 10 },
    { entries: 10, files: 1, depth: 10 },
    { entries: 10, files: 10, depth: 0 },
  ])("reports traversal overflow instead of returning a truncated library (%j)", async (limits) => {
    await file("library/a.json");
    await file("library/nested/b.cjs");
    await expect(
      discoverMigrationLibraryFiles([path.join(scratch, "library")], undefined, limits)
    ).rejects.toThrow(/(?:exceeds|Too many)/);
  });
  it("accepts supported direct filenames, rejects unsupported files, and honours cancellation", async () => {
    const selected = await file("arbitrary.config.JSON");
    const rejected = await file("recipe.ts");
    const discovered = await discoverMigrationLibraryFiles([selected, selected]);
    expect(discovered.hasFolders).toBe(false);
    expect(discovered.files).toMatchObject([{ label: "arbitrary.config.JSON", dataOnly: true }]);
    await expect(discoverMigrationLibraryFiles([rejected])).rejects.toThrow(rejected);
    const controller = new AbortController();
    controller.abort();
    await expect(discoverMigrationLibraryFiles([selected], controller.signal)).rejects.toThrow("cancelled");
  });
});
