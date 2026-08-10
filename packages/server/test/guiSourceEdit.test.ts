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
 * Stage 3 rows: W11-W17, W19, W20, W22, W24, W25 (the block model and the
 * structural operations), swept by S03-S05 and the paste round trip.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { decode } from "../src/parser";
import { findEntry, parseGuiSource, type GuiEntry, type GuiSourceFile } from "../src/gui/sourceModel";
import {
  applyAll,
  applyEdit,
  blockText,
  deleteWidget,
  dropNested,
  duplicateWidget,
  insertChild,
  insertRawChild,
  removeProperty,
  reorderChild,
  setProperty,
  setValue,
  sourceChildren,
  wrapInContainer,
  type GuiEdit,
} from "../src/gui/sourceEdit";
import { devPath } from "../../../scripts/devPaths";

const CORPUS = path.join(__dirname, "fixtures", "gui");

function apply(text: string, edit: GuiEdit | null): string {
  expect(edit).not.toBeNull();
  return applyEdit(text, edit!);
}

function read(name: string): string {
  return fs.readFileSync(path.join(CORPUS, name), "utf8");
}

/** The first widget/decl whose name property equals `name`. */
function widget(file: GuiSourceFile, name: string): GuiEntry {
  const found = file.entries.find((e) => e.body !== null && findEntry(e.body, "name")?.value === name);
  if (!found) throw new Error(`no widget named ${name}`);
  return found;
}

