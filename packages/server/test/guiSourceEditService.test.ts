// Implements the source-writer design of Sage's Clausewitz Studio; behavior contract in docs/gui-designer/parity-checklist.md. GPL-3.0-or-later.
/**
 * paradox/guiSourceEdit: the op API and the refusal guards (G1 stage 4).
 *
 * The ops themselves are asserted byte for byte in `guiSourceEdit.test.ts`;
 * what this file judges is the layer above them, where a gesture is turned into
 * edits or turned DOWN. A refusal that never fires is as bad as one that fires
 * everywhere, so each guard is asserted on the shape that must refuse AND on
 * the neighbouring shape that must not (W10, W18, S09).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { collectGuiDefs, emptyGuiDefs } from "../src/gui/guiDefs";
import { computeGuiSourceEdit, computeGuiSourceEdits } from "../src/gui/sourceEditService";
import { applyAll } from "../src/gui/sourceEdit";
import { parseGuiSource, findEntry } from "../src/gui/sourceModel";
import type { GuiSourceOp } from "@px-lsp/protocol/protocol";

const CORPUS = path.join(__dirname, "fixtures", "gui");
const REFUSALS = fs.readFileSync(path.join(CORPUS, "writer", "refusal-shapes.gui"), "utf8");

/** The 0-based line of the widget with that name, the way the preview reports it. */
function lineOf(text: string, name: string): number {
  const file = parseGuiSource(text);
  const found = file.entries.find((e) => e.body !== null && findEntry(e.body, "name")?.value === name);
  if (!found) throw new Error(`no widget named ${name}`);
  return found.line;
}

function run(text: string, op: GuiSourceOp, defsText = text) {
  return computeGuiSourceEdit(text, op, collectGuiDefs(defsText));
}

/** The text after applying a result's edits, asserting it was not refused. */
function applied(text: string, op: GuiSourceOp, defsText = text): string {
  const result = run(text, op, defsText);
  expect(result?.refused).toBeUndefined();
  return applyAll(text, result!.edits!);
}

function setSize(name: string, value = "{ 80 80 }"): GuiSourceOp {
  return { kind: "setProperties", line: lineOf(REFUSALS, name), properties: [{ key: "size", value }] };
}

function setPosition(name: string): GuiSourceOp {
  return {
    kind: "setProperties",
    line: lineOf(REFUSALS, name),
    properties: [{ key: "position", value: "{ 7 7 }" }],
  };
}

// ── W10: refusal honesty ────────────────────────────────────────────────────

describe("guiSourceEdit: position and size guards (W10, S09)", () => {
  it("refuses a position on a box child, and allows one on a free widget", () => {
    const refused = run(REFUSALS, setPosition("px_refuse_drag_in_vbox"));
    expect(refused!.edits).toBeUndefined();
    expect(refused!.refused).toContain("places its children itself");

    const flow = run(REFUSALS, setPosition("px_refuse_drag_in_flow"));
    expect(flow!.refused).toContain("places its children itself");

    // px_allow_drag sits in a plain window: the drag is a real move.
    expect(applied(REFUSALS, setPosition("px_allow_drag"))).toContain(
      'widget = { name = "px_allow_drag" position = { 7 7 } size = { 40 40 } }'
    );
  });

  it("refuses a size on an hbox/vbox but WRITES one on a flowcontainer", () => {
    const box = run(REFUSALS, setSize("px_refuse_size_box"));
    expect(box!.refused).toContain("content-sized");
    // In-game probe 2026-08-02 (L13e): a flowcontainer keeps an authored
    // size, so refusing the write would block something the engine honors.
    const flow = run(REFUSALS, setSize("px_refuse_size_flow"));
    expect(flow!.refused).toBeUndefined();
    expect(flow!.edits).toBeDefined();
  });

  it("refuses a size on a child expanding on BOTH axes inside a container", () => {
    const both = run(REFUSALS, setSize("px_refuse_size_both"));
    expect(both!.edits).toBeUndefined();
    expect(both!.refused).toContain("expanding on both axes");
  });

  it("writes ONE expanding axis and says which axis the container owns", () => {
    const result = run(REFUSALS, setSize("px_refuse_size_one"));
    expect(result!.refused).toBeUndefined();
    expect(result!.warning).toContain("width");
    expect(applyAll(REFUSALS, result!.edits!)).toContain(
      '\t\t\tname = "px_refuse_size_one"\n\t\t\tlayoutpolicy_horizontal = expanding\n\t\t\tsize = { 80 80 }'
    );
  });

  it("does NOT fire outside a layout container (S09)", () => {
    // Same policies, parent is a plain window: the engine would honour the
    // resize, so a guard here would refuse a write that works.
    const result = run(REFUSALS, setSize("px_outside_container"));
    expect(result!.refused).toBeUndefined();
    expect(result!.warning).toBeUndefined();
    expect(applyAll(REFUSALS, result!.edits!)).toContain('name = "px_outside_container"');
  });

  it("resolves the expanding policy through the TYPE CHAIN, not just the instance", () => {
    const text =
      "types PxTypes {\n" +
      "\ttype px_stretch = widget {\n" +
      "\t\tlayoutpolicy_horizontal = expanding\n" +
      "\t\tlayoutpolicy_vertical = expanding\n" +
      "\t}\n" +
      "\ttype px_stretch_child = px_stretch {\n" +
      "\t}\n" +
      "}\n" +
      "vbox = {\n" +
      '\tname = "px_chain_box"\n' +
      "\tpx_stretch_child = {\n" +
      '\t\tname = "px_chain_child"\n' +
      "\t\tsize = { 10 10 }\n" +
      "\t}\n" +
      "}\n";
    const op: GuiSourceOp = {
      kind: "setProperties",
      line: lineOf(text, "px_chain_child"),
      properties: [{ key: "size", value: "{ 20 20 }" }],
    };
    expect(run(text, op)!.refused).toContain("expanding on both axes");
    // With no defs store, the instance carries no policy of its own and the
    // write goes ahead: the chain is what the guard depends on.
    expect(computeGuiSourceEdit(text, op, emptyGuiDefs())!.refused).toBeUndefined();
  });
});

