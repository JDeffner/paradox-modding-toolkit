/**
 * The GUI editor's interaction smoke: the real app bundle in jsdom, driven by
 * clicks, answered by a stubbed host that replays the REAL server.
 *
 * G3.2's claim is the selection path: a click picks a widget, the app asks the
 * host for that widget's properties by line, and when the document changes
 * under it — an insert that shifts every index and every line — the SAME widget
 * is still selected and re-read.
 *
 * G3.3's claim is the write path, and the stub host is what keeps it honest:
 * every check and every commit is answered by the REAL `guiSourceEdit` service
 * over the REAL document text, and an accepted write is applied to that text
 * and laid out again exactly as `panel.ts` does it. So a drag here proves the
 * op the app sends, the bytes the server changes, and the refusal reasons a
 * user would read, all against the same code the extension ships.
 *
 * G4's claims are the UX pass: the layers panel's eye, lock and solo really
 * reach the canvas and the hit-test, a hovered row really flashes, a drag
 * really snaps and commits the SNAPPED number, a drag inside a box really
 * becomes a reorder op, and a focused subtree is really the only thing left to
 * click. The canvas paints nothing in jsdom, so the styles the painter sets
 * (harness `paint`) stand in for the pixels.
 *
 * G5 stage 1's claim is editing parity, and it rests on the BATCH: a gesture
 * over a multi-selection is one `applyOps` message, one server request and one
 * document change, with a verdict per member. The cases below drive a marquee,
 * a shift-click, a group drag with a refused member, align and distribute, a
 * palette drop, a copy/paste round trip through the stub's clipboard, delete,
 * duplicate, the anchor picker and a wrap — all against the real server.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { GuiLayoutResult, GuiSourceEditResult, GuiSourceOp } from "@px-lsp/protocol/protocol";
import CK3_GUI_SCHEMA from "../../server/data/ck3/guiSchema.json";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { computeGuiWidgetInfo } from "../../server/src/gui/widgetInfo";
import { collectGuiDefs } from "../../server/src/gui/guiDefs";
import { computeGuiSourceEdit, computeGuiSourceEdits } from "../../server/src/gui/sourceEditService";
import { computeGuiVocabulary } from "../../server/src/gui/vocabulary";
import { applyAll } from "../../server/src/gui/sourceEdit";
import type { AppToHost } from "../src/webviews/guiEditor/messages";
import { bootEditor, guiFixture, type EditorHarness } from "./guiEditorHarness";

const TEXT = guiFixture("templates-types.gui");
const REFUSALS = guiFixture("refusal-shapes.gui", "writer");

/** The colours render.ts paints its G4 affordances with, as the stub sees them. */
const GUIDE_STROKE = "#ff4fd8";
const FLASH_STROKE = "#ffd54f";
const DROP_STROKE = "#89d185";
/** render.ts DIM_OPACITY: what solo leaves everything else at. */
const DIM_OPACITY = 0.12;

/** The card is at position { 10 10 } size { 100 50 } inside the frame at 0,0. */
const CARD_CENTER = { x: 60, y: 35 };
const CARD_LINE = TEXT.split(/\r?\n/).findIndex((l) => l.includes('name = "px_card_positioned"'));

/** Layouts the stub host has computed, so a commit can be shown to cost exactly one. */
let layoutRuns = 0;

function layoutOf(text: string) {
  layoutRuns++;
  return computeGuiLayoutResult(text, null, null);
}

/** The host's half of the contract, replayed from the real server. */
function serveLayout(harness: EditorHarness, text: string, file = "templates-types.gui"): void {
  harness.push({ type: "layout", file, result: layoutOf(text), textures: {} });
}

function serveWidgetInfo(harness: EditorHarness, text: string): void {
  const request = [...harness.sent].reverse().find((m) => m.type === "requestWidgetInfo");
  if (!request || request.type !== "requestWidgetInfo") throw new Error("no widget info was requested");
  harness.push({
    type: "widgetInfo",
    line: request.line,
    info: computeGuiWidgetInfo(text, request.line),
  });
}

function lastOfType<T extends AppToHost["type"]>(
  harness: EditorHarness,
  type: T
): Extract<AppToHost, { type: T }> | undefined {
  return [...harness.sent].reverse().find((m) => m.type === type) as
    Extract<AppToHost, { type: T }> | undefined;
}

let editor: EditorHarness;
/** The host's document: what the app's accepted edits are applied to. */
let doc = "";
let docFile = "";
/** How far `serveEdits` has read into what the app sent. */
let served = 0;

beforeEach(() => {
  editor = bootEditor();
  doc = "";
  docFile = "";
  served = 0;
  layoutRuns = 0;
  clipboard = "";
});
afterEach(() => editor.close());

/** Open a document the way the host does: it becomes the text edits apply to. */
function openDoc(text: string, file: string): GuiLayoutResult {
  doc = text;
  docFile = file;
  const result = layoutOf(text);
  editor.push({ type: "layout", file, result, textures: {} });
  return result;
}

/**
 * Smart guides are on by default and pull a drag onto its siblings, which is
 * the point of them. A case about the OP a drag sends says so and turns them
 * off, so its numbers are the gesture's own arithmetic and nothing else;
 * "smart guides" below is where the snapped numbers are asserted.
 */
function withoutGuides(): void {
  editor.toggle("snap", false);
}

/** The stub host's clipboard: exactly as much of one as `panel.ts` uses. */
let clipboard = "";

/**
 * The host's write half, replayed from the real server: answer every check and
 * commit the app has sent since the last call, apply an accepted commit to the
 * document, and push the fresh layout the way `panel.ts` does after its own
 * write. A batch takes the same path as a single op, which is the point of it:
 * one request, one edit set, one document change.
 */
