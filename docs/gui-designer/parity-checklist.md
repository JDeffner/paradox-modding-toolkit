# GUI editor parity checklist

The complete inventory of every check the Sage's Clausewitz Studio GUI harness runs
(`GuiLayoutHarness/Program.cs`, `GuiLayoutHarness/SourceEditorTests.cs`) plus every
invariant sweep its ROADMAP records, mapped onto this repository. It is the scope
document for G1 (writer rebuild) and G2 (layout merge) in
[docs/gui-editor-consolidation.md](../gui-editor-consolidation.md).

Read the Studio side as BEHAVIOR, never as source: G0 regenerates fixtures rather than
copying them, so every row below points at a fixture in
`packages/server/test/fixtures/gui/` that was authored here. See that folder's README.

## Verdict legend

| Verdict | Meaning |
|---|---|
| **covered** | The toolkit already implements this AND asserts it. The citing test is named. |
| **done (G2)** | Landed in the G2 layout merge, with the citing test named. Engine rules cite their spec.md bullet in `layoutEngine.ts`. |
| **done (G1 stage n)** | Landed in that stage of the G1 writer rebuild, with the citing test named. The stages are: 1 the span model, 2 the property operations, 3 the block model and the structural operations, 4 the refusal guards and the `paradox/guiSourceEdit` op API. |
| **G1** | Writer rebuild, still open. G1 ran in four stages on 2026-08-01/02 and closed every row but W21 (extract as type, a refactoring rather than an editing primitive); that row says why it stayed. |
| **G2** | Layout merge. Either unimplemented here, or implemented but never asserted, or implemented DIFFERENTLY (those rows say so). |
| **disputed** | The two engines encode CONTRADICTORY rules and both sides measured. Nothing is implemented and no golden is flipped: the row names both sources and the in-game probe that settles it. |
| **dropped** | Out of the G1/G2 acceptance gates, with the reason. Some return at a later G phase; the reason says which. |

