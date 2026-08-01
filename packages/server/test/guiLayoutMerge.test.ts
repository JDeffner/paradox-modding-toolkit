/**
 * G2 layout merge: goldens for the rules that came in from spec.md's
 * "Studio-verified engine behaviors" section (the Sage's Clausewitz Studio
 * calibration mod's in-game session of 2026-07-17 plus the rules its engine
 * encodes), over the .gui corpus authored in G0. Row ids are
 * docs/gui-designer/parity-checklist.md's; every expected rect is DERIVED from
 * the spec's own formulas, with the derivation in the comment whenever it is
 * not one number.
 *
 * guiLayout.test.ts keeps the batch 01-04 calibration goldens; nothing here
 * changes one. Three checklist rows are DISPUTED between the two engines
 * (L07c, L13e, L23) and are deliberately NOT asserted in either direction —
 * each needs one in-game probe, and the fixture that carries it is named below
 * so the probe has a subject.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { computeFrameCell, computeGuiLayout, type LayoutNode } from "../src/gui/layoutEngine";

const FIXTURES = path.join(__dirname, "fixtures", "gui", "layout");
const RECT_BASELINE = path.join(__dirname, "fixtures", "gui", "layout-rects.baseline.txt");

function layoutFile(file: string): LayoutNode[] {
  const text = fs.readFileSync(path.join(FIXTURES, file), "utf8");
  return computeGuiLayout(text, { viewport: { w: 1920, h: 1080 } });
}

function layoutText(snippet: string): LayoutNode {
  const nodes = computeGuiLayout(snippet, { viewport: { w: 1000, h: 1000 } });
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
}

/** Every layout fixture names its widgets, so tests address them by name. */
function named(nodes: LayoutNode[], name: string): LayoutNode {
  const stack = [...nodes];
  while (stack.length > 0) {
    const n = stack.shift()!;
    if (n.name === name) return n;
    stack.push(...n.children);
  }
  throw new Error(`no widget named ${name}`);
}

/**
 * Rects compared at 2 decimals: expectations are the exact fractional model
 * (spec.md rasterizes within +-1px), so this only absorbs float noise while
 * still printing both rects on a failure.
 */
function expectRect(node: LayoutNode, x: number, y: number, w: number, h: number) {
  const round = (v: number) => Math.round(v * 100) / 100;
  const r = node.rect;
  expect([r.x, r.y, r.w, r.h].map(round)).toEqual([x, y, w, h].map(round));
}

