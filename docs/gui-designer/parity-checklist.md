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
| **G1** | Writer rebuild. Nothing equivalent exists here; `widgetEdit.ts` (91 lines, position/size only) is the whole current writer. |
| **G2** | Layout merge. Either unimplemented here, or implemented but never asserted, or implemented DIFFERENTLY (those rows say so). |
| **dropped** | Out of the G1/G2 acceptance gates, with the reason. Some return at a later G phase; the reason says which. |

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
| L01f | Per-glyph advance/ink beyond the measured `M` / `i` / space | `layout/text-metrics.gui` | **G2**: the toolkit's `GLYPHS` table has three entries and a `DEFAULT_GLYPH` guess; the Studio's model measures the alphabet, so a mixed-case string (its `"Hello"` case) is only approximate here |
| L01g | The vanilla `text_multi` type's hardcoded `size = { 45 45 }` wins over `max_width` | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` "B2-L" |
| L02a | Space-around: n children, side = free/(2n) on BOTH sides, gap = s + 2·side | `layout/box-fill-spacearound.gui` | **covered** by `guiLayout.test.ts` "B1-E1", "B1-F1/F2" |
| L02b | `spacing` adds inside the gap; `margin = { a b }` is horizontal, vertical | `layout/box-fill-spacearound.gui`, `layout/box-margins.gui` | **covered** by `guiLayout.test.ts` "B1-E2", "B1-E3" |
| L02c | No slack (content == container) → children flush and packed, no residual gaps | `layout/box-nested-hug.gui` | **covered** by `guiLayout.test.ts` "B2-I2" |
| L03a | `expanding` children each get floor + free/k (equal SHARE, not equal size) | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J2 + B3-P3" |
| L03b | `growing` yields to an expanding sibling and keeps its own explicit size | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J1" |
| L03c | `growing` alone behaves like expanding | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B3-P2 + B4-T8" |
| L03d | Two growers with no expander share the free space equally | `layout/box-policies.gui` | **G2**: implemented (`takers` falls back to growers) but only the single-grower case is asserted |
| L04a | Deficit: every shrinkable child loses deficit/k, equal DELTA, no shrinking-first priority | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J3 + B3-P4" |
| L04b | A `fixed` child never shrinks; the shrinkable sibling absorbs the whole deficit | `layout/box-policies.gui` | **G2**: implemented, never asserted (both children are shrinkable in the current case) |
| L04c | Minimum-size floors and the redistribution loop: a floored child stops at its min and the rest absorb what is left, total still fits | `layout/box-policies.gui` | **G2**: the toolkit has no per-child minimum and no redistribution loop; it clamps at 0 in one pass |
| L05a | `parentanchor` picks the parent point; the nine combinations are exact | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-B" |
| L05b | `widgetanchor` defaults to the VALUE of `parentanchor`, not top-left | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-C" |
| L05c | `position` is added after anchoring, always screen-space +right/+down | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-D" |
| L05d | Nested offsets accumulate linearly, no implicit padding | `layout/anchors.gui` | **covered** by `guiLayout.test.ts` "B1-H" |
| L06a | `layoutpolicy_horizontal/vertical` classification | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B2-J1" |
| L06b | The `expand` widget TYPE is growing | `layout/box-policies.gui` | **covered** by `guiLayout.test.ts` "B3-P2 + B4-T8" |
| L06c | An `expand = {}` PROPERTY on an ordinary widget makes it growing | `layout/box-policies.gui` | **G2**: the toolkit reads `expand` only as a child element, never as a property |
| L07a | `state = {}` never leaks into the resting rect; it is not a child widget | `layout/state-blocks.gui` | **covered** by `guiLayout.test.ts` "phase 2: state blocks excluded from layout" |
| L07b | A widget with no state block keeps its STATIC position (no substitution) | `layout/state-blocks.gui` | **covered** by the same test |
| L07c | A state block SUPPLIES the resting position when the widget has none | `layout/state-blocks.gui` | **G2**: not implemented here; states are inert full stop |
| L08 | Text sizing end to end through the node (`raw_text` → measured rect) | `layout/text-metrics.gui` | **covered** by `guiLayout.test.ts` text-metrics suite |
| L09 | Real `.gui` parse → box arrangement, the closest headless mirror of a preview | `layout/end-to-end-window.gui` | **covered**: the `guiLayout.test.ts` batch-01/02/03 suites parse real snippets end to end; the new fixture adds the COMBINATION case (spacer + expanding text + button column alignment) |
| L10 | A datamodel gridbox `item` content-sizes (bounding box of its children, positioned child extends it), not a generic widget default | `layout/container-measurability.gui` | **G2**: the toolkit splices `item` children straight in; there is no `item` rect to size |
| L11a | `container` hugs its absolutely-positioned children at the parent origin | `layout/container-measurability.gui` | **covered** by `guiLayout.test.ts` "B2-I4" |
| L11b | Content-sizing runs only when the content is statically MEASURABLE; `{ 0 0 }` children, a child of an unknown type, a `datamodel`, or a binding-valued `visible` all make it unmeasurable, and the preview keeps a visible default rather than collapsing | `layout/container-measurability.gui` | **G2**: no measurability guard here |
| L11c | A plainly `visible = no` child is SKIPPED and the rest still content-size | `layout/container-measurability.gui` | **G2** |
| L12a | A box nested in a box HUGS its content (no fill) and is then placed by the outer box's rules | `layout/box-nested-hug.gui` | **covered** by `guiLayout.test.ts` "B2-I2" |
| L12b | `align = left/right` on a box child does NOTHING; cross placement is unconditionally centred | `layout/box-child-ignored.gui` | **G2**: correct by construction here (`align` is only read for text offsets) but never asserted |
| L13a | flowcontainer never wraps; one run along the main axis, overflowing unclipped | `layout/flow-container.gui` | **covered** by `guiLayout.test.ts` "B2-K1 + B3-Q1" |
| L13b | flowcontainer hugs its content and sits at the parent ORIGIN, no centring | `layout/flow-container.gui` | **covered** by the same test |
| L13c | `direction = vertical` and `spacing` | `layout/flow-container.gui` | **covered** by `guiLayout.test.ts` "B2-K2/K3" |
| L13d | flowcontainer HONORS a child's `parentanchor` on the cross axis (the one container that does) | `layout/flow-container.gui` | **G2**: the toolkit origin-aligns flow children and says so ("unmeasured") |
| L13e | Whether an explicit `size` sets the flow's own rect (toolkit B3-Q1) or is ignored like a box's (Studio GUI009) | `layout/flow-container.gui` | **G2**: the two sides DISAGREE; see §G "Open conflicts" |
| L14a | fixedgridbox: `addcolumn`/`addrow` are the CELL SIZE and the stride | `layout/grid-fixed.gui` | **G2**: no fixedgridbox support here |
| L14b | fixedgridbox flow: vertical single column by default, `flipdirection` transposes, `maxhorizontalslots` caps only while horizontal, `datamodel_wrap` sets the wrap | `layout/grid-fixed.gui` | **G2** |
| L14c | An item with no concrete size anywhere in its chain takes the CELL size; one with a concrete size keeps it at the cell origin | `layout/grid-fixed.gui` | **G2** |
| L14d | A fixedgridbox with no `item` still lays out decorative slots | `layout/grid-fixed.gui` | **G2** |
| L15 | dynamicgridbox: vertical fill by default, `datamodel_wrap` = items per COLUMN, `flipdirection` transposes without mirroring, items pack at their OWN size (addcolumn/addrow are not the stride) | `layout/grid-dynamic.gui` | **G2**: no dynamicgridbox support here |
| L16a | A datamodel list stamps placeholder rows laid out by the container's real policy | `layout/datamodel-ghosts.gui` | **covered** by `guiLayout.test.ts` "phase 2: datamodel list placeholders" |
| L16b | Placeholder count is capped by a container whose own explicit size is known | `layout/datamodel-ghosts.gui` | **covered** by the same suite, "caps ghosts to the container's own explicit size" |
| L16c | Placeholders are never editable | `layout/datamodel-ghosts.gui` | **covered** by the same suite |
| L16d | A container inside a HORIZONTAL box collapses to a single placeholder | `layout/datamodel-ghosts.gui` | **dropped**: a Studio canvas affordance, not an engine fact. The toolkit stamps into the container's real policy, so a horizontal box lays the placeholders across; changing that is a G3 preview-UX decision, not a layout invariant |
| L17a | scrollarea clips; content origin at the viewport origin at scroll 0; a bare `scrollwidget` renders without scrollbar chrome | `layout/clipping.gui` | **covered** by `guiLayout.test.ts` "B3-R1" |
| L17b | `scrollbox` and `scissor = yes` also clip | `layout/clipping.gui` | **G2**: only `scrollarea` sets `clip` here |
| L17c | Descendant rects are CLAMPED to the clipper (the flatten does it, not only the renderer) | `layout/clipping.gui` | **G2**: the toolkit sets a `clip` flag and leaves clamping to the client renderer |
| L18 | Bookmark map characters: feet-anchored portrait placement | none | **dropped**: a CK3 bookmark-screen preview inside the Studio app, not a `.gui` layout rule and not a toolkit surface in any G phase |
| L19a | An hbox/vbox whose parent is a plain widget FILLS it on both axes with no layoutpolicy asked for | `layout/box-fill-spacearound.gui` | **covered** by `guiLayout.test.ts` "B1-E1", "B2-I1 + B3-P1" |
| L19b | The main-axis surplus then spreads as space-around | `layout/box-fill-spacearound.gui` | **covered** by the same tests |
| L20a | A sizeless plain widget is a ZERO rect; children still render from its origin | `layout/widget-basics.gui` | **covered** by `guiLayout.test.ts` "B4-T1" |
| L20b | `scale` multiplies the resolved rect at the same origin | `layout/widget-basics.gui` | **covered** by `guiLayout.test.ts` "B4-T4" |
| L21a | Nine-slice requires BOTH a `Cornered*` spriteType AND a non-zero `spriteborder` | `layout/sprite-nineslice.gui` | **G2**: the toolkit nine-slices on a border alone, which the Studio's §J4 measured as WRONG |
| L21b | A border without a `Cornered*` type is ignored; the whole texture plain-stretches | `layout/sprite-nineslice.gui` | **G2** |
| L21c | A `Cornered*` type with no border tiles (for a `*tiled*` type) or stretches the whole texture | `layout/sprite-nineslice.gui` | **G2** |
| L21d | Nine-slice edge behavior: `Corneredtiled` tiles the edges, `Corneredstretched` stretches them | `layout/sprite-nineslice.gui` | **G2**: the toolkit's `computeNineSlice` always stretches |
| L21e | `2·border > size` on an axis → the corners clamp to size/2 and meet, no centre | `layout/sprite-nineslice.gui` | **covered** by `guiLayout.test.ts` "computeNineSlice: borders clamp so opposite sides never overlap" |
| L21f | `spriteborder = { x y }` axis order (x = left/right width, y = top/bottom height) and the `spriteborder_<side>` overrides | `layout/sprite-nineslice.gui` | **covered** by `guiLayout.test.ts` "carries border geometry from a background block", "per-side overrides win over the { x y } pair" |
| L21g | The nine regions: corners 1:1, edges on one axis, centre on both | `layout/sprite-nineslice.gui` | **covered** by `guiLayout.test.ts` "computeNineSlice: exact 9 regions" |
| L22 | `framesize = { w h }` is a 2D grid, row-major, 1-based; frame ≤ 0 clamps to the first cell and a frame past the last clamps to it | `layout/sprite-framesize.gui` | **G2**: no frame support here at all |
| L23 | A box IGNORES a child's `position` (and `parentanchor`): the slot is the box's business | `layout/box-child-ignored.gui` | **G2**: the toolkit ADDS `position` as an extra offset and marks it "unmeasured". This is a real divergence, and the writer's `PositionIgnoredReason` (W10) depends on the engine agreeing |
| L24 | Only `widget` holds a fixed pixel `size`; hbox/vbox ignore an explicit one, smaller or larger | `layout/box-fill-spacearound.gui` | **covered** by `guiLayout.test.ts` "B2-I1 + B3-P1" |
| L25 | An EMPTY `container` collapses to 0: a fixed `size` will not hold it open | `layout/container-measurability.gui` | **G2**: the toolkit returns the explicit size for a container |
| L26 | `margin` on a plain `widget` is ignored; only `margin_widget` and the layout containers honor margins | `layout/box-margins.gui` | **G2**: the toolkit reads `margin` on a plain widget's children coordinate space only through `marginwidget`, so the plain case is correct by construction but unasserted |
| L27 | `ignoreinvisible` (default `yes` on hbox/vbox) collapses hidden children, including a binding-false `visible`, so siblings shift up | `layout/ignoreinvisible.gui` | **G2**: the toolkit lays hidden children out normally |
| L28 | `resizeparent = yes` resizes the PARENT to the widget's content; a fixed-size DIRECT child of one can collapse, nesting one level deeper preserves it | `layout/resizeparent.gui` | **G2**: `resizeparent` is parsed as an inert property block here |
| L29 | `setitemsizefromcell = yes` (gridbox) forces every cell to the WIDEST item's size; needs a datamodel | `layout/grid-fixed.gui` | **G2** |
| L30 | A percentage WIDTH inside a vbox crashes the game (the vbox's width is content-derived, so `%` cannot resolve); height `%` is the milder case | none | **dropped**: an authoring hazard with no rect consequence. Recorded in `calibration/spec.md`; it belongs to a `.gui` linter, and no linter is in the G-plan |
| L31 | An expanding child must not DEFINE a box's cross size; only fixed children do | `layout/box-child-ignored.gui` | **G2**: the toolkit stretches an expanding child to the cross content size, which is the same outcome for the child but leaves the box's own cross measurement unasserted |
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

The toolkit's entire writer today is `packages/server/src/gui/widgetEdit.ts` (91 lines):
it rewrites or inserts `position`/`size` on the widget whose statement starts on a given
line, and `guiWidgetEdit.test.ts` asserts six cases. It has no span model, no block
notion, no batching, no newline or indent-unit awareness, and no refusals. **Every row
below is therefore G1**, and the table records WHAT G1 owes rather than a verdict column
that would read "G1" forty times.

| Row | Behavior | Fixture |
|---|---|---|
| W01 | Parser SPANS: `HeaderStart` / body-open / body-close land on the right bytes; a block value's span is the raw block text, a quoted value's span includes the quotes, a key's span points at the key | `writer/tabs-comments.gui` |
| W02 | Replace: rewrites only the old value's bytes (minimal edit), key lookup case-insensitive, an unchanged value is a no-op rather than a churn edit | `writer/tabs-comments.gui`, `writer/duplicate-keys.gui` |
| W03 | Insert a property: its own line before the closing brace, at the body's own indent, including a nested body's deeper indent | `writer/tabs-comments.gui`, `writer/spaces-indent.gui` |
| W04 | Remove a property: takes the whole line, but keeps a line that still carries a trailing comment (remove the entry, not the line) | `writer/tabs-comments.gui` |
| W05 | Batch: several edits computed against the SAME text and applied end-first; untouched entries stay byte-identical | `writer/tabs-comments.gui`, `writer/nested-selection.gui` |
| W06 | Formatting preservation: CRLF file gets CRLF inserts; comments survive; a single-line body stays single-line; an empty `{}` body gets a spaced entry; a space-indented file keeps spaces; mixed tab/space bodies each keep their own | `writer/crlf.gui`, `writer/spaces-indent.gui`, `writer/mixed-indent.gui`, `writer/single-line-bodies.gui` |
| W07 | Duplicate key: rewrite the LAST occurrence (CK3 last-in-wins inside one body) | `writer/duplicate-keys.gui` |
| W08 | Compound `a\|b` value: the span covers both sides of the pipe and is replaced whole | `writer/duplicate-keys.gui` |
| W09 | Template use site: an inherited property has no writable entry, so a write adds a LOCAL override and the template's bytes are untouched; a synthetic node reports no source and refuses every op | `writer/template-use-site.gui` |
| W10 | Refusal honesty: `position` on a box child, `size` on a content-sized type (hbox/vbox/flowcontainer), `size` on a child expanding on BOTH axes; one expanding axis writes and names the axis the box owns; the guard must NOT fire outside a layout container | `writer/refusal-shapes.gui` |
| W11 | Reorder permutations: first→last, last→first, middle→first, first→middle; same index is a no-op; an out-of-range index clamps; the moved text is carried VERBATIM (non-whitespace character count unchanged) | `writer/reorder-siblings.gui` |
| W12 | Blank separators belong to the block ABOVE them, so a move-and-move-back is the identity and repeated reorders cannot accumulate blank lines | `writer/blank-separators.gui` |
| W13 | An attached comment travels with its widget; a blank-line-separated section header stays put | `writer/comment-runs.gui` |
| W14 | Reorder refusals and scoping: two declarations sharing a line, a single child, template-expanded children excluded from the source sibling list, and a body whose children are INTERLEAVED with non-child content (the move still lands correctly relative to the sibling aimed at, but round-trip identity legitimately does not hold, so a sweep must skip and count it) | `writer/line-sharing.gui`, `writer/reorder-siblings.gui`, `writer/template-use-site.gui`, `writer/interleaved-children.gui` |
| W15 | Insert a child widget: last in the body at the children's indent, at an index (before that child's BLOCK, comment included), propertyless → an empty block not a malformed one, re-parses as a real child, out-of-range index appends, follows the file's indent unit and newline, single-line and empty bodies stay as they are | `writer/tabs-comments.gui`, `writer/spaces-indent.gui`, `writer/crlf.gui`, `writer/single-line-bodies.gui` |
| W16 | Delete a widget: removes the whole declaration, leaves sibling properties untouched, takes the widget's attached comment with it, and on a line-sharing declaration keeps the neighbour AND the gap | `writer/tabs-comments.gui`, `writer/comment-runs.gui`, `writer/line-sharing.gui` |
| W17 | Duplicate: the copy lands immediately after the original, an asked-for rename touches ONLY the copy and keeps its quoting style, duplicating the last child stays inside the parent's body | `writer/reorder-siblings.gui` |
| W18 | Insert and delete both refuse a synthetic parent; a `type` definition is refused because other files may use it; deleting the only root window is refused | `writer/template-use-site.gui`, `writer/refusal-shapes.gui` |
| W19 | Copy: block text carries the attached comment and the nested body verbatim; it is null for a line-sharing declaration | `writer/paste-fragment.gui`, `writer/line-sharing.gui` |
| W20 | Paste: strips the fragment's COMMON leading whitespace as a string prefix, converts interior indent LEVELS to the destination's unit (no tab survives into a space file), converts newlines to the destination's, a multi-widget fragment pastes as several children, index placement matches insert's, and it refuses a single-line body and a blank or non-widget fragment | `writer/paste-fragment.gui`, `writer/paste-destination.gui`, `writer/crlf.gui`, `writer/single-line-bodies.gui` |
| W21 | Extract as type: a two-edit batch, the definition at the top of the file, `name`/`position` lifted to the instance (use-site identity) and gone from the definition body, the attached comment left at the use site, the re-parsed file carrying the type, and the crown invariant, IDENTICAL rects before and after. Refuses a root widget and an empty type name | `writer/extract-candidate.gui` |
| W22 | Wrap in container: a non-contiguous selection puts the container in the FIRST member's slot, the skipped sibling stays, members land inside in order re-indented, comments travel, the document still parses to one root | `writer/wrap-candidate.gui` |
| W23 | Nested selections collapse to the outermost before a batch is built (an overlapping edit would be dropped and half the batch silently lost); property writes do NOT collapse | `writer/nested-selection.gui` |
| W24 | The append point for a new child is the LAST CHILD's block end, not the closing-brace line; with no children it backs up over a trailing comment run. Otherwise an inserted widget lands below commented-out code and deleting it takes the comments with it | `writer/comment-runs.gui` |
| W25 | Single-line insert/delete are exact inverses, including the separator space (the `{ a  }` accumulation bug) | `writer/single-line-bodies.gui` |

