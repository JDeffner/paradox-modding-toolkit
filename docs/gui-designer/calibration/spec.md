# PdxGui layout spec (measured)

Rules for the GUI designer's layout engine. Every rule carries provenance:
"B1" = measured in batch 01, etc. Confidence is pixel-exact unless noted.
Open questions at the bottom. Game version at measurement time: current
live CK3 install, 100% UI scaling, 1:1 pixels.

A second body of rules from the Sage's Clausewitz Studio is merged in below
under "Studio-verified engine behaviors": what its calibration mod measured in
game on 2026-07-17, plus behaviors its engine and linter encode without an
in-game date on record. Those rules carry `(Studio §X, in-game 2026-07-17)` or
`(Studio, encoded rule)` instead of a batch id. Where that session
independently re-confirmed a rule this spec already had, the confirmation is
recorded in `docs/gui-designer/parity-checklist.md` §F rather than duplicated
here.

## Coordinate system and rendering

- Origin top-left, +x right, +y down, UI units == screen pixels at 100%
  UI scaling; rendering is linear in scale. (B1-A)
- Child coordinates are relative to the parent's top-left; nesting
  accumulates offsets linearly with no implicit padding. (B1-H)
- Plain `widget` does NOT clip children; children may render fully outside
  the parent's rect. (B1-D)
- A `widget` with no `size` has a ZERO rect (no background rendered, no
  hugging, no filling); its children still render relative to its origin.
  (B4-T1)
- Percent sizes (`size = { 50% 50% }`) resolve against the parent's rect.
  (B4-T2)
- `scale` on an icon multiplies its rect, anchored at the top-left
  position. (B4-T4)
- Draw order = file order, later on top. (B1-C, occlusion behavior)
- `color = { r g b a }` tints multiplicatively in plain sRGB:
  rendered_channel = round(value * 255 * texture_channel/255). No gamma or
  linear-light conversion. (B1-G/E backgrounds)
- Default `texture` fill for solids: `gfx/interface/colors/white.dds`.

## Anchoring (widget, icon, any positioned child)

- `parentanchor` picks a point on the parent rect (left/hcenter/right x
  top/vcenter/bottom, `center` = both centers). Default: top-left.
- `widgetanchor` picks the point on the child that lands on the parent
  anchor point. **Its implicit default is the value of `parentanchor`**,
  not top-left. So `parentanchor = bottom|right` alone places the child
  flush inside the corner. (B1-B, all 9 anchors exact; B1-C explicit ==
  implicit)
- Centering uses exact halves: x = (parentW - childW)/2 etc. (B1-B)
- `position = { x y }` is added AFTER anchoring, always screen-space
  +right/+down regardless of anchors (vanilla uses negative offsets with
  bottom/right anchors). (B1-D)

## hbox / vbox

Box sizing depends on the parent kind:

- Parent is a plain `widget`: the box **stretches to fill the parent's
  entire rect in both axes**. Explicit `size` on the box is ignored
  entirely, whether smaller or larger than the parent. (B1-E/F, B2-I1,
  B3-P1)
- Parent is another box: the box **hugs its content exactly** (the wiki
  gallery behavior), and is then placed by the parent's normal child
  rules (cross-centered + space-around). Children inside a hugged box
  are packed with no residual gaps. (B2-I2)
- `position` on a box translates its final rect after sizing (a stretched
  box shifts and overflows the parent, unclipped). (B2-I3)
- Cross axis: every child is individually centered:
  offset = (boxCross - childCross)/2. (B1-E/F)
- Main axis with children total C, spacing s, n children, margin m
  (main-axis component), box main size W:
  - `free = W - 2*m - C - s*(n-1)`
  - each child receives an equal side margin `side = free / (2n)` on both
    sides; adjacent side margins stack, so the visual gap between children
    is `s + 2*side` and the leading/trailing inset is `m + side`.
    (CSS equivalent: justify-content: space-around, plus explicit spacing.)
  - positions are computed fractionally and rasterized within +-1px.
    (B1-E1/E2/E3, three independent confirmations; B1-F vertical mirror)
- `spacing = n` adds n between adjacent children (inside the gap). (B1-E2/F2)
- `margin = { a b }`: a = horizontal inset, b = vertical inset. (B1-E3)
- Directional margins (`margin_top` etc.) inset ONE side of the content
  area; the distribution model then runs inside the remaining area
  (margin_top 30 in a 120-tall box put a lone 40-child at
  y = 30 + (90-40)/2 = 55, exact). (B4-T7)
