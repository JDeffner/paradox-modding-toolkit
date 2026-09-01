# Batch 04 — predictions vs MEASURED RESULTS

Measured 2026-07-11 from `screenshot-clean.png` (991x847, scale 1.0000).

## T1: sizeless plain widget — ZERO SIZE, children still render

No dark red bg rendered anywhere; the wrapper's gray stayed fully visible.
The red child rendered at rel (30,20) regardless (widgets don't clip).
A `widget` without `size` has a zero rect; it does NOT hug (that's
`container`'s job) and does not fill.

## T2: `size = { 50% 50% }` — fraction of parent

Dark green bg measured 100x60 at the parent origin = exactly 50% of
200x120. Percent sizes resolve against the parent rect.

## T3: margin_widget size 100% + margin { 20 10 } — rect is FULL parent

Dark blue bg measured 200x120 (the whole parent); the red child sat at
rel (20,10). Margins offset the children's origin and do not shrink the
margin_widget's own rect. (Whether a BOX child inside it fills
parent-minus-margins — the real HUD use — is still open; noted in
spec.md.)

## T8: expand = {} spacer — textbook

Box filled 200x80; red at rel (0,20), green flush right at (160,20).
The spacer absorbed all 120 free pixels, as a growing child should.

## T4: icon scale = 1.5 — multiplies the rect, top-left anchored

Orange rendered 60x60 with its top-left exactly at the declared position
(100,260); the 40x40 reference rendered unchanged. scale multiplies size
and keeps the position anchor.

## T6: align in a fixed 150x40 textbox, "MM" (ink width 27)

Glyph ink bounding boxes (pixel-probed, AA-trimmed ~1px):

| Case | Predicted ink x | Measured ink |
|---|---|---|
| right\|vcenter | 123 (= 150-27, no padding) | x 123-148, y 18-28 |
| center | 61.5 -> 62 | x 62-87, y 18-28 |

Horizontal align is exact with zero internal padding: right = W - textw,
center = (W - textw)/2 rounded. vcenter: ink rows 18-28 in the 40-tall box
(consistent between both cases); the renderer should center the 21px line
box and let the font's own ascent place the ink.

## T7: margin_top = 30 on an hbox (180x120, one 40x40 child)

Child measured at rel (70,55). x: cross-centered (180-40)/2 = 70. y: the
top margin insets the content area to [30,120], then the usual
space-around: 30 + (90-40)/2 = 55. Exact match: directional margins inset
one side only and compose with the normal distribution model.
