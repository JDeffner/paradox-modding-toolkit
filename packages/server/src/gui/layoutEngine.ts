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

export interface Fill {
  texture?: string;
  /** rgba 0..1; rendered = round(v*255), straight sRGB multiply (B1-G). */
  color?: [number, number, number, number];
  /**
   * Nine-slice border widths [left, top, right, bottom] in texture pixels,
   * sourced from the `spriteborder`/`spriteborder_<side>` .gui attributes.
   * Present => the renderer draws corners unscaled and stretches the edges
   * (see computeNineSlice). Geometry is deterministic; the values are read
   * straight from the document, not a calibrated layout rule.
   */
  border?: [number, number, number, number];
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
 * Number of placeholder rows drawn for a datamodel-driven list (unmeasured:
 * a preview affordance, capped per ghostCount so it never overruns a container
 * whose own size is known). GHOST_OPACITY is applied by the client renderer.
 */
export const GHOST_COUNT = 3;
export const GHOST_OPACITY = 0.45;

/**
 * Nine-slice (corneredtiled/corneredstretched) region layout: corners drawn
 * 1:1, edges stretched on one axis, center on both. Pure deterministic
 * geometry — border widths come from the .gui `spriteborder` attributes and
 * the source texture's own pixel size. Returns 9 src->dst blits in row-major
 * order (TL, T, TR, L, C, R, BL, B, BR); zero-area slices are dropped.
 * The client renderer mirrors this exactly.
 */
export interface NineSliceRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}
export function computeNineSlice(
  rect: LayoutRect,
  border: [number, number, number, number],
  texW: number,
  texH: number
): NineSliceRegion[] {
  // Clamp borders so opposite sides never overlap on a small texture or rect.
  const bl = Math.max(0, Math.min(border[0], texW, rect.w));
  const bt = Math.max(0, Math.min(border[1], texH, rect.h));
  const br = Math.max(0, Math.min(border[2], texW - bl, rect.w - bl));
  const bb = Math.max(0, Math.min(border[3], texH - bt, rect.h - bt));
  // Source and destination column/row spans: [start, size] triples.
  const sCols: [number, number][] = [
    [0, bl],
    [bl, texW - bl - br],
    [texW - br, br],
  ];
  const sRows: [number, number][] = [
    [0, bt],
    [bt, texH - bt - bb],
    [texH - bb, bb],
  ];
  const dCols: [number, number][] = [
    [rect.x, bl],
    [rect.x + bl, rect.w - bl - br],
    [rect.x + rect.w - br, br],
  ];
  const dRows: [number, number][] = [
    [rect.y, bt],
    [rect.y + bt, rect.h - bt - bb],
    [rect.y + rect.h - bb, bb],
  ];
  const out: NineSliceRegion[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const [sx, sw] = sCols[c];
      const [sy, sh] = sRows[r];
      const [dx, dw] = dCols[c];
      const [dy, dh] = dRows[r];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      out.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    }
  }
  return out;
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
}

export function computeGuiLayout(text: string, options?: LayoutOptions): LayoutNode[] {
  const viewport = options?.viewport ?? { w: 1920, h: 1080 };
  const measurer = options?.measurer ?? calibratedMeasurer;
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
  };
  const widgets = collectWidgets(result.root.statements, ctx);
  const root: LayoutRect = { x: 0, y: 0, w: viewport.w, h: viewport.h };
  return widgets.map((w) => arrange(w, root, "plain", measurer));
}