/** The names of a body's source children, in source order. */
function childNames(node: GuiEntry): (string | null)[] {
  return sourceChildren(node).map((c) => (c.body ? (findEntry(c.body, "name")?.value ?? null) : null));
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

// ── W11-W14: reorder ────────────────────────────────────────────────────────

describe("sourceEdit: reorder (W11-W14)", () => {
  const SRC = read("writer/reorder-siblings.gui");
  const A = '\twidget = {\n\t\tname = "px_order_a"\n\t}\n';
  const B = '\twidget = {\n\t\tname = "px_order_b"\n\t}\n';
  const C = '\twidget = {\n\t\tname = "px_order_c"\n\t}\n';

  /** The three-child vbox; the second root box holds the single child. */
  function box(file: GuiSourceFile): GuiEntry {
    return file.root.children[0];
  }

  it("moves first to last, last to first, middle to first and first to middle (W11)", () => {
    const file = parseGuiSource(SRC);
    expect(apply(SRC, reorderChild(file, box(file), 0, 2))).toBe(SRC.replace(A + B + C, B + C + A));
    expect(apply(SRC, reorderChild(file, box(file), 2, 0))).toBe(SRC.replace(A + B + C, C + A + B));
    expect(apply(SRC, reorderChild(file, box(file), 1, 0))).toBe(SRC.replace(A + B + C, B + A + C));
    expect(apply(SRC, reorderChild(file, box(file), 0, 1))).toBe(SRC.replace(A + B + C, B + A + C));
  });

  it("a same-index move is a no-op, an out-of-range index clamps (W11)", () => {
    const file = parseGuiSource(SRC);
    expect(reorderChild(file, box(file), 1, 1)).toBeNull();
    expect(reorderChild(file, box(file), -3, 0)).toBeNull(); // clamps onto its own index
    expect(apply(SRC, reorderChild(file, box(file), 0, 99))).toBe(SRC.replace(A + B + C, B + C + A));
  });

  it("carries the moved text verbatim (W11)", () => {
    const file = parseGuiSource(SRC);
    const after = apply(SRC, reorderChild(file, box(file), 0, 2));
    expect(after.replace(/\s+/g, "")).toBe(SRC.replace(A + B + C, B + C + A).replace(/\s+/g, ""));
    expect(childNames(parseGuiSource(after).root.children[0])).toEqual([
      "px_order_b",
      "px_order_c",
      "px_order_a",
    ]);
  });

  it("refuses a single child and a line-sharing declaration (W14)", () => {
    const file = parseGuiSource(SRC);
    expect(reorderChild(file, file.root.children[1], 0, 1)).toBeNull(); // px_single_child_box
    const shared = parseGuiSource(read("writer/line-sharing.gui"));
    expect(reorderChild(shared, shared.root.children[0], 0, 3)).toBeNull();
  });

  it("template-expanded children are not source siblings (W14)", () => {
    const file = parseGuiSource(read("writer/template-use-site.gui"));
    const use = widget(file, "px_use_site");
    // The template's own widget is NOT a sibling of the use site's child, so
    // there is exactly one source child here and nothing to reorder.
    expect(childNames(use)).toEqual(["px_real_child"]);
    expect(reorderChild(file, use, 0, 1)).toBeNull();
  });

  it("an interleaved body still moves relative to the sibling aimed at (W14, S03)", () => {
    const text = read("writer/interleaved-children.gui");
    const file = parseGuiSource(text);
    const box = file.root.children[0];
    expect(box.body!.contiguous).toBe(false);
    const after = apply(text, reorderChild(file, box, 2, 0));
    expect(childNames(parseGuiSource(after).root.children[0])).toEqual([
      "px_inter_c",
      "px_inter_a",
      "px_inter_b",
    ]);
    // The content between the children keeps its slot, which is exactly why a
    // move-and-move-back is not the identity here and a sweep must skip it.
    expect(after).toContain("\tspacing = 5\n");
    expect(after.indexOf("px_inter_a")).toBeLessThan(after.indexOf("spacing = 5"));
  });

  it("a blank separator travels with the block above it, so a move and back is the identity (W12)", () => {
    const text = read("writer/blank-separators.gui");
    const file = parseGuiSource(text);
    const moved = apply(text, reorderChild(file, file.root.children[0], 0, 3));
    expect(moved).not.toBe(text);
    // px_gap_b keeps the two blank lines that were below it.
    expect(moved).toContain('name = "px_gap_b"\n\t}\n\n\n\twidget');
    const back = parseGuiSource(moved);
    expect(apply(moved, reorderChild(back, back.root.children[0], 3, 0))).toBe(text);
  });

  it("an attached comment travels with its widget, a separated header stays put (W13)", () => {
    const text = read("writer/comment-runs.gui");
    const file = parseGuiSource(text);
    const after = apply(text, reorderChild(file, file.root.children[0], 0, 1));
    expect(after).toContain(
      '\t# the B widget\n\twidget = {\n\t\tname = "px_comment_b"\n\t}\n\n' +
        '\t# the A widget\n\twidget = {\n\t\tname = "px_comment_a"\n\t}\n'
    );
    // The section header is separated by a blank line, so it belongs to nobody
    // and stays at the top of the body.
    expect(after.indexOf("# section header")).toBeLessThan(after.indexOf("# the B widget"));
  });
});

// ── W15, W24: inserting a child widget ──────────────────────────────────────

describe("sourceEdit: insert a child (W15, W24)", () => {
  const PROBE = { type: "widget", properties: [["name", '"px_new"']] } as const;

  it("appends at the last child's block end, above a trailing comment run (W24)", () => {
    const text = read("writer/comment-runs.gui");
    const file = parseGuiSource(text);
    const after = apply(text, insertChild(file, file.root.children[0], PROBE));
    expect(after).toContain(
      '\t\tname = "px_comment_b"\n\t}\n' +
        '\twidget = {\n\t\tname = "px_new"\n\t}\n' +
        "\n\t# trailing run, the append trap:"
    );
  });

  it("a childless body still appends above its trailing comment run (W24)", () => {
    const text = read("writer/comment-runs.gui");
    const file = parseGuiSource(text);
    const after = apply(text, insertChild(file, widget(file, "px_no_children_trailing_comments"), PROBE));
    expect(after).toContain(
      "\tspacing = 4\n\n" +
        '\twidget = {\n\t\tname = "px_new"\n\t}\n' +
        "\t# nothing but a comment run after the last entry\n"
    );
  });

  it("an index lands before that child's block, comment included (W15)", () => {
    const text = read("writer/comment-runs.gui");
    const file = parseGuiSource(text);
    const after = apply(text, insertChild(file, file.root.children[0], PROBE, 1));
    expect(after).toContain(
      '\t\tname = "px_comment_a"\n\t}\n' + '\twidget = {\n\t\tname = "px_new"\n\t}\n' + "\t# the B widget\n"
    );
    expect(childNames(parseGuiSource(after).root.children[0])).toEqual([
      "px_comment_a",
      "px_new",
      "px_comment_b",
    ]);
  });

  it("an out-of-range index appends, and a propertyless insert is an empty body (W15)", () => {
    const text = read("writer/reorder-siblings.gui");
    const file = parseGuiSource(text);
    const after = apply(text, insertChild(file, file.root.children[0], { type: "vbox" }, 99));
    expect(after).toContain('\t\tname = "px_order_c"\n\t}\n\tvbox = {}\n}');
    // It re-parses as a real child rather than as malformed text.
    expect(childNames(parseGuiSource(after).root.children[0])).toEqual([
      "px_order_a",
      "px_order_b",
      "px_order_c",
      null,
    ]);
    expect(parseGuiSource(after).errors).toEqual([]);
  });

  it("follows the file's indent unit (W15, W06)", () => {
    const text = read("writer/spaces-indent.gui");
    const file = parseGuiSource(text);
    const after = apply(text, insertChild(file, widget(file, "px_spaced_window"), PROBE));
    expect(after).toContain('    widget = {\n        name = "px_new"\n    }\n}');
  });

  it("follows the file's newline (W15, W06)", () => {
    const text = read("writer/crlf.gui");
    const file = parseGuiSource(text);
    const vbox = file.root.children[0].body!.children[0];
    const after = apply(text, insertChild(file, vbox, PROBE));
    expect(after).toContain('\t\twidget = {\r\n\t\t\tname = "px_new"\r\n\t\t}\r\n\t}');
    expect(after).not.toMatch(/[^\r]\n/);
  });

  it("refuses a body whose closing brace shares a line with its last content (W15)", () => {
    // There is no line to write on, and a delete could not put a split line
    // back together, so the honest answer is a refusal rather than a mangling.
    const src = "vbox = {\n\tspacing = 5 }\n";
    const file = parseGuiSource(src);
    expect(file.root.children[0].body!.singleLine).toBe(false);
    expect(insertChild(file, file.root.children[0], PROBE)).toBeNull();
    expect(insertRawChild(file, file.root.children[0], 'widget = { name = "px" }\n')).toBeNull();
  });

  it("a single-line body stays single-line (W15, W25)", () => {
    const text = read("writer/single-line-bodies.gui");
    const file = parseGuiSource(text);
    const hbox = widget(file, "px_one_line_window").body!.children[3];
    expect(apply(text, insertChild(file, hbox, PROBE))).toContain(
      '\thbox = { spacing = 2 widget = { size = { 8 8 } } widget = { name = "px_new" } }\n'
    );
  });
});

// ── W16: deleting a widget ──────────────────────────────────────────────────

describe("sourceEdit: delete a widget (W16)", () => {
  it("removes the whole declaration with its attached comment, siblings untouched", () => {
    const text = read("writer/comment-runs.gui");
    const file = parseGuiSource(text);
    const after = applyEdit(text, deleteWidget(file, widget(file, "px_comment_a")));
    expect(after).not.toContain("# the A widget");
    expect(after).not.toContain("px_comment_a");
    expect(after).toContain('\t# the B widget\n\twidget = {\n\t\tname = "px_comment_b"\n\t}\n');
    expect(after).toContain("\t# section header, separated by a blank line below\n");
  });

  it("keeps a sibling property, and the blank separator below the block", () => {
    const text = read("writer/blank-separators.gui");
    const file = parseGuiSource(text);
    const after = applyEdit(text, deleteWidget(file, widget(file, "px_gap_b")));
    // The two blank lines below px_gap_b were its own block's, so they survive
    // the delete: an insert here puts the widget back exactly (S04).
    expect(after).toContain('name = "px_gap_a"\n\t}\n\n\n\n\twidget = {\n\t\tname = "px_gap_c"');
  });

  it("a line-sharing declaration loses one separator space, the neighbour stays (W16)", () => {
    const text = read("writer/line-sharing.gui");
    const file = parseGuiSource(text);
    expect(applyEdit(text, deleteWidget(file, widget(file, "px_share_a")))).toContain(
      '\twidget = { name = "px_share_b" }\n'
    );
    const again = parseGuiSource(text);
    expect(applyEdit(text, deleteWidget(again, widget(again, "px_share_b")))).toContain(
      '\twidget = { name = "px_share_a" }\n'
    );
  });
});

// ── W17: duplicate ──────────────────────────────────────────────────────────

describe("sourceEdit: duplicate (W17)", () => {
  it("the copy lands immediately after the original and only the copy is renamed", () => {
    const text = read("writer/reorder-siblings.gui");
    const file = parseGuiSource(text);
    const after = apply(text, duplicateWidget(file, widget(file, "px_order_a"), "px_order_a_copy"));
    expect(after).toContain(
      '\twidget = {\n\t\tname = "px_order_a"\n\t}\n' +
        '\twidget = {\n\t\tname = "px_order_a_copy"\n\t}\n' +
        '\twidget = {\n\t\tname = "px_order_b"\n\t}\n'
    );
  });

  it("duplicating the LAST child stays inside the parent's body", () => {
    const text = read("writer/reorder-siblings.gui");
    const file = parseGuiSource(text);
    const after = apply(text, duplicateWidget(file, widget(file, "px_order_c"), "px_order_c_copy"));
    expect(childNames(parseGuiSource(after).root.children[0])).toEqual([
      "px_order_a",
      "px_order_b",
      "px_order_c",
      "px_order_c_copy",
    ]);
  });

  it("keeps the name's quoting style, and copies the block verbatim without one", () => {
    const bare = "vbox = {\n\t# a bare name\n\twidget = {\n\t\tname = px_bare\n\t}\n}\n";
    const file = parseGuiSource(bare);
    expect(apply(bare, duplicateWidget(file, widget(file, "px_bare"), "px_bare_copy"))).toBe(
      "vbox = {\n\t# a bare name\n\twidget = {\n\t\tname = px_bare\n\t}\n" +
        "\t# a bare name\n\twidget = {\n\t\tname = px_bare_copy\n\t}\n}\n"
    );
    const again = parseGuiSource(bare);
    expect(apply(bare, duplicateWidget(again, widget(again, "px_bare")))).toBe(
      "vbox = {\n\t# a bare name\n\twidget = {\n\t\tname = px_bare\n\t}\n" +
        "\t# a bare name\n\twidget = {\n\t\tname = px_bare\n\t}\n}\n"
    );
  });

  it("refuses a line-sharing declaration and a rename with no name entry", () => {
    const shared = parseGuiSource(read("writer/line-sharing.gui"));
    expect(duplicateWidget(shared, widget(shared, "px_share_a"), "px_new")).toBeNull();
    const nameless = parseGuiSource("vbox = {\n\twidget = {\n\t\tsize = { 1 1 }\n\t}\n}\n");
    const child = nameless.root.children[0].body!.children[0];
    expect(duplicateWidget(nameless, child, "px_new")).toBeNull();
    expect(duplicateWidget(nameless, child)).not.toBeNull();
  });
});

// ── W19, W20: copy out and paste back ───────────────────────────────────────

describe("sourceEdit: block text and paste (W19, W20)", () => {
  /** The fixture's px header is not part of the fragment a copy would produce. */
  const RAW = read("writer/paste-fragment.gui");
  const FRAGMENT = RAW.slice(RAW.indexOf("\t# the A widget"));

  it("block text carries the attached comment and the nested body verbatim (W19)", () => {
    const text = read("writer/paste-fragment.gui");
    const file = parseGuiSource(text);
    expect(blockText(file, widget(file, "px_fragment_a"))).toBe(
      '\t# the A widget\n\twidget = {\n\t\tname = "px_fragment_a"\n\t\ticon = {\n\t\t\tsize = { 4 4 }\n\t\t}\n\t}\n'
    );
  });

  it("block text is null for a line-sharing declaration (W19)", () => {
    const file = parseGuiSource(read("writer/line-sharing.gui"));
    expect(blockText(file, widget(file, "px_share_a"))).toBeNull();
    expect(blockText(file, widget(file, "px_share_own_line"))).not.toBeNull();
  });

  it("a tab fragment lands fully space-indented at the destination's depth (W20)", () => {
    const text = read("writer/paste-destination.gui");
    const file = parseGuiSource(text);
    const after = apply(
      text,
      insertRawChild(file, widget(file, "px_paste_target").body!.children[0], FRAGMENT)
    );
    expect(after).toBe(
      text.replace(
        "        spacing = 5\n",
        "        spacing = 5\n" +
          "        # the A widget\n" +
          "        widget = {\n" +
          '            name = "px_fragment_a"\n' +
          "            icon = {\n" +
          "                size = { 4 4 }\n" +
          "            }\n" +
          "        }\n" +
          "        widget = {\n" +
          '            name = "px_fragment_b"\n' +
          "        }\n"
      )
    );
    expect(after).not.toContain("\t");
  });

  it("converts the other way too: a space fragment into a tab file (W20)", () => {
    const text = read("writer/reorder-siblings.gui");
    const file = parseGuiSource(text);
    const spaced =
      '  widget = {\n    name = "px_spaced_paste"\n    icon = {\n      size = { 1 1 }\n    }\n  }\n';
    const after = apply(text, insertRawChild(file, file.root.children[0], spaced));
    expect(after).toContain(
      '\twidget = {\n\t\tname = "px_spaced_paste"\n\t\ticon = {\n\t\t\tsize = { 1 1 }\n\t\t}\n\t}\n'
    );
  });

  it("paste then delete the pasted widgets restores the file (W20, S04)", () => {
    const text = read("writer/paste-destination.gui");
    const file = parseGuiSource(text);
    const after = apply(
      text,
      insertRawChild(file, widget(file, "px_paste_target").body!.children[0], FRAGMENT)
    );
    const pasted = parseGuiSource(after);
    const back = applyAll(after, [
      deleteWidget(pasted, widget(pasted, "px_fragment_a")),
      deleteWidget(pasted, widget(pasted, "px_fragment_b")),
    ]);
    expect(back).toBe(text);
  });

  it("converts the fragment's newlines to the destination's (W20, W06)", () => {
    const text = read("writer/crlf.gui");
    const file = parseGuiSource(text);
    const vbox = file.root.children[0].body!.children[0];
    const after = apply(text, insertRawChild(file, vbox, FRAGMENT));
    expect(after).not.toMatch(/[^\r]\n/);
    expect(after).toContain('\t\t\tname = "px_fragment_a"\r\n');
  });

  it("refuses a blank fragment, non-widget text and a single-line body (W20)", () => {
    const text = read("writer/single-line-bodies.gui");
    const file = parseGuiSource(text);
    const win = widget(file, "px_one_line_window");
    expect(insertRawChild(file, win, "   \n\n")).toBeNull();
    expect(insertRawChild(file, win, "size = { 1 1 }\n")).toBeNull();
    expect(insertRawChild(file, win, "widget = { \n")).toBeNull();
    expect(insertRawChild(file, win.body!.children[0], FRAGMENT)).toBeNull(); // single-line vbox
    expect(insertRawChild(file, win, FRAGMENT)).not.toBeNull();
  });
});

// ── W22: wrap in a container ────────────────────────────────────────────────

describe("sourceEdit: wrap in a container (W22)", () => {
  it("a non-contiguous selection wraps at the FIRST member's slot, the skipped sibling stays", () => {
    const text = read("writer/wrap-candidate.gui");
    const file = parseGuiSource(text);
    const members = [widget(file, "px_wrap_a"), widget(file, "px_wrap_c")];
    const after = applyAll(text, wrapInContainer(file, members, { type: "vbox" })!);
    expect(after).toBe(
      "# px fixture: wrap in container. Rows: W22.\n" +
        "#\n" +
        "# Wrapping a NON-contiguous selection (px_wrap_a and px_wrap_c, skipping\n" +
        "# px_wrap_b) puts the new container in the FIRST member's slot and leaves the\n" +
        "# skipped sibling where it was; both members end up inside the container in\n" +
        "# selection order, re-indented one level deeper, each carrying its own attached\n" +
        "# comment. The document still parses to exactly one root.\n" +
        "\n" +
        "window = {\n" +
        '\tname = "px_wrap_root"\n' +
        "\tsize = { 400 300 }\n" +
        "\n" +
        "\tvbox = {\n" +
        "\t\t# label A\n" +
        '\t\twidget = { name = "px_wrap_a" size = { 10 10 } }\n' +
        "\t\t# label C\n" +
        '\t\twidget = { name = "px_wrap_c" size = { 30 30 } }\n' +
        "\t}\n" +
        "\n" +
        '\twidget = { name = "px_wrap_b" size = { 20 20 } }\n' +
        "\n" +
        "}\n"
    );
    const wrapped = parseGuiSource(after);
    expect(wrapped.errors).toEqual([]);
    expect(wrapped.root.children.length).toBe(1);
    expect(childNames(wrapped.root.children[0].body!.children[0])).toEqual(["px_wrap_a", "px_wrap_c"]);
  });

  it("wraps root-level members, where the members' indent is empty", () => {
    const src = 'widget = {\n\tname = "px_one"\n}\nwidget = {\n\tname = "px_two"\n}\n';
    const file = parseGuiSource(src);
    const members = [widget(file, "px_one"), widget(file, "px_two")];
    expect(applyAll(src, wrapInContainer(file, members, { type: "vbox" })!)).toBe(
      'vbox = {\n\twidget = {\n\t\tname = "px_one"\n\t}\n\twidget = {\n\t\tname = "px_two"\n\t}\n}\n'
    );
  });

  it("takes a name for the container, and refuses non-siblings and line-sharing members", () => {
    const text = read("writer/wrap-candidate.gui");
    const file = parseGuiSource(text);
    const named = applyAll(
      text,
      wrapInContainer(file, [widget(file, "px_wrap_a")], {
        type: "vbox",
        properties: [["name", '"px_wrapper"']],
      })!
    );
    expect(named).toContain('\tvbox = {\n\t\tname = "px_wrapper"\n\t\t# label A\n\t\twidget = {');

    expect(wrapInContainer(file, [], { type: "vbox" })).toBeNull();
    expect(wrapInContainer(file, [widget(file, "px_wrap_a")], { type: "  " })).toBeNull();
    expect(
      wrapInContainer(file, [widget(file, "px_wrap_a"), widget(file, "px_wrap_root")], { type: "vbox" })
    ).toBeNull();
    const shared = parseGuiSource(read("writer/line-sharing.gui"));
    expect(wrapInContainer(shared, [widget(shared, "px_share_a")], { type: "vbox" })).toBeNull();
  });
});

// ── W25: single-line insert and delete are exact inverses ───────────────────

describe("sourceEdit: single-line bodies (W25)", () => {
  it("insert then delete restores the line, separator space included", () => {
    for (const body of ["widget = {}\n", "widget = { size = { 4 4 } }\n", "vbox = { spacing = 5 }\n"]) {
      const file = parseGuiSource(body);
      const after = apply(body, setProperty(file, file.root.children[0], "alpha", "1"));
      const reparsed = parseGuiSource(after);
      const alpha = findEntry(reparsed.root.children[0].body!, "alpha")!;
      expect(apply(after, removeProperty(reparsed, alpha))).toBe(body);
    }
  });

  it("an inserted CHILD comes back out the same way", () => {
    for (const body of ["widget = {}\n", "hbox = { spacing = 2 }\n"]) {
      const file = parseGuiSource(body);
      const after = apply(body, insertChild(file, file.root.children[0], { type: "widget" }));
      const reparsed = parseGuiSource(after);
      const child = reparsed.root.children[0].body!.children[0];
      expect(applyEdit(after, deleteWidget(reparsed, child))).toBe(body);
    }
  });

  it("an empty `{ }` is respelled `{}` ONCE and never accumulates (W25)", () => {
    // `{}` and `{ }` become the same text with an entry inside, so the delete
    // restores the canonical spelling rather than guessing. What matters is
    // that it is stable: every round trip after the first is exact.
    const roundTrip = (text: string): string => {
      const file = parseGuiSource(text);
      const after = apply(text, insertChild(file, file.root.children[0], { type: "widget" }));
      expect(after).toBe("vbox = { widget = {} }\n");
      const reparsed = parseGuiSource(after);
      return applyEdit(after, deleteWidget(reparsed, reparsed.root.children[0].body!.children[0]));
    };
    const once = roundTrip("vbox = { }\n");
    expect(once).toBe("vbox = {}\n");
    expect(roundTrip(once)).toBe(once);
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

// ── S03-S05: the inverse round trips ────────────────────────────────────────

interface RoundTripCounts {
  files: number;
  /** Bodies whose children round-tripped through a move to the end and back. */
  reorders: number;
  /** Bodies skipped: interleaved children, or a declaration sharing a line. */
  skipped: number;
  inserts: number;
  /** Inserts whose round trip respelled an empty `{ }` body as `{}` (W25). */
  normalized: number;
  duplicates: number;
  pastes: number;
  bad: string[];
}

/**
 * The two spellings of an empty body. `{}` and `{ }` are the SAME text once an
 * entry sits inside (`{ entry }`), so a delete cannot know which one to put
 * back and restores the canonical `{}`. That is a respelling, not a loss, and
 * it is stable: the next round trip is exact, so nothing accumulates (W25).
 */
function canonicalEmpty(text: string): string {
  return text.replace(/\{[ \t]+\}/g, "{}");
}

const PASTE_PROBE = '\twidget = {\n\t\tname = "px_paste_probe"\n\t\tsize = { 1 1 }\n\t}\n';

/**
 * Probes per kind per vanilla FILE. Each one re-parses its whole file, so the
 * cost is quadratic in file size and an uncapped run over the game tree takes
 * far longer than a gate should: 12 keeps it near half a minute. The cap is a
 * sample, not a claim of full coverage, and the sweep prints what it did. Raise
 * it when the writer changes: 40 was run clean on 2026-08-02, and 12 rather
 * than 4 is what caught the last two shapes (`{a}` and `{ high light }`).
 */
const VANILLA_PROBE_CAP = 12;

/** Up to `cap` items, spread evenly so a cap samples the whole file. */
function pick<T>(items: T[], cap: number | null): T[] {
  if (cap === null || items.length <= cap) return items;
  const step = items.length / cap;
  return Array.from({ length: cap }, (_, i) => items[Math.floor(i * step)]);
}

function named(file: GuiSourceFile, name: string): GuiEntry | undefined {
  return file.entries.find((e) => e.body !== null && findEntry(e.body, "name")?.value === name);
}

/**
 * Every structural round trip that must be an exact inverse, over one corpus:
 * reorder move-to-the-end-and-back (S03), insert-then-delete (S04),
 * duplicate-then-delete-the-copy (S05) and paste-then-delete (W20). Each probe
 * is computed against the ORIGINAL text, applied, re-parsed, and the inverse is
 * computed from that re-parse, so the round trip goes through the real
 * operations rather than through string arithmetic.
 *
 * `cap` bounds the probes per kind per FILE: one full re-parse each is cheap
 * over the 39 fixture files (no cap) and minutes over the vanilla tree, so the
 * vanilla sweep samples instead, spread across each file, and reports how many.
 */
function roundTripSweep(files: { name: string; text: string }[], cap: number | null): RoundTripCounts {
  const counts: RoundTripCounts = {
    files: 0,
    reorders: 0,
    skipped: 0,
    inserts: 0,
    normalized: 0,
    duplicates: 0,
    pastes: 0,
    bad: [],
  };
  for (const { name, text } of files) {
    const file = parseGuiSource(text);
    counts.files++;
    const owners = file.entries.filter((e) => e.kind !== "property" && e.body?.close != null);

    // S03: a move to the end and back is the identity on a contiguous body.
    const boxes: GuiEntry[] = [];
    for (const owner of file.entries) {
      if (!owner.body || owner.body.children.length < 2) continue;
      if (owner.body.contiguous) boxes.push(owner);
      else counts.skipped++;
    }
    for (const owner of pick(boxes, cap)) {
      const at = file.entries.indexOf(owner);
      const last = owner.body!.children.length - 1;
      const out = reorderChild(file, owner, 0, last);
      if (!out) {
        counts.bad.push(`${name}:${owner.line + 1} reorder refused a contiguous body`);
        continue;
      }
      counts.reorders++;
      const moved = applyEdit(text, out);
      const after = parseGuiSource(moved);
      const back = reorderChild(after, after.entries[at], last, 0);
      if (!back || applyEdit(moved, back) !== text) {
        counts.bad.push(`${name}:${owner.line + 1} reorder round trip`);
      }
    }

    // S04: insert a child, delete it again.
    for (const owner of pick(owners, cap)) {
      const out = insertChild(file, owner, { type: "widget", properties: [["name", '"px_probe"']] });
      if (!out) continue;
      counts.inserts++;
      const moved = applyEdit(text, out);
      const after = parseGuiSource(moved);
      const probe = named(after, "px_probe");
      const back = probe ? applyEdit(moved, deleteWidget(after, probe)) : null;
      if (back === null || canonicalEmpty(back) !== canonicalEmpty(text)) {
        counts.bad.push(`${name}:${owner.line + 1} insert-then-delete`);
      } else if (back !== text) {
        counts.normalized++;
      }
    }

    // S05: duplicate a widget, delete the copy.
    const blocks = file.entries.filter((e) => e.kind !== "property" && e.ownLine);
    for (const entry of pick(blocks, cap)) {
      const out = duplicateWidget(file, entry);
      if (!out) continue;
      counts.duplicates++;
      const moved = applyEdit(text, out);
      const after = parseGuiSource(moved);
      const copy = after.entries.find(
        (e) => e.kind !== "property" && e.lineSpan.start === entry.lineSpan.end
      );
      if (!copy || applyEdit(moved, deleteWidget(after, copy)) !== text) {
        counts.bad.push(`${name}:${entry.line + 1} duplicate-then-delete`);
      }
    }

    // W20: paste a fragment, delete what it added.
    for (const owner of pick(owners, cap)) {
      const out = insertRawChild(file, owner, PASTE_PROBE);
      if (!out) continue;
      counts.pastes++;
      const moved = applyEdit(text, out);
      const after = parseGuiSource(moved);
      const probe = named(after, "px_paste_probe");
      if (!probe || applyEdit(moved, deleteWidget(after, probe)) !== text) {
        counts.bad.push(`${name}:${owner.line + 1} paste-then-delete`);
      }
    }
  }
  return counts;
}

describe("sourceEdit: S03-S05 inverse round trips", () => {
  it("every structural round trip restores the fixture corpus byte for byte", () => {
    const counts = roundTripSweep(
      corpusFiles().map((name) => ({ name, text: read(name) })),
      null
    );
    expect(counts.bad).toEqual([]);
    // Baseline recorded 2026-08-02; re-recorded the same day after the L25
    // probe added px_container_sized_kept (+1 widget, +2 children) to
    // container-measurability.gui. See docs/gui-designer/parity-checklist.md §G.
    expect(counts).toMatchObject({
      files: 39,
      reorders: 60,
      skipped: 2,
      inserts: 402,
      normalized: 4,
      duplicates: 397,
      pastes: 228,
    });
  });
});

describe("sourceEdit: S03-S05 vanilla sweep", () => {
  const gamePath = devPath("gamePath");
  const guiDir = gamePath ? path.join(gamePath, "gui") : null;

  it.skipIf(!guiDir)(
    "every structural round trip restores a vanilla file byte for byte",
    () => {
      const counts = roundTripSweep(vanillaFiles(guiDir!), VANILLA_PROBE_CAP);
      expect(counts.bad).toEqual([]);
      expect(counts.files).toBe(373);
      expect(counts.reorders).toBeGreaterThan(1_000);
      expect(counts.inserts).toBeGreaterThan(1_000);
      expect(counts.duplicates).toBeGreaterThan(1_000);
      expect(counts.pastes).toBeGreaterThan(1_000);
      console.log(
        `vanilla S03-S05 sweep (${VANILLA_PROBE_CAP} probes per kind per file): ${counts.files} files, ` +
          `${counts.reorders} reorders (${counts.skipped} non-contiguous bodies skipped), ` +
          `${counts.inserts} inserts (${counts.normalized} empty bodies respelled), ` +
          `${counts.duplicates} duplicates, ${counts.pastes} pastes, 0 bad`
      );
    },
    300_000
  );
});

/** Every vanilla `.gui` file, decoded the way the server reads them. */
function vanillaFiles(guiDir: string): { name: string; text: string }[] {
  const paths: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".gui")) paths.push(p);
    }
  };
  walk(guiDir);
  paths.sort();
  return paths.map((p) => ({ name: path.basename(p), text: decode(fs.readFileSync(p)).text }));
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
    expect(counts).toMatchObject({ files: 39, rewrites: 370, parseChecks: 370 });
  });
});

describe("sourceEdit: S02 vanilla sweep", () => {
  const gamePath = devPath("gamePath");
  const guiDir = gamePath ? path.join(gamePath, "gui") : null;

  it.skipIf(!guiDir)("a single-entry rewrite is byte-identical over the vanilla gui tree", () => {
    const counts = rewriteSweep(vanillaFiles(guiDir!), false);
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
