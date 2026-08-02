// Implements the source-writer design of Sage's Clausewitz Studio; behavior contract in docs/gui-designer/parity-checklist.md. GPL-3.0-or-later.
/**
 * G1 source writer, exact-byte goldens over the span model (`sourceEdit.ts`).
 *
 * The writer matters more than the layout engine: a wrong layout shows a bad
 * preview, a wrong writer CORRUPTS the file. So every unit case asserts the
 * exact resulting text, and the corpus sweeps assert the invariants that found
 * what code review did not (S02 single-entry rewrite byte-identity here; the
 * inverse round trips land with their stages).
 *
 * Stage 2 rows: W02-W09 (property operations), swept by S02.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { decode } from "../src/parser";
import { findEntry, parseGuiSource, type GuiEntry, type GuiSourceFile } from "../src/gui/sourceModel";
import {
  applyAll,
  applyEdit,
  dropNested,
  removeProperty,
  setProperty,
  setValue,
  type GuiEdit,
} from "../src/gui/sourceEdit";
import { devPath } from "../../../scripts/devPaths";

const CORPUS = path.join(__dirname, "fixtures", "gui");

function apply(text: string, edit: GuiEdit | null): string {
  expect(edit).not.toBeNull();
  return applyEdit(text, edit!);
}

/** The first widget/decl whose name property equals `name`. */
function widget(file: GuiSourceFile, name: string): GuiEntry {
  const found = file.entries.find((e) => e.body !== null && findEntry(e.body, "name")?.value === name);
  if (!found) throw new Error(`no widget named ${name}`);
  return found;
}

// ── W02-W08: replace, insert, remove, batch ─────────────────────────────────

describe("sourceEdit: spans, replace, insert, remove (W02-W08)", () => {
  const SRC =
    "window = {\n" +
    '\tname = "test"\n' +
    "\tsize = { 100 200 }\n" +
    "\tvbox = {\n" +
    "\t\tposition = { 10 20 }\n" +
    "\t}\n" +
    "}\n";

  it("replace rewrites only the old value's bytes, minimally (W02)", () => {
    const file = parseGuiSource(SRC);
    const win = file.root.children[0];
    const edit = setProperty(file, win, "size", "{ 300 400 }")!;
    expect(apply(SRC, edit)).toBe(SRC.replace("{ 100 200 }", "{ 300 400 }"));
    expect(edit.end - edit.start).toBe(11); // "{ 100 200 }"
  });

  it("key lookup is case-insensitive, an unchanged value is a no-op (W02)", () => {
    const file = parseGuiSource(SRC);
    const win = file.root.children[0];
    expect(setProperty(file, win, "SIZE", "{ 1 2 }")).not.toBeNull();
    expect(setProperty(file, win, "size", "{ 100 200 }")).toBeNull();
  });

  it("insert lands on its own line before the closing brace (W03)", () => {
    const file = parseGuiSource(SRC);
    const win = file.root.children[0];
    expect(apply(SRC, setProperty(file, win, "visible", "no"))).toBe(
      "window = {\n" +
        '\tname = "test"\n' +
        "\tsize = { 100 200 }\n" +
        "\tvbox = {\n" +
        "\t\tposition = { 10 20 }\n" +
        "\t}\n" +
        "\tvisible = no\n" +
        "}\n"
    );
  });

  it("a nested insert copies the nested indent (W03)", () => {
    const file = parseGuiSource(SRC);
    const vbox = file.root.children[0].body!.children[0];
    expect(apply(SRC, setProperty(file, vbox, "spacing", "5"))).toContain("\n\t\tspacing = 5\n");
  });

  it("remove takes the whole line (W04)", () => {
    const file = parseGuiSource(SRC);
    const size = findEntry(file.root.children[0].body!, "size")!;
    expect(apply(SRC, removeProperty(file, size))).toBe(
      "window = {\n" + '\tname = "test"\n' + "\tvbox = {\n" + "\t\tposition = { 10 20 }\n" + "\t}\n" + "}\n"
    );
  });

  it("a batch replaces and inserts against the same text, untouched bytes identical (W05)", () => {
    const file = parseGuiSource(SRC);
    const vbox = file.root.children[0].body!.children[0];
    const pos = setProperty(file, vbox, "position", "{ 50 60 }")!;
    const siz = setProperty(file, vbox, "size", "{ 70 80 }")!;
    const both = applyAll(SRC, [pos, siz]);
    expect(both).toContain("position = { 50 60 }");
    expect(both).toContain("\t\tsize = { 70 80 }");
    expect(both).toContain('name = "test"');
    expect(both).toContain("\tsize = { 100 200 }"); // window's own size untouched
  });

  it("rewrites the LAST occurrence of a duplicate key (W07)", () => {
    const dup = "widget = {\n\tsize = { 1 1 }\n\tsize = { 2 2 }\n}\n";
    const file = parseGuiSource(dup);
    expect(apply(dup, setProperty(file, file.root.children[0], "size", "{ 9 9 }"))).toBe(
      "widget = {\n\tsize = { 1 1 }\n\tsize = { 9 9 }\n}\n"
    );
  });

  it("a compound a|b value is replaced whole (W08)", () => {
    const compound = "widget = {\n\tparentanchor = top|left\n}\n";
    const file = parseGuiSource(compound);
    expect(apply(compound, setProperty(file, file.root.children[0], "parentanchor", "center"))).toBe(
      "widget = {\n\tparentanchor = center\n}\n"
    );
  });
});