function serveEdits(): void {
  for (; served < editor.sent.length; served++) {
    const message = editor.sent[served];
    if (message.type === "requestVocabulary") {
      const vocabulary = computeGuiVocabulary(doc, CK3_GUI_SCHEMA);
      editor.push({ type: "vocabulary", entries: vocabulary.entries, total: vocabulary.total });
      continue;
    }
    if (message.type === "copyBlocks") {
      const result = answer({ ops: message.lines.map((line) => ({ kind: "blockText" as const, line })) });
      const blocks = (result.results ?? []).map((r) => r.blockText).filter((b): b is string => !!b);
      if (blocks.length > 0) clipboard = blocks.join("");
      editor.push({
        type: "editVerdict",
        id: message.id,
        refused:
          blocks.length > 0 ? undefined : (result.refused ?? "there was nothing to copy on those lines."),
      });
      continue;
    }
    let request: { op: GuiSourceOp } | { ops: GuiSourceOp[] };
    if (message.type === "checkEdit" || message.type === "applyEdit") {
      request = { op: { kind: "setProperties", line: message.line, properties: message.properties } };
    } else if (message.type === "checkReorder" || message.type === "reorder") {
      request = { op: { kind: "reorder", line: message.line, from: message.from, to: message.to } };
    } else if (message.type === "checkOps" || message.type === "applyOps") {
      request = { ops: message.ops };
    } else if (message.type === "pasteInto") {
      if (clipboard.trim().length === 0) {
        editor.push({
          type: "editVerdict",
          id: message.id,
          refused: "the clipboard is empty, so there is nothing to paste.",
        });
        continue;
      }
      request = {
        op: { kind: "insertRaw", line: message.line, fragment: clipboard, index: message.index },
      };
    } else {
      continue;
    }
    const result = answer(request);
    const commits =
      message.type === "applyEdit" ||
      message.type === "reorder" ||
      message.type === "applyOps" ||
      message.type === "pasteInto";
    const writes = commits && !result.refused && (result.edits?.length ?? 0) > 0;
    editor.push({
      type: "editVerdict",
      id: message.id,
      // A check answers with whatever the guards said; a commit that wrote
      // nothing is a refusal even when the writer had no words for it.
      refused: commits
        ? writes
          ? undefined
          : (result.refused ?? "that edit changes nothing.")
        : result.refused,
      warning: result.warning,
      ops: result.results?.map((r) => ({ refused: r.refused, warning: r.warning })),
    });
    if (!writes) continue;
    doc = applyAll(doc, result.edits!);
    editor.push({ type: "layout", file: docFile, result: layoutOf(doc), textures: {} });
  }
}

function answer(request: { op: GuiSourceOp } | { ops: GuiSourceOp[] }): GuiSourceEditResult {
  const defs = collectGuiDefs(doc);
  const result =
    "ops" in request
      ? computeGuiSourceEdits(doc, request.ops, defs)
      : computeGuiSourceEdit(doc, request.op, defs);
  return result ?? { refused: "the server had no answer for that edit." };
}

/** The rect the engine gave a named widget, so no test hardcodes geometry. */
function rectOf(result: GuiLayoutResult, name: string): { x: number; y: number; w: number; h: number } {
  const stack = [...result.nodes];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.name === name) return node.rect;
    stack.push(...node.children);
  }
  throw new Error(`no widget named ${name}`);
}

/** The named widgets sorted by where they appear in the text: source order, read back. */
function orderIn(text: string, names: readonly string[]): string[] {
  return [...names].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

/** A point inside a rect, as a fraction of it (the centre by default). */
function pointIn(rect: { x: number; y: number; w: number; h: number }, fx = 0.5, fy = 0.5) {
  return { x: rect.x + rect.w * fx, y: rect.y + rect.h * fy };
}

describe("boot", () => {
  it("announces itself and renders the layout the host answers with", () => {
    expect(editor.sent).toEqual([{ type: "ready" }]);
    serveLayout(editor, TEXT);
    expect(editor.text("status")).toContain("templates-types.gui");
    expect(editor.rows().length).toBeGreaterThan(5);
    expect(editor.text("inspector")).toContain("Nothing selected");
  });

  it("marks template-expanded rows synthetic in the tree", () => {
    serveLayout(editor, TEXT);
    expect(editor.rows().some((r) => r.includes("px_row_kid") && r.includes("synthetic"))).toBe(true);
  });

  it("a tree over the row budget opens at its top level instead of listing everything", () => {
    // window_character expands to 13,702 widgets behind the vanilla template
    // store, which is neither scannable nor affordable to rebuild after every
    // keystroke. A big document opens collapsed; a small one does not.
    const children = Array.from(
      { length: 2500 },
      (_, i) => `\twidget = { name = "px_big_${i}" size = { 4 4 } }`
    ).join("\n");
    serveLayout(editor, `widget = {\n\tname = "px_big_root"\n\tsize = { 1000 1000 }\n${children}\n}\n`);
    expect(editor.rows()).toHaveLength(1);
    expect(editor.rows()[0]).toContain("px_big_root");
  });

  it("collapsing a row hides its subtree, and selecting inside it opens it again", () => {
    serveLayout(editor, TEXT);
    const twisty = editor.document.querySelector<HTMLElement>("#tree .row .twisty")!;
    twisty.click();
    expect(editor.rows()).toHaveLength(1);

    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    expect(editor.rows().length).toBeGreaterThan(1);
    expect(editor.selectedRow()).toContain("px_card_positioned");
  });
});

describe("selecting on the canvas", () => {
  it("a click picks the smallest rect and asks the host for its properties", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);

    expect(lastOfType(editor, "requestWidgetInfo")).toEqual({
      type: "requestWidgetInfo",
      line: CARD_LINE,
    });
    expect(editor.selectedRow()).toContain("px_card_positioned");
    expect(editor.text("status")).toContain("selected px_card#px_card_positioned");
  });

  it("the inspector shows the server's rows with their template-chain origins", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    serveWidgetInfo(editor, TEXT);

    const inspector = editor.text("inspector");
    expect(inspector).toContain("px_card#px_card_positioned");
    expect(inspector).toContain("type chain: widget");
    expect(inspector).toContain("{ 100 50 }");
    expect(inspector).toContain("from type px_card");
    // The locally authored row carries no origin line.
    expect(inspector).toContain("{ 10 10 }");
  });

  it("Alt+click cycles outward through the stack under the cursor", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    expect(editor.selectedRow()).toContain("px_card_positioned");

    editor.click(CARD_CENTER.x, CARD_CENTER.y, { altKey: true });
    expect(editor.selectedRow()).toContain("px_template_frame");

    // One more wraps back to the innermost.
    editor.click(CARD_CENTER.x, CARD_CENTER.y, { altKey: true });
    expect(editor.selectedRow()).toContain("px_card_positioned");
  });

  it("clicking empty canvas clears, and so does Esc", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.click(1500, 900);
    expect(editor.selectedRow()).toBeNull();
    expect(editor.text("inspector")).toContain("Nothing selected");

    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    expect(editor.selectedRow()).not.toBeNull();
    editor.key("Escape");
    expect(editor.selectedRow()).toBeNull();
  });

  it("Ctrl+Shift+click asks the host to reveal the declaration", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y, { ctrlKey: true, shiftKey: true });
    expect(lastOfType(editor, "reveal")).toEqual({ type: "reveal", line: CARD_LINE });
  });

  it("selecting a synthetic node says it has no source here instead of showing rows", () => {
    serveLayout(editor, TEXT);
    // px_row_kid is spliced in from `type px_row`: it has no statement here.
    const rowIndex = editor.rows().findIndex((r) => r.includes("px_row_kid"));
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    editor.document.querySelectorAll<HTMLElement>("#tree .row")[rowIndex].click();

    expect(editor.text("inspector")).toContain("spliced in from a template or a type");
    expect(editor.text("status")).toContain("(synthetic)");
    // No inspector read is even attempted: there is nothing on that line to read.
    expect(editor.sent.filter((m) => m.type === "requestWidgetInfo")).toHaveLength(0);
  });
});

