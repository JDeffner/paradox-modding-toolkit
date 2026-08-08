/**
 * PdxGui layout engine: turn a .gui document into absolute-positioned
 * rectangles, the model behind the GUI designer's canvas.
 *
 * Every layout rule here is MEASURED, not guessed: the authority is
 * docs/gui-designer/calibration/spec.md, and rule comments cite their batch
 * ("B2-I1" = calibration batch 02, case I1). Where the spec is silent the
 * comment says "unmeasured" and names the assumption — those are the first
 * candidates for a future calibration batch when a rendering looks wrong.
 *
 * Scope (phase 1): structural widgets, boxes with layout policies,
 * flowcontainer, container, margin_widget, scrollarea, textboxes with the
 * calibrated font metrics, template/type/blockoverride resolution.
 * Phase 2 (presentation, NOT calibrated pixel rules): datamodel-list ghost
 * placeholders, nine-slice `spriteborder` geometry on fills, and confirmed
 * exclusion of `state = {}` transition blocks from layout.
 * Phase 3 (G2 layout merge): the rules spec.md carries under "Studio-verified
 * engine behaviors", namely grid box flow and cell math, clipping containers,
 * `ignoreinvisible`, `resizeparent`, container/item content sizing, sprite
 * fill MODE and frame sheets. Those comments cite the spec bullet's own
 * source tag plus the parity-checklist row, e.g. "(Studio §K v3, L14a)";
 * docs/gui-designer/parity-checklist.md is the row index. Three rows are
 * DISPUTED between the two engines (L07c state-supplied position, L13e sized
 * flowcontainer, L23 position on a box child) and are deliberately NOT
 * implemented: both sides measured, so the checklist asks for a re-run rather
 * than letting one engine overwrite the other.
 *
 * No `vscode` imports: unit-tested in plain Node (test/guiLayout.test.ts
 * holds the golden fixtures derived from the calibration screenshots).
 */
import { LineIndex, parseScript, type BlockNode, type ScalarNode, type Statement } from "../parser";
import { collectBlockOverrides, collectGuiDefs, emptyGuiDefs, expandWidget, type GuiDefs } from "./guiDefs";

// ---------------------------------------------------------------------------
// Public model
// ---------------------------------------------------------------------------

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How a texture fills its rect. Nine-slicing needs BOTH a `Cornered*`
 * spriteType AND a non-zero `spriteborder`; a border on its own is IGNORED and
 * the whole texture plain-stretches, and a `*tiled*` type without a border
 * tiles the whole texture. Nine-sliced edges then tile or stretch with the
 * type. (Studio §J1-J7, in-game 2026-07-17; L21a-d.)
 */
export type FillMode = "stretch" | "tile" | "nineslice-stretch" | "nineslice-tile";

export interface Fill {
  texture?: string;
  /** rgba 0..1; rendered = round(v*255), straight sRGB multiply (B1-G). */
  color?: [number, number, number, number];
  /**
   * Nine-slice border widths [left, top, right, bottom] in texture pixels,
   * sourced from the `spriteborder`/`spriteborder_<side>` .gui attributes.
   * The values are read straight from the document, not a calibrated layout
   * rule; `mode` is what says whether they APPLY (a border without a
   * `Cornered*` type does not, Studio §J4).
   */
  border?: [number, number, number, number];
  /**
   * Fill mode from `spriteType` + `spriteborder` (Studio §J, L21a-d). Set on
   * every textured fill. `nineslice-*` means computeNineSlice's regions apply,
   * with edges tiled or stretched per the suffix; `tile` repeats the whole
   * texture; `stretch` scales it to the rect.
   */
  mode?: FillMode;
  /** `framesize = { w h }` grid cell size when the texture is a frame sheet (Studio §L, L22). */
  framesize?: [number, number];
  /** 1-based `frame` index into that grid, clamped by computeFrameCell (Studio §L, L22). */
  frame?: number;
}

export interface TextInfo {
  text: string;
  fontsize: number;
  /** Ink offset of the text run inside the widget rect (align; B4-T6). */
  offsetX: number;
  offsetY: number;
  lines: string[];
  /** Font color when the textbox sets one (rgba 0..1). */
  color?: [number, number, number, number];
}

export interface LayoutNode {
  key: string;
  name?: string;
  /** Absolute rect in canvas coordinates. */
  rect: LayoutRect;
  /** True for scrollarea viewports — the only measured clipper (B3-R1). */
  clip: boolean;
  bg?: Fill;
  /** The widget's own texture fill (icon, textured widgets/buttons). */
  fill?: Fill;
  text?: TextInfo;
  /**
   * 0-based source line of the instance statement in the CURRENT document.
   * Children spliced in from type definitions inherit their instance
   * ancestor's line (their own statements live in other files).
   */
  line?: number;
  /**
   * True when the widget was placed by anchor+position rules (its `position`
   * is honored, so it is draggable). False for children whose rect is
   * dictated by a box/flow parent.
   */
  positioned: boolean;
  /**
   * True when `line` is the widget's OWN statement in the current document
   * (safe to edit). False for children spliced from type definitions, whose
   * `line` is the instance ancestor's — editing those would modify the
   * wrong widget.
   */
  editable: boolean;
  /** Raw `position = { x y }` source values, when present. */
  srcPosition?: [number, number];
  /** Raw `size = { w h }` source values, when present (may be % — see sizePct). */
  srcSize?: [number, number];
  /**
   * True for placeholder copies of a datamodel item template: the list has no
   * real runtime data in the preview, so GHOST_COUNT reduced-opacity instances
   * stand in. Presentation only, propagated to the whole ghost subtree.
   */
  ghost?: boolean;
  children: LayoutNode[];
}

/**
 * How a widget's rect came to be, recorded only when a caller asks for it.
 * Structurally identical to the wire types (`GuiPlacementTerm`, `GuiPlacedBy`,
 * `GuiPlacement`), like LayoutNode is to GuiLayoutNode.
 */
export interface PlacementTerm {
  kind: "parentOrigin" | "parentanchor" | "widgetanchor" | "position";
  source?: string;
  dx: number;
  dy: number;
}
export interface PlacedBy {
  key: string;
  name?: string;
  layout: "box" | "flow" | "grid";
  droppedPosition?: [number, number];
}
export interface Placement {
  rect: LayoutRect;
  parentRect: LayoutRect;
  terms: PlacementTerm[];
  placedBy?: PlacedBy;
  clippedBy?: { key: string; name?: string; rect: LayoutRect };
}

/**
 * Placement-explanation request AND sink: name the widget's own 0-based line,
 * read `result` after the run. Passing one is what turns the trace on; without
 * it `arrange` pays a single truthy test per node and allocates nothing.
 */
export interface PlacementExplain {
  line: number;
  result?: Placement;
}

/** Ancestor facts the trace needs, built only while explaining. */
interface ExplainChain {
  sink: PlacementExplain;
  parent?: WNode;
  /** The rect the parent laid its children in (for a container-placed child). */
  parentRect?: LayoutRect;
  /** The innermost clipping ancestor above this node. */
  clip?: { key: string; name?: string; rect: LayoutRect };
}

/**
 * How the layout treats a widget whose `visible` holds an expression a static
 * preview cannot evaluate. Structurally the wire's `GuiVisibilityOptions`.
 * `visible = no` / `visible = yes` are deterministic and unaffected.
 */
export interface VisibilityOptions {
  mode: "showAll" | "hideAll" | "evaluate";
  /** `evaluate` only: condition source string -> shown/hidden. */
  checks?: Record<string, boolean>;
}

/** One conditional `visible` the run met (the wire's `GuiVisibilityCheck`). */
export interface VisibilityCheck {
  key: string;
  count: number;
  hidden: boolean;
}

/** Per-stage wall clock, filled in when a caller passes one. */
export interface LayoutTiming {
  /** Parsing the document and collecting its own template/type declarations. */
  parseMs: number;
  /** Building the widget tree and arranging every rect. */
  layoutMs: number;
}

/**
 * Number of placeholder rows drawn for a datamodel-driven list (unmeasured:
 * a preview affordance, capped per ghostCount so it never overruns a container
 * whose own size is known). GHOST_OPACITY is applied by the client renderer.
 */
export const GHOST_COUNT = 3;
export const GHOST_OPACITY = 0.45;