describe("L03d/L04b/L04c: policy tiers the corpus never asserted", () => {
  const policies = layoutFile("box-policies.gui");

  it("L03d: two growers with no expander share the free space equally", () => {
    // px_growers_row fills its 300x80 parent. Floors 100 + 0 + 0 = 100, so
    // free = 200 and the two growers take free/2 = 100 each (spec.md: growing
    // "behaves like expanding when alone"). Residual free is 0, side = 0.
    const fixed = named(policies, "px_growers_fixed");
    const a = named(policies, "px_growers_a");
    const b = named(policies, "px_growers_b");
    expectRect(fixed, 0, 220, 100, 40); // cross-centred: 200 + (80-40)/2
    expectRect(a, 100, 220, 100, 40);
    expectRect(b, 200, 220, 100, 40);
  });

  it("L04b: a fixed child never shrinks; the shrinkable sibling eats the deficit", () => {
    // 600 + 600 in a 1000 box = 200 of deficit. Only px_deficit_soft is
    // shrinkable (preferred), so it loses all 200: 600 -> 400. The fixed
    // sibling keeps its 600 (spec.md deficit rule: each SHRINKABLE child).
    expectRect(named(policies, "px_deficit_hard"), 0, 520, 600, 40);
    expectRect(named(policies, "px_deficit_soft"), 600, 520, 400, 40);
  });

  it("L04c: a floored child stops at its minimumsize and the rest absorb the rest", () => {
    // No corpus fixture carries `minimumsize` (recorded as a G0 gap in the
    // checklist row), so the shape is inline. 200 + 200 in a 200 box = 400 of
    // content, 200 of deficit over two shrinkers = 100 each. A floors at its
    // minimumsize 120 so it can only give 80; the leftover 20 redistributes
    // onto B, which lands at 200 - 100 - 20 = 80. Total 120 + 80 = 200: it
    // fits, which the old single-pass clamp could not guarantee.
    const box = layoutText(`
widget = { size = { 200 80 } hbox = {
	widget = { name = "a" layoutpolicy_horizontal = shrinking minimumsize = { 120 0 } size = { 200 40 } }
	widget = { name = "b" layoutpolicy_horizontal = shrinking size = { 200 40 } }
} }`).children[0];
    expectRect(box.children[0], 0, 20, 120, 40);
    expectRect(box.children[1], 120, 20, 80, 40);
  });

  it("L04c: minimumsize is an attribute block, never a phantom child widget", () => {
    // It used to be walked as a child, which cost a box child a whole
    // space-around slot on the 413 vanilla widgets that carry one.
    const box = layoutText(
      `widget = { size = { 200 80 } hbox = { widget = { minimumsize = { 0 10 } size = { 40 40 } } } }`
    ).children[0];
    expect(box.children).toHaveLength(1);
    expectRect(box.children[0], 80, 20, 40, 40); // free 160, n=1, side 80
  });
});

describe("L12b/L31: what a box drops on its children", () => {
  const ignored = layoutFile("box-child-ignored.gui");

  it("L12b: align and parentanchor on a box child do nothing", () => {
    // px_ignored_column fills 420x300 with five 100x30 children: free =
    // 300 - 150 = 150, n = 5, side = 15, so the slots start at 15 and stride
    // 30 + 2*15 = 60. Cross placement is unconditional centring:
    // x = (420 - 100)/2 = 160 for every one of them, whatever it asks for.
    // (Studio §H, in-game 2026-07-17.)
    expectRect(named(ignored, "px_plain"), 160, 15, 100, 30);
    expectRect(named(ignored, "px_anchored"), 160, 135, 100, 30);
    expectRect(named(ignored, "px_align_left"), 160, 195, 100, 30);
    expectRect(named(ignored, "px_align_right"), 160, 255, 100, 30);
    // px_positioned is the L23 probe (does a box drop a child's `position`?).
    // The two engines DISAGREE and both measured; unasserted until the probe
    // is re-run in game. See parity-checklist.md §G.
  });

  it("L31: an expanding child takes main-axis space without defining the cross size", () => {
    // px_cross_column fills 420x200. Main axis is vertical: floors 30 + 30,
    // free = 140, and the one expanding child takes 30 + 140 = 170. Cross:
    // neither child sets layoutpolicy_horizontal, so both are centred at their
    // OWN width — the expander stays 60 wide and does not widen the column.
    expectRect(named(ignored, "px_cross_column"), 0, 320, 420, 200);
    expectRect(named(ignored, "px_cross_fixed"), 60, 320, 300, 30);
    expectRect(named(ignored, "px_cross_expander"), 180, 350, 60, 170);
  });
});

describe("L26: margins only where the engine honors them", () => {
  const margins = layoutFile("box-margins.gui");

  it("`margin` on a plain widget is ignored; margin_widget offsets its children", () => {
    // Same margin = { 20 10 } on both, same 100%x100% rect. Only the
    // margin_widget moves its child's origin (B3-Q2/B4-T3); the plain widget
    // drops the attribute (spec.md "Container sizing").
    expectRect(named(margins, "px_plain_margin"), 0, 420, 200, 120);
    expectRect(named(margins, "px_plain_margin_kid"), 0, 420, 40, 40);
    expectRect(named(margins, "px_margin_widget_full"), 0, 280, 200, 120);
    expectRect(named(margins, "px_margin_widget_kid"), 20, 290, 40, 40);
  });
});