describe("the selection survives a document change", () => {
  it("an insert above the selection shifts every index and line, and it is still selected", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    serveWidgetInfo(editor, TEXT);
    expect(lastOfType(editor, "requestWidgetInfo")!.line).toBe(CARD_LINE);

    // The host's next push after a document change: a fresh layout of new text.
    // The inserted widget takes the card's place in BOTH the child order and
    // the line numbering, so an index or a line kept as identity would follow
    // the stranger.
    const inserted = '\twidget = { name = "px_inserted" position = { 600 300 } size = { 20 20 } }\n';
    const anchor = '\tpx_card = { name = "px_card_positioned"';
    const edited = TEXT.replace(anchor, inserted + anchor);
    serveLayout(editor, edited);

    expect(editor.selectedRow()).toContain("px_card_positioned");
    expect(editor.text("status")).toContain("selected px_card#px_card_positioned");
    // Re-read at the widget's NEW line, because the old one is now the insert.
    const reread = lastOfType(editor, "requestWidgetInfo")!;
    expect(reread.line).toBe(CARD_LINE + 1);

    serveWidgetInfo(editor, edited);
    expect(editor.text("inspector")).toContain("px_card#px_card_positioned");
    expect(editor.text("inspector")).toContain("from type px_card");
  });

  it("a property edit under the selection keeps it and re-reads the new value", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    serveWidgetInfo(editor, TEXT);
    expect(editor.text("inspector")).toContain("{ 100 50 }");

    const edited = TEXT.replace(
      'px_card = { name = "px_card_positioned" position = { 10 10 } }',
      'px_card = { name = "px_card_positioned" position = { 10 10 } size = { 120 60 } }'
    );
    expect(edited).not.toBe(TEXT);
    serveLayout(editor, edited);
    serveWidgetInfo(editor, edited);

    expect(editor.selectedRow()).toContain("px_card_positioned");
    // The override now wins, and its origin says it is written here.
    expect(editor.text("inspector")).toContain("{ 120 60 }");
    expect(editor.text("inspector")).not.toContain("{ 100 50 }");
  });

  it("deleting the selected widget clears the selection rather than moving it", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    expect(editor.selectedRow()).not.toBeNull();

    const edited = TEXT.replace('\tpx_card = { name = "px_card_positioned" position = { 10 10 } }\n', "");
    expect(edited).not.toBe(TEXT);
    serveLayout(editor, edited);

    expect(editor.selectedRow()).toBeNull();
    expect(editor.text("inspector")).toContain("Nothing selected");
  });

  it("a drag commits, and the selection follows the widget it just moved", () => {
    openDoc(TEXT, "templates-types.gui");
    withoutGuides();
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    editor.up(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    serveEdits();

    expect(editor.selectedRow()).toContain("px_card_positioned");
    expect(doc).toContain("position = { 50 30 }");
  });

  it("a stale widgetInfo answer for a line the selection has left is dropped", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.push({
      type: "widgetInfo",
      line: CARD_LINE + 999,
      info: { key: "stale", typeChain: [], properties: [{ key: "alpha", value: "0.1", origin: [] }] },
    });
    expect(editor.text("inspector")).not.toContain("alpha");
    expect(editor.text("inspector")).toContain("Reading properties");
  });
});

describe("dragging on the canvas", () => {
  it("commits ONE op writing the effective position plus the drag delta", () => {
    openDoc(TEXT, "templates-types.gui");
    withoutGuides();
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    // The guards are asked before anything moves, for the property the release
    // would write, on the widget's own line.
    const check = lastOfType(editor, "checkEdit")!;
    expect(check.line).toBe(CARD_LINE);
    expect(check.properties.map((p) => p.key)).toEqual(["position"]);
    serveEdits();

    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    expect(editor.text("status")).toContain("position = { 50 30 }");
    editor.up(CARD_CENTER.x + 40, CARD_CENTER.y + 20);

    // The card's own `position = { 10 10 }` plus (40, 20). Its rect happens to
    // match its position here; anchors.gui is where the two differ, and
    // guiEditorGesture.test.ts pins that case.
    const apply = lastOfType(editor, "applyEdit")!;
    expect(apply).toEqual({
      type: "applyEdit",
      id: apply.id,
      line: CARD_LINE,
      properties: [{ key: "position", value: "{ 50 30 }" }],
    });
    // One gesture, one op: the drag itself wrote nothing on the way.
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(1);
  });

  it("the write is surgical, and the undo the host feeds back restores it byte for byte", () => {
    const before = TEXT;
    openDoc(TEXT, "templates-types.gui");
    withoutGuides();
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    editor.up(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    serveEdits();

    // Only the value's own span moved: comments, tabs, the single-line body and
    // every other widget are the same bytes they were.
    expect(doc).toBe(before.replace("position = { 10 10 }", "position = { 50 30 }"));

    // Native undo: the document goes back and the host pushes its layout. The
    // editor holds no history of its own, so this is the whole undo path.
    editor.push({ type: "layout", file: docFile, result: layoutOf(before), textures: {} });
    expect(editor.selectedRow()).toContain("px_card_positioned");
    serveWidgetInfo(editor, before);
    expect(editor.text("inspector")).toContain("{ 10 10 }");
    expect(editor.text("inspector")).not.toContain("{ 50 30 }");
  });

  it("a drag that rounds to less than a pixel says so instead of writing", () => {
    openDoc(TEXT, "templates-types.gui");
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    // Far enough to be a drag, back to where it started before release.
    editor.move(CARD_CENTER.x + 30, CARD_CENTER.y);
    editor.move(CARD_CENTER.x + 0.2, CARD_CENTER.y);
    editor.up(CARD_CENTER.x + 0.2, CARD_CENTER.y);

    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(editor.toast()).toContain("less than a whole pixel");
    expect(doc).toBe(TEXT);
  });

  it("a box child's drag writes no position, and says so in the server's own words", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const child = rectOf(layout, "px_refuse_drag_in_vbox");
    const start = pointIn(child);
    editor.click(start.x, start.y);
    expect(editor.selectedRow()).toContain("px_refuse_drag_in_vbox");

    editor.press(start.x, start.y);
    serveEdits();
    editor.move(start.x + 40, start.y + 40);
    editor.up(start.x + 40, start.y + 40);

    // The reason is the writer's, verbatim, and it arrives with nothing having
    // moved on the canvas. G4 gives the same gesture a second meaning (the
    // layout-order drag below), and this is the half that stays true: no
    // position is ever written inside a box.
    const reason = computeGuiSourceEdit(
      REFUSALS,
      {
        kind: "setProperties",
        line: lastOfType(editor, "checkEdit")!.line,
        properties: [{ key: "position", value: "{ 5 5 }" }],
      },
      collectGuiDefs(REFUSALS)
    )!.refused;
    expect(reason).toContain("places its children itself");
    expect(editor.toast()).toBe(reason);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(editor.text("status")).not.toContain("position =");
  });

  it("a resize refused on both axes never previews a size the file would not get", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const both = rectOf(layout, "px_refuse_size_both");
    const inside = pointIn(both);
    editor.click(inside.x, inside.y);
    expect(editor.selectedRow()).toContain("px_refuse_size_both");

    // The south-east grip sits on the corner of the selected widget.
    editor.press(both.x + both.w, both.y + both.h);
    expect(lastOfType(editor, "checkEdit")!.properties.map((p) => p.key)).toEqual(["size"]);
    serveEdits();
    editor.move(both.x + both.w + 30, both.y + both.h + 30);
    editor.up(both.x + both.w + 30, both.y + both.h + 30);

    expect(editor.toast()).toContain("expanding on both axes");
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(editor.text("status")).not.toContain("size =");
    expect(doc).toBe(REFUSALS);
  });

  it("a resize the box only half owns warns which axis it keeps, and writes the other", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const one = rectOf(layout, "px_refuse_size_one");
    const inside = pointIn(one);
    editor.click(inside.x, inside.y);
    expect(editor.selectedRow()).toContain("px_refuse_size_one");

    editor.press(one.x + one.w, one.y + one.h);
    serveEdits();
    // The warning arrives with the check and is shown the moment the press
    // becomes a drag, not on every click that merely could have been one.
    expect(editor.toast()).toBeNull();
    editor.move(one.x + one.w + 20, one.y + one.h + 10);
    expect(editor.toast()).toContain("owns the width of an expanding child");

    editor.up(one.x + one.w + 20, one.y + one.h + 10);
    serveEdits();

    // The write went ahead: the widget's own 40x40 plus the drag.
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "size", value: "{ 60 50 }" }]);
    expect(doc).toContain("size = { 60 50 }");
  });
});

