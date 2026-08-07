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
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { GuiLayoutResult, GuiSourceOp } from "@px-lsp/protocol/protocol";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { computeGuiWidgetInfo } from "../../server/src/gui/widgetInfo";
import { collectGuiDefs } from "../../server/src/gui/guiDefs";
import { computeGuiSourceEdit } from "../../server/src/gui/sourceEditService";
import { applyAll } from "../../server/src/gui/sourceEdit";
import type { AppToHost } from "../src/webviews/guiEditor/messages";
import { bootEditor, guiFixture, type EditorHarness } from "./guiEditorHarness";

const TEXT = guiFixture("templates-types.gui");
const REFUSALS = guiFixture("refusal-shapes.gui", "writer");

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
 * The host's write half, replayed from the real server: answer every check and
 * commit the app has sent since the last call, apply an accepted commit to the
 * document, and push the fresh layout the way `panel.ts` does after its own
 * write.
 */
function serveEdits(): void {
  for (; served < editor.sent.length; served++) {
    const message = editor.sent[served];
    if (message.type !== "checkEdit" && message.type !== "applyEdit") continue;
    const op: GuiSourceOp = {
      kind: "setProperties",
      line: message.line,
      properties: message.properties,
    };
    const result = computeGuiSourceEdit(doc, op, collectGuiDefs(doc)) ?? {
      refused: "the server had no answer for that edit.",
    };
    const writes = message.type === "applyEdit" && !result.refused && (result.edits?.length ?? 0) > 0;
    editor.push({
      type: "editVerdict",
      id: message.id,
      refused: writes ? undefined : result.refused,
      warning: result.warning,
    });
    if (!writes) continue;
    doc = applyAll(doc, result.edits!);
    editor.push({ type: "layout", file: docFile, result: layoutOf(doc), textures: {} });
  }
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

  it("a box child's drag is refused before it moves, in the server's own words", () => {
    const layout = openDoc(REFUSALS, "refusal-shapes.gui");
    const child = rectOf(layout, "px_refuse_drag_in_vbox");
    const start = pointIn(child);
    editor.click(start.x, start.y);
    expect(editor.selectedRow()).toContain("px_refuse_drag_in_vbox");

    editor.press(start.x, start.y);
    serveEdits();
    editor.move(start.x + 40, start.y + 40);
    editor.up(start.x + 40, start.y + 40);

    // The reason is the writer's, verbatim, and it arrives with the document
    // untouched and nothing having moved on the canvas.
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
    expect(doc).toBe(REFUSALS);
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
