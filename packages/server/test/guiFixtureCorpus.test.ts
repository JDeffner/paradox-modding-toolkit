/**
 * The .gui fixture corpus is the executable half of the GUI-editor parity work
 * (docs/gui-designer/parity-checklist.md): G1's writer rebuild and G2's layout
 * merge are judged against it. This suite is the corpus's own guard rail. It
 * does not assert layout or writer BEHAVIOR (those assertions land with G1/G2);
 * it asserts that the corpus is still a valid, complete, byte-exact subject:
 *
 *   - every fixture parses (a corpus that does not parse tests nothing);
 *   - the checklist and the folder cannot drift apart in either direction;
 *   - the encoding fixtures still carry the bytes they exist for, which is the
 *     one thing a git checkout can silently destroy (see .gitattributes).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseScript } from "../src/parser";

const CORPUS = path.join(__dirname, "fixtures", "gui");
const CHECKLIST = path.join(__dirname, "..", "..", "..", "docs", "gui-designer", "parity-checklist.md");

/** Every fixture as a posix-style path relative to the corpus root. */
function fixtures(): string[] {
  const out: string[] = [];
  for (const group of fs.readdirSync(CORPUS, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(CORPUS, group.name)).sort()) {
      if (f.endsWith(".gui")) out.push(`${group.name}/${f}`);
    }
  }
  return out.sort();
}

function read(rel: string): string {
  return fs.readFileSync(path.join(CORPUS, rel), "utf8");
}

describe("gui fixture corpus", () => {
  const all = fixtures();

  it("has both groups populated", () => {
    expect(all.filter((f) => f.startsWith("layout/")).length).toBeGreaterThan(10);
    expect(all.filter((f) => f.startsWith("writer/")).length).toBeGreaterThan(10);
  });

  it("every fixture parses with no errors", () => {
    const bad = all.filter((f) => parseScript(read(f)).errors.length > 0);
    expect(bad).toEqual([]);
  });

  it("every fixture states the behavior it exercises and its checklist rows", () => {
    const missing = all.filter((f) => !/^# px fixture\b.*\bRows: [A-Z]\d/s.test(read(f).slice(0, 400)));
    expect(missing).toEqual([]);
  });

  it("the checklist and the corpus name exactly the same files", () => {
    const doc = fs.readFileSync(CHECKLIST, "utf8");
    const cited = new Set(doc.match(/(?:layout|writer)\/[a-z0-9-]+\.gui/g) ?? []);
    expect([...cited].filter((f) => !all.includes(f)).sort()).toEqual([]);
    expect(all.filter((f) => !cited.has(f))).toEqual([]);
  });

  it("the corpus README states the fixtures are original work", () => {
    const readme = fs.readFileSync(path.join(CORPUS, "README.md"), "utf8");
    expect(readme).toMatch(/original work authored in this repository/);
  });

  // The bytes below ARE the test subject for the writer invariants, and a git
  // checkout with the wrong attributes would rewrite them into each other.
  it("the CRLF fixture is CRLF throughout", () => {
    const text = read("writer/crlf.gui");
    expect(text).toContain("\r\n");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("the indent fixtures keep the indent unit they are named for", () => {
    const tabs = read("writer/tabs-comments.gui");
    expect(tabs).toMatch(/^\t\w/m);
    expect(tabs).not.toMatch(/^ +\w/m);

    const spaces = read("writer/spaces-indent.gui");
    expect(spaces).toMatch(/^ {4}\w/m);
    expect(spaces).not.toMatch(/^\t/m);

    // The point of this one is that BOTH appear, inside one file.
    const mixed = read("writer/mixed-indent.gui");
    expect(mixed).toMatch(/^\t+\w/m);
    expect(mixed).toMatch(/^ +\w/m);
  });

  it("the line-sharing fixture really shares lines", () => {
    const lines = read("writer/line-sharing.gui").split("\n");
    expect(lines.filter((l) => (l.match(/\w+ = \{/g) ?? []).length > 1).length).toBeGreaterThan(1);
  });

  it("the blank-separator fixture keeps its one-line and two-line gaps", () => {
    const text = read("writer/blank-separators.gui");
    expect(text).toContain("}\n\n\twidget");
    expect(text).toContain("}\n\n\n\twidget");
  });

  it("the comment-run fixture ends a body with a comment run", () => {
    expect(read("writer/comment-runs.gui")).toMatch(/#[^\n]*\n}\n/);
  });
});