---

## C. Corpus sweeps and headless app modes

The `RealFiles` sweep in `SourceEditorTests.cs` and the numbers the Studio ROADMAP records
for it. These are the checks that found what code review did not, so they are the acceptance
gates that matter for G1.

| Row | Sweep | Verdict |
|---|---|---|
| S01 | Span invariant over every entry of every real file: the recorded span covers key then value in order, and re-tokenizing the span alone reproduces the model's normalized value | **G1** |
| S02 | Single-entry rewrite leaves every OTHER byte identical, and the file still parses to the same root count | **G1** |
| S03 | Reorder move-to-end-then-back restores the file byte for byte, over CONTIGUOUS boxes only; interleaved bodies are skipped and counted (`writer/interleaved-children.gui` is the shape that must be skipped) | **G1** |
| S04 | Insert-then-delete restores the file byte for byte | **G1** |
| S05 | Duplicate-then-delete-the-copy restores the file byte for byte | **G1** |
| S06 | Every widget body's recorded braces land on `{` and `}` | **G1** |
| S07 | Headless rect dump over a corpus (`--render-gui` equivalent), diffed numerically before and after a change | **G2**: the consolidation plan schedules the rect-dump harness with the layout merge |
| S08 | Headless app smoke driving the REAL editor through select → add → duplicate → delete → undo → redo, asserting one document edit per batch, selection surviving the re-parse, and the file byte-identical after undoing the run (`--gui-edit-smoke` equivalent) | **dropped** from G1/G2: it drives a UI that does not exist here yet; the plan schedules the Playwright equivalent alongside G3's webview |
| S09 | The expanding-axis guard never reports an expanding axis for a widget OUTSIDE a layout container (otherwise the guard starts refusing resizes the engine would have honoured) | **G1**: a refusal-honesty invariant, testable headlessly |

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