// ── W18: structural refusals ────────────────────────────────────────────────

describe("guiSourceEdit: structural refusals (W18)", () => {
  it("refuses every structural op inside a type definition", () => {
    // `type px_type_definition = widget { … }`: a declaration, not a named
    // instance, so it is addressed by its own key.
    const decl = parseGuiSource(REFUSALS).entries.find((e) => e.keyLower === "px_type_definition")!;
    const line = decl.line;
    for (const op of [
      { kind: "insert", line, widget: { type: "widget" } },
      { kind: "delete", line },
      { kind: "duplicate", line },
      { kind: "reorder", line, from: 0, to: 1 },
    ] as GuiSourceOp[]) {
      expect(run(REFUSALS, op)!.refused).toContain("type definition");
    }
  });

  it("refuses a line with no editable widget, template-supplied nodes included", () => {
    const text = fs.readFileSync(path.join(CORPUS, "writer", "template-use-site.gui"), "utf8");
    const file = parseGuiSource(text);
    // The template's own child has a line here, but the USE SITE's expanded
    // copy does not: a preview node with no line at all resolves to nothing.
    const result = run(text, { kind: "delete", line: file.lines.lineCount - 1 });
    expect(result!.refused).toContain("no editable widget");
  });

  it("refuses deleting the only root widget", () => {
    const solo = 'window = {\n\tname = "px_only"\n}\n';
    expect(run(solo, { kind: "delete", line: 0 })!.refused).toContain("only root widget");
    const two = solo + 'window = {\n\tname = "px_second"\n}\n';
    expect(applied(two, { kind: "delete", line: 0 })).toBe('window = {\n\tname = "px_second"\n}\n');
  });

  it("refuses any op on a document that does not parse", () => {
    const broken = 'widget = {\n\tname = "px_broken"\n';
    expect(run(broken, { kind: "blockText", line: 0 })!.refused).toContain("parse error");
  });
});

// ── The op surface ──────────────────────────────────────────────────────────