describe("editing an inspector row", () => {
  it("an inherited row writes an override on the widget, as one op", () => {
    openDoc(TEXT, "templates-types.gui");
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    serveWidgetInfo(editor, TEXT);
    // `size` comes from `type px_card`, so the row is inherited.
    expect(editor.text("inspector")).toContain("from type px_card");

    const input = editor.rowInput("size")!;
    expect(input.value).toBe("{ 100 50 }");
    input.value = "{ 120 60 }";
    input.dispatchEvent(new (input.ownerDocument.defaultView as Window & typeof globalThis).Event("change"));

    const apply = lastOfType(editor, "applyEdit")!;
    expect(apply.line).toBe(CARD_LINE);
    expect(apply.properties).toEqual([{ key: "size", value: "{ 120 60 }" }]);
    serveEdits();

    // The override lands at the use site; the type definition keeps its bytes.
    expect(doc).toContain('name = "px_card_positioned" position = { 10 10 } size = { 120 60 }');
    expect(doc).toContain("type px_card = widget {\n\t\tsize = { 100 50 }");
  });

  it("a refused row snaps back to what the file still says, with the reason", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const child = rectOf(layout, "px_refuse_drag_in_vbox");
    const inside = pointIn(child);
    editor.click(inside.x, inside.y);
    serveWidgetInfo(editor, REFUSALS);

    const input = editor.rowInput("position")!;
    expect(input.value).toBe("{ 5 5 }");
    input.value = "{ 40 40 }";
    input.dispatchEvent(new (input.ownerDocument.defaultView as Window & typeof globalThis).Event("change"));
    serveEdits();

    expect(input.value).toBe("{ 5 5 }");
    expect(editor.toast()).toContain("places its children itself");
    expect(doc).toBe(REFUSALS);
  });
});

describe("the commit round trip", () => {
  /**
   * The nudge budget (G3.4). What is timed is everything between the press and
   * the redrawn canvas: the gesture-start guard check, the `setProperties` op,
   * the edit applied to the document, the fresh layout, the scene rebuild and
   * the tree and inspector that follow it. Only two costs of the real thing are
   * missing and both are outside this repository's control: the postMessage
   * hop, and VS Code applying the `WorkspaceEdit`.
   *
   * The Studio's lesson behind the number: a nudge that takes ~150 ms stops
   * feeling like dragging a widget and starts feeling like submitting a form.
   */
  it("a nudge is ONE op, ONE layout of ONE document, inside the nudge budget", () => {
    openDoc(TEXT, "templates-types.gui");
    withoutGuides();
    const taken: number[] = [];

    // Three in a row, following the widget as it moves: the first pays for
    // whatever the JIT has not warmed yet, and a nudge is something a user does
    // repeatedly, so the median is the honest number.
    for (let i = 0; i < 3; i++) {
      const from = { x: CARD_CENTER.x + i * 40, y: CARD_CENTER.y + i * 20 };
      const to = { x: from.x + 40, y: from.y + 20 };
      const commits = editor.sent.filter((m) => m.type === "applyEdit").length;
      layoutRuns = 0;

      const t0 = performance.now();
      editor.press(from.x, from.y);
      serveEdits();
      editor.move(to.x, to.y);
      editor.up(to.x, to.y);
      serveEdits();
      taken.push(performance.now() - t0);

      // One gesture is one op is one layout: the write path re-lays out the
      // document it changed and nothing else, so the cost of a nudge does not
      // grow with the number of .gui files around it.
      expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(commits + 1);
      expect(layoutRuns).toBe(1);
      expect(doc).toContain(`position = { ${50 + i * 40} ${30 + i * 20} }`);
    }
    // The app never asks for a re-layout of its own after a commit; the host
    // pushes the one it already computed.
    expect(editor.sent.filter((m) => m.type === "requestLayout")).toHaveLength(0);

    const sorted = [...taken].sort((a, b) => a - b);
    console.log(`nudge round trip: ${taken.map((t) => `${t.toFixed(1)}ms`).join(", ")}`);

    // Measured on the development machine: 3.7 / 2.7 / 2.5 ms for the three
    // nudges above, against the ~150 ms that made the Studio's nudge feel like
    // a form submission. The budget IS that target rather than the measurement
    // plus headroom: the same gesture on the biggest window the game ships
    // costs ~65 ms of host work (guiEditorPerf.test.ts measures it against the
    // real file), and this budget is what says the two together stay under it.
    expect(sorted[1]).toBeLessThan(150);
  });
});