**Not implemented (the G2 diff)**

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

The corpus is small on purpose. It is the CI gate and it must stand on its own, because CI
has no CK3 install. The vanilla sweep below is the fuzz corpus, and it runs only on a
machine that has the game.

### Vanilla-corpus sweep numbers (recorded as-is, directly comparable)

Vanilla is the same corpus on this machine, so these transfer. Recorded from the Studio
ROADMAP, with the one correction the file counts force:

| Sweep | Studio number | Note for the toolkit run |
|---|---|---|
| Files swept | **376** | This is 373 vanilla `.gui` files **plus the 3 files of the Studio's own test mod**, which its sweep prepends. The toolkit's vanilla-only sweep sees **373** on this machine's install, which matches the count already recorded in `layoutEngine.ts` ("verified over all 373 game .gui files"). Compare 373 vanilla to 373 vanilla, not to 376 |
| Entries re-tokenized | **96,770** | Includes the test mod's 511 entries; expect a slightly lower vanilla-only figure |
| Single-entry rewrites byte-identical | **29,765** | Same caveat |
| Contiguous boxes round-tripping through reorder | **3,094**, with **593** interleaved bodies skipped | The pre-fix figure is the interesting one: **3,335 of 3,687** real boxes FAILED move-and-back before blank lines were given an owner |
| Insert-then-delete and duplicate-then-delete | **0 of 6,209** failing | The pre-fix figure was **74 of 152** parents in the test mod alone |
| Rect dump | **126 rects** on the Studio test mod | NOT reproducible here: that mod is not in this repo and is not being copied. The toolkit re-records its own rect baseline over `fixtures/gui/layout/` at G2 |
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

### Open conflicts to settle in G2

Two places where the two engines encode different rules. Neither can be resolved by
reading code; both need a measurement, and both have a fixture waiting.

1. **flowcontainer with an explicit `size`** (L13e). Toolkit batch 03 (Q1) measured that
   the size sets the container's own rect but not a wrap width; the Studio's GUI009 groups
   flowcontainer with the boxes and ignores the size outright. `layout/flow-container.gui`
   carries both shapes side by side.
2. **`position` on a box child** (L23). The Studio drops it (and refuses the drag on that
   basis); the toolkit adds it as an offset and labels the choice unmeasured. The writer's
   refusal honesty depends on the engine agreeing, so this must be settled before G1's
   `PositionIgnoredReason` equivalent can be trusted. `layout/box-child-ignored.gui` is the
   probe.