/**
 * Sprite fill geometry lives in its own leaf module so the canvas renderer can
 * bundle it without the parser behind it, and re-exports here because it is
 * part of this model's published surface.
 */
export { computeFrameCell, computeNineSlice, type NineSliceRegion } from "./fillGeometry";

/**
 * Fill mode: nine-slice iff a `Cornered*` type AND a non-zero border,
 * otherwise tile for a `*tiled*` type, else stretch (Studio §J, L21a-d).
 */
function fillMode(spriteType: string | undefined, border?: [number, number, number, number]): FillMode {
  const type = spriteType?.toLowerCase() ?? "";
  const tiled = type.includes("tiled");
  const cornered = type.startsWith("cornered") && (border?.some((v) => v > 0) ?? false);
  if (cornered) return tiled ? "nineslice-tile" : "nineslice-stretch";
  return tiled ? "tile" : "stretch";
}

export interface TextMeasurer {
  /** Advance-model width of one line: (n-1)*advance + ink(last). (B2-L) */
  lineWidth(text: string, fontsize: number): number;
  /** Line box height; 21 at fontsize 15, scales linearly. (B1-G, B3-S3) */
  lineHeight(fontsize: number): number;
}

/**
 * Metrics measured for Gitan-Regular (StandardGameFont) at fontsize 15 in
 * batches 01-03. Glyphs outside the measured set use a rough default — fine
 * for layout previews, exact for the fixture strings.
 */
const GLYPHS: Record<string, { adv: number; ink: number }> = {
  M: { adv: 14, ink: 13 }, // B1-G, B2-L
  i: { adv: 4, ink: 4 }, // B1-G, B2-L
  " ": { adv: 4, ink: 0 }, // B3-S2
};
const DEFAULT_GLYPH = { adv: 9, ink: 8 }; // unmeasured average guess

export const calibratedMeasurer: TextMeasurer = {
  lineWidth(text, fontsize) {
    if (text.length === 0) return 0;
    const s = fontsize / 15; // metrics scale exactly linearly (B3-S3)
    let w = 0;
    for (let n = 0; n < text.length; n++) {
      const g = GLYPHS[text[n]] ?? DEFAULT_GLYPH;
      w += n === text.length - 1 ? g.ink : g.adv;
    }
    return w * s;
  },
  lineHeight(fontsize) {
    return 21 * (fontsize / 15); // B1-G, B3-S3
  },
};

export interface LayoutOptions {
  /** Rect the top-level widgets are laid out against. */
  viewport?: { w: number; h: number };
  measurer?: TextMeasurer;
  /**
   * Cross-file template/type store (vanilla + mod, FIOS-merged via
   * guiDefs.mergeGuiDefs). The current document's own declarations are always
   * collected on top: store entries win for globals (FIOS), the file's
   * local_templates win locally.
   */
  defs?: GuiDefs;
  /** Conditional-visibility preview mode; absent = `showAll` (today's rule). */
  visibility?: VisibilityOptions;
  /** Filled with every conditional `visible` met, key -> count + outcome. */
  checks?: Map<string, VisibilityCheck>;
  /** Record why ONE widget's rect is where it is; absent = no trace. */
  explain?: PlacementExplain;
  /** Filled with this run's per-stage wall clock; absent = no measurement. */
  timing?: LayoutTiming;
}

export function computeGuiLayout(text: string, options?: LayoutOptions): LayoutNode[] {
  const viewport = options?.viewport ?? { w: 1920, h: 1080 };
  const measurer = options?.measurer ?? calibratedMeasurer;
  const t0 = options?.timing ? performance.now() : 0;
  const result = parseScript(text);
  const consts = collectConstants(result.root.statements);
  const defs = effectiveDefs(text, options?.defs);
  const lineIndex = new LineIndex(text);
  const ctx: BuildCtx = {
    consts,
    defs,
    overrides: new Map(),
    stack: [],
    lineOf: (offset) => lineIndex.positionAt(offset).line,
    visibility: options?.visibility,
    checks: options?.checks ?? new Map(),
  };
  const t1 = options?.timing ? performance.now() : 0;
  const widgets = collectWidgets(result.root.statements, ctx);
  const root: LayoutRect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
  const chain: ExplainChain | undefined = options?.explain ? { sink: options.explain } : undefined;
  const nodes = widgets.map((w) => arrange(w, root, "plain", measurer, undefined, chain));
  if (options?.timing) {
    options.timing.parseMs = t1 - t0;
    options.timing.layoutMs = performance.now() - t1;
  }
  return nodes;
}

/**
 * The def store a document is laid out against: the cross-file store with the
 * document's OWN declarations layered in (its local_templates always win, other
 * names only when the store has none, FIOS). Exported so a reader about the
 * same document resolves the same names the rendering did.
 */
export function effectiveDefs(text: string, store?: GuiDefs): GuiDefs {
  const own = collectGuiDefs(text);
  if (!store) return own;
  const merged = emptyGuiDefs();
  for (const [k, v] of store.types) merged.types.set(k, v);
  for (const [k, v] of own.types) if (!merged.types.has(k)) merged.types.set(k, v);
  for (const [k, v] of store.templates) merged.templates.set(k, v);
  for (const [k, v] of own.templates) {
    if (v.local || !merged.templates.has(k)) merged.templates.set(k, v);
  }
  return merged;
}

/** Top-level `@name = 42` gui constants, referenced as `@name` in values. */
function collectConstants(statements: Statement[]): Map<string, number> {
  const consts = new Map<string, number>();
  for (const stmt of statements) {
    if (stmt.kind !== "assignment" || !stmt.key.text.startsWith("@")) continue;
    if (stmt.value?.kind !== "scalar") continue;
    const v = parseFloat(stmt.value.text);
    if (Number.isFinite(v)) consts.set(stmt.key.text, v);
  }
  return consts;
}

// ---------------------------------------------------------------------------
// CST -> raw widget nodes
// ---------------------------------------------------------------------------

export type WidgetClass =
  | "plain" // widget, window, button, icon, ... : explicit size or ZERO (B4-T1)
  | "box" // hbox, vbox
  | "flow" // flowcontainer
  | "container" // container: hugs at origin, empty = 0 (B2-I4, L25)
  | "item" // datamodel item template: content-sizes like a container (L10)
  | "grid" // fixedgridbox / dynamicgridbox (L14, L15)
  | "marginwidget" // margin offsets children (B3-Q2, B4-T3)
  | "scrollarea" // scrollarea / scrollbox: clips (B3-R1, L17b)
  | "textbox" // text metrics sizing
  | "expand"; // growing spacer (B4-T8)

interface WNode {
  key: string;
  cls: WidgetClass;
  /** grid only: fixedgridbox (addcolumn/addrow ARE the cell size and stride). */
  fixedCells: boolean;
  vertical: boolean; // vbox / flow direction=vertical
  props: Map<string, ScalarNode>;
  pairs: Map<string, number[]>; // size/position/margin/color number lists
  sizePct: [boolean, boolean]; // per-axis: size value is a percentage (B4-T2)
  consts: Map<string, number>;
  line?: number;
  ownLine: boolean; // line points at this widget's own statement
  /** Resolved once in the build phase, per the request's visibility mode. */
  invisible: boolean;
  bg?: Fill;
  ghost?: boolean; // placeholder copy of a datamodel item template
  /**
   * Resolved `item = {}` wrapper from a datamodel container, captured during
   * process() and stamped out as ghost copies. The wrapper NODE is kept rather
   * than spliced away: a datamodel item content-sizes to the bounding box of
   * its children the way a container does, and a gridbox needs that rect (L10).
   */
  itemTemplate?: WNode;
  children: WNode[];
}

/**
 * Attribute blocks that are data, not child widgets (a superset of
 * guiTree.ts's list: layout also reads `background`/`state`/`block` blocks).
 * `minimumsize = { w h }` belongs here and used to be walked as a phantom
 * child widget, which cost a box child a whole space-around slot (L04c).
 * Exported because `sourceModel.ts` splits widgets from properties by the same
 * set: if the writer and the engine disagreed here, a preview selection could
 * address an attribute block as if it were a widget.
 */
export const PROPERTY_BLOCKS = new Set([
  "size",
  "minimumsize",
  "position",
  "framesize",
  "spriteborder",
  "color",
  "disabledcolor",
  "uv_scale",
  "margin",
  "padding",
  "mipmaplodbias",
  "modify_texture",
  "resizeparent",
  "soundeffect",
  "cursor_properties",
  "background",
  "state",
  "animation",
  "attachanimation",
  "blockoverride",
  "block",
]);