describe("the layers panel", () => {
  it("lists the selected widget's container in source order and says what that order is", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);

    const head = editor.text("layers");
    expect(head).toContain("In widget#px_template_frame");
    expect(head).toContain("later rows paint on top");
    // The frame's own children, in the order the file declares them.
    const rows = editor.layers();
    expect(rows[0]).toContain("px_card_positioned");
    expect(rows[1]).toContain("px_card_resized");
    expect(rows.some((r) => r.includes("px_derived_frame"))).toBe(true);
  });

  it("the eye hides a widget, and the canvas stops picking what it cannot see", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.clickToggle(editor.layer("px_card_positioned"), "eye");
    expect(editor.layer("px_card_positioned").className).toContain("hiddenWidget");

    // The same click lands on the frame behind it now.
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    expect(editor.selectedRow()).toContain("px_template_frame");
  });

  it("the lock leaves a widget on screen and only stops it swallowing clicks", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.clickToggle(editor.layer("px_card_positioned"), "lock");
    // Not hidden: a locked widget is still drawn, which is the whole difference.
    expect(editor.layer("px_card_positioned").className).not.toContain("hiddenWidget");

    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    expect(editor.selectedRow()).toContain("px_template_frame");
  });

  it("solo dims everything outside the isolated subtree", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.paint.reset();
    expect(editor.paint.alphas).not.toContain(DIM_OPACITY);

    editor.clickToggle(editor.layer("px_card_positioned"), "solo");
    expect(editor.paint.alphas).toContain(DIM_OPACITY);

    editor.paint.reset();
    editor.clickToggle(editor.layer("px_card_positioned"), "solo");
    expect(editor.paint.alphas).not.toContain(DIM_OPACITY);
  });

  it("hovering a row flashes that widget's outline on the canvas", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    const row = editor.layer("px_card_resized");

    editor.paint.reset();
    editor.hover(row, true);
    expect(editor.paint.strokes).toContain(FLASH_STROKE);

    editor.paint.reset();
    editor.hover(row, false);
    expect(editor.paint.strokes).not.toContain(FLASH_STROKE);
  });

  it("dragging a row reorders the source as ONE op, and the file follows", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const child = rectOf(layout, "px_refuse_drag_in_vbox");
    editor.click(child.x + child.w / 2, child.y + child.h / 2);
    expect(editor.layers()[0]).toContain("px_refuse_drag_in_vbox");

    const source = editor.layer("px_refuse_drag_in_vbox");
    editor.rowPointer(source, "pointerdown", { x: 0, y: 0 });
    editor.rowPointer(source, "pointermove", { x: 0, y: 20 });
    serveEdits();
    editor.rowPointer(editor.layer("px_refuse_size_one"), "pointermove", { x: 0, y: 60 });
    editor.releasePointer();

    const reorder = lastOfType(editor, "reorder")!;
    expect(reorder.from).toBe(0);
    expect(reorder.to).toBe(2);
    serveEdits();
    // Last of the three now, and carried verbatim: a reorder is a permutation
    // of blocks, never a rewrite of them.
    expect(orderIn(doc, ["px_refuse_drag_in_vbox", "px_refuse_size_both", "px_refuse_size_one"])).toEqual([
      "px_refuse_size_both",
      "px_refuse_size_one",
      "px_refuse_drag_in_vbox",
    ]);
    expect(editor.sent.filter((m) => m.type === "reorder")).toHaveLength(1);
  });

  it("a declaration between the children shifts the index the drag sends", () => {
    // The blockoverride is a source child with no layout node, so the widgets
    // are at source indices 0 and 2. A drag that ranked the visible rows would
    // send to = 1 and land the widget ABOVE the blockoverride; the server's own
    // srcIndex is what makes the drop mean what the user aimed at.
    const withSlot = [
      "widget = {",
      '\tname = "px_slot_root"',
      "\tsize = { 400 300 }",
      '\twidget = { name = "px_slot_a" position = { 0 0 } size = { 40 40 } }',
      '\tblockoverride "px_named_slot" {}',
      '\twidget = { name = "px_slot_b" position = { 0 100 } size = { 40 40 } }',
      "}",
      "",
    ].join("\n");
    openDoc(withSlot, "named-slot.gui");
    editor.click(20, 20);
    expect(editor.selectedRow()).toContain("px_slot_a");

    const source = editor.layer("px_slot_a");
    editor.rowPointer(source, "pointerdown", { x: 0, y: 0 });
    editor.rowPointer(source, "pointermove", { x: 0, y: 20 });
    serveEdits();
    editor.rowPointer(editor.layer("px_slot_b"), "pointermove", { x: 0, y: 60 });
    editor.releasePointer();

    const reorder = lastOfType(editor, "reorder")!;
    expect([reorder.from, reorder.to]).toEqual([0, 2]);
    serveEdits();
    // Below the second widget, and the blockoverride keeps its own slot.
    expect(orderIn(doc, ["px_slot_a", "px_named_slot", "px_slot_b"])).toEqual([
      "px_named_slot",
      "px_slot_b",
      "px_slot_a",
    ]);
  });

  it("a reorder the writer turns down is shown in the writer's own words", () => {
    // Two declarations sharing a line: the blocks are not separable, so the
    // permutation the op would need does not exist.
    const shared = [
      "widget = {",
      '\tname = "px_share_root"',
      "\tsize = { 400 300 }",
      '\twidget = { name = "px_a" position = { 0 0 } size = { 40 40 } } widget = { name = "px_b" position = { 100 0 } size = { 40 40 } }',
      '\twidget = { name = "px_c" position = { 0 100 } size = { 40 40 } }',
      "}",
      "",
    ].join("\n");
    openDoc(shared, "line-sharing.gui");
    editor.click(20, 20);
    expect(editor.selectedRow()).toContain("px_a");

    const source = editor.layer("px_a");
    editor.rowPointer(source, "pointerdown", { x: 0, y: 0 });
    editor.rowPointer(source, "pointermove", { x: 0, y: 20 });
    serveEdits();

    const reason = computeGuiSourceEdit(
      shared,
      { kind: "reorder", line: 0, from: 0, to: 1 },
      collectGuiDefs(shared)
    )!.refused;
    expect(reason).toContain("cannot be reordered");
    expect(editor.toast()).toBe(reason);

    editor.rowPointer(editor.layer("px_c"), "pointermove", { x: 0, y: 60 });
    editor.releasePointer();
    // Refused at the probe: the drop never becomes a commit.
    expect(editor.sent.filter((m) => m.type === "reorder")).toHaveLength(0);
    expect(doc).toBe(shared);
  });
});