describe("L17b: clipping containers", () => {
  const clipping = layoutFile("clipping.gui");

  it("scrollarea, scrollbox and scissor = yes clip; a plain widget does not", () => {
    expect(named(clipping, "px_noclip").clip).toBe(false);
    expect(named(clipping, "px_scissor").clip).toBe(true);
    expect(named(clipping, "px_scrollarea").clip).toBe(true);
    expect(named(clipping, "px_scrollbox").clip).toBe(true);
  });

  it("L17c: a clipped descendant keeps its true rect; the renderer clips it", () => {
    // Deliberate divergence, not an unimplemented rule: the Studio clamps in
    // the flatten, this engine reports true geometry and marks the clipper, and
    // the client (guiPreview) clips. B3-R1's golden in guiLayout.test.ts pins
    // the unclamped corner, so flipping it here would rewrite a measured
    // golden. Same pixels either way.
    expectRect(named(clipping, "px_scroll_corner"), 400, 280, 20, 20);
    expectRect(named(clipping, "px_scrollbox_spill"), 120, 140, 300, 40);
    expectRect(named(clipping, "px_scissor_spill"), 0, 120, 200, 40);
  });
});

describe("L25/L11c/L10: container and item content sizing", () => {
  const containers = layoutFile("container-measurability.gui");

  it("a container hugs its positioned children exactly", () => {
    // (0,0)+40x30 and (60,15)+20x20 -> 80 x 35 (B2-I4).
    expectRect(named(containers, "px_container_measurable"), 0, 0, 80, 35);
    expectRect(named(containers, "px_container_a"), 0, 0, 40, 30);
    expectRect(named(containers, "px_container_b"), 60, 15, 20, 20);
  });

  it("L25: an EMPTY container collapses to 0, its `size` does not hold it open", () => {
    // Authored size = { 120 60 }, no children: it sizes to content, so 0.
    expectRect(named(containers, "px_container_empty"), 0, 100, 0, 0);
  });

  it("L11c: a plainly hidden child is skipped and the rest still content-size", () => {
    // 300x300 hidden + 25x25 shown -> the container is 25x25, not 300x300.
    // The hidden child keeps a rect of its own (the engine reports geometry;
    // hiding is the renderer's job), it just does not size the parent.
    expectRect(named(containers, "px_container_hidden_skipped"), 200, 200, 25, 25);
    expectRect(named(containers, "px_shown_small"), 200, 200, 25, 25);
  });

  it("L10: a datamodel item content-sizes, and a positioned child extends it", () => {
    // px_item_content_size: item content = one 23x23 child -> 23x23 items at
    // the fixedgridbox's cell origins (stride addrow = 48).
    const sized = named(containers, "px_item_content_size");
    expect(sized.children).toHaveLength(3);
    sized.children.forEach((item, i) => {
      expect(item.key).toBe("item");
      expect(item.ghost).toBe(true);
      expectRect(item, 200, 300 + i * 48, 23, 23);
    });

    // px_item_content_offset: the child sits at (30,10) and is 20x20, so the
    // item's box reaches its far edge: 50 x 30, the way a container's does.
    const offset = named(containers, "px_item_content_offset");
    expectRect(offset.children[0], 200, 380, 50, 30);
    expectRect(offset.children[0].children[0], 230, 390, 20, 20);
    expectRect(offset.children[2], 200, 380 + 2 * 48, 50, 30);
  });
});