const CLASS_BY_KEY: Record<string, WidgetClass> = {
  hbox: "box",
  vbox: "box",
  flowcontainer: "flow",
  container: "container",
  item: "item",
  fixedgridbox: "grid",
  dynamicgridbox: "grid",
  margin_widget: "marginwidget",
  scrollarea: "scrollarea",
  scrollbox: "scrollarea", // same viewport behavior; both clip (L17b)
  textbox: "textbox",
  text_single: "textbox",
  text_multi: "textbox",
  editbox: "textbox",
  expand: "expand",
};

function classify(key: string): WidgetClass {
  return CLASS_BY_KEY[key] ?? "plain";
}

/**
 * The engine's own key -> class mapping, for the WRITER's refusal guards: a
 * resize is refused on a content-sized class, a drag on a child of a layout
 * container. Exported rather than copied so a guard can never claim a rule the
 * engine does not apply. The caller resolves a type instance to its base key
 * first (`typeBaseChain`), the way `buildWNode` does.
 */
export function widgetClassOf(baseKey: string): WidgetClass {
  return classify(baseKey.toLowerCase());
}

function blockOf(stmt: Statement): BlockNode | null {
  if (stmt.kind !== "assignment" || !stmt.value) return null;
  if (stmt.value.kind === "block") return stmt.value;
  if (stmt.value.kind === "tagged-block") return stmt.value.block;
  return null;
}

/**
 * Numeric value with @constant resolution; anything unresolvable (data
 * bindings, unknown macros) becomes 0 so rects stay finite on real vanilla
 * files (verified over all 373 game .gui files).
 */
function toNumber(text: string, consts: Map<string, number>): number {
  if (text.startsWith("@")) return consts.get(text) ?? 0;
  const v = parseFloat(text);
  return Number.isFinite(v) ? v : 0;
}

function numbersIn(block: BlockNode, consts: Map<string, number>): number[] {
  const out: number[] = [];
  for (const s of block.statements) {
    if (s.kind === "value" && s.value.kind === "scalar") {
      out.push(toNumber(s.value.text, consts));
    }
  }
  return out;
}

interface BuildCtx {
  consts: Map<string, number>;
  defs: GuiDefs;
  /**
   * blockoverride map inherited from ancestor instances; outer overrides win
   * over inner ones (an instance override reaches into blocks declared deep
   * inside the type's subtree — the PoD resource-bar pattern).
   */
  overrides: Map<string, BlockNode>;
  /** Type keys currently being instantiated, to break recursion cycles. */
  stack: string[];
  /** Offset -> 0-based line in the current document. */
  lineOf: (offset: number) => number;
  /** Conditional-visibility mode; absent = showAll. */
  visibility?: VisibilityOptions;
  /** Every conditional `visible` met, accumulated across the whole document. */
  checks: Map<string, VisibilityCheck>;
}

/**
 * Subtrees that never take part in window layout. Tooltips are created
 * lazily in-engine, which is also how vanilla legally ships type cycles
 * through them (a tooltip containing its own widget type).
 */
const SKIP_SUBTREES = new Set(["tooltipwidget"]);

function buildWNode(key: string, block: BlockNode, ctx: BuildCtx, line?: number, ownLine = false): WNode {
  const lower = key.toLowerCase();
  // Cycle/depth guard: a TYPE instantiated inside its own expansion gets no
  // type expansion (instance statements + templates only), which breaks
  // mutual-recursion chains that the real engine only resolves lazily.
  // Builtin keys (widget in widget) are not cycles and are never pushed.
  const isType = ctx.defs.types.has(lower);
  const cyclic = (isType && ctx.stack.includes(lower)) || ctx.stack.length > 64;
  const { baseKey, statements } = expandWidget(lower, block, ctx.defs, cyclic);
  const node: WNode = {
    key: lower,
    cls: classify(baseKey),
    fixedCells: baseKey === "fixedgridbox",
    vertical: baseKey === "vbox",
    props: new Map(),
    pairs: new Map(),
    sizePct: [false, false],
    consts: ctx.consts,
    line,
    ownLine,
    invisible: false,
    children: [],
  };
  // Local block overrides, shadowed by inherited (outer) ones.
  const rootOverrides = new Map(collectBlockOverrides(statements));
  for (const [k, v] of ctx.overrides) rootOverrides.set(k, v);
  const childStack = isType ? [...ctx.stack, lower] : ctx.stack;

  // `ov` is threaded explicitly: an override is CONSUMED when applied, so a
  // block re-declaring its own name inside override content (vanilla's
  // cooltip chaining pattern) falls back to the default instead of recursing.
  const process = (stmts: Statement[], ov: Map<string, BlockNode>): void => {
    let marker: "block" | "blockoverride" | null = null;
    for (const stmt of stmts) {
      if (stmt.kind === "value") {
        const t = stmt.value.kind === "scalar" ? stmt.value.text.toLowerCase() : "";
        marker = t === "block" ? "block" : t === "blockoverride" ? "blockoverride" : null;
        continue;
      }
      const m = marker;
      marker = null;
      if (m === "blockoverride") continue; // consumed by collectBlockOverrides
      const k = stmt.key.text.toLowerCase();
      const child = blockOf(stmt);
      if (m === "block") {
        // Named slot: overridden content (or its own default), spliced inline.
        const override = ov.get(stmt.key.text);
        const content = override ?? child;
        let sub = ov;
        if (override) {
          sub = new Map(ov);
          sub.delete(stmt.key.text);
        }
        if (content) process(content.statements, sub);
        continue;
      }
      if (child) {
        if (k === "item") {
          // Datamodel item template: `item = { <widget> }` holds one instance
          // of the per-row widget (the universal vanilla pattern — verified in
          // window_character.gui skills hbox + modifiers fixedgridbox: item is
          // always a plain wrapper whose children are the row widget). Captured
          // here, stamped out as ghost copies after process(). The wrapper node
          // survives because the item has a rect of its own: it content-sizes
          // to the bounding box of its children (L10).
          node.itemTemplate = buildWNode(
            "item",
            child,
            { ...ctx, overrides: ov, stack: childStack },
            line,
            false
          );
          continue;
        }
        if (SKIP_SUBTREES.has(k)) {
          continue;
        } else if (k === "background") {
          node.bg = resolveFill(child, ctx.consts, ctx.defs);
        } else if (k === "scrollwidget") {
          // Pass-through: scrollarea content renders at the viewport origin
          // with no rect of its own observed (B3-R1).
          const inner = buildWNode("scrollwidget", child, {
            ...ctx,
            overrides: ov,
            stack: childStack,
          });
          node.children.push(...inner.children);
        } else if (PROPERTY_BLOCKS.has(k)) {
          node.pairs.set(k, numbersIn(child, ctx.consts));
          if (k === "size") {
            const vals: number[] = [];
            let i = 0;
            for (const s of child.statements) {
              if (s.kind === "value" && s.value.kind === "scalar") {
                const t = s.value.text;
                if (i < 2) node.sizePct[i] = t.endsWith("%");
                vals.push(toNumber(t.endsWith("%") ? t.slice(0, -1) : t, ctx.consts));
                i++;
              }
            }
            node.pairs.set("size", vals);
          }
        } else {
          // Line info only for statements physically inside this instance's
          // block (type-def content lives in other files): children spliced
          // from types inherit the instance's line.
          const inInstance = stmt.range.start >= block.range.start && stmt.range.end <= block.range.end;
          const childLine = inInstance ? ctx.lineOf(stmt.key.range.start) : line;
          node.children.push(
            buildWNode(
              stmt.key.text,
              child,
              { ...ctx, overrides: ov, stack: childStack },
              childLine,
              inInstance
            )
          );
        }
      } else if (stmt.value?.kind === "scalar") {
        node.props.set(k, stmt.value);
      }
    }
  };
  process(statements, rootOverrides);
  if (node.props.get("direction")?.text.toLowerCase() === "vertical") node.vertical = true;

  // Builtin fallbacks for the vanilla label types (gui/preload/labels.gui)
  // when no defs store provides the real definitions. text_multi's hardcoded
  // 45x45 bit us in B2-L; reproduce it faithfully.
  if (lower === "text_single" && !ctx.defs.types.has("text_single")) {
    if (!node.props.has("autoresize")) node.props.set("autoresize", fakeScalar("yes"));
  }
  if (lower === "text_multi" && !ctx.defs.types.has("text_multi")) {
    if (!node.pairs.has("size")) node.pairs.set("size", [45, 45]);
    if (!node.props.has("multiline")) node.props.set("multiline", fakeScalar("yes"));
  }
  // Resolved once, after expansion has settled `visible` last-in-wins.
  node.invisible = resolveVisibility(node.props.get("visible")?.text, ctx);

  // unmeasured: placeholder presentation, not a calibrated layout rule.
  // A datamodel list has no runtime rows in a static preview, so it would draw
  // empty. Assumption: each data row is one instance of the `item` template
  // laid out as a normal child. Stamp GHOST_COUNT (capped) ghost copies so the
  // container's real layout policy (box/flow stacking) is visible. Reuses the
  // already-resolved template widgets; no extra expansion machinery.
  if (node.itemTemplate && node.itemTemplate.children.length > 0) {
    markGhost(node.itemTemplate);
    const count = ghostCount(node);
    for (let i = 0; i < count; i++) node.children.push(node.itemTemplate);
  }
  return node;
}

