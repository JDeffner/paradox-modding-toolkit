# Batch 03 — predictions vs MEASURED RESULTS

Measured 2026-07-11 from `screenshot-clean.png` (1014x845, scale 1.0000).

## P1: box size 220x140 in a 180x120 parent — SIZE FULLY IGNORED

Box bg measured exactly 180x120 = the parent. Prediction (minimum
semantics) WRONG: a box parented to a plain widget fills it exactly,
explicit `size` ignored in both directions, smaller or larger. Child
centered at rel (70,40) as usual.

## P2: growing alone — takes everything

red 0,20,40x40; green 40,20,260x40 (floor 40 + all 220 free). Growing
expands like expanding when no expanding sibling outranks it. This is what
`expand = {}` relies on.

## P3: expanding, floors 40 vs 100 — EQUAL SHARE, not equal-final

Measured red 120x40 at 0, green 180x40 at 120. Each got +80 = free/k on
top of its floor. Prediction (equal-final 150/150) WRONG.
Rule: expanding children each receive floor + free/k.

## P4: deficit, preferred 100 / shrinking 60 in 120 — EQUAL DELTA

Measured red 80x40 at 0, green 40x40 at 80. Each lost deficit/k = 20.
Not proportional, no shrinking-first priority.
Rule: shrinkable children each lose deficit/k below their floor.

## Q1: flowcontainer with explicit size 200x120 — STILL NO WRAP

Items in one row at rel x 0/50/100/150/200 (250 total, overflowing).
The explicit size DID set the container's own rect (bg = 200x120 at
origin), but content ignores it. flowcontainer does not wrap, full stop —
the wiki's "wrapping flow" phrasing does not hold for plain size; treat
it as a non-wrapping hug-flow in the renderer. (If some vanilla property
does enable wrapping, revisit; none found in this campaign yet.)

## Q2: margin_widget, margin { 20 10 }, no size — margins offset children; no parent-fill

The red child measured at rel (20,10) = the margins as content-origin
offset. The margin_widget's own dark green bg was completely invisible:
it did NOT size itself to parent-minus-margins; without an explicit size
it hugged the child (bg fully covered). The HUD trick therefore needs
`size = { 100% 100% }` + margins (batch 04 T3 verifies the % form).

## R1: scrollarea — FIRST CLIPPER CONFIRMED

Content bg visible exactly 200x120 at the scrollarea rect; red (0,0) and
yellow (180,50) markers visible, green (280,280) fully clipped. Scroll
offset 0 = content origin at viewport origin. No scrollbar chrome rendered
with a bare scrollwidget.

## S1: text_single max_width 60 — clamps + elides at exactly 60

bg = 60x16. Width exactly max_width with right elision. Oddity: the line
box measured 16 tall instead of 21 (max_width seems to switch the box to
tight ink height) — cosmetic, low priority, noted.

## S2: multiline max_width 150 — wraps at word boundaries, line advance 21

bg = 115x42 = two lines of "MMMM MMMM". 42 = 2 x 21: multiline line
advance equals the single-line box height. Width 115 backs out the space
advance: 111 + space = 115 -> **advance(space) = 4**.

## S3: fontsize 30 — metrics scale EXACTLY linearly

bg = 138x42. Predicted linear: 4*advance(28) + ink(26) = 138 exact;
height 21 * 30/15 = 42 exact. advance/ink/lineheight all scale with
fontsize/15.