describe("L13d: flowcontainer honors a child's parentanchor on the cross axis", () => {
  const flow = layoutFile("flow-container.gui");

  it("the one container that does; unset anchors keep the measured origin run", () => {
    // px_flow_anchor_run hugs: 100 + spacing 5 + 50 = 155 wide, 30 tall (the
    // tallest child), at the parent's origin (220,220). px_flow_anchor_low
    // asks for parentanchor = bottom, and widgetanchor mirrors it (B1-B), so
    // y = 220 + 1*30 - 1*20 = 230: its bottom edge meets the run's.
    expectRect(named(flow, "px_flow_anchor_run"), 220, 220, 155, 30);
    expectRect(named(flow, "px_flow_anchor_tall"), 220, 220, 100, 30);
    expectRect(named(flow, "px_flow_anchor_low"), 325, 230, 50, 20);
    // No anchor asked for -> the origin alignment measured in B2-K1.
    expectRect(named(flow, "px_flow_a"), 0, 0, 50, 30);
    expectRect(named(flow, "px_flow_b"), 50, 0, 50, 30);
    // px_flow_sized is the L13e probe (does an explicit `size` set the flow's
    // own rect, B3-Q1, or is it dropped like a box's, Studio GUI009?). The two
    // sides DISAGREE; B3-Q1's golden stands and nothing new is asserted here.
  });
});

describe("L27: ignoreinvisible", () => {
  const inv = layoutFile("ignoreinvisible.gui");

  it("a `visible = no` child collapses out of a box and the siblings shift up", () => {
    // Two laid-out children of 30 in a 400-tall column: free = 340, n = 2,
    // side = 85. Slots at 85 and 85 + 30 + 2*85 = 285. The hidden child stays
    // in the tree as a zero rect at the cursor, so nothing is drawn for it.
    expectRect(named(inv, "px_collapse_first"), 100, 85, 100, 30);
    expectRect(named(inv, "px_collapse_last"), 100, 285, 100, 30);
    const hidden = named(inv, "px_collapse_hidden");
    expect([hidden.rect.w, hidden.rect.h]).toEqual([0, 0]);
  });

  it("`ignoreinvisible = no` keeps the hidden child's slot", () => {
    // Three children of 30 in 400: free = 310, n = 3, side = 310/6, slots at
    // 310/6, then + 30 + 310/3 each: 185 and 955/3.
    const side = 310 / 6;
    expectRect(named(inv, "px_keep_first"), 220, side, 100, 30);
    expectRect(named(inv, "px_keep_hidden"), 220, 185, 100, 30);
    expectRect(named(inv, "px_keep_last"), 220, 955 / 3, 100, 30);
  });

  it("a binding-valued `visible` is KEPT: a static preview cannot evaluate it", () => {
    // The engine collapses a binding that evaluates false at runtime, but the
    // preview has no runtime. Showing it is the non-destructive default, and
    // it is the same unknown that makes a container unmeasurable (L11b).
    // Same three-child distribution as above, translated by position 0,200.
    expectRect(named(inv, "px_bound_first"), 100, 200 + 310 / 6, 100, 30);
    expectRect(named(inv, "px_bound_maybe"), 100, 385, 100, 30);
    expectRect(named(inv, "px_bound_last"), 100, 200 + 955 / 3, 100, 30);
  });
});

describe("L28: resizeparent", () => {
  const rp = layoutFile("resizeparent.gui");

  it("the widget resizes its PARENT to its own content extent", () => {
    // px_rp_host authors 400x300, but its child carries resizeparent = yes, so
    // it takes that child's content extent instead: px_rp_direct reaches
    // (120,40) and px_rp_holder sits at y 60 with a zero rect of its own
    // (B4-T1), so the extent is 120 x 60.
    expectRect(named(rp, "px_resizeparent_frame"), 0, 0, 400, 300); // only the direct parent
    expectRect(named(rp, "px_rp_host"), 0, 0, 120, 60);
    // Both fixed-size widgets keep their size. The source's "a fixed-size
    // DIRECT child CAN be collapsed" side effect is not implemented: "can" is
    // not a rect rule, so the nested/direct pair is pinned as-is instead.
    expectRect(named(rp, "px_rp_direct"), 0, 0, 120, 40);
    expectRect(named(rp, "px_rp_nested"), 0, 60, 120, 40);
  });
});