- `expand = {}` is a growing spacer: absorbs all free space, pushing
  later siblings flush to the far edge. (B4-T8, B3-P2)
- Default spacing and margin are 0. (B1-E1)

### Layout policies (main axis, measured numerically)

Unified model: policy-driven resizing happens FIRST, then the space-around
distribution applies to the residual free space (usually 0 when any child
expands, so children end up packed from the box origin).

- `expanding` (k children with it): each gets **floor + free/k** — equal
  SHARE of free space, not equal final size (floors 40/100 in a 300 box
  became 120/180). (B2-J1/J2, B3-P3)
- `growing`: receives NOTHING while an expanding sibling exists; behaves
  like expanding when alone (took all 220 free next to a fixed sibling).
  `expand = {}` relies on this. (B2-J1, B3-P2)
- Deficit (content > box): each shrinkable child (preferred or shrinking
  alike) loses **deficit/k** — equal delta, not proportional, no
  shrinking-first priority (floors 100/60 in a 120 box became 80/40).
  (B2-J3, B3-P4)

## flowcontainer

- Never auto-wraps: children flow in ONE row (or one column with
  `direction = vertical`), overflowing the parent unclipped — even with
  an explicit `size` (which only sets the container's own rect, not a
  wrap width). The wiki's "wrapping flow" does not hold. (B2-K1/K2, B3-Q1)
- Hugs its content (background covers exactly the content extent,
  including showing through `spacing` gaps) and sits at the parent's
  ORIGIN — no centering, unlike boxes. (B2-K1/K3)
- `spacing = n` separates items along the flow axis. (B2-K3)

## container

- Hugs the extent of its absolutely-positioned children exactly; placed at
  the parent's origin; children keep their positions. (B2-I4)

## margin_widget

- `margin = { a b }` offsets the CHILDREN's coordinate origin by (a,b);
  it does NOT shrink the margin_widget's own rect. With
  `size = { 100% 100% }` the rect is the full parent and children start
  at (a,b). Without a size it renders zero/hugged like B3-Q2 showed.
  (B3-Q2, B4-T3)
- OPEN: whether a box child inside it fills parent-minus-margins (the
  vanilla HUD pattern implies yes; unmeasured).

## scrollarea

- CLIPS its content to its rect (the only clipping container measured so
  far). Scroll offset 0 = content origin at viewport origin; content
  beyond the rect is simply not drawn. Bare `scrollwidget` content renders
  without scrollbar chrome. (B3-R1)

## Alpha

- `color` alpha and the `alpha` property multiply into one effective
  opacity; straight alpha blend, rendered = trunc(opacity * src * 255)
  over the destination. 0.5 red over black = (127,0,0). (B2-N)

## Text (`text_single`)

- Default font: `StandardGameFont` = **Gitan-Regular** (fonts/fonts.font),
  `Font_Size_Small` fontsize 15. The webview renderer can load the game's
  TTF directly. (vanilla gui/preload/labels.gui + fonts.gui)
- Line box height 21px at 100% scale (the font template declares
  size = { 0 23 }; measured layout box is 21). (B1-G)
- Layout width = (n-1)*advance + ink_width(last glyph); advance(M)=14,
  ink(M)=13; advance(i)=ink(i)=4; advance(space)=4. `background` covers
  exactly this extent. (B1-G, B2-L, B3-S2)
- All metrics (advance, ink, line box) scale EXACTLY linearly with
  `fontsize` (fontsize 30 = 2x every fontsize-15 number). (B3-S3)
- `max_width` clamps the box to exactly that width with right elision
  (measured oddity: the elided line box was 16 tall instead of 21).
  (B3-S1)
- `multiline = yes` + `max_width` wraps at word boundaries; line advance =
  the single-line box height (21 at fontsize 15); box width = widest
  line. (B3-S2)
- `text_single` is `autoresize = yes`, `elide = right`; beware the vanilla
  `text_multi` TYPE carries a hardcoded `size = { 45 45 }` — override size
  or use textbox+multiline directly. (vanilla labels.gui, B2-L)