/** Flag a template subtree as a placeholder (non-editable, dimmed by the client). */
function markGhost(node: WNode): void {
  node.ghost = true;
  for (const c of node.children) markGhost(c);
}

/**
 * How many ghost rows to draw. GHOST_COUNT, but capped to what the container's
 * own explicit size can hold on its main axis when both that size and the
 * item's explicit size are known (so a small fixed list never overruns). Runs
 * in the build phase, so it uses authored sizes only, no text measurement.
 */
function ghostCount(node: WNode): number {
  const size = explicitSize(node);
  if (!size || !node.itemTemplate) return GHOST_COUNT;
  const avail = node.vertical ? size.h : size.w;
  if (avail <= 0) return GHOST_COUNT;
  const extent = staticExtent(node.itemTemplate);
  if (!extent) return GHOST_COUNT; // item bounds unknown: no cap
  const itemMain = node.vertical ? extent.h : extent.w;
  if (itemMain <= 0) return GHOST_COUNT;
  return Math.max(1, Math.min(GHOST_COUNT, Math.floor(avail / itemMain)));
}

/**
 * The item template's bounding box from AUTHORED sizes alone (the build phase
 * has no measurer, so a text row stays unknown). Null when any child lacks an
 * explicit size.
 */
function staticExtent(item: WNode): { w: number; h: number } | null {
  let w = 0;
  let h = 0;
  for (const c of item.children) {
    const s = explicitSize(c);
    if (!s) return null;
    const pos = c.pairs.get("position") ?? [0, 0];
    w = Math.max(w, (pos[0] ?? 0) + s.w);
    h = Math.max(h, (pos[1] ?? 0) + s.h);
  }
  return { w, h };
}

function fakeScalar(text: string): ScalarNode {
  return { kind: "scalar", text, quoted: false, range: { start: 0, end: 0 } };
}

/**
 * The Fill a `background = { ... }` block produces, `using =` templates
 * spliced. Exported so the inspector reads a background exactly the way the
 * canvas drew it instead of re-deriving the same attributes.
 */
export function resolveFill(block: BlockNode, consts: Map<string, number>, defs: GuiDefs): Fill {
  const fill: Fill = {};
  // `background = { using = Background_Area_Dark }` carries its texture via
  // the template; expandWidget with an unknown key just splices templates.
  const { statements } = expandWidget("#background", block, defs);
  let sprite: number[] | undefined;
  let spriteType: string | undefined;
  let framesize: number[] | undefined;
  let frame: number | undefined;
  const side: { l?: number; t?: number; r?: number; b?: number } = {};
  for (const stmt of statements) {
    if (stmt.kind !== "assignment") continue;
    const k = stmt.key.text.toLowerCase();
    if (k === "texture" && stmt.value?.kind === "scalar") fill.texture = stmt.value.text;
    if (k === "spritetype" && stmt.value?.kind === "scalar") spriteType = stmt.value.text;
    if (k === "frame" && stmt.value?.kind === "scalar") frame = toNumber(stmt.value.text, consts);
    if (k === "framesize") {
      const b = blockOf(stmt);
      if (b) framesize = numbersIn(b, consts);
    }
    if (k === "color") {
      const b = blockOf(stmt);
      if (b) {
        const v = numbersIn(b, consts);
        if (v.length >= 3) fill.color = [v[0], v[1], v[2], v[3] ?? 1];
      }
    }
    // Nine-slice: `spriteborder = { x y }` (x=left/right, y=top/bottom) plus
    // per-side scalar overrides. Reachable straight off the background block.
    if (k === "spriteborder") {
      const b = blockOf(stmt);
      if (b) sprite = numbersIn(b, consts);
    }
    if (k.startsWith("spriteborder_") && stmt.value?.kind === "scalar") {
      const v = toNumber(stmt.value.text, consts);
      if (k === "spriteborder_left") side.l = v;
      else if (k === "spriteborder_top") side.t = v;
      else if (k === "spriteborder_right") side.r = v;
      else if (k === "spriteborder_bottom") side.b = v;
    }
  }
  const border = borderTuple(sprite, side);
  if (border) fill.border = border;
  if (fill.texture !== undefined) {
    fill.mode = fillMode(spriteType, border); // Studio §J, L21a-d
    if (framesize && framesize.length >= 2) {
      // Studio §L, L22: the sheet grid; `frame` defaults to the first cell.
      fill.framesize = [framesize[0], framesize[1]];
      fill.frame = frame ?? 1;
    }
  }
  return fill;
}

/**
 * Resolve `spriteborder = { x y }` (x = left & right, y = top & bottom) plus
 * per-side overrides into [left, top, right, bottom], or undefined when no
 * border attribute is present.
 */
function borderTuple(
  pair: number[] | undefined,
  side: { l?: number; t?: number; r?: number; b?: number }
): [number, number, number, number] | undefined {
  const any =
    pair !== undefined ||
    side.l !== undefined ||
    side.t !== undefined ||
    side.r !== undefined ||
    side.b !== undefined;
  if (!any) return undefined;
  const x = pair?.[0] ?? 0;
  const y = pair?.[1] ?? 0;
  return [side.l ?? x, side.t ?? y, side.r ?? x, side.b ?? y];
}