describe("L14/L29: fixedgridbox cell math", () => {
  const grid = layoutFile("grid-fixed.gui");

  it("L14a/L14b: addcolumn/addrow are the cell size and the stride, vertical by default", () => {
    // 14px items in 60x40 cells stay 14px at the cell ORIGIN, one whole cell
    // apart (Studio §K v3). No datamodel_wrap: one column.
    const vertical = named(grid, "px_fixed_vertical");
    expectRect(vertical.children[0], 0, 0, 14, 14);
    expectRect(vertical.children[1], 0, 40, 14, 14);
    expectRect(vertical.children[2], 0, 80, 14, 14);
  });

  it("L14b: flipdirection transposes the fill, maxhorizontalslots caps it", () => {
    // flipdirection = yes fills ACROSS a row and does not mirror: the grid
    // still starts at its top-left. datamodel_wrap 3 keeps all three in one
    // row, one cell (60) apart, from the grid's origin at x = 100.
    const flipped = named(grid, "px_fixed_horizontal");
    expectRect(flipped.children[0], 100, 0, 14, 14);
    expectRect(flipped.children[1], 160, 0, 14, 14);
    expectRect(flipped.children[2], 220, 0, 14, 14);

    // maxhorizontalslots = 2 caps the row at 2, so the third wraps DOWN one
    // cell (addrow = 40) to the start of the next row.
    const capped = named(grid, "px_fixed_capped");
    expectRect(capped.children[0], 320, 0, 14, 14);
    expectRect(capped.children[1], 380, 0, 14, 14);
    expectRect(capped.children[2], 320, 40, 14, 14);
  });

  it("L14c: an item with no concrete size anywhere takes the CELL size", () => {
    // The item wraps a button with no size, which wraps a 100%-fill widget, so
    // nothing in the chain is concrete: the item takes 350x57, the cell.
    const fill = named(grid, "px_fixed_no_intrinsic");
    expectRect(fill.children[0], 0, 200, 350, 57);
    expectRect(fill.children[1], 0, 257, 350, 57);
    // The sizeless button INSIDE it is still a zero rect (B4-T1 is measured
    // and unchanged); only the item takes the cell.
    expectRect(fill.children[0].children[0], 0, 200, 0, 0);
  });

  it("L14d: a grid with no item template still slots its ordinary children", () => {
    // px_fixed_decorative has neither, so the corpus only pins that it stays
    // an empty, finite node; the slotting itself is the inline case below.
    expectRect(named(grid, "px_fixed_decorative"), 560, 200, 0, 0);
    const decorative = layoutText(`
widget = { size = { 300 200 }
	fixedgridbox = {
		addcolumn = 60
		addrow = 40
		widget = { name = "px_slot_a" size = { 20 20 } }
		widget = { name = "px_slot_b" size = { 20 20 } }
	}
}`).children[0];
    expectRect(decorative.children[0], 0, 0, 20, 20);
    expectRect(decorative.children[1], 0, 40, 20, 20);
  });

  it("L29: setitemsizefromcell makes every cell the widest item's size", () => {
    // addcolumn/addrow say 120x24, but with setitemsizefromcell = yes the cell
    // comes from the items instead: all three are 40x20, so the stride is 20
    // down the column rather than 24.
    const uniform = named(grid, "px_fixed_uniform");
    expectRect(uniform.children[0], 380, 200, 40, 20);
    expectRect(uniform.children[1], 380, 220, 40, 20);
    expectRect(uniform.children[2], 380, 240, 40, 20);
  });
});