describe("smart guides", () => {
  it("a drag snaps to a sibling and commits the SNAPPED value, not the cursor's", () => {
    openDoc(TEXT, "templates-types.gui");
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.paint.reset();
    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);

    // The raw drag would write { 50 30 }. px_card_resized spans x 10..70, so
    // its centre line is x = 40, and the card's left edge is 10 world px from
    // it: inside the 6 screen px tolerance at this zoom. The guide is drawn and
    // the number the readout shows is the number the commit sends.
    expect(editor.paint.strokes).toContain(GUIDE_STROKE);
    expect(editor.text("status")).toContain("position = { 40 30 }");
    editor.up(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 40 30 }" }]);
    serveEdits();
    expect(doc).toContain("position = { 40 30 }");
  });

  it("the same drag with the guides off writes exactly where the cursor left it", () => {
    openDoc(TEXT, "templates-types.gui");
    editor.toggle("snap", false);
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.paint.reset();
    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);

    expect(editor.paint.strokes).not.toContain(GUIDE_STROKE);
    editor.up(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 50 30 }" }]);
  });

  it("equal spacing pulls a widget into the middle of the gap between its siblings", () => {
    // 50 px of gap on one side, 70 on the other: nudging it 5 px right lands it
    // at 60 and 60, which is the whole point of an equal-spacing hint.
    const spaced = [
      "widget = {",
      '\tname = "px_space_root"',
      "\tsize = { 400 300 }",
      '\twidget = { name = "px_left" position = { 0 0 } size = { 40 40 } }',
      '\twidget = { name = "px_mid" position = { 90 0 } size = { 40 40 } }',
      '\twidget = { name = "px_right" position = { 200 0 } size = { 40 40 } }',
      "}",
      "",
    ].join("\n");
    openDoc(spaced, "spacing.gui");
    editor.press(110, 20);
    serveEdits();
    editor.move(125, 20);
    editor.up(125, 20);

    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 100 0 }" }]);
    serveEdits();
    expect(doc).toContain('name = "px_mid" position = { 100 0 }');
  });

  it("the grid snaps to its own lattice, and only when it is switched on", () => {
    openDoc(TEXT, "templates-types.gui");
    editor.toggle("snap", false);
    editor.toggle("grid", true);
    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.move(CARD_CENTER.x + 43, CARD_CENTER.y + 27);
    editor.up(CARD_CENTER.x + 43, CARD_CENTER.y + 27);

    // { 53 37 } raw; the grid takes the widget's own top left to the lattice.
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 50 40 }" }]);
  });
});

describe("drag polish", () => {
  it("the inspector's rows and the readout follow the gesture, and go back if it is abandoned", () => {
    openDoc(TEXT, "templates-types.gui");
    withoutGuides();
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    serveWidgetInfo(editor, TEXT);
    expect(editor.rowInput("position")!.value).toBe("{ 10 10 }");

    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    // The row shows the number the commit would send, and the readout the
    // geometry it would land on: both live, neither written yet.
    expect(editor.rowInput("position")!.value).toBe("{ 50 30 }");
    expect(editor.text("status")).toContain("50, 30 · 100 x 50");

    editor.key("Escape");
    expect(editor.rowInput("position")!.value).toBe("{ 10 10 }");
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(doc).toBe(TEXT);
  });
});

describe("dragging a widget inside a layout box", () => {
  it("becomes a layout-order drag: a drop line, then ONE reorder op", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const child = rectOf(layout, "px_refuse_drag_in_vbox");
    const last = rectOf(layout, "px_refuse_size_one");
    const start = pointIn(child);
    editor.click(start.x, start.y);
    editor.press(start.x, start.y);
    // The position check refuses, and the refusal arms the reorder probe.
    serveEdits();

    editor.paint.reset();
    const below = { x: start.x, y: last.y + last.h * 0.75 };
    editor.move(below.x, below.y);
    expect(editor.paint.strokes).toContain(DROP_STROKE);
    expect(editor.text("status")).toContain("layout order 1 -> 3 of 3");

    editor.up(below.x, below.y);
    const reorder = lastOfType(editor, "reorder")!;
    expect(reorder).toEqual({ type: "reorder", id: reorder.id, line: reorder.line, from: 0, to: 2 });
    serveEdits();
    expect(doc.indexOf("px_refuse_drag_in_vbox")).toBeGreaterThan(doc.indexOf("px_refuse_size_one"));
    // Still no position anywhere: the box owns the slots, and it always did.
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
  });

  it("a drop back on its own slot writes nothing", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const child = rectOf(layout, "px_refuse_drag_in_vbox");
    const start = pointIn(child);
    editor.click(start.x, start.y);
    editor.press(start.x, start.y);
    serveEdits();
    editor.move(start.x + 5, start.y + 3);
    editor.up(start.x + 5, start.y + 3);

    expect(editor.sent.filter((m) => m.type === "reorder")).toHaveLength(0);
    expect(doc).toBe(REFUSALS);
  });
});