G2 ran on 2026-08-01. Its goldens live in `packages/server/test/guiLayoutMerge.test.ts` (cited
per row below) alongside the rect-dump baseline `test/fixtures/gui/layout-rects.baseline.txt`
(S07). Six rows stayed open after G2; the in-game probe of 2026-08-02 (one four-case probe
window in the owner's mod) settled the three DISPUTED ones (L07c, L13e, L23) plus the
L25 owner question, leaving only the three deferred for want of a measurement or a
preview-UX decision (L01f, L06c, L11b). L17c remains a deliberate divergence that
renders the same pixels rather than a gap (§E).

G1 ran on 2026-08-01/02 in four stages, each its own commit with the five gates green:
the span model (`sourceModel.ts`), the property operations, the block model and the
structural operations (`sourceEdit.ts`), and the refusal guards plus the
`paradox/guiSourceEdit` op API (`sourceEditService.ts`). Its goldens live in
`guiSourceModel.test.ts`, `guiSourceEdit.test.ts` and `guiSourceEditService.test.ts`, with
the sweep baselines in §G. One row stayed open, W21 (extract as type), and it says why.
Two rows landed with a stated limit rather than silently: W25's empty-body respelling, and
W10's position guard, which takes a side in the still-DISPUTED L23.

"Implemented but never asserted" counts as **G2**, not covered: an unasserted behavior is
not something G2 can be judged by, and the whole point of the regenerated corpus is that
the merge is judged by executable truth.

---

## A. Layout parity: `Program.cs` sections and the engine quirk list

Fixture paths are relative to `packages/server/test/fixtures/gui/`.

| Row | Behavior | Fixture | Verdict |
|---|---|---|---|
| L01a | Line box height 21 at fontsize 15, exactly linear in fontsize | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B1-G + B2-L", "B3-S3" |
| L01b | Line width = (n-1)·advance + ink(last glyph) | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B1-G + B2-L" |
| L01c | `max_width` clamps with right elision | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B3-S1" |
| L01d | `multiline` + `max_width` wraps at word boundaries, advance = line box | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B3-S2" |
| L01e | `align` in a fixed-size textbox: exact, zero internal padding | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B4-T6" |
| L01f | Per-glyph advance/ink beyond the measured `M` / `i` / space | `layout/text-metrics.gui` | **G2**, deferred: the toolkit's `GLYPHS` table has three entries and a `DEFAULT_GLYPH` guess, and NEITHER source carries a per-glyph table: spec.md measured `M`/`i`/space only, and the Studio's numbers are inside its engine, not in the merged spec. Filling it in is a calibration batch (render the alphabet, measure advance and ink), not a merge |
| L01g | The vanilla `text_multi` type's hardcoded `size = { 45 45 }` wins over `max_width` | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B2-L" |
| L02a | Space-around: n children, side = free/(2n) on BOTH sides, gap = s + 2·side | `layout/box-fill-spacearound.gui` | **covered** by `guiLayout.test.ts` "B1-E1", "B1-F1/F2" |
| L02b | `spacing` adds inside the gap; `margin = { a b }` is horizontal, vertical | `layout/box-fill-spacearound.gui`, `layout/box-margins.gui` | **covered** by `guiLayout.test.ts` "B1-E2", "B1-E3" |
| L02c | No slack (content == container) → children flush and packed, no residual gaps | `layout/box-nested-hug.gui` | **covered** by `guiLayout.test.ts` "B2-I2" |
| L03a | `expanding` children each get floor + free/k (equal SHARE, not equal size) | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J2 + B3-P3" |
| L03b | `growing` yields to an expanding sibling and keeps its own explicit size | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J1" |
| L03c | `growing` alone behaves like expanding | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B3-P2 + B4-T8" |
| L03d | Two growers with no expander share the free space equally | `layout/box-policies.gui` | **done (G2)**: was implemented (`takers` falls back to growers), now asserted by `guiLayoutMerge.test.ts` "L03d: two growers with no expander share the free space equally" |
| L04a | Deficit: every shrinkable child loses deficit/k, equal DELTA, no shrinking-first priority | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J3 + B3-P4" |
| L04b | A `fixed` child never shrinks; the shrinkable sibling absorbs the whole deficit | `layout/box-policies.gui` | **done (G2)**: asserted by `guiLayoutMerge.test.ts` "L04b: a fixed child never shrinks" over `px_deficit_fixed_row` |
| L04c | Minimum-size floors and the redistribution loop: a floored child stops at its min and the rest absorb what is left, total still fits | `layout/box-policies.gui` | **done (G2)**: the deficit pass loops now, so a child floored at its `minimumsize` stops and the rest absorb the remainder and the total fits (spec.md "Minimum sizes in the box distribution"). The floor is the vanilla `minimumsize = { w h }` property (414 block-form uses in the game tree, plus 5 binding-valued ones a static preview cannot resolve), which was ALSO being walked as a phantom child widget and cost a box child a whole space-around slot; it is an attribute block now. Main axis only (cross unmeasured). No corpus fixture carries `minimumsize`, so the goldens are inline in `guiLayoutMerge.test.ts` "L04c: a floored child stops at its minimumsize" and "L04c: minimumsize is an attribute block" (a G0 gap worth closing when `box-policies.gui` is next touched) |
| L05a | `parentanchor` picks the parent point; the nine combinations are exact | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-B" |
| L05b | `widgetanchor` defaults to the VALUE of `parentanchor`, not top-left | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-C" |
| L05c | `position` is added after anchoring, always screen-space +right/+down | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-D" |
| L05d | Nested offsets accumulate linearly, no implicit padding | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-H" |
| L06a | `layoutpolicy_horizontal/vertical` classification | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J1" |
| L06b | The `expand` widget TYPE is growing | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B3-P2 + B4-T8" |
| L06c | An `expand = {}` PROPERTY on an ordinary widget makes it growing | `layout/box-policies.gui` | **G2**, deferred: the toolkit reads `expand` only as a child element. Nothing implemented, for two reasons: spec.md has no bullet for the property form (its `expand = {}` bullet, B4-T8/B3-P2, is the spacer WIDGET), and the vanilla tree has no instance of it. All 2,100+ `expand = {}` occurrences are standalone spacer widgets, a few carrying `minimumsize`/`layoutpolicy_*` of their own. `box-policies.gui` has no such shape either. Needs a spec bullet (or a counter-example) before it can be more than a guess |
| L07a | `state = {}` never leaks into the resting rect; it is not a child widget | `layout/state-blocks.gui` | **covered** by `guiLayout.test.ts` "phase 2: state blocks excluded from layout" |
| L07b | A widget with no state block keeps its STATIC position (no substitution) | `layout/state-blocks.gui` | **covered** by the same test |
| L07c | A state block SUPPLIES the resting position when the widget has none | `layout/state-blocks.gui` | **done (probe 2026-08-02)**: a state does NOT supply a resting position; `px_state_only` rendered at its parent's origin, not at its state's `{ 10 20 }`. spec.md's phase-2 bullet and the engine were right, the Studio's encoded rule was wrong; the fixture header now records the settled behavior. Asserted by `guiLayoutMerge.test.ts` "L07c: a state block does NOT supply a resting position" |
| L08 | Text sizing end to end through the node (`raw_text` → measured rect) | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` text-metrics suite |
| L09 | Real `.gui` parse → box arrangement, the closest headless mirror of a preview | `layout/end-to-end-window.gui` | **covered**: the `guiLayout.test.ts` batch-01/02/03 suites parse real snippets end to end; the new fixture adds the COMBINATION case (spacer + expanding text + button column alignment) |
| L10 | A datamodel gridbox `item` content-sizes (bounding box of its children, positioned child extends it), not a generic widget default | `layout/container-measurability.gui` | **done (G2)**: the `item` block is a NODE now instead of being spliced away, and it content-sizes like a container (a positioned child extends it to its far edge). Asserted by `guiLayoutMerge.test.ts` "L10: a datamodel item content-sizes" and "the ghost rows are item wrappers that hug their row widget" |
| L11a | `container` hugs its absolutely-positioned children at the parent origin | `layout/container-measurability.gui` | **covered** by `guiLayout.test.ts` "B2-I4" |
| L11b | Content-sizing runs only when the content is statically MEASURABLE; `{ 0 0 }` children, a child of an unknown type, a `datamodel`, or a binding-valued `visible` all make it unmeasurable, and the preview keeps a visible default rather than collapsing | `layout/container-measurability.gui` | **G2**, deferred to G3: nothing implemented. The guard's OUTPUT is a preview default size for content that cannot be measured, and no measurement in either source pins that number. All four `px_unmeasurable_*` cases authored a container with no `size`, so a guard here could only invent pixels, which is the one thing this engine does not do. It is a preview-UX decision (the GHOST_COUNT/GHOST_OPACITY precedent), so it belongs with G3's canvas. The engine's current answers for those four are recorded in the rect baseline |
| L11c | A plainly `visible = no` child is SKIPPED and the rest still content-size | `layout/container-measurability.gui` | **done (G2)**: content sizing skips a plainly hidden child (a binding-valued `visible` is KEPT: a static preview cannot evaluate it). Asserted by `guiLayoutMerge.test.ts` "L11c: a plainly hidden child is skipped" |
| L12a | A box nested in a box HUGS its content (no fill) and is then placed by the outer box's rules | `layout/box-nested-hug.gui` | **covered** by `guiLayout.test.ts` "B2-I2" |
| L12b | `align = left/right` on a box child does NOTHING; cross placement is unconditionally centred | `layout/box-child-ignored.gui` | **done (G2)**: still correct by construction, asserted now by `guiLayoutMerge.test.ts` "L12b: align and parentanchor on a box child do nothing" (which also pins the parentanchor half of the same spec bullet) |
| L13a | flowcontainer never wraps; one run along the main axis, overflowing unclipped | `layout/flow-container.gui` | **covered** by `guiLayout.test.ts` "B2-K1 + B3-Q1" |
| L13b | flowcontainer hugs its content and sits at the parent ORIGIN, no centring | `layout/flow-container.gui` | **covered** by the same test |
| L13c | `direction = vertical` and `spacing` | `layout/flow-container.gui` | **covered** by `guiLayout.test.ts` "B2-K2/K3" |
| L13d | flowcontainer HONORS a child's `parentanchor` on the cross axis (the one container that does) | `layout/flow-container.gui` | **done (G2)**: a flow child's `parentanchor` (with `widgetanchor` mirroring it) now places it on the cross axis; an unset anchor keeps the measured origin run. Asserted by `guiLayoutMerge.test.ts` "L13d: ... the one container that does" |
| L13e | Whether an explicit `size` sets the flow's own rect (toolkit B3-Q1) or is ignored like a box's (Studio GUI009) | `layout/flow-container.gui` | **done (probe 2026-08-02)**: the authored `size` SETS the flow's own rect; `px_flow_sized` rendered at its full 300x150 while the engine logged "You should not set a size on a container" and applied it anyway. B3-Q1 confirmed; the Studio's GUI009 grouping was wrong for flowcontainer. Asserted by `guiLayoutMerge.test.ts` "L13e: a flowcontainer KEEPS its authored size" |
| L14a | fixedgridbox: `addcolumn`/`addrow` are the CELL SIZE and the stride | `layout/grid-fixed.gui` | **done (G2)**: `addcolumn`/`addrow` are the cell size and the stride. Asserted by `guiLayoutMerge.test.ts` "L14a/L14b: addcolumn/addrow are the cell size and the stride" |
| L14b | fixedgridbox flow: vertical single column by default, `flipdirection` transposes, `maxhorizontalslots` caps only while horizontal, `datamodel_wrap` sets the wrap | `layout/grid-fixed.gui` | **done (G2)**: one flow model for both grid kinds, asserted by `guiLayoutMerge.test.ts` "L14b: flipdirection transposes the fill, maxhorizontalslots caps it" |
| L14c | An item with no concrete size anywhere in its chain takes the CELL size; one with a concrete size keeps it at the cell origin | `layout/grid-fixed.gui` | **done (G2)**: asserted by `guiLayoutMerge.test.ts` "L14c: an item with no concrete size anywhere takes the CELL size". Note the fixture's inner chain (`button` > 100%-fill `widget`) still resolves to a zero rect INSIDE the cell-sized item, because a sizeless widget is a zero rect (B4-T1, measured); what fills a cell-sized item is not a rule either source records |
| L14d | A fixedgridbox with no `item` still lays out decorative slots | `layout/grid-fixed.gui` | **done (G2)**: ordinary children are slotted like items. `px_fixed_decorative` has no children at all, so the corpus only pins that it stays a finite empty node; the slotting itself is an inline case in `guiLayoutMerge.test.ts` "L14d: a grid with no item template still slots its ordinary children" |
| L15 | dynamicgridbox: vertical fill by default, `datamodel_wrap` = items per COLUMN, `flipdirection` transposes without mirroring, items pack at their OWN size (addcolumn/addrow are not the stride) | `layout/grid-dynamic.gui` | **done (G2)**: items pack at their own size, same flow model, addcolumn/addrow are NOT the stride. Asserted by `guiLayoutMerge.test.ts` "L15: dynamicgridbox packs at the item's own size" (both cases) |
| L16a | A datamodel list stamps placeholder rows laid out by the container's real policy | `layout/datamodel-ghosts.gui` | **covered** by `guiLayout.test.ts` "phase 2: datamodel list placeholders" |
| L16b | Placeholder count is capped by a container whose own explicit size is known | `layout/datamodel-ghosts.gui` | **covered** by the same suite, "caps ghosts to the container's own explicit size" |
| L16c | Placeholders are never editable | `layout/datamodel-ghosts.gui` | **covered** by the same suite |
| L16d | A container inside a HORIZONTAL box collapses to a single placeholder | `layout/datamodel-ghosts.gui` | **dropped**: a Studio canvas affordance, not an engine fact. The toolkit stamps into the container's real policy, so a horizontal box lays the placeholders across; changing that is a G3 preview-UX decision, not a layout invariant |
| L17a | scrollarea clips; content origin at the viewport origin at scroll 0; a bare `scrollwidget` renders without scrollbar chrome | `layout/clipping.gui` | **covered** by `guiLayout.test.ts` "B3-R1" |
| L17b | `scrollbox` and `scissor = yes` also clip | `layout/clipping.gui` | **done (G2)**: `scrollbox` and any `scissor = yes` widget clip too. Asserted by `guiLayoutMerge.test.ts` "scrollarea, scrollbox and scissor = yes clip" |
| L17c | Descendant rects are CLAMPED to the clipper (the flatten does it, not only the renderer) | `layout/clipping.gui` | **divergence, deliberate**: the toolkit keeps TRUE geometry on the node plus a `clip` flag, and the client clamps (`guiPreview` already does, per clipping ancestor). Same pixels; clamping in the flatten would rewrite `guiLayout.test.ts` "B3-R1", a measured golden, and would throw away the real rect an inspector and the writer need. Pinned by `guiLayoutMerge.test.ts` "L17c: a clipped descendant keeps its true rect" |
| L18 | Bookmark map characters: feet-anchored portrait placement | none | **dropped**: a CK3 bookmark-screen preview inside the Studio app, not a `.gui` layout rule and not a toolkit surface in any G phase |
| L19a | An hbox/vbox whose parent is a plain widget FILLS it on both axes with no layoutpolicy asked for | `layout/box-fill-spacearound.gui` | **covered** by `guiLayout.test.ts` "B1-E1", "B2-I1 + B3-P1" |
| L19b | The main-axis surplus then spreads as space-around | `layout/box-fill-spacearound.gui` | **covered** by the same tests |
| L20a | A sizeless plain widget is a ZERO rect; children still render from its origin | `layout/widget-basics.gui` | **covered** by `guiLayout.test.ts` "B4-T1" |
| L20b | `scale` multiplies the resolved rect at the same origin | `layout/widget-basics.gui` | **covered** by `guiLayout.test.ts` "B4-T4" |
| L21a | Nine-slice requires BOTH a `Cornered*` spriteType AND a non-zero `spriteborder` | `layout/sprite-nineslice.gui` | **done (G2)**: fills carry a `mode` (`stretch` / `tile` / `nineslice-stretch` / `nineslice-tile`) computed from `spriteType` + border; `border` stays the parsed attribute either way, so the phase-2 parsing goldens are untouched. `guiPreview` nine-slices only when the mode says so. Asserted by `guiLayoutMerge.test.ts` "nine-slice needs BOTH a Cornered* type and a non-zero border" |
| L21b | A border without a `Cornered*` type is ignored; the whole texture plain-stretches | `layout/sprite-nineslice.gui` | **done (G2)**: `guiLayoutMerge.test.ts` "a border with no Cornered* type is ignored: the whole texture stretches" |
| L21c | A `Cornered*` type with no border tiles (for a `*tiled*` type) or stretches the whole texture | `layout/sprite-nineslice.gui` | **done (G2)**: `guiLayoutMerge.test.ts` "a tiled type with no border tiles the whole texture" |
| L21d | Nine-slice edge behavior: `Corneredtiled` tiles the edges, `Corneredstretched` stretches them | `layout/sprite-nineslice.gui` | **done (G2)**, engine half: the mode distinguishes `nineslice-tile` from `nineslice-stretch`, which is what the renderer needs; `computeNineSlice`'s region geometry is shared by both and unchanged. DRAWING tiled edges is G3 renderer work (`guiPreview` still stretches them) |
| L21e | `2·border > size` on an axis → the corners clamp to size/2 and meet, no centre | `layout/sprite-nineslice.gui` | **covered** by `guiLayout.test.ts` "computeNineSlice: borders clamp so opposite sides never overlap" |
| L21f | `spriteborder = { x y }` axis order (x = left/right width, y = top/bottom height) and the `spriteborder_<side>` overrides | `layout/sprite-nineslice.gui` | **covered** by `guiLayout.test.ts` "carries border geometry from a background block", "per-side overrides win over the { x y } pair" |
| L21g | The nine regions: corners 1:1, edges on one axis, centre on both | `layout/sprite-nineslice.gui` | **covered** by `guiLayout.test.ts` "computeNineSlice: exact 9 regions" |
| L22 | `framesize = { w h }` is a 2D grid, row-major, 1-based; frame ≤ 0 clamps to the first cell and a frame past the last clamps to it | `layout/sprite-framesize.gui` | **done (G2)**, engine half: fills carry `framesize`/`frame`, and `computeFrameCell` resolves the row-major 1-based cell with both clamps, mirroring `computeNineSlice`'s split (the texture's pixel size belongs to the renderer). Asserted by `guiLayoutMerge.test.ts` "L22: frame sheets" (the fixture wiring and the grid math, including the vanilla 747x234 @ 249x78 shape). Drawing the cell is G3: `guiPreview` still paints the whole sheet |
| L23 | A box IGNORES a child's `position` (and `parentanchor`): the slot is the box's business | `layout/box-child-ignored.gui` | **done (probe 2026-08-02)**: the box DROPS a child's `position`; `px_positioned` sat exactly on a plain sibling's coordinate and the engine logged "Widget cannot have a position in a layout". The Studio's §H was right; this engine's offset was removed the same day. Asserted by `guiLayoutMerge.test.ts` "L23: a box drops a child's position"; W10's `positionIgnoredReason` guard is now measured-correct |
| L24 | Only `widget` holds a fixed pixel `size`; hbox/vbox ignore an explicit one, smaller or larger | `layout/box-fill-spacearound.gui` | **covered** by `guiLayout.test.ts` "B2-I1 + B3-P1" |
| L25 | An EMPTY `container` collapses to 0: a fixed `size` will not hold it open | `layout/container-measurability.gui` | **done (probe 2026-08-02, NARROW)**: a NON-empty `container` KEEPS an authored `size` (`px_container_sized_kept` rendered at its full 250x120 while the engine logged "You should not set a size on a container" and applied it anyway); only an EMPTY one collapses to 0, where a fixed `size` will not hold it open. The G2 broad implementation was corrected to the narrow rule in `naturalSize` the same day. A datamodel `item` still content-sizes unconditionally (L10). Asserted by `guiLayoutMerge.test.ts` "L25 narrow: a NON-empty container keeps an authored size" plus the existing empty-collapse case |
| L26 | `margin` on a plain `widget` is ignored; only `margin_widget` and the layout containers honor margins | `layout/box-margins.gui` | **done (G2)**: still correct by construction, asserted now by `guiLayoutMerge.test.ts` "`margin` on a plain widget is ignored; margin_widget offsets its children" (the two shapes side by side) |
| L27 | `ignoreinvisible` (default `yes` on hbox/vbox) collapses hidden children, including a binding-false `visible`, so siblings shift up | `layout/ignoreinvisible.gui` | **done (G2)**: a plainly hidden child is collapsed out of a box's distribution (`ignoreinvisible` defaults to yes) and stays in the tree as a ZERO rect so the preview can still list it. A BINDING-valued `visible` is KEPT: a static preview cannot evaluate it, and showing it is the non-destructive default (documented in the engine). Asserted by `guiLayoutMerge.test.ts` "L27: ignoreinvisible", three cases |
| L28 | `resizeparent = yes` resizes the PARENT to the widget's content; a fixed-size DIRECT child of one can collapse, nesting one level deeper preserves it | `layout/resizeparent.gui` | **done (G2)**, measured half: a `resizeparent = yes` child now sizes its PARENT to that child's content extent. The "a fixed-size DIRECT child CAN be collapsed" side effect is NOT implemented ("can" is not a rect rule and nothing measured says when it fires), so the goldens pin the direct and the nested widget both keeping their size. `guiLayoutMerge.test.ts` "the widget resizes its PARENT to its own content extent" |
| L29 | `setitemsizefromcell = yes` (gridbox) forces every cell to the WIDEST item's size; needs a datamodel | `layout/grid-fixed.gui` | **done (G2)**: `setitemsizefromcell = yes` takes the cell from the widest item instead of addcolumn/addrow. Measured on width, applied per axis, with an axis no item can size falling back to addcolumn/addrow. Asserted by `guiLayoutMerge.test.ts` "L29: setitemsizefromcell makes every cell the widest item's size" |
| L30 | A percentage WIDTH inside a vbox crashes the game (the vbox's width is content-derived, so `%` cannot resolve); height `%` is the milder case | none | **dropped**: an authoring hazard with no rect consequence. Recorded in `calibration/spec.md`; it belongs to a `.gui` linter, and no linter is in the G-plan |
| L31 | An expanding child must not DEFINE a box's cross size; only fixed children do | `layout/box-child-ignored.gui` | **done (G2)**: the hug path already used each child's FLOOR, so an expanding child cannot GROW the cross size; asserted by `guiLayoutMerge.test.ts` "L31: an expanding child takes main-axis space without defining the cross size" (the fill case, over the fixture) and "L31: an expanding child does not widen a HUGGED box either" (the box-in-box case, inline). One shape stays unpinned on purpose: an expander whose own authored floor is WIDER than its fixed sibling's. The hug is max(floors) (B2-I2), so that floor would set the box's cross size, which reads against "only fixed children do"; neither source measures the shape, so no golden claims an answer |
| L32a | `type` instantiation, instance properties overriding the definition, type chains to the built-in root, base behavior class inherited | `layout/templates-types.gui` | **covered** by `guiLayout.test.ts` "instantiates a type with instance overrides winning", "resolves type chains and inherits the base behavior class" |
| L32b | `using = <Template>` splices; a use-site property wins; `local_template` never crosses files | `layout/templates-types.gui` | **covered** by `guiLayout.test.ts` "splices templates via using =", "merges stores FIOS" |
| L32c | `block` slot + `blockoverride` fill / blank, including a block nested deep in the type's subtree | `layout/templates-types.gui` | **covered** by `guiLayout.test.ts` "block declares a slot, blockoverride fills or blanks it", "blockoverride reaches blocks nested deep in the type's subtree" |
| L32d | Self-referencing types are guarded instead of hanging | `layout/templates-types.gui` | **covered** by `guiLayout.test.ts` "guards against self-referencing types instead of hanging" |
| L33 | Percent sizes resolve against the parent rect | `layout/widget-basics.gui` | **covered** by `guiLayout.test.ts` "B4-T2" |
| L34a | Directional margins inset ONE side; the distribution then runs in the remainder | `layout/box-margins.gui` | **covered** by `guiLayout.test.ts` "B4-T7" |
| L34b | `margin_widget` offsets its CHILDREN's origin without shrinking its own rect | `layout/box-margins.gui` | **covered** by `guiLayout.test.ts` "B3-Q2 + B4-T3" |
| L35 | Cross-file resolution: a `.gui` under a `gui/` tree resolves types and templates declared in the OTHER files of that tree, so a widget referencing an external template gets its real size; a self-contained file resolves with no registry (this is the Studio harness's `BuildRegistries`, and its render mode also preloads localization for text) | `layout/templates-types.gui` (self-contained side) | **covered** by `guiLayout.test.ts` "vanilla store: text_single resolves through the real preload types" and "merges stores FIOS", plus `guiNavigation.test.ts` for `resolveGuiDef` / `typeBaseChain`. Loc preloading is the server's loc index, not the layout engine |

---

## B. Writer parity: `SourceEditorTests.cs`

The toolkit's entire writer BEFORE G1 was `packages/server/src/gui/widgetEdit.ts` (91
lines): it rewrote or inserted `position`/`size` on the widget whose statement starts on a
given line, and `guiWidgetEdit.test.ts` asserted seven cases. It had no span model, no
block notion, no batching, no newline or indent-unit awareness, and no refusals. Every row
below started as **G1**; G1 landed in four stages, so the Status column records which
stage closed a row and the test that judges it.

The writer is now `sourceModel.ts` (spans) + `sourceEdit.ts` (operations) +
`sourceEditService.ts` (guards and the `paradox/guiSourceEdit` op API), and
`widgetEdit.ts` is a deprecated alias over that core, unchanged on the wire. Its seven
tests still pass, with one expectation updated deliberately: a property it has to INSERT
now lands on its own line before the closing brace (W03), where the writer puts every new
property, rather than first in the body.

| Row | Behavior | Fixture | Status |
|---|---|---|---|
| W01 | Parser SPANS: `HeaderStart` / body-open / body-close land on the right bytes; a block value's span is the raw block text, a quoted value's span includes the quotes, a key's span points at the key | `writer/tabs-comments.gui` | **done (G1 stage 1)**: `packages/server/src/gui/sourceModel.ts` records the key, operator and value span of every entry plus each body's braces; asserted by `guiSourceModel.test.ts` "gui source model: spans (W01)" (six cases) and swept by S01/S06 |
| W02 | Replace: rewrites only the old value's bytes (minimal edit), key lookup case-insensitive, an unchanged value is a no-op rather than a churn edit | `writer/tabs-comments.gui`, `writer/duplicate-keys.gui` | **done (G1 stage 2)**: `setProperty` / `setValue` in `packages/server/src/gui/sourceEdit.ts`, asserted by `guiSourceEdit.test.ts` "replace rewrites only the old value's bytes, minimally (W02)" and "key lookup is case-insensitive, an unchanged value is a no-op (W02)". The lookup is stage 1's `findEntry` |
| W03 | Insert a property: its own line before the closing brace, at the body's own indent, including a nested body's deeper indent | `writer/tabs-comments.gui`, `writer/spaces-indent.gui` | **done (G1 stage 2)**: `insertProperty`, asserted by `guiSourceEdit.test.ts` "insert lands on its own line before the closing brace (W03)" and "a nested insert copies the nested indent (W03)". The indent it copies is `GuiBody.indent` (stage 1) |
| W04 | Remove a property: takes the whole line, but keeps a line that still carries a trailing comment (remove the entry, not the line) | `writer/tabs-comments.gui` | **done (G1 stage 2)**: `removeProperty`, asserted by `guiSourceEdit.test.ts` "remove takes the whole line (W04)" and "remove keeps a line that still holds a trailing comment (W04)" |
| W05 | Batch: several edits computed against the SAME text and applied end-first; untouched entries stay byte-identical | `writer/tabs-comments.gui`, `writer/nested-selection.gui` | **done (G1 stage 2)**: `applyAll`, asserted by `guiSourceEdit.test.ts` "a batch replaces and inserts against the same text, untouched bytes identical (W05)" and "applies later offsets first and drops overlapping edits" |
| W06 | Formatting preservation: CRLF file gets CRLF inserts; comments survive; a single-line body stays single-line; an empty `{}` body gets a spaced entry; a space-indented file keeps spaces; mixed tab/space bodies each keep their own | `writer/crlf.gui`, `writer/spaces-indent.gui`, `writer/mixed-indent.gui`, `writer/single-line-bodies.gui` | **done (G1 stage 2)** for the property writes: five cases in `guiSourceEdit.test.ts` "formatting preservation (W06)", including "mixed bodies in ONE file each keep their own indent" over `writer/mixed-indent.gui` (the indent is a copied STRING, so the file-wide unit cannot leak into the space-indented body next door). The same preservation over a child-widget insert and a paste lands with stage 3 |
| W07 | Duplicate key: rewrite the LAST occurrence (last-in-wins inside one body) | `writer/duplicate-keys.gui` | **done (G1 stage 2)**: `guiSourceEdit.test.ts` "rewrites the LAST occurrence of a duplicate key (W07)" |
| W08 | Compound `a\|b` value: the span covers both sides of the pipe and is replaced whole | `writer/duplicate-keys.gui` | **done (G1 stage 2)**: `guiSourceEdit.test.ts` "a compound a\|b value is replaced whole (W08)". The span half is stage 1's |
| W09 | Template use site: an inherited property has no writable entry, so a write adds a LOCAL override and the template's bytes are untouched; a synthetic node reports no source and refuses every op | `writer/template-use-site.gui` | **done (G1 stage 2)** for the write half: `guiSourceEdit.test.ts` "an inherited property has no local entry, so a write adds a LOCAL override" and "a node with no body (a scalar entry) refuses every property write". A synthetic node's refusal REASON string is stage 4's |
| W10 | Refusal honesty: `position` on a box child, `size` on a content-sized type (hbox/vbox; flowcontainer was narrowed out by the L13e probe), `size` on a child expanding on BOTH axes; one expanding axis writes and names the axis the box owns; the guard must NOT fire outside a layout container | `writer/refusal-shapes.gui` | **done (G1 stage 4)**: `positionIgnoredReason` / `sizeIgnoredReason` in `packages/server/src/gui/sourceEditService.ts`, six cases in `guiSourceEditService.test.ts` "position and size guards (W10, S09)", each on the shape that must refuse AND the neighbour that must not. Classes come from the engine's own `widgetClassOf`, resolved through `typeBaseChain`, never re-derived. The position half was VINDICATED by the L23 probe (2026-08-02): the box drops a child's position, the engine now renders the same truth the guard refuses to write, and the guard stays. The size half was NARROWED the same day: a flowcontainer KEEPS an authored size (L13e), so only hbox/vbox refuse it now |
| W11 | Reorder permutations: first→last, last→first, middle→first, first→middle; same index is a no-op; an out-of-range index clamps; the moved text is carried VERBATIM (non-whitespace character count unchanged) | `writer/reorder-siblings.gui` | **done (G1 stage 3)**: `reorderChild` rewrites the run between the two indices as ONE edit, asserted by `guiSourceEdit.test.ts` "moves first to last, last to first, middle to first and first to middle (W11)", "a same-index move is a no-op, an out-of-range index clamps (W11)" and "carries the moved text verbatim (W11)" |
| W12 | Blank separators belong to the block ABOVE them, so a move-and-move-back is the identity and repeated reorders cannot accumulate blank lines | `writer/blank-separators.gui` | **done (G1 stage 3)**: the move permutes `blockSpan`s, so each block carries its own separators; asserted by `guiSourceEdit.test.ts` "a blank separator travels with the block above it, so a move and back is the identity (W12)" and swept by S03 |
| W13 | An attached comment travels with its widget; a blank-line-separated section header stays put | `writer/comment-runs.gui` | **done (G1 stage 3)**: `guiSourceEdit.test.ts` "an attached comment travels with its widget, a separated header stays put (W13)" |
| W14 | Reorder refusals and scoping: two declarations sharing a line, a single child, template-expanded children excluded from the source sibling list, and a body whose children are INTERLEAVED with non-child content (the move still lands correctly relative to the sibling aimed at, but round-trip identity legitimately does not hold, so a sweep must skip and count it) | `writer/line-sharing.gui`, `writer/reorder-siblings.gui`, `writer/template-use-site.gui`, `writer/interleaved-children.gui` | **done (G1 stage 3)**: three refusals plus the interleaved case, in `guiSourceEdit.test.ts` "refuses a single child and a line-sharing declaration (W14)", "template-expanded children are not source siblings (W14)" and "an interleaved body still moves relative to the sibling aimed at (W14, S03)". Whatever sits BETWEEN two children keeps its slot while the blocks permute through it, which is exactly why the move is right and the round trip is not; S03 skips and counts those bodies |
| W15 | Insert a child widget: last in the body at the children's indent, at an index (before that child's BLOCK, comment included), propertyless → an empty block not a malformed one, re-parses as a real child, out-of-range index appends, follows the file's indent unit and newline, single-line and empty bodies stay as they are | `writer/tabs-comments.gui`, `writer/spaces-indent.gui`, `writer/crlf.gui`, `writer/single-line-bodies.gui` | **done (G1 stage 3)**: `insertChild`, seven cases in `guiSourceEdit.test.ts` "insert a child (W15, W24)". A propertyless insert writes the one-line `widget = {}`. One shape is REFUSED rather than written: a body whose `}` shares a line with its last content has no line to insert on, and a delete could not put that line back |
| W16 | Delete a widget: removes the whole declaration, leaves sibling properties untouched, takes the widget's attached comment with it, and on a line-sharing declaration keeps the neighbour AND the gap | `writer/tabs-comments.gui`, `writer/comment-runs.gui`, `writer/line-sharing.gui` | **done (G1 stage 3)**: `deleteWidget` removes `lineSpan` (comments in, separators out), asserted by the three cases in `guiSourceEdit.test.ts` "delete a widget (W16)". A line-sharing declaration loses its exact bytes plus ONE separator space, which keeps the line's indent and its neighbour intact |
| W17 | Duplicate: the copy lands immediately after the original, an asked-for rename touches ONLY the copy and keeps its quoting style, duplicating the last child stays inside the parent's body | `writer/reorder-siblings.gui` | **done (G1 stage 3)**: `duplicateWidget`, four cases in `guiSourceEdit.test.ts` "duplicate (W17)", swept by S05 |
| W18 | Insert and delete both refuse a synthetic parent; a `type` definition is refused because other files may use it; deleting the only root window is refused | `writer/template-use-site.gui`, `writer/refusal-shapes.gui` | **done (G1 stage 4)**: four cases in `guiSourceEditService.test.ts` "structural refusals (W18)". The type-definition guard covers EVERY structural op (insert, delete, duplicate, reorder, wrap, paste), not just insert and delete; property writes still go through, since editing a type's own property is what its file is for. A fifth refusal was added on the same honesty grounds: a document with a parse error is not edited at all, because no offset in it can be trusted |
| W19 | Copy: block text carries the attached comment and the nested body verbatim; it is null for a line-sharing declaration | `writer/paste-fragment.gui`, `writer/line-sharing.gui` | **done (G1 stage 3)**: `blockText`, asserted by `guiSourceEdit.test.ts` "block text carries the attached comment and the nested body verbatim (W19)" and "block text is null for a line-sharing declaration (W19)" |
| W20 | Paste: strips the fragment's COMMON leading whitespace as a string prefix, converts interior indent LEVELS to the destination's unit (no tab survives into a space file), converts newlines to the destination's, a multi-widget fragment pastes as several children, index placement matches insert's, and it refuses a single-line body and a blank or non-widget fragment | `writer/paste-fragment.gui`, `writer/paste-destination.gui`, `writer/crlf.gui`, `writer/single-line-bodies.gui` | **done (G1 stage 3)**: `insertRawChild`, four cases in `guiSourceEdit.test.ts` "block text and paste (W19, W20)" (the tab-fragment-into-a-space-file golden, the CRLF conversion, the three refusals, and paste-then-delete identity), swept over both corpora |
| W21 | Extract as type: a two-edit batch, the definition at the top of the file, `name`/`position` lifted to the instance (use-site identity) and gone from the definition body, the attached comment left at the use site, the re-parsed file carrying the type, and the crown invariant, IDENTICAL rects before and after. Refuses a root widget and an empty type name | `writer/extract-candidate.gui` | **G1**, the one row G1 did not close: it is a refactoring, not an editing primitive, and the four G1 stages scoped the primitives (the stage-4 op union has no `extract`). Everything it needs now exists (`blockText`, `wrapInContainer`'s slot-replacement shape, `setProperties`, the batch rules), and the rect-identity invariant it is judged by is the layout engine's, so it belongs with the G3 designer that would offer the gesture. `writer/extract-candidate.gui` is waiting for it |
| W22 | Wrap in container: a non-contiguous selection puts the container in the FIRST member's slot, the skipped sibling stays, members land inside in order re-indented, comments travel, the document still parses to one root | `writer/wrap-candidate.gui` | **done (G1 stage 3)**: `wrapInContainer` returns the batch (one replace at the first member's slot, one delete per other member), asserted by the exact-file golden in `guiSourceEdit.test.ts` "a non-contiguous selection wraps at the FIRST member's slot, the skipped sibling stays", plus the container name and the three refusals |
| W23 | Nested selections collapse to the outermost before a batch is built (an overlapping edit would be dropped and half the batch silently lost); property writes do NOT collapse | `writer/nested-selection.gui` | **done (G1 stage 2)**: `dropNested`, asserted by `guiSourceEdit.test.ts` "a selection holding a box and its child collapses to the box". The drop half of the invariant (an overlapping edit is dropped, not applied) is asserted with W05 |
| W24 | The append point for a new child is the LAST CHILD's block end, not the closing-brace line; with no children it backs up over a trailing comment run. Otherwise an inserted widget lands below commented-out code and deleting it takes the comments with it | `writer/comment-runs.gui` | **done (G1 stage 3)**: both halves asserted over `writer/comment-runs.gui` by `guiSourceEdit.test.ts` "appends at the last child's block end, above a trailing comment run (W24)" and "a childless body still appends above its trailing comment run (W24)" |
| W25 | Single-line insert/delete are exact inverses, including the separator space (the `{ a  }` accumulation bug) | `writer/single-line-bodies.gui` | **done (G1 stage 3)**: an inline insert lands before the body's own trailing gap and adds ONE space, and the delete takes that space back, so `{a}` stays tight and `{ a }` stays spaced; asserted by `guiSourceEdit.test.ts` "single-line bodies (W25)" (three cases) and swept by S04. One shape cannot invert and is pinned instead: `{}` and `{ }` are the SAME text once an entry is inside, so a delete restores the canonical `{}`. That respelling happens once and is then stable, which is the accumulation the row is about; the sweeps count it separately (4 in the fixture corpus) rather than passing it off as identity |

### Stage 1 model decisions (the readings the invariants forced)

The span model is `packages/server/src/gui/sourceModel.ts`. Six places where the rows
above underspecify what a span or an extent IS, closed so the next reader inherits an
answer instead of a choice:

1. **An entry is every `key [op] value` statement anywhere in the file**, attribute-block
   interiors (`background = { texture = … }`) and `type`/`template` definition bodies
   included, not just the properties of live widgets. That is why the toolkit's entry
   counts below are not comparable one-for-one with the Studio's (§G).
2. **The model value a span must re-tokenize to** (S01): a quoted scalar without its
   quotes, a bare scalar verbatim (so `top\|left` is ONE value, W08), and a block rendered
   from its tokens with single spaces. The rendering is deliberately independent of the
   interior whitespace the span itself preserves, so the check is "same tokens", not "same
   bytes twice".
3. **Two extents per entry, because delete and reorder need different ones.** `lineSpan` =
   attached comments plus the entry's own lines; `blockSpan` = that plus the blank lines
   below it. Reorder moves `blockSpan` (W12: the extents then tile, so a move is a pure
   permutation), delete removes `lineSpan` (W16: taking the blank separator too would
   break the insert-then-delete inverse, S04, by one blank line per round trip).
4. **A comment attaches upward, a blank line breaks it** (W13), and a comment on the
   entry's own last line is NOT part of the extent: it is `trailingComment`, the
   information that keeps W04's remove entry-granular instead of line-granular.
5. **The append point is the last child's `lineSpan` end** (before its blank separators),
   not its `blockSpan` end, which is the same one-blank-line reasoning as (3).
6. **Widget vs property uses the layout engine's own attribute-block set**, now exported
   from `layoutEngine.ts` rather than copied, so a preview selection can never address an
   attribute block as a widget. One shape needed a rule of its own: vanilla writes a named
   slot both as `blockoverride "name" { … }` (272 uses) and as `blockoverride = "name"
   { … }` (29 uses, which the CST reads as one assignment with a tagged-block value). The
   model normalizes the second into the first, so a slot is one shape downstream.

---

## C. Corpus sweeps and headless app modes

The `RealFiles` sweep in `SourceEditorTests.cs` and the numbers the Studio ROADMAP records
for it. These are the checks that found what code review did not, so they are the acceptance
gates that matter for G1.

| Row | Sweep | Verdict |
|---|---|---|
| S01 | Span invariant over every entry of every real file: the recorded span covers key then value in order, and re-tokenizing the span alone reproduces the model's normalized value | **done (G1 stage 1)**: `guiSourceModel.test.ts` "every recorded span re-tokenizes to its model value, over the whole corpus" (39 files) and "… over the vanilla gui tree" (373 files, gated on `dev-paths.json`). Zero mismatches on both; baselines in §G |
| S02 | Single-entry rewrite leaves every OTHER byte identical, and the file still parses to the same root count | **done (G1 stage 2)**: `guiSourceEdit.test.ts` "over the fixture corpus, a rewrite changes exactly its value span" (39 files, 370 rewrites) and "a single-entry rewrite is byte-identical over the vanilla gui tree" (373 files, 40,585 rewrites, dev-paths-gated). Zero drift on both; baselines in §G |
| S03 | Reorder move-to-end-then-back restores the file byte for byte, over CONTIGUOUS boxes only; interleaved bodies are skipped and counted (`writer/interleaved-children.gui` is the shape that must be skipped) | **done (G1 stage 3)**: `guiSourceEdit.test.ts` "S03-S05 inverse round trips" over the fixture corpus and "S03-S05 vanilla sweep" over the game tree. Baselines in §G |
| S04 | Insert-then-delete restores the file byte for byte | **done (G1 stage 3)**: swept with S03, with the paste round trip alongside it. Empty-body respellings are counted separately, never as identity (W25) |
| S05 | Duplicate-then-delete-the-copy restores the file byte for byte | **done (G1 stage 3)**: swept with S03 |
| S06 | Every widget body's recorded braces land on `{` and `}` | **done (G1 stage 1)**: swept with S01 over both corpora (every body, not only widget bodies), plus `guiSourceModel.test.ts` "every body's braces land on braces, and a body's entries are inside it" |
| S07 | Headless rect dump over a corpus (`--render-gui` equivalent), diffed numerically before and after a change | **done (G2)**: `guiLayoutMerge.test.ts` "S07: rect dump over the fixture corpus" dumps every rect of every `layout/` fixture against `test/fixtures/gui/layout-rects.baseline.txt`, recorded 2026-08-01 over the merged engine. Re-record with `PX_WRITE_GUI_RECT_BASELINE=1` so an intended change lands as a numeric diff in review. The Studio's 126-rect test-mod dump stays unreproducible here by design (§G) |
| S08 | Headless app smoke driving the REAL editor through select → add → duplicate → delete → undo → redo, asserting one document edit per batch, selection surviving the re-parse, and the file byte-identical after undoing the run (`--gui-edit-smoke` equivalent) | **dropped** from G1/G2: it drives a UI that does not exist here yet; the plan schedules the Playwright equivalent alongside G3's webview |
| S09 | The expanding-axis guard never reports an expanding axis for a widget OUTSIDE a layout container (otherwise the guard starts refusing resizes the engine would have honoured) | **done (G1 stage 4)**: `guiSourceEditService.test.ts` "does NOT fire outside a layout container (S09)" over `px_outside_container`, which carries the same two expanding policies as the refused `px_refuse_size_both` and differs only in its parent |

---

## D. Studio harness checks that are neither layout nor writer

| Row | Studio section | Verdict |
|---|---|---|
| X01 | **Layout Explain**: a rect decomposed into labeled terms, with the self-checking invariant that the terms SUM to the final position (an unexplained rect gets an honest "engine placement" residual); plus the guard/provenance notes (box-placed, expanding axis, ignored explicit size, runtime-dependent visibility, clipping ancestor) | **dropped** from G1/G2: the G5 "why it's here" panel. Worth keeping the sum invariant when it lands: it is what makes drift visible instead of silent |
| X02 | **Tree filter** query language (`type:`, `name:`, plain text, `size>`/`size<` against the rendered rect, `hidden`, `bound`, `synthetic`, terms ANDed) | **dropped** from G1/G2: tree UI, G3/G4 |
| X03 | **Template gallery** generator: every generated file parses with our own parser, has one root with the asked name and size, passes the linter with ZERO findings, option toggles toggle, the visibility/`_open` variable wiring is present, and the name sanitizer handles spaces/case/leading digits | **dropped** from G1/G2: G5, and it depends on a `.gui` linter the toolkit does not have. The toolkit's own scaffolds (`packages/vscode/src/scaffold/`) are the natural home |
| X04 | **Preset library** round-trips: name sanitized, properties round-trip in ORDER with values verbatim, an empty set refuses to save, delete reports honestly | **dropped** from G1/G2: G5 |
| X05 | **Component library** round-trips: source stored VERBATIM, alphabetical listing, delete reports honestly | **dropped** from G1/G2: G5 |
| X06 | **Texture catalog**: enumeration with forward-slash relative paths, non-images skipped, a mod texture OVERRIDING vanilla at the same path, plain-text / `ext:` / `from:` filters ANDed | **dropped** from G1/G2: G5. The server already resolves asset paths with mod-over-vanilla precedence (`features/assetPaths.ts`, `assetPaths.test.ts`) and decodes DDS, so G5 is a browser over existing code |
| X07 | **Dependency graph**: scripted_gui definitions parsed from text (comment-safe), bare and block `trigger_event` collected and deduped, 1-based definition lines, `GetScriptedGui('x')` references found with and without inner spaces, the reverse event→gui map, transitive chains through scripted effects with cycle safety, and the widget-subtree extractor (scripted_gui in a descendant's `onclick`, plain-identifier text as a loc key vs a `[binding]` that is not, datamodel expressions as bindings) | **dropped** from G1/G2: G5 dependency surfaces. The toolkit has a generic dependency explorer (`overview/dependencies.ts`, `dependencies.test.ts`) and a loc index to build on |
| X08 | **Property provenance**: a local value reports no origin, a chain value names the type that supplies it, a deep-chain value names the ancestor, a `using` mixin names the mixin, a local override still reveals the shadowed chain value, the type chain walks to the built-in root, and the inherited listing excludes locally-set keys | **dropped** from G1/G2: the G3 inspector. `guiDefs.ts` already has `typeBaseChain`, `resolveGuiDef` and `collectOverridableBlocks` (`guiNavigation.test.ts`), which is most of the machinery |
| X09 | **GuiLinter** findings (the GUI001/007/008/009/010/015 codes the quirk list cites) | **dropped** from G1/G2: no `.gui` linter exists here and none is in the G-plan. AGENTS.md's "deep validation belongs to ck3-tiger" is the standing reason; the quirk knowledge lives in `calibration/spec.md` instead |

---

## E. What `layoutEngine.ts` already implements

Read from `packages/server/src/gui/layoutEngine.ts` (1,132 lines) and `guiDefs.ts`, not
assumed. This is the honest starting inventory for G2.

**Implemented and asserted**

- Anchors: `anchorFractions` + `placeInParent`, with `widgetanchor` defaulting to the
  value of `parentanchor` and `position` added after anchoring.
- Percent sizes against the parent rect (`sizePct`), and `scale` multiplying the rect.
- Plain widget with no size → zero rect (`naturalSize` default branch).
- Box FILLS a non-box parent on both axes, explicit size ignored (`placeInParent`, the
  `cls === "box"` branch); box in a box HUGS (`naturalSize` box branch, reached through
  `arrangeBoxChildren`).
- Space-around distribution with `side = free/(2n)`, `spacing`, the `margin` pair and the
  directional `margin_*` overrides (`arrangeBoxChildren`, `margins`).
- Cross-axis centring, with a stretch when the child's cross policy is
  expanding/growing/preferred.
- Policies: expanding gets `floor + free/k`; growing and preferred take the space only
  when no expander is present; a deficit takes `deficit/k` off every preferred/shrinking
  child; the `expand` widget class is growing.
- flowcontainer: single non-wrapping run, `direction = vertical`, `spacing`, hugging, at
  the parent origin.
- `container` hugging its positioned children; `margin_widget` offsetting the children's
  origin while keeping its own rect.
- `scrollarea` marked as clipping, with `scrollwidget` as a pass-through.
- Text: the calibrated advance/ink model, linear fontsize scaling, `max_width` clamp,
  multiline word wrap, `align` offsets, the `text_multi` 45×45 fallback.
- Template/type/`using`/`block`/`blockoverride` expansion with instance overrides, a
  recursion guard, FIOS store merging and file-local `local_template` (`guiDefs.ts`).
- Datamodel `item` placeholder rows, capped, non-editable, drawn at reduced opacity.
- Nine-slice REGION geometry with border clamping (`computeNineSlice`) and border
  extraction from a `background` block or a widget's own textured fill.
- `state = {}` treated as an inert property block.
- `@constant` resolution, and unresolvable values (data bindings, unknown macros) folded
  to 0 so rects stay finite over the whole vanilla tree.

**The G2 diff, as it stood before the merge**

- A box IGNORING a child's `position`; the toolkit adds it as an offset (L23).
- `ignoreinvisible` / hidden-child collapse (L27).
- `resizeparent` (L28).
- `scrollbox` and `scissor = yes` as clippers, and clamping descendant rects (L17b/c).
- dynamicgridbox and fixedgridbox flow and cell math, `setitemsizefromcell`,
  `item` content-sizing (L10, L14, L15, L29).
- Sprite fill MODE: the `Cornered*` + border gating, tiled vs stretched edges (L21a-d).
- `frame` / `framesize` sheets (L22).
- The container measurability guard and the empty-container collapse (L11b/c, L25).
- Minimum-size floors and the deficit redistribution loop (L04c).
- flowcontainer honoring a child's `parentanchor` (L13d).
- A state block supplying a resting position (L07c).
- The `expand` PROPERTY form (L06c).
- A per-glyph text metrics table beyond `M` / `i` / space (L01f).

**What G2 landed, and what it left** (2026-08-01, `layoutEngine.ts` phase 3)

Everything on that list shipped with goldens except the rows below: L27, L28, L17b,
L10/L14/L15/L29, L21a-d, L22, L25, L11c, L04c and L13d all landed. What stayed out, each
for a stated reason rather than for want of time:

- **L23** and **L07c** are DISPUTED (see §G), as is **L13e**, which the merge inherited
  rather than raised: both engines measured, they disagree, and one in-game probe each
  settles it. Nothing was implemented and no golden was flipped in either direction.
- **L17c** is a deliberate divergence: true geometry on the node plus a `clip` flag, the
  client clamps. Same pixels, and the measured B3-R1 golden stays.
- **L11b** (the measurability guard) needs a preview default SIZE that no measurement
  pins; it moves to G3 with the canvas.
- **L06c** and **L01f** have no source at all: no spec.md bullet, and for L06c no vanilla
  instance of the shape either. Both need a measurement before they can be code.

Two side effects worth knowing: `minimumsize` is an attribute block now (it was being
walked as a phantom child widget, costing a box child a space-around slot), and a
datamodel `item` is a NODE in the layout tree instead of being spliced away, which is what
gives a gridbox cell something to size. Vanilla sweep after the merge: 373 files, 334,628
nodes, no non-finite rect, 1.6 s (before: 329,500 nodes, 1.5 s).

---

## F. Correspondences with `calibration/spec.md`

These rules were measured on the toolkit side FIRST and the Studio's engine encodes the
same facts (its ROADMAP cites "Toolkit calibration batch 01/04" as its source), so they
are not part of G2's diff even though both harnesses check them. Listing them here is what
makes §A's G2 rows the TRUE missing set.

| Rule | Toolkit provenance | Studio's independent in-game confirmation |
|---|---|---|
| Anchored box fills both axes + space-around | batch 01 (B1-E/F), batch 02 (I1), batch 03 (P1) | test mod §I1, 2026-07-17 |
| Box nested in a box hugs its content | batch 02 (I2) | test mod §H, 2026-07-17 |
| Sizeless plain widget is a zero rect | batch 04 (T1) | test mod §I2, 2026-07-17 |
| `scale` multiplies the resolved rect at the same origin | batch 04 (T4) | test mod §I3, 2026-07-17 |
| Cross-axis placement is per-child centring | batch 01 (B1-E/F) | test mod §H, 2026-07-17 (with the `align` finding, which is new: L12b) |
| Policy tiers and equal-delta deficit shrink | batch 02 (J1-J3), batch 03 (P2-P4) | encoded in the Studio engine, no separate in-game pass recorded |
| Text metrics: 21px line box, linear scaling, advance model | batches 01-03 (G, L, S1-S3) | encoded in the Studio engine, no separate in-game pass recorded |

Everything the Studio measured that spec.md did NOT already have has been merged into
`calibration/spec.md` under "Studio-verified engine behaviors", each labeled with its
source and, where one is on record, its in-game date. Those merged rules are exactly §A's
G2 rows.

---

## G. Acceptance numbers

### Invariant targets over the regenerated corpus (the gate)

G0 replaces the Studio's corpus-specific counts with the INVARIANTS they carried, over
`packages/server/test/fixtures/gui/`. The targets are absolute and hold on any machine:

- **Zero span mismatches** (S01): every recorded span re-tokenizes to its model value.
- **Byte identity outside the target span** (S02): a single-entry rewrite changes exactly
  the bytes of that entry's value and nothing else, and the document still parses to the
  same root count.
- **Exact inverses** (S03-S05): reorder move-and-back, insert-then-delete,
  duplicate-then-delete-the-copy and paste-then-delete each restore the file byte for byte.
- **Braces on braces** (S06) for every widget body.
- **Rect identity** for extract-as-type (W21).
- **Refusals never write** (W10, W18): a refused gesture leaves the file untouched.

The COUNTS (files, entries, boxes, parents, rewrites) are recorded as a baseline the first
time G1 runs the sweep over this corpus. They are deliberately not predicted here: a
guessed baseline is worse than none, because it would be silently "met". G1's commit
records them, and a later drop in any count means a fixture stopped being exercised, which
is itself a regression.

**Recorded 2026-08-01, G1 stage 1** (the span model), by
`packages/server/test/guiSourceModel.test.ts`:

| Corpus | Files | Entries | Declarations | Bodies | Span mismatches |
|---|---|---|---|---|---|
| Fixture corpus (`test/fixtures/gui/`) | 39 | 1,308 | 402 | 788 | **0** |
| Vanilla `gui/` tree (dev-paths-gated) | 373 | 172,178 | 45,364 | 68,406 | **0** |

The fixture counts are asserted exactly (a drop means a fixture stopped being exercised);
the vanilla counts are asserted as a file count plus lower bounds and printed, because a
game patch legitimately moves them. The vanilla sweep runs in 1.1 s over 277,839 lines.
"Declarations" is the widget + template/type/slot subset of the entries; the remaining
126,814 vanilla entries are properties. The later stages append their own rows here
(rewrites, reorders, inverse round trips) as they land.

**Recorded 2026-08-02, G1 stage 2** (property operations), by
`packages/server/test/guiSourceEdit.test.ts`:

| Corpus | Files | Rewrites | Re-parses | Byte drift |
|---|---|---|---|---|
| Fixture corpus (`test/fixtures/gui/`) | 39 | 370 | 370 | **0** |
| Vanilla `gui/` tree (dev-paths-gated) | 373 | 40,585 | 365 | **0** |

One probe per BODY: the sweep rewrites that body's first property value to a marker and
asserts the rest of the file is byte-identical, so 370 is the number of fixture bodies
that hold a property (of 788 bodies), and 40,585 the vanilla number. The second half of
S02, "the file still parses to the same root count", re-parses after every probe on the
fixture corpus; over the vanilla tree that would be 40,585 full parses of the game tree
(four minutes of gate time), so there it re-parses once per file, which is 365 of the 373
(the other eight hold no body with a property in it), and leans on S01/S06 sweeping every
span of those same files. The vanilla sweep runs in 3.7 s.

**Recorded 2026-08-02, G1 stage 3** (the structural operations), by
`packages/server/test/guiSourceEdit.test.ts`:

| Corpus | Files | Reorders (S03) | Skipped | Inserts (S04) | Duplicates (S05) | Pastes | Failures |
|---|---|---|---|---|---|---|---|
| Fixture corpus (`test/fixtures/gui/`) | 39 | 60 | 2 | 402 | 397 | 228 | **0** |
| Vanilla `gui/` tree (dev-paths-gated) | 373 | 2,650 | 704 | 3,796 | 3,762 | 3,358 | **0** |

Every probe is computed against the original text, applied, re-parsed, and its inverse
computed from THAT re-parse, so a round trip goes through the real operations rather than
through string arithmetic. "Skipped" is S03's own count of bodies whose children do not
tile: interleaved content between them, or a declaration sharing a line. Four fixture
inserts and seven vanilla ones respelled an empty `{ }` as `{}` and are counted, not
passed off as identity (W25).

The vanilla numbers are a SAMPLE: each probe re-parses its whole file, so the cost is
quadratic in file size and an uncapped run over the game tree takes far longer than a gate
should. The sweep takes 12 probes per kind per file, spread across the file, and prints
what it did (24 s for the whole test file). A one-off pass at 40 probes per kind ran clean
on 2026-08-02; the step up from 4 to 12 is what caught the last two writer bugs, so raise
the cap when the writer changes. The fixture corpus is swept with no cap at all, which is
what CI gates on.

The corpus is small on purpose. It is the CI gate and it must stand on its own, because CI
has no CK3 install. The vanilla sweep below is the fuzz corpus, and it runs only on a
machine that has the game.

### Vanilla-corpus sweep numbers (recorded as-is, directly comparable)

Vanilla is the same corpus on this machine, so these transfer. Recorded from the Studio
ROADMAP, with the one correction the file counts force:

| Sweep | Studio number | Note for the toolkit run |
|---|---|---|
| Files swept | **376** | This is 373 vanilla `.gui` files **plus the 3 files of the Studio's own test mod**, which its sweep prepends. The toolkit's vanilla-only sweep sees **373** on this machine's install, which matches the count already recorded in `layoutEngine.ts` ("verified over all 373 game .gui files") and was confirmed again by the G1 stage-1 span sweep (2026-08-01), which also found all 373 parsing without a single error. Compare 373 vanilla to 373 vanilla, not to 376 |
| Entries re-tokenized | **96,770** | Includes the test mod's 511 entries. The toolkit's 2026-08-01 figure is **172,178 over 373 files, zero mismatches**, and the gap is a DEFINITION difference, not a coverage one: an entry here is every `key [op] value` statement in the file, including the interiors of attribute blocks (`background = { texture = … }`) and the bodies of `type`/`template` definitions. 277,839 lines of vanilla `.gui` produce 172,178 entries, so the toolkit's set is close to "every assignment in the tree" and cannot be under-counting the Studio's |
| Single-entry rewrites byte-identical | **29,765** | Same caveat |
| Contiguous boxes round-tripping through reorder | **3,094**, with **593** interleaved bodies skipped | The pre-fix figure is the interesting one: **3,335 of 3,687** real boxes FAILED move-and-back before blank lines were given an owner |
| Insert-then-delete and duplicate-then-delete | **0 of 6,209** failing | The pre-fix figure was **74 of 152** parents in the test mod alone |
| Rect dump | **126 rects** on the Studio test mod | NOT reproducible here: that mod is not in this repo and is not being copied. RECORDED at G2 instead over this repo's own corpus: 352 rects across the 21 `layout/` fixtures, in `test/fixtures/gui/layout-rects.baseline.txt` (2026-08-01). The vanilla side is the sweep above: 373 files, 334,628 nodes, zero non-finite rects |
| App smoke | 16/16 → 34/34 → 45/45 → 50/50 across 8 vanilla files + the test mod | S08, dropped from G1/G2 |

Any non-zero failure count in a sweep is a failure. A materially different total (files,
entries) is not a failure by itself but must be explained: the usual cause is a game patch
adding or removing `.gui` files.

### How the vanilla sweeps gate on `dev-paths.json`

Same precedent as every other corpus-gated test in this repo:

```ts
import { devPath } from "../../../scripts/devPaths";

