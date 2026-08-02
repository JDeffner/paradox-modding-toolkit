/**
 * The GUI editor's interaction smoke: the real app bundle in jsdom, driven by
 * clicks, answered by a stubbed host that replays the REAL server.
 *
 * G3.2's claim is the selection path: a click picks a widget, the app asks the
 * host for that widget's properties by line, and when the document changes
 * under it — an insert that shifts every index and every line — the SAME widget
 * is still selected and re-read. G3.3 adds the drag-commit and refusal cases on
 * top of this harness.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { computeGuiLayoutResult } from "../../server/src/gui/layoutService";
import { computeGuiWidgetInfo } from "../../server/src/gui/widgetInfo";
import type { AppToHost } from "../src/webviews/guiEditor/messages";
import { bootEditor, guiFixture, type EditorHarness } from "./guiEditorHarness";

const TEXT = guiFixture("templates-types.gui");

/** The card is at position { 10 10 } size { 100 50 } inside the frame at 0,0. */
const CARD_CENTER = { x: 60, y: 35 };
const CARD_LINE = TEXT.split(/\r?\n/).findIndex((l) => l.includes('name = "px_card_positioned"'));

function layoutOf(text: string) {
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

beforeEach(() => {
  editor = bootEditor();
});
afterEach(() => editor.close());

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