- `align` in a fixed-size textbox: horizontal placement is exact with zero
  internal padding (right: x = W - textwidth; center: (W - textwidth)/2
  rounded up). vcenter centers the line box; ink rows measured 18-28 in a
  40-tall box at fontsize 15. (B4-T6)

## Phase 2 additions (presentation / deterministic, NOT calibrated pixels)

These three behaviors ship in the layout engine but are explicitly NOT
measured layout rules — no calibration batch backs a pixel value here. They
are marked `unmeasured` in the engine and asserted structurally (ghosts,
state) or as exact deterministic math (nine-slice) in the fixtures.

- **Datamodel list placeholders.** A widget with `datamodel = "[...]"` carries
  its per-row widget in an `item = { <widget> }` block (verified universal in
  vanilla: window_character.gui skills `hbox` and modifiers `fixedgridbox` both
  wrap the row widget in `item`). A static preview has no runtime rows, so the
  engine stamps out 3 (`GHOST_COUNT`) copies of the resolved item template,
  capped so they never overrun a container whose own explicit size is known.
  Ghost copies are non-editable and drawn at `GHOST_OPACITY` 0.45. Assumption:
  one data row == one instance of the item template laid out as a normal child.
- **Nine-slice `spriteborder`.** `spriteborder = { x y }` (x = left & right,
  y = top & bottom) plus `spriteborder_<side>` overrides put border widths on
  the fill; the renderer draws the four corners unscaled, stretches the four
  edges on one axis and the center on both. Border values are read straight
  from the `.gui` attributes (reachable off `background` blocks and a widget's
  own textured fill); the region geometry is deterministic. `texture_density`
  scaling of the border is NOT applied (known gap). Sprite `.gfx` definitions
  that declare a spriteborder outside the `.gui` are not parsed (known gap).
- **`state = {}` blocks excluded.** State blocks describe animated transitions
  (alpha/position deltas over a duration), not the resting layout. They are
  treated as inert property blocks: base widget properties win and nothing
  inside a `state` leaks into the rect. (Confirmed by fixture.)

## Studio-verified engine behaviors

Two provenances, labeled per bullet. `(Studio §X, in-game 2026-07-17)` = the
Sage's Clausewitz Studio calibration mod measured it in game that session,
section by section (§H..§L). `(Studio, encoded rule)` = its layout engine or
linter encodes the behavior with no in-game date on record. Facts only; the
toolkit's own coverage of each is tracked in
`docs/gui-designer/parity-checklist.md`.

### What a box drops on its children

- `align = left/right` on a box child does NOTHING: all three of left, right
  and unset rendered at the same centred position. `align` is a
  TEXT-INTERNAL property, positioning text inside a fixed-size text widget's
  own rect, and has no meaning as a box placement. (Studio §H, in-game
  2026-07-17)
- A box likewise ignores a child's `parentanchor`; cross-axis placement is
  unconditionally per-child centring, with no per-child override. That is the
  vcenter that staggers variable-height columns in an hbox. (Studio §H,
  in-game 2026-07-17)
- A box places its children itself and ignores their `position`. (Studio, §H
  session, 2026-07-17. CONFLICT: this repo's layout engine applies a box
  child's `position` as an extra offset and labels the choice unmeasured; see
  parity-checklist.md §G "Open conflicts".)
- `layoutpolicy_horizontal/vertical = expanding` makes a child fill the
  remaining space on that axis, shared among expanding siblings. An expanding
  child must NOT define the box's cross size; only fixed children do.
  (Studio, encoded rule)

### Container sizing

