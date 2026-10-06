import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importWiki } from "./import-content.mjs";
import { groupsFor } from "./catalog.mjs";

const cache = resolve(import.meta.dirname, "../.cache");
await mkdir(cache, { recursive: true });
async function fixture(t) {
  const root = await mkdtemp(join(cache, "wiki-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const wiki = join(root, "source");
  const output = join(root, "output");
  await mkdir(wiki);
  const git = (...args) => execFileSync("git", ["-C", wiki, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  const commit = (date) => {
    git("add", ".");
    execFileSync(
      "git",
      [
        "-C",
        wiki,
        "-c",
        "user.name=Joël Deffner",
        "-c",
        "user.email=134447802+JDeffner@users.noreply.github.com",
        "commit",
        "-qm",
        "Wiki fixture",
      ],
      { env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } }
    );
  };
  await writeFile(join(wiki, "Home.md"), "# Home\n\nThe wiki introduction.\n");
  return { wiki, output, git, commit };
}

test("imports committed guides and assets without copying dirty edits or wiki controls", async (t) => {
  const { wiki, output, git, commit } = await fixture(t);
  await writeFile(join(wiki, "Guide.md"), "# Guide\n\nPublished text.\n");
  await writeFile(join(wiki, "_Sidebar.md"), "Navigation only");
  await writeFile(join(wiki, "TODO.md"), "Maintenance only");
  await mkdir(join(wiki, "images"));
  const pixels = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  await writeFile(join(wiki, "images/example.png"), pixels);
  commit();
  await writeFile(join(wiki, "Guide.md"), "Unpublished draft");
  const manifest = await importWiki(wiki, output);
  assert.deepEqual(manifest.importedPages, ["Guide.md", "Home.md"]);
  assert.equal(manifest.wikiRevision, git("rev-parse", "HEAD"));
  assert.equal(await readFile(join(output, "content/Guide.md"), "utf8"), "# Guide\n\nPublished text.\n");
  assert.deepEqual(await readFile(join(output, "images/example.png")), pixels);
  await assert.rejects(readFile(join(output, "content/_Sidebar.md")), { code: "ENOENT" });
});

test("wiki additions, renames and deletions replace the cache and update navigation", async (t) => {
  const { wiki, output, commit } = await fixture(t);
  await writeFile(join(wiki, "Old.md"), "# Old\n");
  commit();
  await importWiki(wiki, output);
  await rename(join(wiki, "Old.md"), join(wiki, "New.md"));
  await writeFile(join(wiki, "Getting-Started.md"), "# Getting Started\n");
  commit();
  const manifest = await importWiki(wiki, output);
  assert.deepEqual(manifest.importedPages, ["Getting-Started.md", "Home.md", "New.md"]);
  await assert.rejects(readFile(join(output, "content/Old.md")), { code: "ENOENT" });
  const catalog = groupsFor(manifest.importedPages.map((name) => name.slice(0, -3)));
  assert.deepEqual(catalog.flatMap((group) => group.pages).sort(), ["Getting-Started", "Home", "New"]);
  assert.equal(catalog.find((group) => group.title === "More guides").pages[0], "New");
});

test("an invalid wiki fails without replacing the last successful import", async (t) => {
  const { wiki, output, commit } = await fixture(t);
  commit();
  await importWiki(wiki, output);
  const before = await readFile(join(output, "manifest.json"), "utf8");
  await rm(join(wiki, "Home.md"));
  commit();
  await assert.rejects(importWiki(wiki, output), /Wiki has no Home.md/);
  assert.equal(await readFile(join(output, "manifest.json"), "utf8"), before);
});

test("page dates follow each file's committed history, including renamed pages", async (t) => {
  const { wiki, output, git, commit } = await fixture(t);
  await writeFile(join(wiki, "Guide.md"), "# Guide\n\nOriginal guide.\n");
  commit("2026-08-01T12:00:00Z");
  const originalRevision = git("rev-parse", "HEAD");
  await writeFile(join(wiki, "Home.md"), "# Home\n\nNew introduction.\n");
  commit("2026-09-15T12:00:00Z");
  const manifest = await importWiki(wiki, output);
  assert.equal(manifest.pageHistory["Guide.md"].revision, originalRevision);
  // Git versions serialize UTC as either Z or +00:00; the instant must match.
  assert.equal(Date.parse(manifest.pageHistory["Guide.md"].updatedAt), Date.parse("2026-08-01T12:00:00Z"));
  assert.equal(Date.parse(manifest.pageHistory["Home.md"].updatedAt), Date.parse("2026-09-15T12:00:00Z"));
  await rename(join(wiki, "Guide.md"), join(wiki, "Renamed.md"));
  commit("2026-09-20T12:00:00Z");
  const renamed = await importWiki(wiki, output);
  assert.equal(Date.parse(renamed.pageHistory["Renamed.md"].updatedAt), Date.parse("2026-09-20T12:00:00Z"));
  assert.equal(renamed.pageHistory["Guide.md"], undefined);
});

test("a shallow checkout cannot assign snapshot dates to unchanged pages", async (t) => {
  const { wiki, output, commit } = await fixture(t);
  commit();
  const shallow = `${output}-shallow`;
  execFileSync("git", ["clone", "--quiet", "--depth", "1", pathToFileURL(wiki).href, shallow]);
  await assert.rejects(importWiki(shallow, output), /history is incomplete/);
});
