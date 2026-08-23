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
 *
 * G5 stage 2's claim is the devtools halo and the browsers, and it has two
 * halves. The first is that a CLOSED panel costs nothing: no request goes out
 * for a surface nobody opened, which the cases assert by counting messages
 * rather than by reading the panel. The second is that everything the new
 * surfaces write goes through the SAME guarded paths as stage 1 — a texture
 * pick and a `using` are `checkEdit` then `applyEdit`, a preset is one
 * `applyOps` batch, a component is an `insertRaw` — so a refusal reads exactly
 * as it does from the inspector.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type {
  GuiDependenciesResult,
  GuiLayoutResult,
  GuiSourceEditResult,
  GuiSourceOp,
  GuiVisibilityOptions,
} from "@px-lsp/protocol/protocol";
import CK3_GUI_SCHEMA from "../../server/data/ck3/guiSchema.json";
import { ANCHOR_X, ANCHOR_Y } from "../../server/src/gui/anchorSpec";
import { computeGuiLayoutResult, VIEWPORT } from "../../server/src/gui/layoutService";
import { computeGuiWidgetInfo } from "../../server/src/gui/widgetInfo";
import { collectGuiDefs } from "../../server/src/gui/guiDefs";
import { computeGuiSourceEdit, computeGuiSourceEdits } from "../../server/src/gui/sourceEditService";
import { computeGuiVocabulary } from "../../server/src/gui/vocabulary";
import { computeGuiDependencies } from "../../server/src/gui/guiDependencies";
import { collectScriptedGuiCalls, emptyGuiScriptLinks } from "../../server/src/gui/guiLinks";
import { loadSchema } from "../../server/src/schema/loader";
import { ServerData } from "../../server/src/serverData";
import { applyAll } from "../../server/src/gui/sourceEdit";
import { resolveGuiText } from "../../server/src/gui/textResolve";
import { UNRESOLVED_TEXT } from "../src/webviews/guiEditor/app/render";
import { countTopLevelBlocks } from "../src/webviews/guiEditor/userData";
import type {
  AppToHost,
  EditProperty,
  GuiEditorUiState,
  TextureEntry,
} from "../src/webviews/guiEditor/messages";
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
  return computeGuiLayoutResult(text, null, null, [], [], storedVisibility);
}

/** The host's half of the contract, replayed from the real server. */
function serveLayout(harness: EditorHarness, text: string, file = "templates-types.gui"): void {
  harness.push({
    type: "layout",
    file,
    result: layoutOf(text),
    textures: {},
    visibility: storedVisibility,
  });
}

/**
 * The inspector read, HONOURING the placement flag: the trace costs a full
 * layout server side, so a host that answered with it either way would hide the
 * whole reason the flag exists.
 */