describe("guiSourceEdit: the op surface", () => {
  const DOC =
    "window = {\n" +
    '\tname = "px_root"\n' +
    "\tsize = { 400 300 }\n" +
    "\n" +
    "\t# the first child\n" +
    "\twidget = {\n" +
    '\t\tname = "px_a"\n' +
    "\t}\n" +
    "\twidget = {\n" +
    '\t\tname = "px_b"\n' +
    "\t}\n" +
    "}\n";

  it("sets several properties in one batch, rewriting and inserting together", () => {
    const out = applied(DOC, {
      kind: "setProperties",
      line: 0,
      properties: [
        { key: "size", value: "{ 500 400 }" },
        { key: "alpha", value: "0.5" },
        { key: "visible", value: "yes" },
      ],
    });
    expect(out).toContain("\tsize = { 500 400 }\n");
    expect(out).toContain("\talpha = 0.5\n\tvisible = yes\n}\n");
  });

  it("removes a property with a null value, and ignores one that is already absent", () => {
    const out = applied(DOC, {
      kind: "setProperties",
      line: 0,
      properties: [
        { key: "size", value: null },
        { key: "spacing", value: null },
      ],
    });
    expect(out).not.toContain("size = { 400 300 }");
    expect(out).toContain('\tname = "px_root"\n\n\t# the first child\n');
  });

  it("keeps a batch to one shared insert in an empty single-line body", () => {
    const out = applied("widget = {}\n", {
      kind: "setProperties",
      line: 0,
      properties: [
        { key: "size", value: "{ 1 1 }" },
        { key: "alpha", value: "1" },
      ],
    });
    expect(out).toBe("widget = { size = { 1 1 } alpha = 1 }\n");
  });

  it("reorders, inserts, duplicates and deletes children", () => {
    expect(applied(DOC, { kind: "reorder", line: 0, from: 0, to: 1 })).toContain(
      '\twidget = {\n\t\tname = "px_b"\n\t}\n\t# the first child\n\twidget = {\n\t\tname = "px_a"\n\t}\n'
    );
    expect(
      applied(DOC, { kind: "insert", line: 0, widget: { type: "vbox", properties: [["name", '"px_new"']] } })
    ).toContain('\tvbox = {\n\t\tname = "px_new"\n\t}\n}\n');
    expect(applied(DOC, { kind: "duplicate", line: lineOf(DOC, "px_b"), name: "px_b_copy" })).toContain(
      '\t\tname = "px_b"\n\t}\n\twidget = {\n\t\tname = "px_b_copy"\n\t}\n}\n'
    );
    expect(applied(DOC, { kind: "delete", line: lineOf(DOC, "px_a") })).toBe(
      DOC.replace('\t# the first child\n\twidget = {\n\t\tname = "px_a"\n\t}\n', "")
    );
  });

  it("pastes raw text as a child and copies a block back out", () => {
    const copied = run(DOC, { kind: "blockText", line: lineOf(DOC, "px_a") });
    expect(copied!.blockText).toBe('\t# the first child\n\twidget = {\n\t\tname = "px_a"\n\t}\n');
    expect(copied!.edits).toEqual([]);

    const out = applied(DOC, { kind: "insertRaw", line: 0, fragment: copied!.blockText!, index: 0 });
    expect(out).toContain(
      '\t# the first child\n\twidget = {\n\t\tname = "px_a"\n\t}\n\t# the first child\n\twidget = {\n\t\tname = "px_a"\n\t}\n'
    );
  });

  it("wraps a selection of siblings in a fresh container", () => {
    const out = applied(DOC, {
      kind: "wrap",
      lines: [lineOf(DOC, "px_a"), lineOf(DOC, "px_b")],
      container: { type: "vbox", properties: [["name", '"px_wrapper"']] },
    });
    expect(out).toContain(
      '\tvbox = {\n\t\tname = "px_wrapper"\n' +
        '\t\t# the first child\n\t\twidget = {\n\t\t\tname = "px_a"\n\t\t}\n' +
        '\t\twidget = {\n\t\t\tname = "px_b"\n\t\t}\n\t}\n'
    );
    expect(parseGuiSource(out).errors).toEqual([]);
  });

  it("answers null for an op it does not know, and refuses an impossible one", () => {
    expect(
      computeGuiSourceEdit(DOC, { kind: "nonsense" } as unknown as GuiSourceOp, emptyGuiDefs())
    ).toBeNull();
    expect(computeGuiSourceEdit(DOC, null, emptyGuiDefs())).toBeNull();
    expect(run(DOC, { kind: "reorder", line: lineOf(DOC, "px_a"), from: 0, to: 1 })!.refused).toContain(
      "cannot be reordered"
    );
    expect(run(DOC, { kind: "insertRaw", line: 0, fragment: "   " })!.refused).toContain("cannot be pasted");
  });
});

// ── The batch form: one gesture over several widgets ────────────────────────