function collectWidgets(statements: Statement[], ctx: BuildCtx): WNode[] {
  const out: WNode[] = [];
  let isDecl = false;
  for (const stmt of statements) {
    if (stmt.kind === "value") {
      // A bare `template` / `types` / `type` word marks the next assignment
      // as a declaration (collected by guiDefs), not a live widget.
      isDecl =
        stmt.value.kind === "scalar" &&
        ["template", "local_template", "types", "type"].includes(stmt.value.text.toLowerCase());
      continue;
    }
    const decl = isDecl;
    isDecl = false;
    const block = blockOf(stmt);
    if (!block || decl) continue;
    const k = stmt.key.text.toLowerCase();
    if (PROPERTY_BLOCKS.has(k)) continue;
    if (k.startsWith("@")) continue;
    out.push(buildWNode(stmt.key.text, block, ctx, ctx.lineOf(stmt.key.range.start), true));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

function num(node: WNode, key: string): number | undefined {
  const s = node.props.get(key);
  if (!s) return undefined;
  return toNumber(s.text, node.consts);
}

function str(node: WNode, key: string): string | undefined {
  return node.props.get(key)?.text;
}

function yes(node: WNode, key: string): boolean {
  return node.props.get(key)?.text.toLowerCase() === "yes";
}

/** parentanchor/widgetanchor -> fractional point (0=left/top, 1=right/bottom). */
function anchorFractions(spec: string | undefined): [number, number] {
  let fx = 0;
  let fy = 0;
  if (!spec) return [0, 0];
  for (const part of spec.toLowerCase().split("|")) {
    switch (part.trim()) {
      case "left":
        fx = 0;
        break;
      case "hcenter":
        fx = 0.5;
        break;
      case "right":
        fx = 1;
        break;
      case "top":
        fy = 0;
        break;
      case "vcenter":
        fy = 0.5;
        break;
      case "bottom":
        fy = 1;
        break;
      case "center":
        fx = 0.5;
        fy = 0.5;
        break;
    }
  }
  return [fx, fy];
}

/** margin pair + directional overrides -> [left, top, right, bottom]. (B1-E3, B4-T7) */
function margins(node: WNode): [number, number, number, number] {
  const pair = node.pairs.get("margin");
  let l = pair?.[0] ?? 0;
  let t = pair?.[1] ?? 0;
  let r = pair?.[0] ?? 0;
  let b = pair?.[1] ?? 0;
  const ml = num(node, "margin_left");
  const mt = num(node, "margin_top");
  const mr = num(node, "margin_right");
  const mb = num(node, "margin_bottom");
  if (ml !== undefined) l = ml;
  if (mt !== undefined) t = mt;
  if (mr !== undefined) r = mr;
  if (mb !== undefined) b = mb;
  return [l, t, r, b];
}

type Policy = "fixed" | "expanding" | "growing" | "preferred" | "shrinking";

function policy(node: WNode, horizontal: boolean): Policy {
  if (node.cls === "expand") return "growing"; // B4-T8, B3-P2
  const p = str(node, horizontal ? "layoutpolicy_horizontal" : "layoutpolicy_vertical");
  switch (p?.toLowerCase()) {
    case "expanding":
      return "expanding";
    case "growing":
      return "growing";
    case "preferred":
      return "preferred";
    case "shrinking":
      return "shrinking";
    default:
      return "fixed";
  }
}

/**
 * Is this widget hidden for layout purposes? `visible = no` is deterministic
 * and collapses; a `visible = "[binding]"` cannot be evaluated in a static
 * preview, so by DEFAULT the widget is KEPT even though the engine collapses a
 * binding that evaluates false at runtime (spec.md `ignoreinvisible`, L27):
 * showing it is the non-destructive default, and the same unknown makes a
 * container's content unmeasurable (L11b).
 *
 * The preview modes only move that default: `hideAll` collapses every
 * conditional, `evaluate` collapses the ones the caller assigned false. Every
 * conditional met is recorded either way, so a client can offer the toggles
 * before the user has switched mode.
 */
function resolveVisibility(value: string | undefined, ctx: BuildCtx): boolean {
  if (value === undefined) return false;
  const lower = value.toLowerCase();
  if (lower === "no") return true;
  if (lower === "yes") return false;
  const mode = ctx.visibility?.mode ?? "showAll";
  const hiddenNow =
    mode === "hideAll" ? true : mode === "evaluate" ? ctx.visibility?.checks?.[value] === false : false;
  const seen = ctx.checks.get(value);
  if (seen) seen.count++;
  else ctx.checks.set(value, { key: value, count: 1, hidden: hiddenNow });
  return hiddenNow;
}

/** The resolved flag, decided once per widget in the build phase. */
function hidden(node: WNode): boolean {
  return node.invisible;
}

/** `ignoreinvisible` defaults to yes on hbox/vbox (spec.md, L27). */
function collapsesHidden(box: WNode): boolean {
  return box.props.get("ignoreinvisible")?.text.toLowerCase() !== "no";
}

/**
 * `minimumsize = { w h }` floor. Applied on the box MAIN axis only: it is the
 * floor a shrinking child stops at, which is what the deficit redistribution
 * needs (spec.md "Minimum sizes in the box distribution", L04c). Cross-axis
 * effect unmeasured. A binding-valued `minimumsize` folds to 0 like every
 * other unresolvable value (5 vanilla widgets write one).
 */
function minimumSize(node: WNode): { w: number; h: number } {
  const min = node.pairs.get("minimumsize");
  return { w: min?.[0] ?? 0, h: min?.[1] ?? 0 };
}

/**
 * The child whose `resizeparent = yes` dictates this widget's size: the widget
 * takes that child's content extent instead of its own authored size
 * (spec.md "Container sizing", L28). The source's "a fixed-size DIRECT child
 * of one CAN be collapsed" side effect is NOT implemented: "can" is not a rect
 * rule, and nothing measured says when it fires.
 */
function resizeParentSource(node: WNode): WNode | undefined {
  return node.children.find((c) => yes(c, "resizeparent"));
}

/**
 * Classes whose size flows through naturalSize (spec.md "Container sizing",
 * L25 and L10). The probe DID say so (in-game 2026-08-02): a NON-empty
 * container KEEPS an authored `size` (the engine warns "you should not set a
 * size on a container" yet applies it), so naturalSize implements the narrow
 * reading and this predicate only routes containers/items through it. See
 * parity-checklist.md L25.
 */
function contentSized(cls: WidgetClass): boolean {
  return cls === "container" || cls === "item";
}

// ---------------------------------------------------------------------------
// Natural (content-hug) sizes, bottom-up
// ---------------------------------------------------------------------------

function naturalSize(node: WNode, measurer: TextMeasurer): { w: number; h: number } {
  switch (node.cls) {
    case "expand":
      return { w: 0, h: 0 };
    case "textbox":
      return textSize(node, measurer).size;
    case "box": {
      // Hug = children floors + spacing + margins (B2-I2: exact, packed).
      // A collapsed hidden child contributes nothing, not even its spacing
      // (L27). An expanding child contributes its FLOOR only, never a share of
      // free space: it cannot GROW the box's cross size (L31). A floor wider
      // than a fixed sibling's still sets the hug, and that shape is unmeasured
      // by either source (parity-checklist.md L31).
      const [ml, mt, mr, mb] = margins(node);
      const spacing = num(node, "spacing") ?? 0;
      let main = 0;
      let cross = 0;
      let laid = 0;
      for (const c of boxChildren(node)) {
        const s = naturalSize(c, measurer);
        const min = minimumSize(c);
        const cm = Math.max(node.vertical ? s.h : s.w, node.vertical ? min.h : min.w);
        const cc = node.vertical ? s.w : s.h;
        main += cm + (laid > 0 ? spacing : 0);
        cross = Math.max(cross, cc);
        laid++;
      }
      return node.vertical
        ? { w: cross + ml + mr, h: main + mt + mb }
        : { w: main + ml + mr, h: cross + mt + mb };
    }
    case "grid": {
      // A grid keeps an authored size; otherwise it hugs the slots it filled
      // (unmeasured: neither source records a gridbox's own rect without a
      // size, and every fixture authors the cells rather than the box).
      const explicit = explicitSize(node);
      if (explicit) return explicit;
      let w = 0;
      let h = 0;
      for (const cell of gridCells(node, measurer)) {
        w = Math.max(w, cell.x + cell.w);
        h = Math.max(h, cell.y + cell.h);
      }
      return { w, h };
    }
    case "flow": {
      // Single non-wrapping run (B2-K, B3-Q1). Explicit size sets the flow's
      // own rect but not the content run (B3-Q1).
      const explicit = explicitSize(node);
      if (explicit) return explicit;
      const spacing = num(node, "spacing") ?? 0;
      let main = 0;
      let cross = 0;
      node.children.forEach((c, i) => {
        const s = naturalSize(c, measurer);
        main += (node.vertical ? s.h : s.w) + (i > 0 ? spacing : 0);
        cross = Math.max(cross, node.vertical ? s.w : s.h);
      });
      return node.vertical ? { w: cross, h: main } : { w: main, h: cross };
    }
    case "container": {
      // NARROW rule, measured in-game 2026-08-02 (L25): a container WITH
      // children keeps an authored `size` (the engine warns yet applies it);
      // an EMPTY one collapses, a fixed size will not hold it open. Without
      // an authored size it hugs the children's extent at their positions
      // (B2-I4).
      const explicit = explicitSize(node);
      if (explicit && node.children.length > 0) return explicit;
      return hugChildren(node, measurer);
    }
    case "item":
      // A datamodel `item` sizes to its content unconditionally, rather than
      // taking a generic widget default (L10).
      return hugChildren(node, measurer);
    case "marginwidget": {
      const explicit = explicitSize(node);
      if (explicit) return explicit;
      return hugChildren(node, measurer);
    }
    default: {
      // Plain widget/icon/window: explicit size or ZERO — no hug (B4-T1),
      // unless a `resizeparent = yes` child dictates the size instead (L28).
      const resizer = resizeParentSource(node);
      if (resizer) return hugChildren(resizer, measurer);
      const explicit = explicitSize(node);
      if (!explicit) return { w: 0, h: 0 };
      const scale = num(node, "scale") ?? 1; // multiplies the rect (B4-T4)
      return { w: explicit.w * scale, h: explicit.h * scale };
    }
  }
}

/**
 * Bounding box of the children at their positions (B2-I4). Anchored children
 * inside a hugging container are unmeasured; the extent uses position +
 * natural size only. A plainly hidden child is skipped and the rest still
 * content-size (L11c).
 */
function hugChildren(node: WNode, measurer: TextMeasurer): { w: number; h: number } {
  const [ml, mt] = margins(node);
  let w = 0;
  let h = 0;
  for (const c of node.children) {
    if (hidden(c)) continue;
    const s = naturalSize(c, measurer);
    const pos = c.pairs.get("position") ?? [0, 0];
    w = Math.max(w, (pos[0] ?? 0) + s.w);
    h = Math.max(h, (pos[1] ?? 0) + s.h);
  }
  return { w: w + ml, h: h + mt };
}

/** A box's laid-out children: hidden ones collapse out unless asked not to (L27). */
function boxChildren(box: WNode): WNode[] {
  if (!collapsesHidden(box)) return box.children;
  return box.children.filter((c) => !hidden(c));
}

/** Explicit size with percentages unresolved (returns the raw number). */
function explicitSize(node: WNode): { w: number; h: number } | null {
  const size = node.pairs.get("size");
  if (!size || size.length < 2) return null;
  return { w: size[0], h: size[1] };
}

// ---------------------------------------------------------------------------
// Arrangement, top-down
// ---------------------------------------------------------------------------

type ParentKind = "plain" | "box" | "flow";

function arrange(
  node: WNode,
  content: LayoutRect,
  parentKind: ParentKind,
  measurer: TextMeasurer,
  forced?: LayoutRect,
  chain?: ExplainChain
): LayoutNode {
  const rect = forced ?? placeInParent(node, content, measurer);
  const srcPosition = node.pairs.get("position");
  const srcSize = node.pairs.get("size");
  const out: LayoutNode = {
    key: node.key,
    name: str(node, "name"),
    rect,
    // scrollarea (measured B3-R1), scrollbox, and any widget carrying
    // `scissor = yes` clip their subtree (spec.md "Clipping containers", L17b).
    // L17c's "clamp the descendant rects in the flatten" stays a RENDERER job
    // here: these rects are true geometry and the client clips them (the
    // B3-R1 golden pins the unclamped corner rect, and guiPreview clips it).
    clip: node.cls === "scrollarea" || yes(node, "scissor"),
    bg: node.bg,
    line: node.line,
    positioned: forced === undefined,
    // Ghosts are synthetic placeholders: never draggable/editable even though
    // the item template statements physically exist in the document.
    editable: node.ownLine && node.line !== undefined && !node.ghost,
    srcPosition: srcPosition && srcPosition.length >= 2 ? [srcPosition[0], srcPosition[1]] : undefined,
    srcSize: srcSize && srcSize.length >= 2 ? [srcSize[0], srcSize[1]] : undefined,
    ghost: node.ghost ? true : undefined,
    children: [],
  };
  const colorPair = node.pairs.get("color");
  const color: [number, number, number, number] | undefined =
    colorPair && colorPair.length >= 3
      ? [colorPair[0], colorPair[1], colorPair[2], colorPair[3] ?? 1]
      : undefined;
  if (node.cls === "textbox") {
    out.text = textInfo(node, rect, measurer);
    if (color) out.text.color = color;
  } else if (node.props.has("texture") || color) {
    // A widget's own textured fill can carry nine-slice borders directly
    // (spriteborder is collected into pairs; per-side overrides into props).
    const border = borderTuple(node.pairs.get("spriteborder"), {
      l: num(node, "spriteborder_left"),
      t: num(node, "spriteborder_top"),
      r: num(node, "spriteborder_right"),
      b: num(node, "spriteborder_bottom"),
    });
    const texture = str(node, "texture");
    out.fill = { texture, color, border };
    if (texture !== undefined) {
      out.fill.mode = fillMode(str(node, "spritetype"), border); // Studio §J, L21a-d
      const framesize = node.pairs.get("framesize");
      if (framesize && framesize.length >= 2) {
        out.fill.framesize = [framesize[0], framesize[1]]; // Studio §L, L22
        out.fill.frame = num(node, "frame") ?? 1;
      }
    }
  }

  if (
    chain &&
    chain.sink.result === undefined &&
    node.ownLine &&
    !node.ghost &&
    node.line === chain.sink.line
  ) {
    chain.sink.result = explainPlacement(node, out, content, forced !== undefined, chain);
  }
  const sub = chain && descend(chain, node, out);

  switch (node.cls) {
    case "box":
      out.children = arrangeBoxChildren(node, rect, measurer, sub);
      break;
    case "flow":
      out.children = arrangeFlowChildren(node, rect, measurer, sub);
      break;
    case "grid":
      out.children = arrangeGridChildren(node, rect, measurer, sub);
      break;
    case "marginwidget": {
      // Margins inset the children's coordinate space; the widget's own rect
      // is untouched (B4-T3). Symmetric inset on the far sides is ASSUMED
      // from the vanilla HUD pattern (unmeasured; only the origin is pinned).
      const [ml, mt, mr, mb] = margins(node);
      const inner: LayoutRect = {
        x: rect.x + ml,
        y: rect.y + mt,
        w: Math.max(0, rect.w - ml - mr),
        h: Math.max(0, rect.h - mt - mb),
      };
      out.children = node.children.map((c) => arrange(c, inner, "plain", measurer, undefined, sub));
      break;
    }
    default:
      out.children = node.children.map((c) => arrange(c, rect, "plain", measurer, undefined, sub));
      break;
  }
  return out;
}

/** The chain a node's children see: this node as parent, its clip if it clips. */
function descend(chain: ExplainChain, node: WNode, out: LayoutNode): ExplainChain {
  return {
    sink: chain.sink,
    parent: node,
    parentRect: out.rect,
    clip: out.clip ? { key: node.key, name: out.name, rect: out.rect } : chain.clip,
  };
}

/**
 * "Why is it here": the terms of the anchor sum, or the container that placed
 * the widget instead, plus the clip rect that bounds it.
 */
function explainPlacement(
  node: WNode,
  out: LayoutNode,
  content: LayoutRect,
  forced: boolean,
  chain: ExplainChain
): Placement {
  const placement: Placement = {
    rect: out.rect,
    // A container-placed child was handed its slot as `content`; the rect worth
    // naming is the container's own, which the chain carries.
    parentRect: forced ? (chain.parentRect ?? content) : content,
    terms: forced ? [] : placementTerms(node, content, out.rect),
  };
  const parent = chain.parent;
  if (forced && parent) {
    const pos = node.pairs.get("position");
    placement.placedBy = {
      key: parent.key,
      name: str(parent, "name"),
      layout: parent.cls === "box" ? "box" : parent.cls === "flow" ? "flow" : "grid",
      // The engine logs "Widget cannot have a position in a layout" and drops
      // it (probe 2026-08-02, L23); naming the dropped value is the point.
      droppedPosition: pos && pos.length >= 2 ? [pos[0], pos[1]] : undefined,
    };
  }
  if (chain.clip) placement.clippedBy = chain.clip;
  return placement;
}

/**
 * The anchor sum, term by term, mirroring placeInParent's formula (B1-B/C/D).
 * The dx/dy add up to the rect origin exactly, which the test pins: that
 * equality is what keeps this readout from drifting from the placement it
 * explains.
 */
function placementTerms(node: WNode, content: LayoutRect, rect: LayoutRect): PlacementTerm[] {
  const pa = str(node, "parentanchor");
  const waOwn = str(node, "widgetanchor");
  const wa = waOwn ?? pa;
  const [pfx, pfy] = anchorFractions(pa);
  const [wfx, wfy] = anchorFractions(wa);
  const pos = node.pairs.get("position");
  const terms: PlacementTerm[] = [{ kind: "parentOrigin", dx: content.x, dy: content.y }];
  if (pa !== undefined)
    terms.push({ kind: "parentanchor", source: pa, dx: pfx * content.w, dy: pfy * content.h });
  if (wa !== undefined) {
    terms.push({ kind: "widgetanchor", source: wa, dx: -wfx * rect.w, dy: -wfy * rect.h });
  }
  if (pos !== undefined) {
    terms.push({
      kind: "position",
      source: `{ ${pos[0] ?? 0} ${pos[1] ?? 0} }`,
      dx: pos[0] ?? 0,
      dy: pos[1] ?? 0,
    });
  }
  return terms;
}

/** Size + anchor + position for a child of a NON-box parent. */
function placeInParent(node: WNode, content: LayoutRect, measurer: TextMeasurer): LayoutRect {
  let w: number;
  let h: number;
  if (node.cls === "box") {
    // Boxes FILL a non-box parent, explicit size ignored entirely
    // (B1-E/F, B2-I1, B3-P1). Inside another box they hug — but that path
    // goes through arrangeBoxChildren, not here.
    w = content.w;
    h = content.h;
  } else if (node.cls === "textbox") {
    // Textboxes always size via the text rules (autoresize measurement can
    // override an inherited size like Font_Size_Small's `size = { 0 23 }`).
    const s = textSize(node, measurer).size;
    w = s.w;
    h = s.h;
  } else if (contentSized(node.cls)) {
    // container / datamodel item: naturalSize owns the rule (narrow L25: a
    // non-empty container keeps an authored size; item always content, L10).
    const s = naturalSize(node, measurer);
    w = s.w;
    h = s.h;
  } else {
    // A `resizeparent = yes` child replaces this widget's authored size with
    // that child's content extent (L28).
    const explicit = resizeParentSource(node) ? null : explicitSize(node);
    if (explicit) {
      // Percent sizes resolve against the parent rect (B4-T2).
      w = node.sizePct[0] ? (explicit.w / 100) * content.w : explicit.w;
      h = node.sizePct[1] ? (explicit.h / 100) * content.h : explicit.h;
      const scale = num(node, "scale") ?? 1; // B4-T4
      w *= scale;
      h *= scale;
    } else {
      const s = naturalSize(node, measurer);
      w = s.w;
      h = s.h;
    }
  }

  // widgetanchor implicitly mirrors parentanchor (B1-B, B1-C); position is
  // always screen-space +right/+down, added after anchoring (B1-D).
  const pa = str(node, "parentanchor");
  const wa = str(node, "widgetanchor") ?? pa;
  const [pfx, pfy] = anchorFractions(pa);
  const [wfx, wfy] = anchorFractions(wa);
  const pos = node.pairs.get("position") ?? [0, 0];
  const x = content.x + pfx * content.w - wfx * w + (pos[0] ?? 0);
  const y = content.y + pfy * content.h - wfy * h + (pos[1] ?? 0);
  return { x, y, w, h };
}

/**
 * Box (hbox/vbox) child arrangement, per the measured model:
 * 1. floors = natural sizes; 2. policies resize (expanding: +free/k;
 *    growing acts only without expanding siblings; deficit: preferred and
 *    shrinking each lose deficit/k) (B2-J, B3-P);
 * 3. residual free space distributes as space-around: each child gets
 *    side = residual/(2n) on both sides (B1-E/F);
 * 4. cross axis: fill if the cross policy stretches, else centered (B1-E/F).
 */
function arrangeBoxChildren(
  box: WNode,
  rect: LayoutRect,
  measurer: TextMeasurer,
  chain?: ExplainChain
): LayoutNode[] {
  const vertical = box.vertical;
  const [ml, mt, mr, mb] = margins(box);
  const spacing = num(box, "spacing") ?? 0;
  const contentMain = vertical ? rect.h - mt - mb : rect.w - ml - mr;
  const contentCross = vertical ? rect.w - ml - mr : rect.h - mt - mb;
  if (box.children.length === 0) return [];

  // `ignoreinvisible` defaults to yes: a plainly hidden child is collapsed out
  // of the layout and its siblings shift up to fill the gap (spec.md, L27). It
  // still reaches the tree, as a ZERO rect at the cursor, so the preview can
  // list and select it; nothing of it is drawn, which is what the game does.
  const laid = boxChildren(box);
  const kept = new Set(laid);
  const n = laid.length;

  const naturals = laid.map((c) => {
    if (c.cls === "box") {
      // box-in-box hugs (B2-I2)
      return naturalSize(c, measurer);
    }
    return resolvedChildSize(c, rect, measurer);
  });
  // `minimumsize = { w h }` floors the main-axis size and is where a shrinking
  // child stops (spec.md "Minimum sizes in the box distribution", L04c).
  const minMains = laid.map((c) => {
    const min = minimumSize(c);
    return vertical ? min.h : min.w;
  });
  const mains = naturals.map((s, i) => Math.max(vertical ? s.h : s.w, minMains[i]));
  const crosses = naturals.map((s) => (vertical ? s.w : s.h));

  let free = n === 0 ? 0 : contentMain - mains.reduce((a, b) => a + b, 0) - spacing * (n - 1);
  const mainPolicies = laid.map((c) => policy(c, !vertical));
  if (free > 0) {
    const expanders = mainPolicies.map((p, i) => ({ p, i })).filter(({ p }) => p === "expanding");
    // Without expanding siblings, growing AND preferred take the space; the
    // growing case is measured (B3-P2), preferred sharing with growing is
    // unmeasured — treated as the same tier.
    const growers = mainPolicies
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p === "growing" || p === "preferred");
    const takers = expanders.length > 0 ? expanders : growers;
    if (takers.length > 0) {
      const share = free / takers.length; // floor + free/k (B3-P3)
      for (const { i } of takers) mains[i] += share;
      free = 0;
    }
  } else if (free < 0) {
    // Deficit: every shrinkable child loses deficit/k, an equal DELTA with no
    // shrinking-first priority (B2-J3, B3-P4). A child that reaches its floor
    // stops there and the REST absorb what it could not give, so the total
    // still fits (spec.md "Minimum sizes in the box distribution", L04c);
    // a `fixed` child never shrinks at all (L04b).
    let owed = -free;
    let pool = mainPolicies
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p === "preferred" || p === "shrinking")
      .map(({ i }) => i);
    while (owed > 1e-9 && pool.length > 0) {
      const delta = owed / pool.length;
      const next: number[] = [];
      for (const i of pool) {
        const room = Math.max(0, mains[i] - minMains[i]);
        const take = Math.min(delta, room);
        mains[i] -= take;
        owed -= take;
        if (room > delta) next.push(i);
      }
      if (next.length === pool.length) break; // nobody floored: converged
      pool = next;
    }
    // Nothing left that can give: keep the floors and overflow (unmeasured).
    free = 0;
  }

  const side = n > 0 ? free / (2 * n) : 0; // space-around (B1-E/F)
  const crossPolicies = laid.map((c) => policy(c, vertical));
  const out: LayoutNode[] = [];
  let cursor = (vertical ? rect.y + mt : rect.x + ml) + side;
  let i = -1;
  for (const child of box.children) {
    if (!kept.has(child)) {
      const zero: LayoutRect = vertical
        ? { x: rect.x + ml, y: cursor, w: 0, h: 0 }
        : { x: cursor, y: rect.y + mt, w: 0, h: 0 };
      out.push(arrange(child, zero, "box", measurer, zero, chain));
      continue;
    }
    i++;
    const main = mains[i];
    const stretchCross =
      crossPolicies[i] === "expanding" || crossPolicies[i] === "growing" || crossPolicies[i] === "preferred";
    const cross = stretchCross ? contentCross : Math.min(crosses[i], Number.POSITIVE_INFINITY);
    const crossOffset =
      (vertical ? rect.x + ml : rect.y + mt) + (stretchCross ? 0 : (contentCross - cross) / 2);
    // `position` on a box child is DROPPED: the box places its children.
    // In-game probe 2026-08-02 (px_positioned sat exactly where a plain
    // sibling does), and the engine logs "Widget cannot have a position in a
    // layout". Settles L23; the writer's positionIgnoredReason guard matches.
    const forced: LayoutRect = vertical
      ? { x: crossOffset, y: cursor, w: cross, h: main }
      : { x: cursor, y: crossOffset, w: main, h: cross };
    out.push(arrange(child, forced, "box", measurer, forced, chain));
    cursor += main + 2 * side + spacing;
  }
  return out;
}