// ── W06: formatting the writer must preserve ────────────────────────────────

describe("sourceEdit: formatting preservation (W06)", () => {
  it("a CRLF file gets a CRLF insert, comments survive", () => {
    const crlf =
      "widget = {\r\n" +
      "\t# keep this comment\r\n" +
      "\tsize = { 10 10 }\t# and this trailing one\r\n" +
      "}\r\n";
    const file = parseGuiSource(crlf);
    const out = apply(crlf, setProperty(file, file.root.children[0], "alpha", "0.5"));
    expect(out).toContain("\talpha = 0.5\r\n");
    expect(out).toContain("# keep this comment");
    expect(out).toContain("# and this trailing one");
  });

  it("remove keeps a line that still holds a trailing comment (W04)", () => {
    const crlf = "widget = {\r\n\tsize = { 10 10 }\t# and this trailing one\r\n}\r\n";
    const file = parseGuiSource(crlf);
    const size = findEntry(file.root.children[0].body!, "size")!;
    expect(apply(crlf, removeProperty(file, size))).toContain("# and this trailing one");
  });

  it("a single-line body stays single-line", () => {
    const oneLine = "widget = { size = { 4 4 } }\n";
    const file = parseGuiSource(oneLine);
    expect(apply(oneLine, setProperty(file, file.root.children[0], "alpha", "1"))).toBe(
      "widget = { size = { 4 4 } alpha = 1 }\n"
    );
  });

  it("an empty single-line body gets a spaced entry (W25)", () => {
    const empty = "widget = {}\n";
    const file = parseGuiSource(empty);
    expect(apply(empty, setProperty(file, file.root.children[0], "alpha", "1"))).toBe(
      "widget = { alpha = 1 }\n"
    );
  });

  it("a space-indented file keeps spaces", () => {
    const spaced = "widget = {\n    size = { 1 1 }\n}\n";
    const file = parseGuiSource(spaced);
    expect(apply(spaced, setProperty(file, file.root.children[0], "alpha", "1"))).toBe(
      "widget = {\n    size = { 1 1 }\n    alpha = 1\n}\n"
    );
  });

  it("mixed bodies in ONE file each keep their own indent", () => {
    // The indent is a string copied from the body being written into, never a
    // column count, so the file-wide unit (tabs here) cannot leak into the
    // space-indented body next door.
    const text = fs.readFileSync(path.join(CORPUS, "writer/mixed-indent.gui"), "utf8");
    const file = parseGuiSource(text);
    expect(file.indentUnit).toBe("\t");
    expect(apply(text, setProperty(file, widget(file, "px_mixed_tabbed"), "alpha", "1"))).toContain(
      '\t\tname = "px_mixed_tabbed"\n\t\tsize = { 40 40 }\n\t\talpha = 1\n\t}'
    );
    expect(apply(text, setProperty(file, widget(file, "px_mixed_spaced"), "alpha", "1"))).toContain(
      '        name = "px_mixed_spaced"\n        size = { 40 40 }\n        alpha = 1\n    }'
    );
  });
});

// ── W09: template use site and refusals ─────────────────────────────────────

describe("sourceEdit: template use site (W09)", () => {
  const TSRC = "template MyTpl {\n\tsize = { 5 5 }\n}\nwindow = {\n\tusing = MyTpl\n}\n";

  it("an inherited property has no local entry, so a write adds a LOCAL override", () => {
    const file = parseGuiSource(TSRC);
    const win = file.root.children[1];
    expect(findEntry(win.body!, "size")).toBeNull();
    expect(findEntry(win.body!, "using")!.value).toBe("MyTpl");
    expect(apply(TSRC, setProperty(file, win, "size", "{ 8 8 }"))).toBe(
      "template MyTpl {\n\tsize = { 5 5 }\n}\nwindow = {\n\tusing = MyTpl\n\tsize = { 8 8 }\n}\n"
    );
  });

  it("a node with no body (a scalar entry) refuses every property write", () => {
    const file = parseGuiSource(TSRC);
    const using = findEntry(file.root.children[1].body!, "using")!;
    expect(setProperty(file, using, "size", "{ 1 1 }")).toBeNull();
  });
});

// ── W23: nested selection collapses to the outermost ────────────────────────

describe("sourceEdit: dropNested (W23)", () => {
  it("a selection holding a box and its child collapses to the box", () => {
    const file = parseGuiSource(fs.readFileSync(path.join(CORPUS, "writer/nested-selection.gui"), "utf8"));
    const outer = widget(file, "px_outer");
    const inner = widget(file, "px_inner_one");
    const sibling = widget(file, "px_sibling");
    expect(dropNested([outer, inner])).toEqual([outer]);
    expect(dropNested([inner, outer])).toEqual([outer]);
    // Non-nested siblings both survive; property writes never route through this.
    expect(dropNested([outer, sibling])).toEqual([outer, sibling]);
    expect(dropNested([inner])).toEqual([inner]);
  });
});

