# Batch 02 — predictions vs MEASURED RESULTS

Measured 2026-07-11 from `screenshot-clean.png` (1103x826, scale 1.0000).
Coordinates relative to case rects as noted.

## I1: hbox with explicit `size = { 150 80 }` — SIZE IGNORED

Measured: dark red box bg = 20,60,180x120 = the FULL wrapper. The explicit
size did not survive; the box still fills a plain-widget parent. Child red
40x40 at rel (70,40) = exact space-around center. (Whether `size` acts as a
minimum when it EXCEEDS the parent: batch 03 P1.)

## I2: hbox nested in a vbox — INNER BOX HUGS

Outer vbox filled 180x120 (dark blue). The inner hbox's dark red bg was not
detectable: it hugged its two 40x40 children exactly (80x40, fully covered).
Placement by the parent vbox: cross-centered x=50 = (180-80)/2, main-axis
space-around y=40 = (120-40)/2. Children packed inside the hugged box: red
rel 0, green rel 40, no internal gap.

So batch 01's stretch rule is parent-kind dependent:
**box in plain widget = fill; box in box = hug content.**

## I3: `position` on a stretched hbox — HONORED

Box bg measured 430,70,180x120 = full parent size shifted by exactly
(10,10), overflowing the wrapper bottom/right, unclipped. position
translates the final rect after sizing.

## I4: `container` — HUGS AT ORIGIN

Dark green bg = 620,60,110x70 = exact extent of the two absolutely
positioned 40x40 children (max x 70+40, max y 30+40). Sits at the parent's
origin (no centering). Children at their exact positions.

## J1: fixed / expanding / growing (box 300x80, free 180)

| Child | Predicted | Measured (rel to box) |
|---|---|---|
| red fixed | 0,20,40x40 | **0,20,40x40** |
| green expanding | 40,20,220x40 | **40,20,220x40** |
| blue growing | 260,20,40x40 | **260,20,40x40** |

Expanding consumed ALL free space; growing got nothing next to an expanding
sibling; children packed from 0 (residual free = 0, so space-around
contributes 0 — consistent unified model: policies first, space-around on
the residual).

## J2: two expanding (equal floors 40+40, box 300)

Measured: red 0,20,150x40; green 150,20,150x40. Equal split, 150 each.
(Equal-final vs equal-share indistinguishable with equal floors: batch 03 P3.)

## J3: preferred vs shrinking, deficit 40 (floors 80+80, box 120)

Measured: red 0,20,60x40; green 60,20,60x40. Both shrank by 20 — no
priority difference visible with equal floors (batch 03 P4 uses uneven
floors to separate equal-delta / proportional / shrinking-first).

## K: flowcontainer — DOES NOT WRAP

- K1 (five 50x30 in a 200-wide wrapper): single row at the parent ORIGIN,
  total 250x30, overflowing the wrapper right edge unclipped (the cyan tail
  was only occluded by the next case's widget, drawn later).
- K2 direction=vertical: single column 150 tall in the 120-tall wrapper,
  overflowing below, unclipped.
- K3 spacing=10: single row, items at x = 0/60/120/180/240; the
  flowcontainer's own bg showed through the 10px gaps, i.e. the bg hugs the
  content extent (290x30).

flowcontainer hugs its content, never auto-wraps, and does not center
itself (origin placement). Whether an explicit `size` enables wrapping:
batch 03 Q1.

## L: text — advance/ink model; text_multi case was invalid

Measured: "M" bg = 13x21, "MM" bg = 27x21. So bg width =
(n-1)*advance + ink_width(last glyph), with advance(M)=14, ink(M)=13.
Cross-check batch 01: 10xM predicted 9*14+13 = 139 = measured. For "i":
advance = ink = 4 (10xi = 40).

text_multi rendered 45x45 with elision: the vanilla `text_multi` TYPE has
a built-in `size = { 45 45 }` (gui/preload/labels.gui:26), so `max_width`
did nothing here. Test invalid; batch 03 S2 redoes multiline via
text_single + multiline + max_width.

Font identified (vanilla files): text_single/text_multi use
Font_Type_Standard = **StandardGameFont = Gitan-Regular**, Font_Size_Small
= fontsize 15 (declared line size 23; measured layout box height 21).

## N: alpha — one multiplicative model

Both `color = { 1 0 0 0.5 }` and `color = { 1 0 0 1 }` + `alpha = 0.5`
rendered rgb (127,0,0) over black: effective_opacity = color.a * alpha,
straight blend, 255*0.5 truncated to 127.