describe("L15: dynamicgridbox packs at the item's own size", () => {
  const grid = layoutFile("grid-dynamic.gui");

  it("vertical by default; addcolumn is NOT the stride here", () => {
    // 40px items with addcolumn = 70 pack 40 apart, down one column
    // (datamodel_wrap = 3 is items-per-COLUMN, and there are three).
    const vertical = named(grid, "px_dyn_vertical");
    expectRect(vertical.children[0], 0, 0, 40, 40);
    expectRect(vertical.children[1], 0, 40, 40, 40);
    expectRect(vertical.children[2], 0, 80, 40, 40);
  });

  it("flipdirection transposes without mirroring; maxhorizontalslots caps the row", () => {
    const horizontal = named(grid, "px_dyn_horizontal");
    expectRect(horizontal.children[0], 0, 320, 40, 40);
    expectRect(horizontal.children[1], 40, 320, 40, 40);
    expectRect(horizontal.children[2], 80, 320, 40, 40);

    // Capped at 2 per row: the third wraps down by the row's own height (40),
    // not by addrow.
    const capped = named(grid, "px_dyn_capped");
    expectRect(capped.children[0], 320, 320, 40, 40);
    expectRect(capped.children[1], 360, 320, 40, 40);
    expectRect(capped.children[2], 320, 360, 40, 40);
  });
});

describe("L21a-d: sprite fill mode", () => {
  const sprites = layoutFile("sprite-nineslice.gui");

  it("nine-slice needs BOTH a Cornered* type and a non-zero border", () => {
    // Studio §J1-J7, in-game 2026-07-17. `border` stays the parsed attribute
    // in every case (the phase-2 goldens assert that); `mode` says whether it
    // applies, which is what §J4 measured the toolkit getting wrong.
    expect(named(sprites, "px_ns_native").fill?.mode).toBe("stretch");
    expect(named(sprites, "px_ns_tiled_border").fill?.mode).toBe("nineslice-tile");
    expect(named(sprites, "px_ns_stretch_bord").fill?.mode).toBe("nineslice-stretch");
    expect(named(sprites, "px_ns_corner_clamp").fill?.mode).toBe("nineslice-stretch");
  });

  it("a border with no Cornered* type is ignored: the whole texture stretches", () => {
    const borderOnly = named(sprites, "px_ns_border_only");
    expect(borderOnly.fill?.mode).toBe("stretch"); // §J4
    expect(borderOnly.fill?.border).toEqual([16, 16, 16, 16]); // still parsed
  });

  it("a tiled type with no border tiles the whole texture", () => {
    expect(named(sprites, "px_ns_type_only").fill?.mode).toBe("tile"); // §J6
    expect(named(sprites, "px_ns_tiled_type").fill?.mode).toBe("tile");
  });

  it("the mode reaches a background block, with its asymmetric border", () => {
    const asymmetric = named(sprites, "px_ns_asymmetric");
    expect(asymmetric.bg?.mode).toBe("nineslice-tile"); // §J7
    expect(asymmetric.bg?.border).toEqual([16, 8, 16, 8]); // x = left/right, y = top/bottom
    const perSide = named(sprites, "px_ns_per_side");
    expect(perSide.bg?.mode).toBe("nineslice-stretch");
    expect(perSide.bg?.border).toEqual([10, 5, 10, 20]);
  });
});

describe("L22: frame sheets", () => {
  const frames = layoutFile("sprite-framesize.gui");

  it("framesize and frame reach the fill", () => {
    const first = named(frames, "px_frame_1");
    expect(first.fill?.framesize).toEqual([32, 32]);
    expect(first.fill?.frame).toBe(1);
    expect(named(frames, "px_frame_clamp_low").fill?.frame).toBe(0);
    expect(named(frames, "px_frame_centre").fill?.framesize).toEqual([249, 78]);
  });

  it("the grid is row-major and 1-based, and out-of-range frames clamp", () => {
    // 96x64 at framesize 32x32 is a 3x2 grid: index = frame - 1, column =
    // index % 3, row = index / 3 (Studio §L, in-game 2026-07-17).
    const cell = (frame: number) => computeFrameCell([32, 32], frame, 96, 64);
    expect(cell(1)).toEqual({ sx: 0, sy: 0, sw: 32, sh: 32 });
    expect(cell(3)).toEqual({ sx: 64, sy: 0, sw: 32, sh: 32 });
    expect(cell(4)).toEqual({ sx: 0, sy: 32, sw: 32, sh: 32 }); // wraps DOWN
    expect(cell(6)).toEqual({ sx: 64, sy: 32, sw: 32, sh: 32 });
    expect(cell(0)).toEqual(cell(1)); // frame <= 0 clamps to the first cell
    expect(cell(7)).toEqual(cell(6)); // past the last clamps to the last

    // The vanilla shape check: 747x234 at framesize 249x78 is 3x3, so frame 5
    // is the centre cell.
    expect(computeFrameCell([249, 78], 5, 747, 234)).toEqual({ sx: 249, sy: 78, sw: 249, sh: 78 });
  });
});