// ── applyAll ordering ───────────────────────────────────────────────────────

describe("sourceEdit: applyAll ordering (W05)", () => {
  it("applies later offsets first and drops overlapping edits", () => {
    const text = "abcdef";
    // Two inserts at the same offset keep list order; a replace that overlaps a
    // later edit is dropped rather than corrupting the text.
    expect(
      applyAll(text, [
        { start: 2, end: 2, newText: "X" },
        { start: 2, end: 2, newText: "Y" },
      ])
    ).toBe("abXYcdef");
    // End-first: the rightmost edit (2..4 → "Q") applies, then 0..3 overlaps it
    // (its end 3 > the applied edit's start 2) and is dropped.
    expect(
      applyAll(text, [
        { start: 0, end: 3, newText: "Z" },
        { start: 2, end: 4, newText: "Q" },
      ])
    ).toBe("abQef");
  });
});

// ── S02: single-entry rewrite leaves every other byte identical ─────────────

interface RewriteCounts {
  files: number;
  rewrites: number;
  /** Rewrites that were also re-parsed to check the root count still holds. */
  parseChecks: number;
  bad: string[];
}

/**
 * One probe per body: rewrite that body's first property value and assert every
 * other byte survived. `reparseAll` re-parses after every probe as well, which
 * is the second half of S02 (the document still parses to the same root count).
 * The vanilla sweep passes false: one full re-parse per rewrite is 40k parses of
 * the game tree, minutes of gate time, and S01/S06 already sweep every span of
 * those same 373 files, so there the root count is checked once per file.
 */
function rewriteSweep(named: { name: string; text: string }[], reparseAll: boolean): RewriteCounts {
  const counts: RewriteCounts = { files: 0, rewrites: 0, parseChecks: 0, bad: [] };
  for (const { name, text } of named) {
    const file = parseGuiSource(text);
    counts.files++;
    const rootCount = file.root.children.length;
    let checkedThisFile = false;
    for (const node of file.entries) {
      if (!node.body) continue;
      const target = node.body.entries.find((e) => e.kind === "property" && e.valueSpan);
      if (!target) continue;
      const edit = setValue(file, target, "PX_PROBE");
      // A value that already reads "PX_PROBE" is a no-op; nothing in the corpus does.
      if (!edit) continue;
      counts.rewrites++;
      const after = applyEdit(text, edit);
      const expected =
        text.slice(0, target.valueSpan!.start) + "PX_PROBE" + text.slice(target.valueSpan!.end);
      if (after !== expected) {
        counts.bad.push(`${name}:${target.line + 1} byte drift`);
        continue;
      }
      if (!reparseAll && checkedThisFile) continue;
      checkedThisFile = true;
      counts.parseChecks++;
      if (parseGuiSource(after).root.children.length !== rootCount) {
        counts.bad.push(`${name}:${target.line + 1} root count changed`);
      }
    }
  }
  return counts;
}

function corpusFiles(): string[] {
  const out: string[] = [];
  for (const group of fs.readdirSync(CORPUS, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(CORPUS, group.name)).sort()) {
      if (f.endsWith(".gui")) out.push(`${group.name}/${f}`);
    }
  }
  return out.sort();
}

describe("sourceEdit: S02 single-entry rewrite byte-identity", () => {
  it("over the fixture corpus, a rewrite changes exactly its value span", () => {
    const counts = rewriteSweep(
      corpusFiles().map((name) => ({ name, text: fs.readFileSync(path.join(CORPUS, name), "utf8") })),
      true
    );
    expect(counts.bad).toEqual([]);
    // Baseline recorded 2026-08-02; see docs/gui-designer/parity-checklist.md §G.
    expect(counts).toMatchObject({ files: 39, rewrites: 367, parseChecks: 367 });
  });
});

describe("sourceEdit: S02 vanilla sweep", () => {
  const gamePath = devPath("gamePath");
  const guiDir = gamePath ? path.join(gamePath, "gui") : null;

  it.skipIf(!guiDir)("a single-entry rewrite is byte-identical over the vanilla gui tree", () => {
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".gui")) paths.push(p);
      }
    };
    walk(guiDir!);
    paths.sort();
    const named = paths.map((p) => ({ name: path.basename(p), text: decode(fs.readFileSync(p)).text }));
    const counts = rewriteSweep(named, false);
    expect(counts.bad).toEqual([]);
    expect(counts.files).toBe(373);
    expect(counts.rewrites).toBeGreaterThan(20_000);
    // One re-parse per file that carried a probe: 365 of the 373 do, the rest
    // hold no body with a property in it. A lower bound, like the rewrites: a
    // game patch legitimately moves the number.
    expect(counts.parseChecks).toBeGreaterThan(300);
    console.log(
      `vanilla S02 rewrite sweep: ${counts.files} files, ${counts.rewrites} rewrites, ` +
        `${counts.parseChecks} re-parses, 0 bad`
    );
  });
});