/** flowcontainer: pack children from the origin, never wrap (B2-K, B3-Q1). */
function arrangeFlowChildren(
  flow: WNode,
  rect: LayoutRect,
  measurer: TextMeasurer,
  chain?: ExplainChain
): LayoutNode[] {
  const spacing = num(flow, "spacing") ?? 0;
  const out: LayoutNode[] = [];
  let cursor = flow.vertical ? rect.y : rect.x;
  for (const child of flow.children) {
    const s = resolvedChildSize(child, rect, measurer);
    // flowcontainer is the ONE container that honors a child's `parentanchor`
    // on the cross axis (spec.md "Container sizing", L13d); widgetanchor still
    // mirrors it (B1-B/C). Unset anchors keep the measured origin alignment
    // (B2-K1). The MAIN axis stays the flow cursor.
    const pa = str(child, "parentanchor");
    const [pfx, pfy] = anchorFractions(pa);
    const [wfx, wfy] = anchorFractions(str(child, "widgetanchor") ?? pa);
    const crossOffset = flow.vertical ? rect.x + pfx * rect.w - wfx * s.w : rect.y + pfy * rect.h - wfy * s.h;
    const forced: LayoutRect = flow.vertical
      ? { x: crossOffset, y: cursor, w: s.w, h: s.h }
      : { x: cursor, y: crossOffset, w: s.w, h: s.h };
    out.push(arrange(child, forced, "flow", measurer, forced, chain));
    cursor += (flow.vertical ? s.h : s.w) + spacing;
  }
  return out;
}