- Only `widget` holds a fixed pixel `size`. `hbox`/`vbox`/`flowcontainer`
  size to their content and silently drop an explicit pixel `size` (a vbox
  with `size = { 210 850 }` renders at content height, not 850). For a
  fixed-size box, wrap in a `widget`. (Studio, encoded rule. For
  `flowcontainer` this CONFLICTS with B3-Q1 above, which measured the size as
  setting the container's own rect; see parity-checklist.md §G.)
- A percentage WIDTH inside a `vbox` CRASHES the game: the vbox's width is
  content-derived and therefore indeterminate, so the `%` has nothing to
  resolve against. A percentage HEIGHT is the milder case. This is the
  exception to "percent sizes resolve against the parent's rect" above, and
  an authoring hazard rather than a rect rule. (Studio, encoded rule;
  Linter GUI007)
- An EMPTY `container` collapses to 0: it sizes to content, and a fixed
  `size` will not hold it open. A `widget` keeps its size when empty, so a
  spacer or padding row must be a `widget`. (Studio, encoded rule)
- A datamodel gridbox `item` sizes to its content, the bounding box of its
  children, the way a `container` does, rather than taking a generic widget
  default. A positioned child extends that box to its far edge. (Studio,
  encoded rule)
- `ignoreinvisible` defaults to `yes` on hbox/vbox: a hidden child is
  collapsed out of the layout and its siblings shift up to fill the gap.
  That covers a plain `visible = no` and a `visible = "[expr]"` binding that
  evaluates false, which is the mechanism behind conditional connector lines
  and hidden columns. (Studio, encoded rule)
- `resizeparent = yes` inverts the direction: the widget resizes ITS PARENT
  to its own content size (used on the inner widget of a `zoomwidget` so the
  pan/zoom bounds fit the content). Side effect: a fixed-size widget that is
  a DIRECT child of a resizeparent container can be collapsed; nesting it one
  level deeper, inside a plain child, preserves its size. (Studio, encoded
  rule)
- `margin` on a plain `widget` is ignored. Only `margin_widget`, and the
  layout containers acting on their own children, honor margins. (Studio,
  encoded rule)
- `flowcontainer` is the one container that DOES honor a child's
  `parentanchor` on the cross axis. (Studio, encoded rule)
- Clipping containers are `scrollarea`, `scrollbox`, and any widget carrying
  `scissor = yes`. (Studio, encoded rule; this spec had measured `scrollarea`
  only, B3-R1)

### Grid boxes

- `dynamicgridbox` flows its `item` template VERTICALLY by default: items go
  down a column and wrap into a new column after `datamodel_wrap` items, so
  `datamodel_wrap` is items-per-COLUMN. `flipdirection = yes` transposes the
  fill to horizontal (across a row, wrapping down) and does NOT mirror
  anything; the flipped grid still starts top-left. Items pack at their OWN
  size: `addcolumn`/`addrow` are not the stride here (14px items with
  `addcolumn = 70` packed at 14px). `maxhorizontalslots` caps columns only
  while filling horizontally. (Studio §K v2, in-game 2026-07-17)
- `fixedgridbox` has the SAME flow (vertical default, `flipdirection`
  transposes, `maxhorizontalslots` caps only when horizontal) but uses
  `addcolumn`/`addrow` as the CELL SIZE and therefore the stride:
  `addcolumn = 60` items sat 60px apart. Vanilla shape check:
  `characters_grid` (no flip, `addcolumn = 650`) is a vertical list,
  `traits_grid` (`flipdirection = yes`) a horizontal row. (Studio §K v3,
  in-game 2026-07-17)
- A `fixedgridbox` item with NO concrete size anywhere in its chain (instance,
  `using`, type chain) takes its CELL size, which is how a row whose only
  content is a 100%-fill child fills its cell. An item WITH a concrete size
  keeps it and sits at the cell origin (a 14px item in a 60px cell stayed
  14px). (Studio §K v3, in-game 2026-07-17)
- `setitemsizefromcell = yes` (gridbox only) forces every cell to the WIDEST
  item's size, giving uniform cells: 6 text bars of varying width all
  rendered at the widest's 79px with it on, ragged with it off. It needs a
  `datamodel`; static hand-written children cannot produce it. (Studio §K v3,
  in-game 2026-07-17)

### Sprite fill mode (answers the spec's open nine-slice question)

Nine-slicing requires BOTH a `Cornered*` `spriteType` AND a non-zero
`spriteborder`. Measured against a purpose-built 48x48 texture with a 16px
border, pixel-scanned from screenshots. (Studio §J, in-game 2026-07-17)

- `Corneredtiled` + border: corners drawn at native 16px, edges and centre
  TILE at their native size (4px stripes stayed 4px). (§J2)
- `Corneredstretched` + border: corners native, edges and centre STRETCH
  (4px stripes widened to ~36px). (§J3)
- `spriteborder` with NO `Cornered*` type: the border is IGNORED and the
  whole texture plain-stretches, corners and all (a 16px corner became 66px
  at scale 200/48). (§J4)
- `2*border > size` on an axis: the four corners each render at size/2 and
  MEET; there is no edge or centre. (§J5, measured at 24x24)
- `Corneredtiled` with NO `spriteborder`: the whole texture plain-TILES (the
  48px frame repeats). A bare tiled type behaves the same. (§J6)
- Asymmetric `spriteborder = { 16 8 }` still nine-slices; x is the left/right
  corner WIDTH and y the top/bottom corner HEIGHT. (§J7)
- Rule: nine-slice iff `Cornered*` AND a non-zero border; otherwise Tile for
  a `*tiled*` type, else Stretch.

### Sprite frames (answers the spec's open frame question)

- `framesize = { w h }` makes the texture a 2D GRID indexed ROW-MAJOR and
  1-based. The texture is `cols*w x rows*h`; `frame = N` picks column
  `(N-1) % cols`, row `(N-1) / cols`. `frame <= 0` clamps to the first cell
  and a frame past the last clamps to it. It is NOT a horizontal-only strip:
  frames past the first row DO wrap down (a 3x2 calibration sheet showed
  frame 4 as the first cell of the bottom row). `button_event.dds` is the
  vanilla shape check: 747x234 at `framesize = { 249 78 }` is a 3x3 grid.
  (Studio §L, in-game 2026-07-17)

### Non-layout facts recorded for completeness

Kept here so the merged spec loses nothing, even though neither affects a
computed rect.

- There is no engine path to bottom-align variable-length columns in a
  pannable canvas: the dynasty tree top-aligns (root at top) and does not
  bottom-align its leaves. Two workarounds: reverse so the anchor item is at
  the top, or pad shorter columns with invisible holder-height `widget` rows
  so every column has equal total height. (Studio, encoded rule)
- GUI data binding has no list reverse and no parametrized list name: a
  datamodel renders in list order, and `GetGlobalList('name')` takes a
  literal name that cannot be driven per item. Script-side, variable lists
  only append and dedup identical scopes, so N distinct filler entries need
  `ordered_in_global_list = { max = <var> ... }`; a `limit`-gated
  `every_in_global_list` does not work, because the limit is snapshotted
  before the effects run. (Studio, encoded rule)

## Practical notes for the calibration harness itself

- Labels must sit >= 28px above measured rects: antialiased descenders
  merge into same-colored components below. (B1-B analyzer artifact)
- Steam F12 screenshots are JPG; use clipboard snips (the analyzer's
  companion `analyze.ps1` reads a saved PNG; the clipboard can be saved
  via System.Windows.Forms.Clipboard).

## Open questions (queued for batch 05+)

- Box child inside a margin_widget: fills parent-minus-margins? (the HUD
  pattern's actual mechanism)
- Sub-pixel rasterization rule (floor/round/ceil) for fractional box
  offsets — pin down once a case makes it observable at larger scale.
- The 16px-tall elided line box oddity (B3-S1).
- Nine-slice `texture_density` scaling of the border. The tiling-vs-stretch
  half of this question is CLOSED by the Studio §J session above; how density
  scales the border is still unmeasured.
- `mirror`, overlappingitembox, scrollbar chrome metrics,
  `alwaystransparent`/input behavior (irrelevant to static rendering).
- The three open CONFLICTS between this spec and the Studio measurements,
  each of which needs one in-game probe to settle:
  - a `flowcontainer` with an explicit `size` (B3-Q1 says it sets the
    container's own rect; the Studio treats it as ignored);
  - `position` on a box child (this spec is silent, this repo's engine adds
    it as an offset, the Studio drops it per §H);
  - a `state` block supplying the resting position of a widget that has none
    (the phase-2 section above says nothing inside a `state` leaks into the
    rect, which is what the engine does; the Studio's engine substitutes the
    state's position. Neither is in-game dated. Surfaced by the G2 merge,
    2026-08-01).
  Fixtures for all three are waiting in
  `packages/server/test/fixtures/gui/layout/`; see
  `docs/gui-designer/parity-checklist.md` §G. G2 implemented nothing for any
  of them, so no measured golden was overwritten by the other engine's rule.

CLOSED since batch 04, by the Studio §J/§K/§L in-game session recorded above:
sprite frames (`framesize` grids), fixedgridbox cell math, dynamicgridbox
flow, `setitemsizefromcell`, `ignoreinvisible`, and `spriteType`
tiling-vs-stretch.
