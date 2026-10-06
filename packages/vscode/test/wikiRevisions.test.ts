import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const base = path.resolve(".local/testing");
const initialDate = "2026-01-02T03:04:05.000Z";
const laterDate = "2026-02-03T04:05:06.000Z";
const image = "packages/vscode/media/image-guidelines.md";
const bbcode = "packages/vscode/media/steam-bbcode.md";
const diagnostic = "docs/diagnostics/PX1001.md";
const sources = [
  image,
  "packages/vscode/media/steam-workshop-error-codes.md",
  bbcode,
  "packages/vscode/src/webviews/credits/credits.ts",
  "packages/vscode/src/webviews/wiki/moddingTools.ts",
  "packages/vscode/src/webviews/wiki/moddingGuides.ts",
  diagnostic,
];
type Revisions = Record<string, { lastEdited?: string; uncommitted: boolean }>;
let scratch: string;
let root: string;

function write(source: string, content: string, cwd = root) {
  const file = path.join(cwd, source);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function git(args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env) {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function commit(date = initialDate) {
  git(["add", "--all"]);
  git(["commit", "-q", "-m", "Update fixture sources"], root, {
    ...process.env,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}
function build(cwd = root) {
  const result = spawnSync(process.execPath, [path.join(cwd, "scripts/copy-docs.mjs")], {
    cwd,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const revisions = JSON.parse(
    fs.readFileSync(path.join(cwd, "packages/vscode/dist/wiki-revisions.json"), "utf8")
  ) as Revisions;
  // Git versions spell UTC as either Z or +00:00; compare the recorded instant.
  for (const revision of Object.values(revisions)) {
    if (revision.lastEdited !== undefined) {
      revision.lastEdited = new Date(revision.lastEdited).toISOString();
    }
  }
  return { revisions, warning: result.stderr };
}

beforeEach(() => {
  fs.mkdirSync(base, { recursive: true });
  scratch = fs.mkdtempSync(path.join(base, "wiki-dates-build-"));
  root = path.join(scratch, "source");
  for (const source of sources) write(source, `Fixture: ${source}\n`);
  write("docs/diagnostics/README.md", "# Diagnostics index\n");
  write(".gitignore", "packages/vscode/dist/\n");
  for (const script of ["copy-docs.mjs", "wiki-revisions.mjs"]) {
    const target = path.join(root, "scripts", script);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve("scripts", script), target);
  }
  git(["init", "-q"]);
  git(["config", "user.name", "Wiki revision fixture"]);
  git(["config", "user.email", "wiki-fixture@example.invalid"]);
});
afterEach(() => {
  expect(scratch.startsWith(`${base}${path.sep}`)).toBe(true);
  fs.rmSync(scratch, { recursive: true, force: true });
});

it("bundles each owned source date and changes only dates for edited article sources", () => {
  commit();
  const initial = build();
  expect(initial.warning).toBe("");
  expect(Object.keys(initial.revisions).sort()).toEqual([...sources].sort());
  for (const source of sources) {
    expect(initial.revisions[source]).toEqual({ lastEdited: initialDate, uncommitted: false });
  }
  fs.utimesSync(path.join(root, image), new Date("2030-01-01"), new Date("2030-01-01"));
  expect(build().revisions).toEqual(initial.revisions);
  write("unrelated.txt", "An unrelated change\n");
  commit(laterDate);
  expect(build().revisions).toEqual(initial.revisions);
  write(image, "Edited image article\n");
  commit(laterDate);
  expect(build().revisions).toEqual({
    ...initial.revisions,
    [image]: { lastEdited: laterDate, uncommitted: false },
  });
  expect(fs.readFileSync(path.join(root, "packages/vscode/dist/diagnostics/PX1001.md"), "utf8")).toBe(
    `Fixture: ${diagnostic}\n`
  );
});

it("keeps committed dates for staged and unstaged content and marks new untracked articles", () => {
  commit();
  write(image, "Staged edit\n");
  git(["add", image]);
  write(bbcode, "Unstaged edit\n");
  const added = "docs/diagnostics/PX1002.md";
  write(added, "# New diagnostic article\n");
  const { revisions } = build();
  expect(revisions[image]).toEqual({ lastEdited: initialDate, uncommitted: true });
  expect(revisions[bbcode]).toEqual({ lastEdited: initialDate, uncommitted: true });
  expect(revisions[diagnostic]).toEqual({ lastEdited: initialDate, uncommitted: false });
  expect(revisions[added]).toEqual({ uncommitted: true });
  // The package contains the working file. An index-only change does not date it.
  write(image, `Fixture: ${image}\n`);
  expect(build().revisions[image]).toEqual({ lastEdited: initialDate, uncommitted: false });
});

it("does not substitute a shallow checkout commit for missing source history", () => {
  commit();
  write("unrelated.txt", "The shallow boundary is an unrelated commit\n");
  commit(laterDate);
  const clone = path.join(scratch, "shallow");
  git(["clone", "-q", "--depth", "1", pathToFileURL(root).href, clone]);
  write(image, "Local shallow edit\n", clone);
  const { revisions, warning } = build(clone);
  expect(warning).toContain("shallow Git history");
  for (const source of sources) expect(revisions[source].lastEdited).toBeUndefined();
  expect(revisions[image].uncommitted).toBe(true);
  expect(revisions[diagnostic].uncommitted).toBe(false);
});

it("does not use a deleted source's history for an untracked or newly staged replacement", () => {
  commit();
  git(["rm", diagnostic]);
  commit(laterDate);
  write(diagnostic, "# Replacement article\n");
  expect(build().revisions[diagnostic]).toEqual({ uncommitted: true });
  git(["add", diagnostic]);
  expect(build().revisions[diagnostic]).toEqual({ uncommitted: true });
});

it("keeps dates unknown in a source archive and still copies article content", () => {
  const gitDir = path.resolve(root, ".git");
  expect(gitDir.startsWith(`${scratch}${path.sep}`)).toBe(true);
  fs.rmSync(gitDir, { recursive: true, force: true });
  const { revisions, warning } = build();
  expect(warning).toContain("Wiki edit dates unavailable");
  for (const source of sources) expect(revisions[source]).toEqual({ uncommitted: false });
  expect(fs.existsSync(path.join(root, "packages/vscode/dist/diagnostics/PX1001.md"))).toBe(true);
});

it("marks sources without commits as uncommitted without inventing a date", () => {
  const { revisions, warning } = build();
  expect(warning).toContain("Git history has no commits");
  for (const source of sources) expect(revisions[source]).toEqual({ uncommitted: true });
});
