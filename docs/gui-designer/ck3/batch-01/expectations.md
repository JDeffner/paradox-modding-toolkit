# Batch 01 — cases, predictions, MEASURED RESULTS

Measured 2026-07-11 from `screenshot-clean.png` (1028x874, UI scale 100%,
analyzer scale factor exactly 1.0000). All coordinates in canvas units
(= pixels here), relative to the black canvas top-left.

Verdict summary: Hypothesis 2 (implicit widgetanchor mirrors parentanchor)
CONFIRMED pixel-exact. `position` is screen-space. No clipping by plain
widgets. Boxes inside a plain widget STRETCH to fill it and distribute
extra main-axis space as space-around. Full rules: ../spec.md.

## A: ruler bars — exact

| Marker | Expected | Measured |
|---|---|---|
| white 200 | 20,12,200x12 | 20,12,200x12 |
| magenta 100 | 240,12,100x12 | 240,12,100x12 |
| cyan 50 | 360,12,50x12 | 360,12,50x12 |

Rendering is 1:1 and linear at 100% UI scaling.

## B: parentanchor alone — Hypothesis 2 exact on all nine

Container measured at 20,60,300x200 (the analyzer bbox showed 2px taller:
the label's antialiased descenders merged into the gray component — batch 02
keeps labels 28px above rects). Marker positions relative to container:

| Marker | H1 predicted | H2 predicted | Measured |
|---|---|---|---|
| default | 0,0 | 0,0 | 0,0 |
| top\|hcenter | 150,0 | 140,0 | **140,0** |
| top\|right | 300,0 | 280,0 | **280,0** |
| vcenter\|left | 0,100 | 0,90 | **0,90** |
| center | 150,100 | 140,90 | **140,90** |
| vcenter\|right | 300,100 | 280,90 | **280,90** |
| bottom\|left | 0,200 | 0,180 | **0,180** |
| bottom\|hcenter | 150,200 | 140,180 | **140,180** |
| bottom\|right | 300,200 | 280,180 | **280,180** |

## C: explicit widgetanchor — identical to implicit

Red (implicit) measured at rel 130,80 = exact center for 40x40; yellow
(implicit, bottom|right) at rel 260,180 = flush corner. Green and cyan
(explicit widgetanchor) not detected as separate components: perfectly
covered. Explicit `widgetanchor = X` == the implicit default when
`parentanchor = X`.

## D: position offsets — screen-space, and no clipping

| Marker | Setup | Screen-space predicted (rel) | Measured (rel) |
|---|---|---|---|
| red | no anchor, pos 30,30 | 30,30 | **30,30** |
| green | bottom\|right anchors, pos -30,-30 | 170,150 | **170,150** |
| yellow | bottom\|right anchors, pos 30,30 | 230,210 (outside) | **230,210, fully rendered outside the parent** |
| cyan | parentanchor center, pos 40,0 | 140,90 | **140,90** |

`position` always adds +x right / +y down after anchoring. Plain widgets do
not clip children.

## E: hbox — SURPRISE: box fills its plain-widget parent, space-around

The hbox background measured exactly 180x120 = the wrapper widget's full
size, in all three cases (the wrapper's own gray was completely hidden).
Children cross-axis: each exactly centered (red y=40, green y=30, blue y=50).

Main axis model that fits all three cases: with content width C, spacing s,
horizontal margin mh, box width W: free = W - 2*mh - C - s*(n-1); each child
gets a side margin free/(2n) on both sides (adjacent margins add up).
Positions are computed fractionally and rasterize within ±1px.

| Case | free | side margin | Predicted child x (frac) | Measured |
|---|---|---|---|---|
| E1 plain | 50 | 8.33 | 8.3 / 85 / 141.7 | 9 / 86 / 142 |
| E2 spacing 8 | 34 | 5.67 | 5.7 / 84.3 / 143 | 6 / 85 / 144 |
| E3 margin 12 6 | 26 | 4.33 | 16.3 / 85.3 / 133.7 | 17 / 86 / 134 |

`margin = { a b }` order confirmed: a = horizontal, b = vertical (horizontal
inset visibly shifted content; vertical indistinguishable here because
cross-axis centering already reproduces it).

## F: vbox — same model, vertical

Boxes filled their 140x160 wrappers exactly. F1 (free 40, side 6.67):
children y measured 7 / 60 / 133 (predicted 6.7 / 60 / 133.3). F2 spacing 8
(free 24, side 4): measured 4 / 60 / 136 exact. Cross-axis centered
(x = 40/50/55 exact).

## G: text — first metrics

| Run | Measured bg rect |
|---|---|
| 10x M | 20,530,139x21 |
| 10x i | 20,560,40x21 |

Default `text_single` line box height 21 at 100% scale. Proportional font,
avg advance M≈13.9, i≈4.0 (padding vs glyph extent unresolved — batch 02
measures 1 vs 2 chars). Background covers exactly the text extent.

## H: nesting — exact linear accumulation

Inner widget measured 330,550,100x60 (= 300+30, 530+20); red marker
340,560 (= +10,+10). No padding introduced by nesting.

## Bonus finding: color values are direct sRGB multipliers

Measured mean RGB of flat fills: 0.2 -> 51, 0.25 -> 63, 0.4 -> 102,
0.5 -> 127/128, 1.0 -> 255. So rendered = round(value*255) against the
white texture, NO gamma/linear-light transform. The webview renderer can
use CSS rgb() with a plain *255 conversion.