const guiDir = devPath("gamePath") ? path.join(devPath("gamePath")!, "gui") : null;

it.skipIf(!guiDir)("vanilla sweep: every span re-tokenizes", () => { /* … */ });
```

- The path comes from `games.ck3.gamePath` in the gitignored `dev-paths.json`, or from the
  `PX_CK3_GAME_PATH` environment variable, or from the legacy flat `gamePath` slot.
- The vanilla `gui/` tree is `gamePath + "/gui"`, walked recursively for `*.gui`, exactly
  what `guiLayout.test.ts` already does in its two `it.skipIf(!devPath("gamePath"))` cases.
- **Skip when absent, never fail.** CI and any contributor without the game get a green
  run from the fixture corpus alone.
- Never hardcode a personal path in a tracked file (AGENTS.md).
- The sweep must never WRITE to the game folder. Everything is in memory, as the Studio's
  own sweep is.

### Open conflicts: DISPUTED after G2, one probe each

Three places where the two engines encode contradictory rules. None can be resolved by
reading code, all three need one in-game measurement, and all three have a fixture waiting.
G2 implemented NOTHING for them and flipped no golden in either direction: both sides were
measured, so overwriting one with the other would destroy evidence rather than settle it.

"Unasserted" means the NAMED goldens say nothing about the three probe widgets. The S07 rect
baseline does carry their current rects, because it dumps every rect of every fixture, so
settling a dispute the other way will re-record `layout-rects.baseline.txt`
(`PX_WRITE_GUI_RECT_BASELINE=1`). That is the point of the baseline: the answer changes as a
reviewable numeric diff instead of silently.

1. **flowcontainer with an explicit `size`** (L13e). Toolkit batch 03 (Q1) measured that
   the size sets the container's own rect but not a wrap width; the Studio's GUI009 groups
   flowcontainer with the boxes and ignores the size outright. `layout/flow-container.gui`
   carries both shapes side by side (`px_flow_run` vs `px_flow_sized`). Probe: put both in
   a mod, screenshot, compare the two backgrounds' extents.
2. **`position` on a box child** (L23). The Studio drops it (and refuses the drag on that
   basis, §H session 2026-07-17); the toolkit adds it as an offset and labels the choice
   unmeasured; spec.md is silent. The writer's refusal honesty depends on the engine
   agreeing, so this must be settled before G1's `PositionIgnoredReason` equivalent can be
   trusted. `layout/box-child-ignored.gui` is the probe: `px_positioned` carries
   `position = { 40 40 }` next to four identical siblings, and its rect is deliberately
   left unasserted by the G2 goldens.
3. **A state block supplying a resting position** (L07c). NEW as of G2, and it points the
   other way: the Studio's engine lets a `state` supply the resting position of a widget
   that has none, `state-blocks.gui`'s `px_state_only` was authored to that expectation,
   and spec.md's phase-2 bullet says the exact opposite ("nothing inside a `state` leaks
   into the rect"), which is what this engine does and what `guiLayout.test.ts` asserts.
   Neither source is in-game dated. Probe: a sizeless-position widget whose only offset
   lives in a `state`, screenshotted at rest.