function effectiveDefs(text: string, store?: GuiDefs): GuiDefs {
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

type WidgetClass =
  | "plain" // widget, window, button, icon, ... : explicit size or ZERO (B4-T1)
  | "box" // hbox, vbox
  | "flow" // flowcontainer
  | "container" // container: hugs at origin (B2-I4)
  | "marginwidget" // margin offsets children (B3-Q2, B4-T3)
  | "scrollarea" // clips (B3-R1)
  | "textbox" // text metrics sizing
  | "expand"; // growing spacer (B4-T8)

interface WNode {
  key: string;
  cls: WidgetClass;
  vertical: boolean; // vbox / flow direction=vertical
  props: Map<string, ScalarNode>;
  pairs: Map<string, number[]>; // size/position/margin/color number lists
  sizePct: [boolean, boolean]; // per-axis: size value is a percentage (B4-T2)
  consts: Map<string, number>;
  line?: number;
  ownLine: boolean; // line points at this widget's own statement
  bg?: Fill;
  ghost?: boolean; // placeholder copy of a datamodel item template
  /**
   * Resolved item-template widgets from a datamodel container's `item = {}`
   * block, captured during process() and stamped out as ghost copies.
   */
  itemTemplate?: WNode[];
  children: WNode[];
}

/** Attribute blocks that are data, not child widgets (mirrors guiTree.ts). */
const PROPERTY_BLOCKS = new Set([
  "size",
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
  margin_widget: "marginwidget",
  scrollarea: "scrollarea",
  textbox: "textbox",
  text_single: "textbox",
  text_multi: "textbox",
  editbox: "textbox",
  expand: "expand",
};

function classify(key: string): WidgetClass {
  return CLASS_BY_KEY[key] ?? "plain";
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
    vertical: baseKey === "vbox",
    props: new Map(),
    pairs: new Map(),
    sizePct: [false, false],
    consts: ctx.consts,
    line,
    ownLine,
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
          // here, stamped out as ghost copies after process().
          const itemNode = buildWNode(
            "item",
            child,
            { ...ctx, overrides: ov, stack: childStack },
            line,
            false
          );
          node.itemTemplate = itemNode.children;
          continue;
        }
        if (SKIP_SUBTREES.has(k)) {
          continue;
        } else if (k === "background") {
          node.bg = fillFrom(child, ctx.consts, ctx.defs);
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

  // unmeasured: placeholder presentation, not a calibrated layout rule.
  // A datamodel list has no runtime rows in a static preview, so it would draw
  // empty. Assumption: each data row is one instance of the `item` template
  // laid out as a normal child. Stamp GHOST_COUNT (capped) ghost copies so the
  // container's real layout policy (box/flow stacking) is visible. Reuses the
  // already-resolved template widgets; no extra expansion machinery.
  if (node.itemTemplate && node.itemTemplate.length > 0) {
    for (const t of node.itemTemplate) markGhost(t);
    const count = ghostCount(node);
    for (let i = 0; i < count; i++) node.children.push(...node.itemTemplate);
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
  let itemMain = 0;
  for (const t of node.itemTemplate) {
    const s = explicitSize(t);
    if (!s) return GHOST_COUNT; // item bounds unknown: no cap
    itemMain += node.vertical ? s.h : s.w;
  }
  if (itemMain <= 0) return GHOST_COUNT;
  return Math.max(1, Math.min(GHOST_COUNT, Math.floor(avail / itemMain)));
}

function fakeScalar(text: string): ScalarNode {
  return { kind: "scalar", text, quoted: false, range: { start: 0, end: 0 } };
}

function fillFrom(block: BlockNode, consts: Map<string, number>, defs: GuiDefs): Fill {
  const fill: Fill = {};
  // `background = { using = Background_Area_Dark }` carries its texture via
  // the template; expandWidget with an unknown key just splices templates.
  const { statements } = expandWidget("#background", block, defs);
  let sprite: number[] | undefined;
  const side: { l?: number; t?: number; r?: number; b?: number } = {};
  for (const stmt of statements) {
    if (stmt.kind !== "assignment") continue;
    const k = stmt.key.text.toLowerCase();
    if (k === "texture" && stmt.value?.kind === "scalar") fill.texture = stmt.value.text;
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
      const [ml, mt, mr, mb] = margins(node);
      const spacing = num(node, "spacing") ?? 0;
      let main = 0;
      let cross = 0;
      node.children.forEach((c, i) => {
        const s = naturalSize(c, measurer);
        const cm = node.vertical ? s.h : s.w;
        const cc = node.vertical ? s.w : s.h;
        main += cm + (i > 0 ? spacing : 0);
        cross = Math.max(cross, cc);
      });
      return node.vertical
        ? { w: cross + ml + mr, h: main + mt + mb }
        : { w: main + ml + mr, h: cross + mt + mb };
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
    case "container":
    case "marginwidget": {
      const explicit = explicitSize(node);
      if (explicit) return explicit;
      // Hug the extent of children at their positions (B2-I4). Anchored
      // children inside a hugging container are unmeasured; extent uses
      // position + natural size only.
      const [ml, mt] = margins(node);
      let w = 0;
      let h = 0;
      for (const c of node.children) {
        const s = naturalSize(c, measurer);
        const pos = c.pairs.get("position") ?? [0, 0];
        w = Math.max(w, (pos[0] ?? 0) + s.w);
        h = Math.max(h, (pos[1] ?? 0) + s.h);
      }
      return { w: w + ml, h: h + mt };
    }
    default: {
      // Plain widget/icon/window: explicit size or ZERO — no hug (B4-T1).
      const explicit = explicitSize(node);
      if (!explicit) return { w: 0, h: 0 };
      const scale = num(node, "scale") ?? 1; // multiplies the rect (B4-T4)
      return { w: explicit.w * scale, h: explicit.h * scale };
    }
  }
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
  forced?: LayoutRect
): LayoutNode {
  const rect = forced ?? placeInParent(node, content, measurer);
  const srcPosition = node.pairs.get("position");
  const srcSize = node.pairs.get("size");
  const out: LayoutNode = {
    key: node.key,
    name: str(node, "name"),
    rect,
    clip: node.cls === "scrollarea",
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
    out.fill = { texture: str(node, "texture"), color, border };
  }

  switch (node.cls) {
    case "box":
      out.children = arrangeBoxChildren(node, rect, measurer);
      break;
    case "flow":
      out.children = arrangeFlowChildren(node, rect, measurer);
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
      out.children = node.children.map((c) => arrange(c, inner, "plain", measurer));
      break;
    }
    default:
      out.children = node.children.map((c) => arrange(c, rect, "plain", measurer));
      break;
  }
  return out;
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
  } else {
    const explicit = explicitSize(node);
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
function arrangeBoxChildren(box: WNode, rect: LayoutRect, measurer: TextMeasurer): LayoutNode[] {
  const vertical = box.vertical;
  const [ml, mt, mr, mb] = margins(box);
  const spacing = num(box, "spacing") ?? 0;
  const contentMain = vertical ? rect.h - mt - mb : rect.w - ml - mr;
  const contentCross = vertical ? rect.w - ml - mr : rect.h - mt - mb;
  const n = box.children.length;
  if (n === 0) return [];

  const naturals = box.children.map((c) => {
    if (c.cls === "box") {
      // box-in-box hugs (B2-I2)
      return naturalSize(c, measurer);
    }
    return resolvedChildSize(c, rect, measurer);
  });
  const mains = naturals.map((s) => (vertical ? s.h : s.w));
  const crosses = naturals.map((s) => (vertical ? s.w : s.h));

  let free = contentMain - mains.reduce((a, b) => a + b, 0) - spacing * (n - 1);
  const mainPolicies = box.children.map((c) => policy(c, !vertical));
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
    const shrinkers = mainPolicies
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p === "preferred" || p === "shrinking");
    if (shrinkers.length > 0) {
      const delta = free / shrinkers.length; // equal delta (B3-P4)
      for (const { i } of shrinkers) mains[i] = Math.max(0, mains[i] + delta);
      free = 0;
    }
    // No shrinkable children: keep floors and overflow, packed (unmeasured).
    if (free < 0) free = 0;
  }

  const side = free / (2 * n); // space-around (B1-E/F)
  const crossPolicies = box.children.map((c) => policy(c, vertical));
  const out: LayoutNode[] = [];
  let cursor = (vertical ? rect.y + mt : rect.x + ml) + side;
  for (let i = 0; i < n; i++) {
    const child = box.children[i];
    const main = mains[i];
    const stretchCross =
      crossPolicies[i] === "expanding" || crossPolicies[i] === "growing" || crossPolicies[i] === "preferred";
    const cross = stretchCross ? contentCross : Math.min(crosses[i], Number.POSITIVE_INFINITY);
    const crossOffset =
      (vertical ? rect.x + ml : rect.y + mt) + (stretchCross ? 0 : (contentCross - cross) / 2);
    // `position` on a box child is applied as an extra offset (unmeasured;
    // vanilla advice is to never anchor/position inside boxes).
    const pos = child.pairs.get("position") ?? [0, 0];
    const forced: LayoutRect = vertical
      ? { x: crossOffset + (pos[0] ?? 0), y: cursor + (pos[1] ?? 0), w: cross, h: main }
      : { x: cursor + (pos[0] ?? 0), y: crossOffset + (pos[1] ?? 0), w: main, h: cross };
    out.push(arrange(child, forced, "box", measurer, forced));
    cursor += main + 2 * side + spacing;
  }
  return out;
}

/** flowcontainer: pack children from the origin, never wrap (B2-K, B3-Q1). */
function arrangeFlowChildren(flow: WNode, rect: LayoutRect, measurer: TextMeasurer): LayoutNode[] {
  const spacing = num(flow, "spacing") ?? 0;
  const out: LayoutNode[] = [];
  let cursor = flow.vertical ? rect.y : rect.x;
  for (const child of flow.children) {
    const s = resolvedChildSize(child, rect, measurer);
    // Cross-axis alignment inside a flow is unmeasured (all calibration
    // children were equal-height); origin-aligned here.
    const forced: LayoutRect = flow.vertical
      ? { x: rect.x, y: cursor, w: s.w, h: s.h }
      : { x: cursor, y: rect.y, w: s.w, h: s.h };
    out.push(arrange(child, forced, "flow", measurer, forced));
    cursor += (flow.vertical ? s.h : s.w) + spacing;
  }
  return out;
}

/** Child size with % and scale resolved (children of boxes/flows). */
function resolvedChildSize(
  node: WNode,
  parentRect: LayoutRect,
  measurer: TextMeasurer
): { w: number; h: number } {
  if (node.cls === "textbox") return textSize(node, measurer).size;
  const explicit = explicitSize(node);
  if (node.cls !== "box" && explicit) {
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
