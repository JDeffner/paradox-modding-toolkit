# PdxGui layout calibration campaign

Goal: measure, in-game, exactly how PdxGui lays out widgets, and persist every
finding as (a) a spec entry and (b) a golden fixture, so the future GUI
designer's layout engine can be built and regression-tested against reality.

## Method

Each batch is a `test_gui.gui` file for the game's debug sandbox window
(`game/gui/debug/test_gui.gui`, spawned via console). Every experiment:

- is spatially isolated inside a black 940x650 "canvas" widget whose bounds
  double as the pixel ruler (940 UI units wide),
- marks every measured rectangle with a flat, fully opaque, unique color from
  `gfx/interface/colors/white.dds` tinted via `color = { r g b a }`, so a
  script can extract exact bounding boxes from a PNG screenshot,
- has a written PREDICTION in the batch's `expectations.md` before the
  screenshot exists. Deviations are the interesting data.

Results flow into:

- `spec.md` (created after batch 1): the layout rules, stated precisely,
  with "measured in batch N" provenance.
- Golden fixtures (later): `.gui` input + expected rectangle JSON, as vitest
  cases for the layout engine.

## Workflow per batch

1. The batch file is copied over
   `<game>\gui\debug\test_gui.gui`
   (vanilla original preserved next to it as `test_gui.gui.vanilla.bak`;
   Steam "Verify integrity" also restores it).
2. Launch CK3 with `-debug_mode -develop`, enter any game (the map, not the
   main menu).
3. Open the console (`` ` ``) and run:
   `gui.CreateWidget gui/debug/test_gui.gui test_window`
   (despawn: `gui.clearwidgets test_window`, or the window's X button).
4. Screenshot as PNG: `Win+PrtScr` (lands in `Pictures\Screenshots`) or
   Snipping Tool. NOT Steam F12 (JPG compression ruins color matching).
   Native resolution, any window placement.
5. Note the UI Scaling setting (Settings -> Graphics) if it is not 100%.
6. Hand the PNG over; a System.Drawing-based analyzer extracts the rectangles
   and results are written into `expectations.md` (measured column) and
   `spec.md`.

Hot-iterating within a session: edit the game file, console `reload gui`,
despawn + respawn the window.

## Batches

| Batch | Covers | Status |
|---|---|---|
| 01 | ruler/scale, parentanchor, widgetanchor, position sign & anchors, clipping, hbox/vbox metrics, box-in-widget stretch + space-around, nested offsets, first text metrics, color transfer function | **measured 2026-07-11**, results in batch-01/expectations.md and spec.md |
| 02 | explicit size on boxes, box-in-box hug, position on stretched box, container hug, layoutpolicies numeric (expanding/growing/preferred/shrinking), flowcontainer wrap/direction/spacing, text padding + multiline, alpha models | **measured 2026-07-11** |
| 03 | box size > parent (min semantics), growing alone, expanding with unequal floors, deficit with unequal floors, flowcontainer with explicit size, margin_widget, scrollarea clipping, text max_width/multiline/fontsize scaling | **measured 2026-07-11** |
| 04 | sizeless widget, % sizes, margin_widget 100%+margins (HUD pattern), expand spacer, icon scale, textbox align, directional box margins | **measured 2026-07-11** |

Campaign paused after batch 04 with the core layout model complete; the
vanilla `test_gui.gui` was restored from the `.vanilla.bak` backup. To run
a future batch, copy its `test_gui.gui` from this folder over the game file
again. Next build step: implement the layout engine against spec.md and
turn each batch's measured tables into golden vitest fixtures.

Planned next: margin_widget, scrollarea viewport, nine-slice `spriteborder`
and sprite frames (needs a purpose-built calibration DDS generated with the
repo's own DDS encoder), fixedgridbox cell math, min_width/max_width on
text, icon scale/mirror, sub-pixel rasterization rule.

## Cross-game probes (Vic3 / EU5)

The engine's measured defaults are CK3-tuned. `probes/` carries the same
experiments as game-agnostic probe windows for other titles, with the
CK3-tuned engine's own output as the prediction column
(`probes/engine-predictions.txt`). Packages: `eu5-package/` (self-contained,
for an external runner) and `vic3-probe.md` (run checklist; the mod is
installed in the local Vic3 mods folder). Results feed
`GameProfile.guiTextMetrics` and, if a layout rule itself diverges, new
game-tagged spec entries.