describe("subtree focus", () => {
  it("scopes the tree and the canvas to one subtree, and the breadcrumb walks back out", () => {
    serveLayout(editor, TEXT);
    // Somewhere inside the frame but on no child of it.
    editor.click(600, 350);
    expect(editor.selectedRow()).toContain("px_template_frame");

    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    const full = editor.rows().length;
    editor.key("f");

    expect(editor.rows()).toHaveLength(1);
    expect(editor.rows()[0]).toContain("px_card_positioned");
    expect(editor.text("status")).toContain("focused on px_card#px_card_positioned");
    expect(editor.text("focusBar")).toContain("px_template_frame");

    // The canvas is scoped too: the frame is no longer there to be clicked.
    editor.click(600, 350);
    expect(editor.selectedRow()).toBeNull();

    editor.clickIn(editor.document.getElementById("focusBar")!, "button");
    expect(editor.rows()).toHaveLength(full);
    editor.click(600, 350);
    expect(editor.selectedRow()).toContain("px_template_frame");
  });

  it("a crumb focuses the ancestor it names", () => {
    serveLayout(editor, TEXT);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.key("f");
    expect(editor.rows()).toHaveLength(1);

    editor.clickIn(editor.document.getElementById("focusBar")!, ".crumb");
    // The frame is the card's only ancestor, so focusing it brings its whole
    // subtree back as rows, with the frame itself as the root.
    expect(editor.rows()[0]).toContain("px_template_frame");
    expect(editor.rows().length).toBeGreaterThan(1);
    expect(editor.text("status")).toContain("focused on widget#px_template_frame");
  });

  it("the focus survives the re-layout an edit causes", () => {
    openDoc(TEXT, "templates-types.gui");
    editor.toggle("snap", false);
    editor.click(CARD_CENTER.x, CARD_CENTER.y);
    editor.key("f");
    expect(editor.rows()).toHaveLength(1);

    editor.press(CARD_CENTER.x, CARD_CENTER.y);
    serveEdits();
    editor.move(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    editor.up(CARD_CENTER.x + 40, CARD_CENTER.y + 20);
    serveEdits();

    expect(doc).toContain("position = { 50 30 }");
    expect(editor.rows()).toHaveLength(1);
    expect(editor.rows()[0]).toContain("px_card_positioned");
  });
});

// ── G5 stage 1: several widgets at a time ───────────────────────────────────

/**
 * Three free root widgets with room around them (so a marquee has empty canvas
 * to start on), a frame with a child (a container a drop and a paste can go
 * into), and a vbox child (the member the guards refuse).
 */
const GROUP = [
  'widget = { name = "px_g5_a" position = { 10 10 } size = { 40 40 } }',
  'widget = { name = "px_g5_b" position = { 100 30 } size = { 40 40 } }',
  'widget = { name = "px_g5_c" position = { 260 90 } size = { 40 40 } }',
  "widget = {",
  '\tname = "px_g5_frame"',
  "\tposition = { 600 400 }",
  "\tsize = { 300 200 }",
  '\twidget = { name = "px_g5_inner" position = { 10 10 } size = { 40 40 } }',
  "}",
  "vbox = {",
  '\tname = "px_g5_box"',
  "\tposition = { 1000 400 }",
  '\twidget = { name = "px_g5_boxed" size = { 40 40 } }',
  "}",
  "",
].join("\n");

/** The centre of each fixture widget, so no case hardcodes a rect. */
function centreOf(layout: GuiLayoutResult, name: string) {
  return pointIn(rectOf(layout, name));
}

function openGroup(): GuiLayoutResult {
  const layout = openDoc(GROUP, "group.gui");
  // The vocabulary the palette and the wrap menu are built from.
  serveEdits();
  return layout;
}

describe("multi-selection", () => {
  it("shift+click adds and removes, and every panel shows the whole set", () => {
    const layout = openGroup();
    const a = centreOf(layout, "px_g5_a");
    const b = centreOf(layout, "px_g5_b");
    editor.click(a.x, a.y);
    editor.click(b.x, b.y, { shiftKey: true });

    expect(editor.text("status")).toContain("2 selected");
    expect(editor.selectedRows("tree")).toHaveLength(2);
    expect(editor.selectedRows("layers")).toHaveLength(2);
    // The inspector says whose rows it is showing rather than merging them.
    expect(editor.text("inspector")).toContain("The rows below are the primary's alone");

    editor.click(b.x, b.y, { shiftKey: true });
    expect(editor.selectedRows("tree")).toHaveLength(1);
    expect(editor.text("status")).toContain("selected widget#px_g5_a");
  });

  it("a marquee on empty canvas selects what is entirely inside it", () => {
    openGroup();
    editor.press(0, 0);
    editor.move(320, 150);
    expect(editor.text("status")).toContain("3 widget(s) inside the marquee");
    editor.up(320, 150);

    expect(editor.selectedRows("tree")).toHaveLength(3);
    expect(editor.text("status")).toContain("3 selected");
    // The frame and the box are outside the band and stay unselected.
    expect(editor.selectedRows("tree").join(" ")).not.toContain("px_g5_frame");
  });

  it("a group drag moves every member as ONE batch, and says who stayed", () => {
    const layout = openGroup();
    withoutGuides();
    const a = centreOf(layout, "px_g5_a");
    const boxed = centreOf(layout, "px_g5_boxed");
    editor.click(a.x, a.y);
    editor.click(boxed.x, boxed.y, { shiftKey: true });
    // Press the member that CAN move, so the gesture is a move and not the
    // reorder a box child's own press turns into.
    editor.press(a.x, a.y);
    serveEdits();
    editor.move(a.x + 20, a.y + 10);
    // The refusal is the server's, verbatim, and it arrives before anything
    // has been written.
    expect(editor.toast()).toContain("places its children itself");
    editor.up(a.x + 20, a.y + 10);
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toHaveLength(1);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(doc).toContain('name = "px_g5_a" position = { 30 20 }');
    // The box child is where the file always had it.
    expect(doc).toContain('name = "px_g5_boxed" size = { 40 40 }');
  });

  it("Escape clears the whole set, not just the primary", () => {
    const layout = openGroup();
    editor.click(centreOf(layout, "px_g5_a").x, centreOf(layout, "px_g5_a").y);
    editor.click(centreOf(layout, "px_g5_b").x, centreOf(layout, "px_g5_b").y, { shiftKey: true });
    editor.key("Escape");
    expect(editor.selectedRows("tree")).toHaveLength(0);
  });
});

describe("align and distribute", () => {
  it("aligns the selection's left edges as ONE batch of position writes", () => {
    const layout = openGroup();
    for (const [i, name] of ["px_g5_a", "px_g5_b", "px_g5_c"].entries()) {
      const at = centreOf(layout, name);
      editor.click(at.x, at.y, i === 0 ? {} : { shiftKey: true });
    }
    editor.button("⇤").click();
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    // The leftmost widget is already there, so its op is not sent at all.
    expect(apply.ops).toHaveLength(2);
    expect(doc).toContain('name = "px_g5_a" position = { 10 10 }');
    expect(doc).toContain('name = "px_g5_b" position = { 10 30 }');
    expect(doc).toContain('name = "px_g5_c" position = { 10 90 }');
    // One gesture, one document change: the layout ran once for all of them.
    expect(editor.sent.filter((m) => m.type === "applyOps")).toHaveLength(1);
  });

  it("distributes the vertical gaps evenly", () => {
    const layout = openGroup();
    for (const [i, name] of ["px_g5_a", "px_g5_b", "px_g5_c"].entries()) {
      const at = centreOf(layout, name);
      editor.click(at.x, at.y, i === 0 ? {} : { shiftKey: true });
    }
    editor.button("↕").click();
    serveEdits();

    // Tops at 10, 30 and 90 over a span of 10..130: three 40 px widgets leave
    // 40 px of gap to share, so the middle one lands at 10 + 40 + 20 = 70.
    expect(doc).toContain('name = "px_g5_b" position = { 100 50 }');
    expect(doc).toContain('name = "px_g5_c" position = { 260 90 }');
  });
});

describe("the palette", () => {
  it("offers the game's own widgets and filters them", () => {
    openGroup();
    editor.button("Palette").click();
    serveEdits();

    expect(editor.paletteRows().length).toBeGreaterThan(5);
    editor.filterPalette("vbo");
    expect(editor.paletteRows()[0]).toContain("vbox");
  });

  it("a drop commits ONE insert op and selects what it wrote", () => {
    const layout = openGroup();
    editor.button("Palette").click();
    serveEdits();
    const frame = rectOf(layout, "px_g5_frame");

    editor.rowPointer(editor.paletteRow("vbox"), "pointerdown");
    // Inside the frame but on none of its children: the drop appends.
    editor.move(frame.x + frame.w * 0.7, frame.y + frame.h * 0.7);
    expect(editor.text("status")).toContain("into widget#px_g5_frame");
    editor.up(frame.x + frame.w * 0.7, frame.y + frame.h * 0.7);
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toEqual([{ kind: "insert", line: 3, widget: { type: "vbox" }, index: undefined }]);
    expect(doc).toContain(
      '\twidget = { name = "px_g5_inner" position = { 10 10 } size = { 40 40 } }\n\tvbox = {}\n'
    );
    // The new widget is the selection, and the toast says why it draws nothing.
    expect(editor.selectedRow()).toContain("vbox");
    expect(editor.toast()).toContain("no size yet");
  });

  it("a drop the writer refuses is shown in the writer's own words", () => {
    // Inside a `type` definition: other files instantiate it, so the writer
    // turns the insert down rather than restructuring it through one preview.
    const inType = [
      "types PxG5Types {",
      "\ttype px_g5_card = widget {",
      "\t\tsize = { 200 100 }",
      '\t\twidget = { name = "px_g5_type_kid" size = { 20 20 } }',
      "\t}",
      "}",
      "",
      "px_g5_card = {",
      '\tname = "px_g5_use"',
      "\tposition = { 100 100 }",
      "}",
      "",
    ].join("\n");
    openDoc(inType, "in-type.gui");
    serveEdits();
    editor.button("Palette").click();
    serveEdits();

    // The instance's own children are spliced from the type, so a drop on them
    // finds no container with bytes here at all.
    editor.rowPointer(editor.paletteRow("vbox"), "pointerdown");
    editor.move(110, 110);
    expect(editor.text("status")).toContain("into px_g5_card#px_g5_use");
    editor.up(110, 110);
    serveEdits();
    // The use site takes the child: a type definition is never edited through
    // an instance, and this insert is not one.
    expect(doc).toContain("\tvbox = {}\n");
    expect(doc).toContain('\t\twidget = { name = "px_g5_type_kid" size = { 20 20 } }\n');
  });
});

describe("copy, paste, delete and duplicate", () => {
  it("copies a block and pastes it back as the next sibling", () => {
    const layout = openGroup();
    const inner = centreOf(layout, "px_g5_inner");
    editor.click(inner.x, inner.y);
    editor.key("c", { ctrlKey: true });
    serveEdits();
    expect(editor.toast()).toContain("1 widget(s) copied");

    editor.key("v", { ctrlKey: true });
    serveEdits();
    // Verbatim, twice, inside the same frame.
    expect(doc.split('name = "px_g5_inner"')).toHaveLength(3);
    expect(doc).toContain(
      '\twidget = { name = "px_g5_inner" position = { 10 10 } size = { 40 40 } }\n' +
        '\twidget = { name = "px_g5_inner" position = { 10 10 } size = { 40 40 } }\n'
    );
  });

  it("a multi-copy concatenates the blocks in source order", () => {
    const layout = openGroup();
    // Selected bottom-up; the clipboard still reads like the file.
    editor.click(centreOf(layout, "px_g5_c").x, centreOf(layout, "px_g5_c").y);
    editor.click(centreOf(layout, "px_g5_a").x, centreOf(layout, "px_g5_a").y, { shiftKey: true });
    editor.key("c", { ctrlKey: true });
    serveEdits();
    expect(clipboard.indexOf("px_g5_a")).toBeLessThan(clipboard.indexOf("px_g5_c"));

    editor.click(centreOf(layout, "px_g5_inner").x, centreOf(layout, "px_g5_inner").y);
    editor.key("v", { ctrlKey: true });
    serveEdits();
    expect(doc.indexOf("px_g5_a", doc.indexOf("px_g5_frame"))).toBeLessThan(
      doc.indexOf("px_g5_c", doc.indexOf("px_g5_frame"))
    );
  });

  it("Del removes the whole selection in one batch, Ctrl+D duplicates", () => {
    const layout = openGroup();
    editor.click(centreOf(layout, "px_g5_a").x, centreOf(layout, "px_g5_a").y);
    editor.click(centreOf(layout, "px_g5_b").x, centreOf(layout, "px_g5_b").y, { shiftKey: true });
    editor.key("Delete");
    serveEdits();
    // The quoted names, because `px_g5_box` has `px_g5_b` inside it.
    expect(doc).not.toContain('name = "px_g5_a"');
    expect(doc).not.toContain('name = "px_g5_b"');
    expect(doc).toContain('name = "px_g5_c"');
    expect(editor.sent.filter((m) => m.type === "applyOps")).toHaveLength(1);

    const after = layoutOf(doc);
    editor.click(centreOf(after, "px_g5_c").x, centreOf(after, "px_g5_c").y);
    editor.key("d", { ctrlKey: true });
    serveEdits();
    expect(doc.split("px_g5_c")).toHaveLength(3);
  });
});

describe("the anchor picker", () => {
  it("writes a spec the layout engine parses, guards asked first", () => {
    const layout = openGroup();
    const a = centreOf(layout, "px_g5_a");
    editor.click(a.x, a.y);
    serveWidgetInfo(editor, doc);

    const grids = editor.document.querySelectorAll("#inspector .anchorGrid");
    expect(grids).toHaveLength(2);
    // Bottom right of the parentanchor grid: the last of nine cells.
    const cell = grids[0].children[8] as HTMLElement;
    cell.click();
    serveEdits();

    expect(lastOfType(editor, "checkEdit")!.properties).toEqual([
      { key: "parentanchor", value: "bottom|right" },
    ]);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([
      { key: "parentanchor", value: "bottom|right" },
    ]);
    expect(doc).toContain("parentanchor = bottom|right");
    // The engine reads it: the widget is now anchored to the viewport's corner.
    expect(rectOf(layoutOf(doc), "px_g5_a").x).toBeGreaterThan(1000);
  });
});

describe("wrap", () => {
  it("wraps the selection in the container the menu names", () => {
    const layout = openGroup();
    const inner = centreOf(layout, "px_g5_inner");
    editor.click(inner.x, inner.y);

    const select = editor.document.querySelector<HTMLSelectElement>("#inspector .tools select")!;
    select.value = "vbox";
    editor.button("Wrap").click();
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toEqual([{ kind: "wrap", lines: [7], container: { type: "vbox" } }]);
    expect(doc).toContain(
      '\tvbox = {\n\t\twidget = { name = "px_g5_inner" position = { 10 10 } size = { 40 40 } }\n\t}\n'
    );
  });
});
