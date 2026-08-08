/**
 * paradox/guiWidgetInfo backend: the properties of ONE widget, with the
 * template/type chain each value came from. This is the designer inspector's
 * read side.
 *
 * Two rules keep it honest:
 * - It addresses the widget the way the WRITER does (`findWidgetAtLine` over
 *   the source model), so what the inspector lists is what a `setProperties`
 *   op would rewrite, on the same line, in the same file.
 * - It resolves the widget the way the ENGINE does (`effectiveDefs` +
 *   `expandWidgetWithOrigins`), so it cannot list a value the canvas did not
 *   lay the widget out with. Last-in-wins per key, exactly as the engine reads
 *   an expanded body.
 *
 * Values are rendered from the parser's own tokens rather than sliced out of
 * the document: a property inherited from a type lives in another file, whose
 * text the def store does not keep.
 *
 * Three answers ride on the same expansion, so none of them can disagree with
 * the property list: what a row OVERRIDES (the values the same key had before
 * it), the TEXTURES the widget draws (with their frame-sheet grid), and, when
 * the caller asks for it, the PLACEMENT trace explaining the widget's rect.
 * The placement trace is the only one that costs a layout run, so it is the
 * only one behind a flag.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */
import type {
  GuiPlacement,
  GuiTextureInfo,
  GuiWidgetInfo,
  GuiWidgetOverride,
  GuiWidgetProperty,
} from "@px-lsp/protocol/protocol";
import type { BlockNode, Statement, ValueNode } from "../parser";
import {
  computeGuiLayout,
  effectiveDefs,
  PROPERTY_BLOCKS,
  resolveFill,
  type Fill,
  type PlacementExplain,
} from "./layoutEngine";
import { expandWidgetWithOrigins, typeBaseChain, type GuiDefs } from "./guiDefs";
import { findWidgetAtLine, parseGuiSource, type GuiSourceFile } from "./sourceModel";
import { describeTexture, type TextureRoots } from "./textureInfo";

/** Marker words whose assignment is a named slot, not a property. */
const SLOT_KEYS = new Set(["block", "blockoverride"]);

/** Marker words that turn the FOLLOWING assignment into a declaration. */
const DECL_MARKERS = new Set(["template", "local_template", "types", "type", "block", "blockoverride"]);

export interface WidgetInfoOptions {
  /** Run the layout with an explanation trace and fill `placement`. */
  placement?: boolean;
  /** Roots a texture path resolves against; without them a texture row carries
   * the path alone (no sheet size, so no grid). */
  roots?: TextureRoots;
  /** Viewport the placement trace lays out against; the service's own default. */
  viewport?: { w: number; h: number };
}

export function computeGuiWidgetInfo(
  text: string,
  line: number,
  store?: GuiDefs,
  options?: WidgetInfoOptions
): GuiWidgetInfo | null {
  const file = parseGuiSource(text);
  const target = findWidgetAtLine(file, line);
  if (!target || !target.block) return null;
  // A template/type DECLARATION is not an instance: expanding its own name
  // would splice the definition into itself. The canvas never selects one.
  if (target.marker) return null;

  const defs = effectiveDefs(text, store);
  const expanded = expandWidgetWithOrigins(target.key, target.block, defs);

  // Last-in-wins per key, and the winner keeps the position it was written at:
  // inherited rows stay where the type put them, an override moves down to the
  // instance body, which is where its bytes are.
  const byKey = new Map<string, GuiWidgetProperty>();
  // The same winners as raw nodes, for the readers that need structure rather
  // than a rendering (textures, frame sheets).
  const rawByKey = new Map<string, ValueNode>();
  let marker: string | null = null;
  for (const { stmt, origin } of expanded.statements) {
    if (stmt.kind === "value") {
      marker =
        stmt.value.kind === "scalar" && DECL_MARKERS.has(stmt.value.text.toLowerCase())
          ? stmt.value.text.toLowerCase()
          : null;
      continue;
    }
    const wasDecl = marker !== null;
    marker = null;
    if (wasDecl || !stmt.value) continue;
    const keyLower = stmt.key.text.toLowerCase();
    if (SLOT_KEYS.has(keyLower)) continue;
    // The inverse rule the writer and the engine share: a block child is a
    // widget unless its key is a known attribute block.
    if (stmt.value.kind === "block" && !PROPERTY_BLOCKS.has(keyLower)) continue;
    const shadowed = byKey.get(keyLower);
    // The shadowed value is the "overrides X from template Y" note: it is the
    // engine's own discard, recorded where the discard happens rather than
    // reconstructed from a second walk.
    const overrides: GuiWidgetOverride[] | undefined = shadowed
      ? [...(shadowed.overrides ?? []), { value: shadowed.value, origin: shadowed.origin }]
      : undefined;
    byKey.delete(keyLower);
    byKey.set(keyLower, {
      key: stmt.key.text,
      value: renderValue(stmt.value),
      origin,
      ...(overrides ? { overrides } : {}),
    });
    rawByKey.set(keyLower, stmt.value);
  }

  const info: GuiWidgetInfo = {
    key: target.key,
    name: nameOf(expanded.statements),
    typeChain: typeBaseChain(target.key, [defs]),
    properties: [...byKey.values()],
    textures: texturesOf(rawByKey, constantsIn(file), defs, options?.roots),
  };

  if (options?.placement) {
    // The trace is what the flag gates: an ordinary layout never records it,
    // so the default path stays at today's cost.
    const explain: PlacementExplain = { line: target.line };
    computeGuiLayout(text, { defs: store, viewport: options.viewport, explain });
    // Placement is structurally the wire type, like LayoutNode is.
    if (explain.result) info.placement = explain.result as unknown as GuiPlacement;
  }
  return info;
}