describe("datamodel items are nodes now (L10 consequence)", () => {
  it("the ghost rows are item wrappers that hug their row widget", () => {
    // The item template used to be spliced straight into the container. It is
    // a node with a rect of its own now, which is what a gridbox cell needs;
    // for a vbox the hug is the same rect the row widget had, so the batch
    // goldens in guiLayout.test.ts are untouched. free = 400 - 3*30 = 310,
    // n = 3, side = 310/6, slots at 310/6, 185 and 955/3.
    const ghosts = layoutFile("datamodel-ghosts.gui");
    const column = named(ghosts, "px_ghost_column");
    expect(column.children).toHaveLength(3);
    expect(column.children.map((c) => c.key)).toEqual(["item", "item", "item"]);
    expectRect(column.children[0], 80, 310 / 6, 40, 30);
    expectRect(column.children[1], 80, 185, 40, 30);
    expectRect(column.children[2], 80, 955 / 3, 40, 30);
    for (const item of column.children) {
      expect(item.ghost).toBe(true);
      expect(item.editable).toBe(false);
      expectRect(item.children[0], item.rect.x, item.rect.y, 40, 30);
    }
  });
});

/**
 * S07: the rect-dump baseline the consolidation plan schedules with the layout
 * merge (the Studio's `--render-gui` equivalent, over this repo's own corpus
 * rather than its test mod, which is not here). It is not a rule check: it is
 * the numeric diff that makes an unintended rect change visible. When a change
 * is intended, re-record with
 *   PX_WRITE_GUI_RECT_BASELINE=1 npx vitest run packages/server/test/guiLayoutMerge.test.ts
 * and the diff in review shows exactly which rects moved.
 */
describe("S07: rect dump over the fixture corpus", () => {
  it("every fixture's rects match the recorded baseline", () => {
    const files = fs
      .readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".gui"))
      .sort();
    const round = (v: number) => String(Math.round(v * 100) / 100);
    const lines: string[] = [];
    const dump = (n: LayoutNode, depth: number): void => {
      const flags = [n.clip ? "clip" : "", n.ghost ? "ghost" : ""].filter(Boolean).join(" ");
      const label = n.name ? `${n.key}#${n.name}` : n.key;
      const rect = [n.rect.x, n.rect.y, n.rect.w, n.rect.h].map(round).join(" ");
      lines.push(`${"  ".repeat(depth + 1)}${label} ${rect}${flags ? ` [${flags}]` : ""}`);
      for (const c of n.children) dump(c, depth + 1);
    };
    for (const file of files) {
      lines.push(file);
      for (const node of layoutFile(file)) dump(node, 0);
    }
    const text = `${lines.join("\n")}\n`;
    if (process.env.PX_WRITE_GUI_RECT_BASELINE) fs.writeFileSync(RECT_BASELINE, text, "utf8");
    // Line endings are the checkout's business, the numbers are ours.
    const recorded = fs.readFileSync(RECT_BASELINE, "utf8").replace(/\r\n/g, "\n");
    expect(text).toBe(recorded);
  });
});