function serveWidgetInfo(harness: EditorHarness, text: string): void {
  const request = [...harness.sent].reverse().find((m) => m.type === "requestWidgetInfo");
  if (!request || request.type !== "requestWidgetInfo") throw new Error("no widget info was requested");
  harness.push({
    type: "widgetInfo",
    line: request.line,
    info: computeGuiWidgetInfo(text, request.line, undefined, {
      placement: request.placement === true,
      viewport: VIEWPORT,
    }),
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

/**
 * The stage 2 half of the stub host: exactly the per-user state `panel.ts`
 * keeps in `workspaceState`, and the gfx listing it keeps from its own walk.
 * Plain objects, because the point of the contract is that a host needs nothing
 * cleverer than this to satisfy it.
 */
let storedVisibility: GuiVisibilityOptions | undefined;
let savedComponents: Record<string, string> = {};
let savedPresets: Record<string, EditProperty[]> = {};
let textureCatalogue: TextureEntry[] = [];
let revealedAt: { file: string; line: number }[] = [];
/** The view preferences the host keeps, which ride down on every layout it pushes. */
let storedUi: GuiEditorUiState | undefined;

beforeEach(() => {
  editor = bootEditor();
  doc = "";
  docFile = "";
  served = 0;
  layoutRuns = 0;
  clipboard = "";
  storedVisibility = undefined;
  savedComponents = {};
  savedPresets = {};
  textureCatalogue = [];
  revealedAt = [];
  storedUi = undefined;
});
afterEach(() => editor.close());

/** Open a document the way the host does: it becomes the text edits apply to. */
function openDoc(text: string, file: string): GuiLayoutResult {
  doc = text;
  docFile = file;
  const result = layoutOf(text);
  editor.push({ type: "layout", file, result, textures: {}, visibility: storedVisibility });
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
      editor.push({
        type: "vocabulary",
        entries: vocabulary.entries,
        total: vocabulary.total,
        properties: vocabulary.properties ?? {},
        commonProperties: vocabulary.commonProperties ?? [],
      });
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
    if (serveHalo(message)) continue;
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
    editor.push({
      type: "layout",
      file: docFile,
      result: layoutOf(doc),
      textures: {},
      visibility: storedVisibility,
    });
  }
}

/**
 * The stage 2 messages, answered the way `panel.ts` answers them. Returns true
 * when it handled the message, so the write path below sees only writes.
 *
 * `insertComponent` and `savePreset` deliberately go through the SAME server
 * calls the paste and the batched write already use: what makes a saved
 * component safe is that it is an `insertRaw` op like any other, not a second
 * way into the document.
 */
function serveHalo(message: AppToHost): boolean {
  switch (message.type) {
    case "setVisibility": {
      storedVisibility =
        message.mode === "showAll" && !Object.values(message.checks ?? {}).some((v) => v === false)
          ? undefined
          : { mode: message.mode, checks: message.checks };
      editor.push({
        type: "layout",
        file: docFile,
        result: layoutOf(doc),
        textures: {},
        visibility: storedVisibility,
      });
      return true;
    }
    case "requestDependencies": {
      editor.push({
        type: "dependencies",
        line: message.line,
        result: dependenciesFor(doc, message.line),
      });
      return true;
    }
    case "requestTextureList": {
      const needle = message.query.trim().toLowerCase();
      const matches = textureCatalogue.filter((e) => e.path.toLowerCase().includes(needle));
      editor.push({
        type: "textureList",
        entries: matches.slice(0, 200),
        total: matches.length,
        roots: true,
      });
      return true;
    }
    case "requestThumbnails": {
      const urls: Record<string, string | null> = {};
      for (const path of message.paths) urls[path] = `stub:${path}`;
      editor.push({ type: "thumbnails", urls });
      return true;
    }
    case "requestUserData":
      pushUserData();
      return true;
    case "saveComponent": {
      const result = answer({ ops: message.lines.map((line) => ({ kind: "blockText" as const, line })) });
      const blocks = (result.results ?? []).map((r) => r.blockText).filter((b): b is string => !!b);
      if (blocks.length === 0) {
        editor.push({
          type: "editVerdict",
          id: message.id,
          refused: result.refused ?? "there was nothing to save on those lines.",
        });
        return true;
      }
      savedComponents[message.name] = blocks.join("");
      editor.push({ type: "editVerdict", id: message.id });
      pushUserData();
      return true;
    }
    case "insertComponent": {
      const fragment = savedComponents[message.name];
      if (!fragment) {
        editor.push({
          type: "editVerdict",
          id: message.id,
          refused: `there is no saved component called "${message.name}" any more.`,
        });
        return true;
      }
      commitOne(message.id, {
        op: { kind: "insertRaw", line: message.line, fragment, index: message.index },
      });
      return true;
    }
    case "setUiState":
      // Stored and never echoed back mid-session, exactly like panel.ts: the
      // app has already applied it and the next panel reads it from its layout.
      storedUi = {
        valueMode: message.valueMode,
        snap: message.snap ?? storedUi?.snap,
        grid: message.grid ?? storedUi?.grid,
        loc: message.loc ?? storedUi?.loc,
      };
      return true;
    case "savePreset":
      savedPresets[message.name] = message.properties;
      pushUserData();
      return true;
    case "forgetSaved":
      if (message.kind === "component") delete savedComponents[message.name];
      else delete savedPresets[message.name];
      pushUserData();
      return true;
    case "revealAt":
      revealedAt.push({ file: message.file, line: message.line });
      return true;
    default:
      return false;
  }
}

function pushUserData(): void {
  editor.push({
    type: "userData",
    components: Object.entries(savedComponents).map(([name, text]) => ({
      name,
      widgets: countTopLevelBlocks(text),
      text,
    })),
    presets: Object.entries(savedPresets).map(([name, properties]) => ({ name, properties })),
  });
}

/** One op, applied and laid out again: `panel.ts`'s `commit`, in miniature. */
function commitOne(id: number, request: { op: GuiSourceOp }): void {
  const result = answer(request);
  const writes = !result.refused && (result.edits?.length ?? 0) > 0;
  editor.push({
    type: "editVerdict",
    id,
    refused: writes ? undefined : (result.refused ?? "that edit changes nothing."),
    warning: result.warning,
  });
  if (!writes) return;
  doc = applyAll(doc, result.edits!);
  editor.push({
    type: "layout",
    file: docFile,
    result: layoutOf(doc),
    textures: {},
    visibility: storedVisibility,
  });
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
    // The case is about the op's numbers, so the guides (which would match the
    // height to a sibling's) are off, as in every other case about an op.
    withoutGuides();
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

    // { 53 37 } raw; the 8 px grid takes the widget's own top left to the lattice.
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 56 40 }" }]);
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

/** Open the library the way the toolbar does, with the vocabulary and the saved data served. */
function openLibrary(): void {
  editor.button("Library").click();
  serveEdits();
}

/** A mouse click on a panel element. */
function clickOn(node: Element): void {
  node.dispatchEvent(new editor.document.defaultView!.MouseEvent("click", { bubbles: true }));
}

const CHIP = 'widget = { name = "px_chip" size = { 10 10 } }';

describe("the library", () => {
  it("lists the vocabulary by section and searches across it", () => {
    openGroup();
    openLibrary();

    expect(editor.libraryTiles().length).toBeGreaterThan(5);
    editor.librarySection("This file");
    expect(editor.libraryTiles()).toEqual([]);
    editor.librarySection("Widgets");
    const widgets = editor.libraryTiles();
    expect(widgets).toContain("vbox");
    expect(widgets).toContain("hbox");
    editor.librarySection("All");
    editor.searchLibrary("vbo");
    expect(editor.libraryTiles()[0]).toBe("vbox");
    expect(editor.libraryTiles().every((name) => name.includes("vbo"))).toBe(true);
    editor.searchLibrary("nothing-like-this");
    expect(editor.text("library")).toContain("Nothing matches");
  });

  it("this file's declarations and the saved pieces each have a section", () => {
    savedComponents = { chip: CHIP };
    openDoc(TEXT, "templates-types.gui");
    openLibrary();
    editor.librarySection("This file");
    expect(editor.libraryTiles().length).toBeGreaterThan(0);
    expect(editor.text("library")).toContain("this file");
    editor.librarySection("Saved");
    expect(editor.libraryTiles()).toEqual(["chip"]);
    expect(editor.text("library")).toContain("saved · 1 widget");
  });

  it("asks for previews only for the tiles on screen, in batches of at most 48, each once", () => {
    openGroup();
    openLibrary();
    expect(editor.sent.filter((m) => m.type === "requestPreviews")).toHaveLength(0);

    editor.scrollLibrary();
    const requests = editor.sent.filter((m) => m.type === "requestPreviews");
    expect(requests.length).toBeGreaterThan(0);
    let asked = 0;
    for (const request of requests) {
      if (request.type !== "requestPreviews") continue;
      expect(request.entries.length).toBeLessThanOrEqual(48);
      asked += request.entries.length;
    }
    // The first page of 60, every tile of it. The second scroll pages on and
    // asks nothing twice.
    expect(asked).toBe(60);
    editor.scrollLibrary();
    const names = editor.sent.flatMap((m) =>
      m.type === "requestPreviews" ? m.entries.map((e) => e.name) : []
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(60);
  });

  it("a saved component previews as raw text, and a preview the server cannot stand up says why", () => {
    savedComponents = { chip: CHIP };
    openGroup();
    openLibrary();
    editor.librarySection("Saved");
    editor.scrollLibrary();
    const request = lastOfType(editor, "requestPreviews")!;
    expect(request.entries).toEqual([{ name: "chip", kind: "raw", fragment: CHIP }]);
    editor.push({
      type: "previews",
      previews: [{ name: "chip", node: null, textures: [], reason: "nothing to lay out" }],
      textures: {},
    });
    const tile = editor.libraryTile("chip");
    expect(tile.hasAttribute("data-empty")).toBe(true);
    expect(tile.title).toContain("nothing to lay out");
  });

  it("a click on a tile inserts next to the selection through the same insert op", () => {
    const layout = openGroup();
    openLibrary();
    const inner = centreOf(layout, "px_g5_inner");
    editor.click(inner.x, inner.y);
    clickOn(editor.libraryTile("vbox"));
    serveEdits();
    expect(lastOfType(editor, "applyOps")!.ops).toEqual([
      { kind: "insert", line: 3, widget: { type: "vbox" }, index: 1 },
    ]);
    expect(editor.selectedRow()).toContain("vbox");
  });

  it("a click with nothing selected inserts into the first root", () => {
    openGroup();
    openLibrary();
    clickOn(editor.libraryTile("vbox"));
    serveEdits();
    expect(lastOfType(editor, "applyOps")!.ops).toEqual([
      { kind: "insert", line: 0, widget: { type: "vbox" }, index: undefined },
    ]);
  });

  it("a saved tile drops through insertComponent, by name", () => {
    savedComponents = { chip: CHIP };
    const layout = openGroup();
    openLibrary();
    const frame = rectOf(layout, "px_g5_frame");
    editor.librarySection("Saved");
    editor.rowPointer(editor.libraryTile("chip"), "pointerdown");
    editor.move(frame.x + frame.w * 0.7, frame.y + frame.h * 0.7);
    editor.up(frame.x + frame.w * 0.7, frame.y + frame.h * 0.7);
    serveEdits();
    expect(lastOfType(editor, "insertComponent")).toMatchObject({ name: "chip", line: 3 });
    expect(doc).toContain('name = "px_chip"');
  });

  it("a drop commits ONE insert op and selects what it wrote", () => {
    const layout = openGroup();
    openLibrary();
    const frame = rectOf(layout, "px_g5_frame");

    editor.rowPointer(editor.libraryTile("vbox"), "pointerdown");
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
    openLibrary();

    // The instance's own children are spliced from the type, so a drop on them
    // finds no container with bytes here at all.
    editor.rowPointer(editor.libraryTile("vbox"), "pointerdown");
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

  it("Del removes the whole selection in one batch, after a confirm, and Ctrl+D duplicates", async () => {
    const layout = openGroup();
    editor.click(centreOf(layout, "px_g5_a").x, centreOf(layout, "px_g5_a").y);
    editor.click(centreOf(layout, "px_g5_b").x, centreOf(layout, "px_g5_b").y, { shiftKey: true });
    editor.key("Delete");
    // More than one widget: the page asks first, and nothing has gone out yet.
    expect(editor.sent.filter((m) => m.type === "applyOps")).toHaveLength(0);
    expect(editor.document.querySelector(".px-dialog")?.textContent).toContain("Delete 2 widgets?");
    editor.button("Delete").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
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

// ── G5 stage 2: the devtools halo, the browsers and the saved library ────────

/** The colours the stage 2 overlays paint with, as the canvas stub sees them. */
const PARENT_STROKE = "#7fd1c1";
const PULSE_STROKE = "#4fffb0";

/**
 * A widget anchored to its parent's corner (an anchor sum to explain), one
 * inside a vbox (a dropped position to report), one calling a scripted_gui and
 * naming two loc keys (a dependency answer), and a conditional `visible` (a
 * visibility check).
 *
 * The conditional one sits INSIDE the vbox on purpose: `ignoreinvisible`
 * defaults to yes there, so a hidden child collapses to a zero rect and the
 * mode has something a test can see. Outside a box, `visible` changes no rect
 * at all, which is the engine's answer and not this panel's business.
 */
const HALO = [
  'widget = { name = "px_h_root"',
  "\tposition = { 100 50 }",
  "\tsize = { 400 300 }",
  '\twidget = { name = "px_h_anchored"',
  "\t\tparentanchor = bottom|right",
  "\t\tposition = { -30 -20 }",
  "\t\tsize = { 40 20 }",
  "\t}",
  '\twidget = { name = "px_h_button"',
  "\t\tposition = { 10 10 }",
  "\t\tsize = { 60 30 }",
  "\t\tonclick = \"[GetScriptedGui('px_h_gui').Execute(GuiScope.End)]\"",
  '\t\ttext = "PX_H_LABEL"',
  '\t\ttooltip = "PX_H_MISSING"',
  "\t}",
  "}",
  '\nvbox = { name = "px_h_box"',
  "\tposition = { 700 100 }",
  '\twidget = { name = "px_h_boxed" position = { 5 5 } size = { 40 40 } }',
  '\twidget = { name = "px_h_conditional"',
  '\t\tvisible = "[GetPlayer.IsAI]"',
  "\t\tsize = { 30 30 }",
  "\t}",
  "}",
  "",
].join("\n");

/** The script side the dependency panel reads, indexed the way the server does. */
const depsData = new ServerData();
const depsSchema = loadSchema(null);
const depsLinks = emptyGuiScriptLinks();
const SGUI_FILE = "/px/common/scripted_guis/px_h.txt";
depsData.index.addAll([
  { name: "px_h_gui", kind: "scripted_gui", file: SGUI_FILE, line: 3, source: "mod" },
  {
    name: "PX_H_LABEL",
    kind: "loc_key",
    file: "/px/localization/px_l_english.yml",
    line: 1,
    source: "mod",
    value: "Open it",
  },
]);
collectScriptedGuiCalls(HALO, "/px/gui/px_h.gui", depsLinks);

function dependenciesFor(text: string, line: number | undefined): GuiDependenciesResult {
  return computeGuiDependencies(depsData, depsSchema, text, line, depsLinks);
}

function openHalo(): GuiLayoutResult {
  const layout = openDoc(HALO, "halo.gui");
  serveEdits();
  editor.button("Devtools").click();
  serveEdits();
  return layout;
}

/**
 * The halo's own requests fire on a DEBOUNCE after a selection change, so a
 * case that clicks a widget and then reads a halo panel has to let the timer
 * run: jsdom's timers are Node's, and a synchronous test never reaches them.
 * That the wait is needed at all is the assertion the debounce is real.
 */
async function settleHalo(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  serveEdits();
}

describe("the halo costs nothing while it is closed", () => {
  it("asks for no trace, no dependencies, no textures and no saved data until it is opened", () => {
    const layout = openDoc(HALO, "halo.gui");
    serveEdits();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);

    // The inspector's own read goes out, WITHOUT the placement flag, and none
    // of the halo's own requests do.
    const read = lastOfType(editor, "requestWidgetInfo")!;
    expect(read.placement).toBeUndefined();
    for (const type of ["requestDependencies", "requestTextureList", "requestUserData"] as const) {
      expect(editor.sent.filter((m) => m.type === type)).toHaveLength(0);
    }
  });

  it("opening the Why tab re-reads the SAME widget, this time with the trace", () => {
    const layout = openHalo();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    const read = lastOfType(editor, "requestWidgetInfo")!;
    expect(read.placement).toBe(true);

    // Moving off the tab stops paying for it again.
    editor.button("Uses").click();
    editor.click(at.x, at.y);
    expect(lastOfType(editor, "requestWidgetInfo")!.placement).toBeUndefined();
  });
});

describe("why is it here", () => {
  it("reads the anchor terms and closes them on the rect the canvas drew", () => {
    const layout = openHalo();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    serveWidgetInfo(editor, doc);

    const body = editor.text("haloBody");
    expect(body).toContain("the parent's content box");
    expect(body).toContain("parentanchor = bottom|right");
    expect(body).toContain("widgetanchor = bottom|right (mirrors parentanchor)");
    expect(body).toContain("position = { -30 -20 }");
    expect(body).toContain("= where it sits");
    // The closing row IS the engine's rect, so the panel and the canvas cannot
    // be made to disagree.
    const rect = rectOf(layout, "px_h_anchored");
    expect(body).toContain(`${rect.x}, ${rect.y}`);
  });

  it("says a box took the slot and dropped the position the author wrote", () => {
    const layout = openHalo();
    const at = centreOf(layout, "px_h_boxed");
    editor.click(at.x, at.y);
    serveWidgetInfo(editor, doc);

    const body = editor.text("haloBody");
    expect(body).toContain("vbox#px_h_box placed it");
    expect(body).toContain("position = { 5 5 } was DROPPED");
    expect(body).toContain("Widget cannot have a position in a layout");
  });
});

describe("the canvas devtools", () => {
  it("the constraint overlay reaches the canvas only when it is switched on", () => {
    const layout = openHalo();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    serveWidgetInfo(editor, doc);

    editor.paint.reset();
    expect(editor.paint.strokes).not.toContain(PARENT_STROKE);
    editor.toggle("constraints", true);
    expect(editor.paint.strokes).toContain(PARENT_STROKE);

    editor.paint.reset();
    editor.toggle("constraints", false);
    expect(editor.paint.strokes).not.toContain(PARENT_STROKE);
  });

  it("the overlay fetches its own trace when the panel that reads it is closed", () => {
    const layout = openDoc(HALO, "halo.gui");
    serveEdits();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    serveWidgetInfo(editor, doc);
    // No halo, so the first read was the plain one and there is nothing to draw.
    expect(lastOfType(editor, "requestWidgetInfo")!.placement).toBeUndefined();

    editor.toggle("constraints", true);
    expect(lastOfType(editor, "requestWidgetInfo")!.placement).toBe(true);
    editor.paint.reset();
    serveWidgetInfo(editor, doc);
    expect(editor.paint.strokes).toContain(PARENT_STROKE);
  });

  it("a heatmap tints the scene and says what it is tinting", () => {
    openHalo();
    editor.heatmap("synthetic");
    expect(editor.toast()).toContain("spliced in from a template or a type");
    editor.heatmap("depth");
    expect(editor.toast()).toContain("depth 0 to");
    editor.heatmap("off");
  });

  it("pulses flash what a commit moved, and say how many, only while switched on", () => {
    const layout = openHalo();
    editor.toggle("snap", false);
    const at = centreOf(layout, "px_h_anchored");

    editor.press(at.x, at.y);
    serveEdits();
    editor.move(at.x + 40, at.y + 20);
    editor.up(at.x + 40, at.y + 20);
    serveEdits();
    expect(editor.text("status")).not.toContain("layout:");

    editor.toggle("pulses", true);
    const again = centreOf(layoutOf(doc), "px_h_anchored");
    editor.paint.reset();
    editor.press(again.x, again.y);
    serveEdits();
    editor.move(again.x + 40, again.y + 20);
    editor.up(again.x + 40, again.y + 20);
    serveEdits();

    expect(editor.text("status")).toContain("layout: 1 widget changed");
    expect(editor.paint.strokes).toContain(PULSE_STROKE);
  });

  it("the stats line carries the server's stages and the app's own", () => {
    openHalo();
    const stats = editor.text("stats");
    for (const part of ["parse", "defs", "layout", "server", "scene", "paint"]) {
      expect(stats).toContain(part);
    }
    expect(stats).toContain("w");
  });
});

describe("conditional visibility", () => {
  it("a mode change is one message, the layout is the answer, and the badge says so", () => {
    openHalo();
    editor.button("Visible").click();
    // Reported in every mode, so the toggle UI exists before the mode changes.
    expect(editor.text("haloBody")).toContain("[GetPlayer.IsAI]");
    expect(editor.badge()).toBeNull();

    editor.button("Hide all").click();
    serveEdits();
    expect(lastOfType(editor, "setVisibility")).toMatchObject({ mode: "hideAll" });
    expect(editor.badge()).toContain("hiding every conditional widget");
    // The widget really collapsed. It stays in the tree as a zero rect, which
    // is the engine's own answer (L27) and what lets the user still select the
    // thing they have just made invisible; the badge is why that is not a
    // mystery.
    expect(rectOf(layoutOf(doc), "px_h_conditional")).toMatchObject({ w: 0, h: 0 });
    expect(editor.text("haloBody")).toContain("hidden");

    editor.button("Show all").click();
    serveEdits();
    expect(editor.badge()).toBeNull();
    expect(rectOf(layoutOf(doc), "px_h_conditional")).toMatchObject({ w: 30, h: 30 });
  });

  it("evaluate takes a per-check assignment, and the host remembers it", () => {
    openHalo();
    editor.button("Visible").click();
    editor.button("Evaluate").click();
    serveEdits();

    const box = editor.document.querySelector<HTMLInputElement>("#haloBody label.check input")!;
    expect(box.disabled).toBe(false);
    box.checked = false;
    box.dispatchEvent(new (editor.document.defaultView as Window & typeof globalThis).Event("change"));
    serveEdits();

    expect(lastOfType(editor, "setVisibility")).toMatchObject({
      mode: "evaluate",
      checks: { "[GetPlayer.IsAI]": false },
    });
    expect(storedVisibility).toEqual({ mode: "evaluate", checks: { "[GetPlayer.IsAI]": false } });
    expect(editor.badge()).toContain("1 condition(s) set to false");
    expect(rectOf(layoutOf(doc), "px_h_conditional")).toMatchObject({ w: 0, h: 0 });
  });
});

describe("the dependency panel", () => {
  it("lists the scripted_gui a widget calls, its chain and its loc keys", async () => {
    const layout = openHalo();
    editor.button("Uses").click();
    const at = centreOf(layout, "px_h_button");
    editor.click(at.x, at.y);
    await settleHalo();

    // Scoped to the widget's own source subtree, which is what the head says.
    expect(lastOfType(editor, "requestDependencies")!.line).toBe(8);
    const body = editor.text("haloBody");
    expect(body).toContain("px_h_gui");
    expect(body).toContain("PX_H_LABEL");
    // The index has no definition for the tooltip key, and the panel says so
    // rather than leaving it to be discovered in game.
    expect(body).toContain("PX_H_MISSING");
    expect(body).toContain("missing");
  });

  it("a row with a definition site reveals it in the text editor", async () => {
    const layout = openHalo();
    editor.button("Uses").click();
    const at = centreOf(layout, "px_h_button");
    editor.click(at.x, at.y);
    await settleHalo();

    editor.haloClick("px_h_gui");
    serveEdits();
    // A scripted_gui lives outside the .gui being edited, so it is the
    // arbitrary-file reveal and not the document one.
    expect(revealedAt).toEqual([{ file: SGUI_FILE, line: 3 }]);
    expect(editor.sent.filter((m) => m.type === "reveal")).toHaveLength(0);
  });

  it("the scope switch asks about the whole file instead of the selection", async () => {
    const layout = openHalo();
    editor.button("Uses").click();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    await settleHalo();
    // The anchored widget calls nothing.
    expect(editor.text("haloBody")).toContain("This calls no scripted_gui");

    const scope = editor.document.querySelector<HTMLInputElement>("#haloBody label.check input")!;
    scope.checked = true;
    scope.dispatchEvent(new (editor.document.defaultView as Window & typeof globalThis).Event("change"));
    serveEdits();

    expect(lastOfType(editor, "requestDependencies")!.line).toBeUndefined();
    expect(editor.text("haloBody")).toContain("px_h_gui");
  });
});

describe("the type and template browser", () => {
  const WITH_TEMPLATE = [
    "template PxHDeco {",
    "\tsize = { 24 24 }",
    "}",
    "",
    'widget = { name = "px_t_root"',
    "\tsize = { 400 300 }",
    '\twidget = { name = "px_t_kid" position = { 10 10 } size = { 40 40 } }',
    "}",
    "",
  ].join("\n");

  it("applies a template to the selection as a guarded `using` write", () => {
    openDoc(WITH_TEMPLATE, "template.gui");
    serveEdits();
    editor.button("Devtools").click();
    editor.button("Types").click();
    serveEdits();

    editor.click(30, 30);
    expect(editor.selectedRow()).toContain("px_t_kid");
    editor.filterHalo("PxHDeco");
    editor.haloClick("PxHDeco");
    editor.haloClick("Apply as using = PxHDeco");
    serveEdits();

    // Guards first, then the write, exactly as the anchor picker does it.
    expect(lastOfType(editor, "checkEdit")!.properties).toEqual([{ key: "using", value: "PxHDeco" }]);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "using", value: "PxHDeco" }]);
    expect(doc).toContain("using = PxHDeco");
  });

  it("inserting a type goes out as the palette's own insert op", () => {
    openDoc(WITH_TEMPLATE, "template.gui");
    serveEdits();
    editor.button("Devtools").click();
    editor.button("Types").click();
    serveEdits();

    editor.click(30, 30);
    editor.filterHalo("vbox");
    editor.haloClick("vbox");
    editor.haloClick("Insert here");
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toEqual([{ kind: "insert", line: 4, widget: { type: "vbox" }, index: 1 }]);
    expect(doc).toContain("\tvbox = {}\n");
  });
});

describe("the texture browser", () => {
  it("lists what the host walked, thumbnails only the page, and picks through the guards", async () => {
    const layout = openDoc(HALO, "halo.gui");
    serveEdits();
    textureCatalogue = [
      { path: "gfx/interface/icons/px_shield.dds", source: "mod" },
      { path: "gfx/interface/icons/px_sword.dds", source: "game" },
      { path: "gfx/interface/frames/px_frame.dds", source: "game" },
    ];
    editor.button("Devtools").click();
    editor.button("Art").click();
    serveEdits();

    expect(editor.text("haloBody")).toContain("px_shield.dds");
    // A thumbnail per listed row, and no more.
    const asked = lastOfType(editor, "requestThumbnails")!;
    expect(asked.paths).toHaveLength(3);

    editor.filterHalo("sword");
    serveEdits();
    expect(lastOfType(editor, "requestTextureList")!.query).toBe("sword");
    expect(editor.text("haloBody")).not.toContain("px_shield.dds");

    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    await settleHalo();
    editor.haloClick("px_sword.dds");
    serveEdits();

    // Guards first, then the write, in the engine's own format: quoted,
    // root-relative, forward slashes.
    expect(lastOfType(editor, "checkEdit")!.properties).toEqual([
      { key: "texture", value: '"gfx/interface/icons/px_sword.dds"' },
    ]);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([
      { key: "texture", value: '"gfx/interface/icons/px_sword.dds"' },
    ]);
    expect(doc).toContain('texture = "gfx/interface/icons/px_sword.dds"');
  });
});

describe("saved components and presets", () => {
  it("ships nothing, saves a selection's verbatim block, and inserts it back", () => {
    const layout = openDoc(HALO, "halo.gui");
    serveEdits();
    editor.button("Devtools").click();
    editor.button("Saved").click();
    serveEdits();
    // No invented content: the panel is empty until the user fills it.
    expect(editor.text("haloBody")).toContain("Nothing saved yet");
    expect(savedComponents).toEqual({});

    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    const name = editor.document.querySelector<HTMLInputElement>("#haloBody input.text")!;
    name.value = "corner tag";
    name.dispatchEvent(new (editor.document.defaultView as Window & typeof globalThis).Event("input"));
    editor.haloClick("Save selection");
    serveEdits();

    expect(Object.keys(savedComponents)).toEqual(["corner tag"]);
    expect(savedComponents["corner tag"]).toContain("px_h_anchored");
    expect(editor.text("haloBody")).toContain("corner tag");

    const before = doc;
    editor.haloClick("Insert");
    serveEdits();
    // An insertRaw of the stored bytes: the widget is in the file twice now.
    expect(doc).not.toBe(before);
    expect(doc.split("px_h_anchored")).toHaveLength(3);
  });

  it("a preset is saved from the inspector and applied to the whole selection as ONE batch", () => {
    const layout = openDoc(HALO, "halo.gui");
    serveEdits();
    const anchored = centreOf(layout, "px_h_anchored");
    editor.click(anchored.x, anchored.y);
    serveWidgetInfo(editor, doc);

    const name = editor.document.querySelector<HTMLInputElement>(
      '#inspector input[placeholder="Preset name"]'
    )!;
    name.value = "corner";
    name.dispatchEvent(new (editor.document.defaultView as Window & typeof globalThis).Event("input"));
    // The button names the count, and the count is the widget's OWN rows.
    const save = [...editor.document.querySelectorAll<HTMLButtonElement>("#inspector button")].find((b) =>
      (b.textContent ?? "").startsWith("Save ")
    )!;
    save.click();
    serveEdits();

    expect(Object.keys(savedPresets)).toEqual(["corner"]);
    const saved = savedPresets["corner"];
    expect(saved.map((p) => p.key)).toContain("parentanchor");
    // Inherited rows are another file's bytes and are not part of a preset.
    expect(saved.every((p) => p.value.length > 0)).toBe(true);

    editor.button("Devtools").click();
    editor.button("Saved").click();
    serveEdits();
    const button = centreOf(layoutOf(doc), "px_h_button");
    editor.click(button.x, button.y);
    editor.click(anchored.x, anchored.y, { shiftKey: true });
    editor.haloClick("Apply");
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toHaveLength(2);
    expect(editor.sent.filter((m) => m.type === "applyOps")).toHaveLength(1);
    expect(doc).toContain("parentanchor = bottom|right");
    // The other member took the preset too.
    expect(doc.split("parentanchor = bottom|right")).toHaveLength(3);
  });

  it("forgetting a component leaves the document alone", () => {
    const layout = openDoc(HALO, "halo.gui");
    serveEdits();
    savedComponents = { spare: 'widget = { name = "px_spare" size = { 4 4 } }\n' };
    editor.button("Devtools").click();
    editor.button("Saved").click();
    serveEdits();
    expect(editor.text("haloBody")).toContain("spare");

    const before = doc;
    editor.click(centreOf(layout, "px_h_anchored").x, centreOf(layout, "px_h_anchored").y);
    editor.haloClick("Forget");
    serveEdits();
    expect(savedComponents).toEqual({});
    expect(doc).toBe(before);
  });
});

describe("the texture inspector", () => {
  it("reports the sheet's size and its frame grid for the selected widget", () => {
    const sheetDoc = [
      'icon = { name = "px_ti_icon"',
      "\tposition = { 0 0 }",
      "\tsize = { 32 32 }",
      '\ttexture = "gfx/px_fixtures/framestrip.dds"',
      "\tframesize = { 32 32 }",
      "\tframe = 3",
      "}",
      "",
    ].join("\n");
    openDoc(sheetDoc, "sheet.gui");
    serveEdits();
    editor.button("Devtools").click();
    editor.button("Texture").click();
    editor.click(16, 16);
    serveWidgetInfo(editor, doc);

    const body = editor.text("haloBody");
    expect(body).toContain("framestrip.dds");
    expect(body).toContain("fill:");
    // No roots in this stub, so the header could not be read: the panel says
    // that rather than drawing a grid it cannot justify.
    expect(body).toContain("not found under any root");
  });

  it("says plainly when the widget draws nothing", () => {
    const layout = openHalo();
    editor.button("Texture").click();
    const at = centreOf(layout, "px_h_anchored");
    editor.click(at.x, at.y);
    serveWidgetInfo(editor, doc);
    expect(editor.text("haloBody")).toContain("draws no texture");
  });
});

// ── round 2: the inspector reads, adds and edits in place ───────────────────

/**
 * A widget with the three shapes round 2 is about: a long value (what a display
 * mode abbreviates), a block value (what the sub-editor takes apart), and room
 * for a property it does not carry yet.
 */
const INSPECT = [
  "widget = {",
  '\tname = "px_r2_root"',
  "\tsize = { 400 300 }",
  "\twidget = {",
  '\t\tname = "px_r2_card"',
  "\t\tposition = { 20 20 }",
  "\t\tsize = { 120 60 }",
  "\t\tbackground = { using = Background_Area_Dark alpha = 0.7 }",
  "\t}",
  "}",
  "",
].join("\n");

/** Open INSPECT, select the card, and answer both reads the panel makes. */
function openInspect(): void {
  openDoc(INSPECT, "inspect.gui");
  serveEdits();
  editor.click(80, 50);
  expect(editor.selectedRow()).toContain("px_r2_card");
  serveWidgetInfo(editor, doc);
}

describe("how much of a value the inspector shows", () => {
  it("cycles full -> abbreviated -> hidden, and abbreviated keeps the whole value on hover", () => {
    openInspect();
    expect(editor.rowInput("background")!.value).toContain("Background_Area_Dark");

    editor.button("Values: full").click();
    // A LABEL, not a short input value: an input holds what a commit would
    // write, and an ellipsis is not something this editor may write.
    expect(editor.rowInput("background")).toBeNull();
    const label = editor.propRow("background")!.querySelector<HTMLElement>(".val.short")!;
    expect(label.textContent).toContain("…");
    expect(label.title).toContain("{ using = Background_Area_Dark alpha = 0.7 }");
    // A short value has nothing to abbreviate, so it stays editable.
    expect(editor.rowInput("position")!.value).toBe("{ 20 20 }");

    editor.button("Values: abbreviated").click();
    expect(editor.text("inspector")).toContain("background");
    expect(editor.text("inspector")).not.toContain("0.7");
    expect(editor.text("inspector")).not.toContain("{ 20 20 }");

    editor.button("Values: hidden").click();
    expect(editor.rowInput("background")!.value).toContain("Background_Area_Dark");
  });

  it("clicking an abbreviated value opens that one row for editing", () => {
    openInspect();
    editor.button("Values: full").click();
    editor.clickIn(editor.propRow("background")!, ".val.short");
    expect(editor.rowInput("background")!.value).toBe("{ using = Background_Area_Dark alpha = 0.7 }");
    // That row alone: the mode is untouched, so the others are still labels.
    expect(editor.button("Values: abbreviated")).toBeTruthy();
  });

  it("the host is told, and it is what the NEXT panel boots with", () => {
    openInspect();
    editor.button("Values: full").click();
    serveEdits();
    expect(lastOfType(editor, "setUiState")).toEqual({ type: "setUiState", valueMode: "abbreviated" });
    expect(storedUi).toEqual({ valueMode: "abbreviated" });

    // A second panel, opened with what the host kept.
    editor.close();
    editor = bootEditor();
    editor.push({
      type: "layout",
      file: "inspect.gui",
      result: layoutOf(INSPECT),
      textures: {},
      ui: storedUi,
    });
    editor.click(80, 50);
    serveWidgetInfo(editor, INSPECT);
    expect(editor.button("Values: abbreviated")).toBeTruthy();
    expect(editor.rowInput("background")).toBeNull();

    // Adopted once: a later layout carrying nothing does not undo it, which is
    // what keeps a push already in flight from fighting the user.
    editor.push({ type: "layout", file: "inspect.gui", result: layoutOf(INSPECT), textures: {} });
    expect(editor.button("Values: abbreviated")).toBeTruthy();
  });
});

describe("adding a property", () => {
  it("completes from the harvested vocabulary for this widget's type", () => {
    openInspect();
    editor.typeRow("+name", "vis", false);
    const offered = editor.suggestions();
    expect(offered).toContain("visible");
    // Harvested, not invented: every offer is a name guiVocabulary answered with.
    const vocabulary = computeGuiVocabulary(doc, CK3_GUI_SCHEMA);
    const known = new Set([
      ...Object.values(vocabulary.properties ?? {}).flat(),
      ...(vocabulary.commonProperties ?? []),
    ]);
    expect(offered.filter((name) => !known.has(name))).toEqual([]);
    // A property the widget already carries is an edit of its row, not an add.
    editor.typeRow("+name", "siz", false);
    expect(editor.suggestions()).not.toContain("size");
  });

  it("picking a completion and committing writes ONE guarded op into the widget's body", () => {
    openInspect();
    editor.typeRow("+name", "vis", false);
    editor.pickSuggestion("visible");
    editor.typeRow("+value", "no", false);
    editor.button("Add").click();

    const check = lastOfType(editor, "checkEdit")!;
    expect(check.properties).toEqual([{ key: "visible", value: "no" }]);
    serveEdits();
    const apply = lastOfType(editor, "applyEdit")!;
    expect(apply.properties).toEqual([{ key: "visible", value: "no" }]);
    serveEdits();
    // Into the card's own body, and nothing else in the file moved.
    expect(doc).toBe(INSPECT.replace("\t}\n}", "\t\tvisible = no\n\t}\n}"));
  });

  it("offers the engine's own anchor words as values, and never anything else", () => {
    openInspect();
    editor.typeRow("+name", "parentanchor", false);
    const options = editor.valueOptions();
    // The nine cells of the layout engine's own anchor table (anchorSpec).
    expect(options).toHaveLength(9);
    expect(options).toContain("center");
    expect(options).toContain("bottom|right");
    const words = new Set([...ANCHOR_X, ...ANCHOR_Y, "center"]);
    expect(options.every((spec) => spec.split("|").every((word) => words.has(word)))).toBe(true);
  });

  it("a refusal is the server's, and nothing is written", () => {
    // A vbox child with no position of its own: the row is addable, and the
    // guards are what turn it down.
    const layout = openDoc(GROUP, "group.gui");
    serveEdits();
    const at = centreOf(layout, "px_g5_boxed");
    editor.click(at.x, at.y);
    serveWidgetInfo(editor, doc);

    editor.typeRow("+name", "position", false);
    editor.typeRow("+value", "{ 40 40 }", false);
    editor.button("Add").click();
    serveEdits();
    expect(editor.toast()).toContain("places its children itself");
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(doc).toBe(GROUP);
  });
});

describe("a block value, as rows", () => {
  it("expands into one row per inner key and commits the recomposed block as ONE write", () => {
    openInspect();
    editor.clickIn(editor.propRow("background")!, ".twisty");
    // Two keys plus the row that adds a third.
    expect(editor.propRow("background")!.querySelectorAll(".block .line")).toHaveLength(3);

    editor.typeRow("background.1.value", "0.4");
    serveEdits();
    const apply = lastOfType(editor, "applyEdit")!;
    expect(apply.properties).toEqual([
      { key: "background", value: "{ using = Background_Area_Dark alpha = 0.4 }" },
    ]);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(1);
    expect(doc).toContain("background = { using = Background_Area_Dark alpha = 0.4 }");
  });

  it("a removed key and an added one are each one write of the whole block", () => {
    openInspect();
    editor.clickIn(editor.propRow("background")!, ".twisty");
    editor.clickIn(editor.propRow("background")!, ".block .toggle");
    serveEdits();
    expect(doc).toContain("background = { alpha = 0.7 }");
    serveWidgetInfo(editor, doc);

    editor.typeRow("background.new.key", "texture", false);
    editor.typeRow("background.new.value", '"gfx/px/plate.dds"', false);
    editor.button("Add key").click();
    serveEdits();
    expect(doc).toContain('background = { alpha = 0.7 texture = "gfx/px/plate.dds" }');
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(2);
  });

  it("a bare pair keeps its plain row: there is nothing to take apart", () => {
    openInspect();
    expect(editor.propRow("size")!.querySelector(".twisty")).toBeNull();
    expect(editor.propRow("background")!.querySelector(".twisty")).not.toBeNull();
  });
});

describe("the inspector holds its place across the re-layout a commit causes", () => {
  it("keeps the scroll offset, the open sub-editor and the caret", () => {
    openInspect();
    editor.clickIn(editor.propRow("background")!, ".twisty");
    editor.scrollPanel("inspector", 120);

    editor.typeRow("position", "{ 30 30 }");
    serveEdits();
    serveWidgetInfo(editor, doc);
    expect(doc).toContain("position = { 30 30 }");

    // The panel the user was reading is the panel they get back.
    expect(editor.scrollOf("inspector")).toBe(120);
    expect(editor.propRow("background")!.querySelectorAll(".block .line").length).toBeGreaterThan(0);
    expect(editor.focusedRow()).toBe("position");
  });

  it("keeps text typed into a sibling field that was never committed", () => {
    openInspect();
    // Half-typed add-property name, then a commit elsewhere rebuilds the rows.
    editor.typeRow("+name", "vis", false);
    editor.typeRow("position", "{ 30 30 }");
    serveEdits();
    serveWidgetInfo(editor, doc);
    expect(editor.field("+name")!.value).toBe("vis");
  });

  it("goes back to the top for a different widget, whose rows it has never scrolled", () => {
    openInspect();
    editor.clickIn(editor.propRow("background")!, ".twisty");
    editor.scrollPanel("inspector", 120);

    // The root, not the card: another widget's rows entirely.
    editor.click(300, 200);
    expect(editor.selectedRow()).toContain("px_r2_root");
    serveWidgetInfo(editor, doc);
    expect(editor.scrollOf("inspector")).toBe(0);
    expect(editor.propRow("size")!.querySelector(".block")).toBeNull();
  });
});

// ── Increment 1: canvas feel ────────────────────────────────────────────────

/** A real wait, because the nudge burst is a trailing timer on the page's own clock. */
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** nudge.ts NUDGE_BURST_MS plus a margin. */
const BURST = 320;

describe("arrow-key nudges", () => {
  it("a burst of keys is ONE op, previewed key by key, and never two in flight", async () => {
    const layout = openGroup();
    withoutGuides();
    const a = centreOf(layout, "px_g5_a");
    editor.click(a.x, a.y);

    editor.key("ArrowRight");
    editor.key("ArrowRight");
    editor.key("ArrowRight");
    editor.key("ArrowDown", { shiftKey: true });
    // The preview and the readout move at once; the document has not.
    expect(editor.text("status")).toContain("position = { 13 20 }");
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);

    await tick(BURST);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(1);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 13 20 }" }]);

    // The commit is still unanswered: the next burst waits for it.
    editor.key("ArrowLeft", { altKey: true });
    await tick(BURST);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(1);
    serveEdits();
    expect(doc).toContain('name = "px_g5_a" position = { 13 20 }');
    await tick(BURST);
    // Alt is one grid step, added to the FRESH source value the layout brought.
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(2);
    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 5 20 }" }]);
    serveEdits();
    expect(doc).toContain('name = "px_g5_a" position = { 5 20 }');
  });

  it("a multi-selection nudges as ONE batch, and Escape drops an unwritten one", async () => {
    const layout = openGroup();
    const a = centreOf(layout, "px_g5_a");
    const b = centreOf(layout, "px_g5_b");
    editor.click(a.x, a.y);
    editor.click(b.x, b.y, { shiftKey: true });

    editor.key("ArrowDown");
    editor.key("Escape");
    await tick(BURST);
    expect(editor.sent.filter((m) => m.type === "applyOps")).toHaveLength(0);
    // Escape took the nudge, not the selection.
    expect(editor.selectedRows("tree")).toHaveLength(2);

    editor.key("ArrowDown");
    editor.key("ArrowDown");
    await tick(BURST);
    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toEqual([
      { kind: "setProperties", line: 0, properties: [{ key: "position", value: "{ 10 12 }" }] },
      { kind: "setProperties", line: 1, properties: [{ key: "position", value: "{ 100 32 }" }] },
    ]);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    serveEdits();
    expect(doc).toContain('name = "px_g5_a" position = { 10 12 }');
    expect(doc).toContain('name = "px_g5_b" position = { 100 32 }');
  });
});

describe("resizing a multi-selection", () => {
  it("the grips sit on the selection's bounds and write one size per member in ONE batch", () => {
    const layout = openGroup();
    withoutGuides();
    const a = centreOf(layout, "px_g5_a");
    const b = centreOf(layout, "px_g5_b");
    editor.click(a.x, a.y);
    editor.click(b.x, b.y, { shiftKey: true });

    // a is 10,10 40x40 and b is 100,30 40x40: the bounds' south-east corner.
    editor.press(140, 70);
    const check = lastOfType(editor, "checkOps")!;
    expect(
      check.ops.map((op) => (op.kind === "setProperties" ? op.properties.map((p) => p.key) : []))
    ).toEqual([["size"], ["size"]]);
    serveEdits();
    editor.move(160, 80);
    editor.up(160, 80);
    serveEdits();

    const apply = lastOfType(editor, "applyOps")!;
    expect(apply.ops).toEqual([
      { kind: "setProperties", line: 1, properties: [{ key: "size", value: "{ 60 50 }" }] },
      { kind: "setProperties", line: 0, properties: [{ key: "size", value: "{ 60 50 }" }] },
    ]);
    expect(editor.sent.filter((m) => m.type === "applyEdit")).toHaveLength(0);
    expect(doc).toContain('name = "px_g5_a" position = { 10 10 } size = { 60 50 }');
    expect(doc).toContain('name = "px_g5_b" position = { 100 30 } size = { 60 50 }');
  });
});

describe("smart guides, increment 1", () => {
  it("a drag snaps to the parent's own edge when there is no sibling to align to", () => {
    const layout = openGroup();
    const inner = centreOf(layout, "px_g5_inner");
    editor.click(inner.x, inner.y);
    editor.press(inner.x, inner.y);
    serveEdits();
    // 8 left puts the left edge 2 short of the frame's; 30 down is nowhere near it.
    editor.move(inner.x - 8, inner.y + 30);
    editor.up(inner.x - 8, inner.y + 30);
    serveEdits();

    expect(lastOfType(editor, "applyEdit")!.properties).toEqual([{ key: "position", value: "{ 0 40 }" }]);
    expect(doc).toContain('name = "px_g5_inner" position = { 0 40 }');
  });
});

describe("the library drag, increment 1", () => {
  it("a release outside the canvas cancels, and the next drag starts clean", () => {
    const layout = openGroup();
    openLibrary();
    const frame = rectOf(layout, "px_g5_frame");
    const over = { x: frame.x + frame.w * 0.7, y: frame.y + frame.h * 0.7 };

    editor.rowPointer(editor.libraryTile("vbox"), "pointerdown");
    // The chip follows the cursor from the press on.
    expect(editor.document.querySelector(".paletteGhost")?.textContent).toBe("vbox");
    editor.move(over.x, over.y);
    expect(editor.text("status")).toContain("into widget#px_g5_frame");
    expect(editor.document.getElementById("dropTarget")!.hidden).toBe(false);

    // Released over the tree panel, say: nothing is written and nothing stays armed.
    editor.windowPointer("pointerup", { x: -40, y: 300 });
    expect(editor.sent.filter((m) => m.type === "applyOps")).toHaveLength(0);
    expect(editor.document.querySelector(".paletteGhost")).toBeNull();
    expect(editor.document.getElementById("dropTarget")!.hidden).toBe(true);
    expect(editor.text("status")).not.toContain("vbox");
    // A pointer move over the canvas with nothing armed is a hover, not a drop preview.
    editor.move(over.x, over.y);
    expect(editor.text("status")).not.toContain("into widget#px_g5_frame");

    editor.rowPointer(editor.libraryTile("vbox"), "pointerdown");
    editor.move(over.x, over.y);
    editor.up(over.x, over.y);
    serveEdits();
    expect(lastOfType(editor, "applyOps")!.ops).toEqual([
      { kind: "insert", line: 3, widget: { type: "vbox" }, index: undefined },
    ]);
  });
});

describe("Alt+drag", () => {
  it("duplicates the widget under the cursor and moves the COPY, leaving the original", () => {
    const layout = openGroup();
    withoutGuides();
    const a = centreOf(layout, "px_g5_a");
    editor.press(a.x, a.y, { altKey: true });
    serveEdits();
    editor.move(a.x + 50, a.y);
    editor.up(a.x + 50, a.y);

    // First the duplicate; the copy lands right after the original.
    expect(lastOfType(editor, "applyOps")!.ops).toEqual([{ kind: "duplicate", line: 0 }]);
    serveEdits();
    // Then the move, on the copy's own line, as the copy is now the selection.
    const move = lastOfType(editor, "applyEdit")!;
    expect(move.line).toBe(1);
    expect(move.properties).toEqual([{ key: "position", value: "{ 60 10 }" }]);
    serveEdits();
    expect(doc).toContain('name = "px_g5_a" position = { 10 10 }');
    expect(doc).toContain('name = "px_g5_a" position = { 60 10 }');
    expect(editor.selectedRow()).toContain("px_g5_a");
  });
});

describe("keyboard navigation", () => {
  it("Tab cycles siblings, Enter descends, Shift+Enter ascends, Shift+F zooms to the selection", () => {
    const layout = openGroup();
    const a = centreOf(layout, "px_g5_a");
    editor.click(a.x, a.y);
    editor.key("Tab");
    expect(editor.selectedRow()).toContain("px_g5_b");
    editor.key("Tab", { shiftKey: true });
    expect(editor.selectedRow()).toContain("px_g5_a");

    const frame = centreOf(layout, "px_g5_frame");
    editor.click(frame.x + 100, frame.y + 80);
    expect(editor.selectedRow()).toContain("px_g5_frame");
    editor.key("Enter");
    expect(editor.selectedRow()).toContain("px_g5_inner");
    editor.key("Enter", { shiftKey: true });
    expect(editor.selectedRow()).toContain("px_g5_frame");

    const before = editor.document.getElementById("zoomLabel")!.textContent;
    editor.key("F", { shiftKey: true });
    expect(editor.document.getElementById("zoomLabel")!.textContent).not.toBe(before);
    // Home fits the reference viewport again.
    editor.key("Home");
    expect(editor.document.getElementById("zoomLabel")!.textContent).toBe(before);
  });
});

describe("the toolbar, increment 1", () => {
  it("undo and redo are requests for the host's own history", () => {
    openGroup();
    editor.document.getElementById("undo")!.click();
    editor.document.getElementById("redo")!.click();
    expect(editor.sent.slice(-2)).toEqual([{ type: "undo" }, { type: "redo" }]);
  });

  it("the snap and grid toggles are remembered by the host and boot the next panel", () => {
    openGroup();
    editor.toggle("grid", true);
    serveEdits();
    expect(lastOfType(editor, "setUiState")).toEqual({
      type: "setUiState",
      valueMode: "full",
      snap: true,
      grid: true,
    });
    editor.toggle("snap", false);
    serveEdits();
    expect(storedUi).toEqual({ valueMode: "full", snap: false, grid: true });

    editor.close();
    editor = bootEditor();
    editor.push({ type: "layout", file: "group.gui", result: layoutOf(GROUP), textures: {}, ui: storedUi });
    expect((editor.document.getElementById("grid") as HTMLInputElement).checked).toBe(true);
    expect((editor.document.getElementById("snap") as HTMLInputElement).checked).toBe(false);
  });
});

// ---- textbox text: resolved by default, raw on request ----------------------

const LOC_TEXT = [
  "widget = {",
  '\tname = "px_loc_frame"',
  "\tsize = { 400 300 }",
  '\ttextbox = { name = "px_loc_known" position = { 10 10 } size = { 200 30 } text = "px_known_key" }',
  '\ttextbox = { name = "px_loc_missing" position = { 10 50 } size = { 200 30 } text = "px_missing_key" }',
  '\ttextbox = { name = "px_loc_fn" position = { 10 90 } size = { 200 30 } text = "[GetPlayer.GetName]" }',
  '\twidget = { name = "px_loc_plain" position = { 10 130 } size = { 200 30 } }',
  "}",
].join("\n");

/** The stub host's loc index and preview table: what the REAL resolver reads. */
let storedPreviewValues: Record<string, string> = {};
const locIndex = (key: string): string | undefined => (key === "px_known_key" ? "Hello there" : undefined);

/** A layout the way `panel.ts` requests one: the stored loc mode and preview table ride along. */
function serveLocLayout(text = LOC_TEXT): GuiLayoutResult {
  doc = text;
  docFile = "loc.gui";
  const resolve =
    storedUi?.loc === "raw"
      ? undefined
      : (raw: string) => resolveGuiText(raw, { loc: locIndex, previewValues: storedPreviewValues });
  const result = computeGuiLayoutResult(text, null, null, [], [], undefined, resolve);
  editor.push({
    type: "layout",
    file: "loc.gui",
    result,
    textures: {},
    ui: storedUi,
    previewValues: storedPreviewValues,
  });
  return result;
}

function textOf(result: GuiLayoutResult, name: string): string | undefined {
  return result.nodes[0].children.find((n) => n.name === name)?.text?.text;
}

function textTip(): string | null {
  const node = editor.document.getElementById("textTip")!;
  return node.hasAttribute("hidden") ? null : (node.textContent ?? "");
}

describe("textbox text", () => {
  beforeEach(() => {
    storedPreviewValues = {};
  });

  it("is resolved by default, and an unresolved key or datafunction paints muted and dotted", () => {
    editor.paint.reset();
    const layout = serveLocLayout();
    expect(textOf(layout, "px_loc_known")).toBe("Hello there");
    expect(editor.paint.strokes).toContain(UNRESOLVED_TEXT);

    // Nothing to underline once the whole document resolves.
    storedPreviewValues = { "[GetPlayer.GetName]": "Alice" };
    editor.paint.reset();
    const resolved = serveLocLayout(LOC_TEXT.replace("px_missing_key", "px_known_key"));
    expect(textOf(resolved, "px_loc_fn")).toBe("Alice");
    expect(editor.paint.strokes).not.toContain(UNRESOLVED_TEXT);
  });

  it("the Raw toggle is remembered by the host and asks for a layout in that mode", () => {
    serveLocLayout();
    editor.document.getElementById("locRaw")!.click();
    serveEdits();
    expect(editor.sent.slice(-2)).toEqual([
      { type: "setUiState", valueMode: "full", loc: "raw" },
      { type: "requestLayout" },
    ]);
    expect(storedUi?.loc).toBe("raw");
    const layout = serveLocLayout();
    expect(textOf(layout, "px_loc_known")).toBe("px_known_key");
    expect(editor.document.getElementById("locRaw")!.getAttribute("aria-pressed")).toBe("true");

    // The next panel boots in the stored mode without being told twice.
    editor.close();
    editor = bootEditor();
    serveLocLayout();
    expect(editor.document.getElementById("locRaw")!.getAttribute("aria-pressed")).toBe("true");
    expect(editor.document.getElementById("locResolved")!.getAttribute("aria-pressed")).toBe("false");
    expect(editor.sent.filter((m) => m.type === "requestLayout")).toEqual([]);
  });

  it("hovering a textbox explains each segment; a plain widget has no tooltip", () => {
    const layout = serveLocLayout();
    const known = rectOf(layout, "px_loc_known");
    editor.move(known.x + 20, known.y + 10);
    expect(textTip()).toContain("loc");
    expect(textTip()).toContain("px_known_key");
    expect(textTip()).toContain("Hello there");

    const missing = rectOf(layout, "px_loc_missing");
    editor.move(missing.x + 20, missing.y + 10);
    expect(textTip()).toContain("px_missing_key");
    expect(textTip()).toContain("not localized");

    const fn = rectOf(layout, "px_loc_fn");
    editor.move(fn.x + 20, fn.y + 10);
    expect(textTip()).toContain("datafn");
    expect(textTip()).toContain("[GetPlayer.GetName]");
    expect(textTip()).toContain("resolved by the game at runtime");

    const plain = rectOf(layout, "px_loc_plain");
    editor.move(plain.x + 20, plain.y + 10);
    expect(textTip()).toBeNull();
  });

  it("the inspector shows what a key resolved to, and offers to create a missing one", () => {
    const layout = serveLocLayout();
    const known = rectOf(layout, "px_loc_known");
    editor.click(known.x + 20, known.y + 10);
    serveWidgetInfo(editor, doc);
    const row = editor.propRow("text")!;
    expect(row.textContent).toContain("shows: Hello there");
    expect(row.querySelector("button")).toBeNull();

    const missing = rectOf(layout, "px_loc_missing");
    editor.click(missing.x + 20, missing.y + 10);
    serveWidgetInfo(editor, doc);
    editor.button("Create localization").click();
    expect(lastOfType(editor, "editLoc")).toEqual({ type: "editLoc", key: "px_missing_key" });
  });

  it("a datafunction takes a preview value from the inspector, and gives it back", () => {
    const layout = serveLocLayout();
    const fn = rectOf(layout, "px_loc_fn");
    editor.click(fn.x + 20, fn.y + 10);
    serveWidgetInfo(editor, doc);
    editor.button("Set preview value…").click();
    const input = editor.document.querySelector<HTMLInputElement>('.px-popover [data-row="+previewValue"]')!;
    expect(input).not.toBeNull();
    input.value = "Alice";
    input.dispatchEvent(
      new editor.document.defaultView!.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(lastOfType(editor, "setPreviewValue")).toEqual({
      type: "setPreviewValue",
      expression: "GetPlayer.GetName",
      value: "Alice",
    });

    // The host wrote the table and laid the document out with it.
    storedPreviewValues = { "[GetPlayer.GetName]": "Alice" };
    const next = serveLocLayout();
    expect(textOf(next, "px_loc_fn")).toBe("Alice");
    serveWidgetInfo(editor, doc);
    expect(editor.propRow("text")!.textContent).toContain("shows: Alice");
    editor.button("Preview value: Alice").click();
    expect(lastOfType(editor, "clearPreviewValue")).toEqual({
      type: "clearPreviewValue",
      expression: "GetPlayer.GetName",
    });
  });
});