/** The widget's effective `name`, last-in-wins like every other scalar. */
function nameOf(statements: readonly { stmt: Statement }[]): string | undefined {
  let found: string | undefined;
  for (const { stmt } of statements) {
    if (stmt.kind !== "assignment" || stmt.value?.kind !== "scalar") continue;
    if (stmt.key.text.toLowerCase() === "name") found = stmt.value.text;
  }
  return found;
}

/** Top-level `@name = 42` constants, which a `framesize` or `frame` may use. */
function constantsIn(file: GuiSourceFile): Map<string, number> {
  const consts = new Map<string, number>();
  for (const entry of file.root.entries) {
    if (!entry.key.startsWith("@") || entry.valueKind !== "scalar" || entry.value === null) continue;
    const v = parseFloat(entry.value);
    if (Number.isFinite(v)) consts.set(entry.key, v);
  }
  return consts;
}

/**
 * The textures the widget draws: its own fill first, then its background. Read
 * off the same last-in-wins winners the property list came from, and the
 * background through the engine's own `resolveFill`, so a row here names a
 * texture the canvas drew.
 */
function texturesOf(
  raw: Map<string, ValueNode>,
  consts: Map<string, number>,
  defs: GuiDefs,
  roots?: TextureRoots
): GuiTextureInfo[] {
  const out: GuiTextureInfo[] = [];
  const own = raw.get("texture");
  if (own?.kind === "scalar") {
    const framesize = numberPair(raw.get("framesize"), consts);
    out.push(
      describeTexture(
        {
          texture: own.text,
          framesize,
          frame: framesize ? numberOf(raw.get("frame"), consts) : undefined,
        },
        "fill",
        roots
      )
    );
  }
  const background = raw.get("background");
  const block: BlockNode | null =
    background?.kind === "block" ? background : background?.kind === "tagged-block" ? background.block : null;
  if (block) {
    const fill: Fill = resolveFill(block, consts, defs);
    if (fill.texture !== undefined) {
      out.push(
        describeTexture(
          { texture: fill.texture, framesize: fill.framesize, frame: fill.frame },
          "background",
          roots
        )
      );
    }
  }
  return out;
}

function numberOf(value: ValueNode | undefined, consts: Map<string, number>): number | undefined {
  if (value?.kind !== "scalar") return undefined;
  if (value.text.startsWith("@")) return consts.get(value.text);
  const v = parseFloat(value.text);
  return Number.isFinite(v) ? v : undefined;
}

function numberPair(value: ValueNode | undefined, consts: Map<string, number>): [number, number] | undefined {
  if (value?.kind !== "block") return undefined;
  const nums: number[] = [];
  for (const s of value.statements) {
    if (s.kind !== "value" || s.value.kind !== "scalar") continue;
    const n = numberOf(s.value, consts);
    nums.push(n ?? 0);
  }
  return nums.length >= 2 ? [nums[0], nums[1]] : undefined;
}

/**
 * A value as authored, from the tokens alone. Quoted scalars keep their quotes
 * (`.gui` distinguishes them and the row should read like the source); a block
 * renders with single spaces, so the rendering is independent of the interior
 * whitespace of a file this reader may not have.
 */
function renderValue(value: ValueNode): string {
  if (value.kind === "scalar") return value.quoted ? `"${value.text}"` : value.text;
  if (value.kind === "tagged-block") return `${value.tag.text} ${renderValue(value.block)}`;
  const parts = value.statements.map(renderStatement);
  return parts.length === 0 ? "{}" : `{ ${parts.join(" ")} }`;
}

function renderStatement(stmt: Statement): string {
  if (stmt.kind === "value") return renderValue(stmt.value);
  const key = stmt.key.quoted ? `"${stmt.key.text}"` : stmt.key.text;
  if (!stmt.value) return stmt.op === null ? key : `${key} ${stmt.op}`;
  const value = renderValue(stmt.value);
  return stmt.op === null ? `${key} ${value}` : `${key} ${stmt.op} ${value}`;
}
