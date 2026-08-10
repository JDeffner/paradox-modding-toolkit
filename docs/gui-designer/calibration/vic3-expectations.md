# Vic3 probe results — 2026-08-09

Run by Joel on the live install (game 1.13.9, 1920x1080 fullscreen, GUI
scaling 100%, render scale 100%). Five windows spawned via
`gui.createwidget`; screenshots analyzed with `analyze.ps1` (probe A from a
lossy WebP re-encode — scale still resolved exactly 1.0000 from the ruler;
B-E from clean PNGs) plus direct pixel scans for colors outside the
analyzer's palette. Engine predictions: `probes/engine-predictions.txt`.
The error.log corroborations:

- `px_probe_b.gui:110 - Widget cannot have a position in a layout` (B3/L23)
- `px_probe_c.gui:75/146/178 - You should not set a size on a container!`
  (C2 sized flow, C4 sized container, C5 EMPTY sized container — all three
  warned, all three APPLIED)
- `px_probe_c.gui:265 - No vertical/horizontal scrollbar found` (C8 still
  clipped exactly)

## Verdict summary

Every core layout rule measured identical to CK3, pixel-exact: anchors (all
9), implicit `widgetanchor` = `parentanchor`, `position` after anchoring
(negative + overflow unclipped), box stretch-in-widget + space-around
fractions (E/F rows all within rasterization of the fractional model),
box-in-box hug, `position` dropped in a box, `margin_top` inset model,
`expanding` floor+free/k (120/180), `growing` takes all free (220) but
nothing beside `expanding` (260/40), deficit equal-delta with explicit
policies (80/40), `expand = {}` spacer, flowcontainer hug/no-wrap/overflow
(spacing 8 run at the origin, occluded by the later-drawn neighbor exactly
like CK3's B2-K1), sized flowcontainer KEEPS 180x100 (L13e), container hug
(180x110), sized non-empty container KEEPS 150x100 (L25), margin_widget
100%+margins (full rect, child at (20,15)), scrollarea clips to exactly
160x100 at scroll 0 (R1) even with no scrollbar chrome, sizeless widget zero
rect (child at (30,450)), 50% percent size (100x50), scale 2.0 (80x80),
multiline word wrap, align default/center/right with ZERO padding
(ink starts at exactly x, x+(W-textw)/2, x+W-textw), loc-key text ==
raw_text metrics.

## Newly measured (unmeasured anywhere before)

- **B11 policy-less deficit**: children with NO layoutpolicy do NOT shrink —
  100+60 stayed 100/60 in the 120 box, overflowing. The engine's
  "default = fixed" assumption is now measured (Vic3 provenance; CK3 still
  unmeasured). B9 (minimumsize) turned out to measure the same thing, since
  its children carried no policies either: 100/100 unshrunk, exactly the
  engine's prediction. The minimumsize FLOOR with explicit shrink policies
  remains unmeasured in Vic3.
- **B3-Q2 disambiguated**: a sizeless margin_widget hugs its children AT the
  margin offset. The bg was invisible in both games' probes; the
  origin-anchored hug the engine used to compute (margin-inclusive, bg
  strips visible at (0,0)..(margin)) fits neither. Engine corrected for all
  games; the bare-mw rect is now pinned in the B3-Q2 golden. (A zero rect
  also fits this screenshot — a follow-up case with TWO children of
  different extents would separate hug-union from zero. Queued for the next
  batch.)

## Divergences from the CK3-measured rules

| Case | CK3 | Vic3 measured | Disposition |
|---|---|---|---|
| C5 empty container with `size` | collapses to 0 (probe 2026-08-02, L25 narrow) | KEEPS the authored 150x60 (warn-yet-apply) | `guiLayoutQuirks.emptySizedContainerKept` on the vic3 profile |
| T5 `max_width` overflow | clamps to 80, right-ELIDES, odd 16px-tall box | clamps the box to 80x20 (normal height), ink renders the FULL run unclipped to x=537, no elision | rect identical to the engine's — rendering-only divergence, recorded here, no engine change |
| Text metrics | Gitan-Regular: M 14/13, i 4/4, space 4, line box 21 @15, EXACTLY linear (B3-S3) | serif default face: M adv=ink=14 @15, i 4/4, space 3; advance re-rounds per size (`round(0.9*fs)`: 14 @15, 15 @17, 27 @30); line box `1.3*fs` exact (ceil'd: 20 @15, 39 @30, 23 @17); bare textbox defaults to fontsize 17 | vic3 `guiTextMetrics`: base-30 table + `roundPerSize` reproduces every measured box exactly |

## Text solve (probe D/E)

Measured boxes (canvas units): 10xM @15 = 140x20, 10xi @15 = 40x20,
10xM @30 = 270x39, "M M M M M" @15 = 82x20, "MMMM MMMM" widest line = 115,
multiline box 115x39 (2 lines, advance 19.5 fractional), 10xM default =
150x23 (text_single AND bare textbox identical). Solving
9a+i=140, 4a+4s+i=82, 7a+s+i=115 gives a=14, i=14, s=3 (clean integers).
The default-size box then pins defaultFontsize=17 (adv 15 = round(0.9*17),
box 23 = ceil(1.3*17)).

## Probe-design notes for the next round

- B9 needs explicit `preferred`/`shrinking` policies to engage the
  minimumsize floor.
- C7 needs two children of different extents to separate hug-union from
  zero-rect.
- Only probe A carries the ruler; the analyzer needed known rects to derive
  the other windows' origins. Give every window a ruler bar.
- Several bg colors (olive, brown, blue-cyan mixes) fall outside
  analyze.ps1's palette; extend the classifier or stick to its named colors.