/** One slotted grid child, in the grid's own (0,0-based) coordinates. */
interface GridCell {
  child: WNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Grid box slotting, shared by naturalSize and the arrangement so the two
 * cannot drift. Both kinds fill VERTICALLY by default (down a column, wrapping
 * into a new column after `datamodel_wrap` items, so datamodel_wrap is
 * items-per-COLUMN); `flipdirection = yes` transposes the fill to horizontal
 * and mirrors nothing (the flipped grid still starts top-left);
 * `maxhorizontalslots` caps the slots per line only while filling horizontally.
 * (Studio §K v2/v3, in-game 2026-07-17; L14b, L15.)
 *
 * fixedgridbox uses `addcolumn`/`addrow` as the CELL SIZE and therefore the
 * stride (L14a); dynamicgridbox packs items at their OWN size, where
 * addcolumn/addrow are not the stride (L15).
 */
function gridCells(grid: WNode, measurer: TextMeasurer): GridCell[] {
  if (grid.children.length === 0) return [];
  const horizontal = yes(grid, "flipdirection");
  const wrap = num(grid, "datamodel_wrap") ?? 0;
  const maxSlots = num(grid, "maxhorizontalslots") ?? 0;
  let perLine = wrap > 0 ? wrap : Number.POSITIVE_INFINITY;
  if (horizontal && maxSlots > 0) perLine = Math.min(perLine, maxSlots);

  const contents = grid.children.map((c) => resolvedChildSize(c, { x: 0, y: 0, w: 0, h: 0 }, measurer));
  let cellW = num(grid, "addcolumn") ?? 0;
  let cellH = num(grid, "addrow") ?? 0;
  if (grid.fixedCells && yes(grid, "setitemsizefromcell")) {
    // Every cell takes the WIDEST item's size, so ragged rows go uniform
    // (Studio §K v3, L29). Measured on width; applied per axis here, and an
    // axis no item can size falls back to addcolumn/addrow.
    const w = Math.max(0, ...contents.map((s) => s.w));
    const h = Math.max(0, ...contents.map((s) => s.h));
    if (w > 0) cellW = w;
    if (h > 0) cellH = h;
  }

  const out: GridCell[] = [];
  let slot = 0;
  let line = 0;
  let mainCursor = 0;
  let crossCursor = 0;
  let lineCross = 0;
  grid.children.forEach((child, i) => {
    const content = contents[i];
    let cell: GridCell;
    if (grid.fixedCells) {
      // An item with NO concrete size anywhere in its chain takes the CELL
      // size; one with a concrete size keeps it at the cell ORIGIN
      // (Studio §K v3, L14c).
      const concrete = content.w > 0 || content.h > 0;
      cell = {
        child,
        x: (horizontal ? slot : line) * cellW,
        y: (horizontal ? line : slot) * cellH,
        w: concrete ? content.w : cellW,
        h: concrete ? content.h : cellH,
      };
    } else {
      cell = {
        child,
        x: horizontal ? mainCursor : crossCursor,
        y: horizontal ? crossCursor : mainCursor,
        w: content.w,
        h: content.h,
      };
      mainCursor += horizontal ? content.w : content.h;
      // Cross stride = the widest item of the line (unmeasured beyond the
      // uniform-item case every calibration grid used).
      lineCross = Math.max(lineCross, horizontal ? content.h : content.w);
    }
    out.push(cell);
    slot++;
    if (slot >= perLine) {
      slot = 0;
      line++;
      mainCursor = 0;
      crossCursor += lineCross;
      lineCross = 0;
    }
  });
  return out;
}

/** fixedgridbox / dynamicgridbox: slot the children, cells relative to the grid. */
function arrangeGridChildren(
  grid: WNode,
  rect: LayoutRect,
  measurer: TextMeasurer,
  chain?: ExplainChain
): LayoutNode[] {
  return gridCells(grid, measurer).map((cell) => {
    const forced: LayoutRect = { x: rect.x + cell.x, y: rect.y + cell.y, w: cell.w, h: cell.h };
    return arrange(cell.child, forced, "plain", measurer, forced, chain);
  });
}

/** Child size with % and scale resolved (children of boxes/flows/grids). */
function resolvedChildSize(
  node: WNode,
  parentRect: LayoutRect,
  measurer: TextMeasurer
): { w: number; h: number } {
  if (node.cls === "textbox") return textSize(node, measurer).size;
  const explicit = explicitSize(node);
  if (node.cls !== "box" && !contentSized(node.cls) && explicit) {
    const scale = num(node, "scale") ?? 1;
    return {
      w: (node.sizePct[0] ? (explicit.w / 100) * parentRect.w : explicit.w) * scale,
      h: (node.sizePct[1] ? (explicit.h / 100) * parentRect.h : explicit.h) * scale,
    };
  }
  return naturalSize(node, measurer);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function textContent(node: WNode): string {
  return str(node, "raw_text") ?? str(node, "text") ?? "";
}

function textSize(node: WNode, measurer: TextMeasurer): { size: { w: number; h: number }; lines: string[] } {
  const fontsize = num(node, "fontsize") ?? 15; // Font_Size_Small default
  const content = textContent(node);
  const maxWidth = num(node, "max_width");
  const explicit = explicitSize(node);
  // Vanilla `textbox` does not autoresize; text_single opts in (labels.gui).
  // A fixed-size textbox ignores max_width entirely — that is exactly the
  // measured text_multi 45x45 behavior (B2-L).
  const autoresize = yes(node, "autoresize");

  if (autoresize) {
    if (yes(node, "multiline") && maxWidth !== undefined) {
      // Word wrap at max_width; box width = widest line, height = lines *
      // line advance = single-line box height (B3-S2).
      const lines = wrapWords(content, maxWidth, fontsize, measurer);
      const w = Math.max(0, ...lines.map((l) => measurer.lineWidth(l, fontsize)));
      return { size: { w, h: lines.length * measurer.lineHeight(fontsize) }, lines };
    }
    let w = measurer.lineWidth(content, fontsize);
    if (maxWidth !== undefined && w > maxWidth) w = maxWidth; // clamp+elide (B3-S1)
    return { size: { w, h: measurer.lineHeight(fontsize) }, lines: [content] };
  }
  if (explicit) {
    return { size: { w: explicit.w, h: explicit.h }, lines: [content] };
  }
  return {
    size: { w: measurer.lineWidth(content, fontsize), h: measurer.lineHeight(fontsize) },
    lines: [content],
  };
}

function textInfo(node: WNode, rect: LayoutRect, measurer: TextMeasurer): TextInfo {
  const fontsize = num(node, "fontsize") ?? 15;
  const { lines } = textSize(node, measurer);
  const textW = Math.max(0, ...lines.map((l) => measurer.lineWidth(l, fontsize)));
  const lineH = measurer.lineHeight(fontsize);
  const [fx, fy] = anchorFractions(str(node, "align"));
  // Horizontal align is exact with zero padding: x = f * (W - textwidth);
  // vertical centers the line box (B4-T6).
  return {
    text: textContent(node),
    fontsize,
    offsetX: fx * (rect.w - textW),
    offsetY: fy * (rect.h - lines.length * lineH),
    lines,
  };
}

function wrapWords(text: string, maxWidth: number, fontsize: number, measurer: TextMeasurer): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (line.length > 0 && measurer.lineWidth(candidate, fontsize) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : [""];
}