describe("guiSourceEdit: a batch of ops against one text", () => {
  const DOC =
    "window = {\n" +
    '\tname = "px_batch_root"\n' +
    "\tsize = { 400 300 }\n" +
    '\twidget = { name = "px_one" position = { 0 0 } size = { 10 10 } }\n' +
    '\twidget = { name = "px_two" position = { 40 40 } size = { 10 10 } }\n' +
    "\tvbox = {\n" +
    '\t\tname = "px_box"\n' +
    '\t\twidget = { name = "px_boxed" position = { 5 5 } size = { 10 10 } }\n' +
    "\t}\n" +
    "}\n";

  function batch(text: string, ops: GuiSourceOp[]) {
    return computeGuiSourceEdits(text, ops, collectGuiDefs(text));
  }

  function move(text: string, name: string, value: string): GuiSourceOp {
    return { kind: "setProperties", line: lineOf(text, name), properties: [{ key: "position", value }] };
  }

  it("moves two widgets as ONE edit set, applied together", () => {
    const result = batch(DOC, [move(DOC, "px_one", "{ 5 5 }"), move(DOC, "px_two", "{ 45 45 }")])!;
    expect(result.refused).toBeUndefined();
    expect(result.results!.map((r) => r.edits.length)).toEqual([1, 1]);
    // Both offsets are into the SAME text, so one apply lands both.
    const out = applyAll(DOC, result.edits!);
    expect(out).toContain('name = "px_one" position = { 5 5 }');
    expect(out).toContain('name = "px_two" position = { 45 45 }');
  });

  it("a refused member skips itself and leaves the others applied", () => {
    const result = batch(DOC, [
      move(DOC, "px_one", "{ 5 5 }"),
      move(DOC, "px_boxed", "{ 9 9 }"),
      move(DOC, "px_two", "{ 45 45 }"),
    ])!;
    expect(result.refused).toBeUndefined();
    expect(result.results![1].refused).toContain("places its children itself");
    expect(result.results![1].edits).toEqual([]);
    const out = applyAll(DOC, result.edits!);
    expect(out).toContain('name = "px_one" position = { 5 5 }');
    expect(out).toContain('name = "px_two" position = { 45 45 }');
    // The box child keeps every byte it had: a skipped op writes nothing.
    expect(out).toContain('name = "px_boxed" position = { 5 5 }');
  });

  it("a member that changes nothing reports no edits and no refusal", () => {
    const result = batch(DOC, [move(DOC, "px_one", "{ 0 0 }"), move(DOC, "px_two", "{ 45 45 }")])!;
    expect(result.results![0]).toEqual({
      refused: undefined,
      warning: undefined,
      edits: [],
      blockText: undefined,
    });
    expect(result.edits).toHaveLength(1);
  });

  it("a second op over bytes the first already rewrites is refused, not dropped", () => {
    // Deleting a widget and then setting a property on it: applyAll would drop
    // the loser silently, so the batch names it instead.
    const result = batch(DOC, [
      { kind: "delete", line: lineOf(DOC, "px_one") },
      move(DOC, "px_one", "{ 5 5 }"),
    ])!;
    expect(result.results![0].edits).toHaveLength(1);
    expect(result.results![1].refused).toContain("already rewrites those bytes");
    expect(applyAll(DOC, result.edits!)).toBe(
      DOC.replace('\twidget = { name = "px_one" position = { 0 0 } size = { 10 10 } }\n', "")
    );
  });

  it("carries a per-op warning and joins them at the top", () => {
    const line = lineOf(REFUSALS, "px_refuse_size_one");
    const result = computeGuiSourceEdits(
      REFUSALS,
      [{ kind: "setProperties", line, properties: [{ key: "size", value: "{ 80 80 }" }] }],
      collectGuiDefs(REFUSALS)
    )!;
    expect(result.results![0].warning).toContain("owns the width of an expanding child");
    expect(result.warning).toBe(result.results![0].warning);
  });

  it("refuses the whole request only for a whole-request failure", () => {
    expect(computeGuiSourceEdits(DOC, [], emptyGuiDefs())!.refused).toContain("named no widgets");
    expect(
      computeGuiSourceEdits("widget = {", [{ kind: "delete", line: 0 }], emptyGuiDefs())!.refused
    ).toContain("parse error");
    expect(computeGuiSourceEdits(DOC, null, emptyGuiDefs())).toBeNull();
    // An unknown op is that op's refusal, not the batch's.
    const mixed = batch(DOC, [
      { kind: "nonsense" } as unknown as GuiSourceOp,
      move(DOC, "px_one", "{ 5 5 }"),
    ])!;
    expect(mixed.refused).toBeUndefined();
    expect(mixed.results![0].refused).toContain("no such edit");
    expect(mixed.results![1].edits).toHaveLength(1);
  });
});
