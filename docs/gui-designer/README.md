# GUI designer: calibration evidence and editor ledgers

This folder holds two things: the **in-game layout-calibration campaign**
(the measured evidence behind `packages/server/src/gui/layoutEngine.ts`) and
the **ledgers of the GUI editor rebuild**. Every rule in the layout engine
cites a spec entry here, and every spec entry cites the batch or probe run
that measured it.

## What the files are

| Path | What it is |
|---|---|
| `spec.md` | The layout rules, stated precisely, with "measured in batch N" / probe provenance per rule. THE authority for layout math, all games; game-tagged entries where a game diverges. |
| `analyze.ps1` | Screenshot analyzer: extracts exact bounding boxes from a calibration PNG by matching the flat unique marker colors. |
| `probes/` | The game-agnostic probe kit: five `px_probe_*.gui` windows mirroring the CK3 batch geometry, plus `engine-predictions.txt` (the CK3-tuned engine's own output as the prediction column for other games). |
| `ck3/` | The original campaign: `batch-01`..`batch-04` (each: `test_gui.gui` + written predictions in `expectations.md` + the measured screenshot) and a preview render. Measured 2026-07-11. |
| `vic3/` | `probe.md` (the run checklist), `expectations.md` (measured vs predicted from the 2026-08-09 run), `run-2026-08-09/` (the five screenshots + per-window analysis). |
| `eu5/` | `package/` + `package.zip`: the self-contained probe mod and instructions for an external runner (Joel owns no EU5 install). Results pending. |
| `parity-checklist.md` | Row-level ledger of the GUI source-writer and layout-engine rebuild (the Studio parity work): per-row status, citing fixture and test. The behavior contract the `gui/sourceEdit*` modules reference. |
| `g3-plan.md`, `g3-checklist.md` | The webview editor's build plan and the human-mouse acceptance pass (feel is not headless-testable). |

## How the calibration was done

Each experiment is a `test_gui.gui` for the game's debug sandbox window,
spawned via console. The method that makes results machine-readable:

- every experiment sits inside a black 940x650 "canvas" widget whose bounds
  double as the pixel ruler (940 UI units wide);
- every measured rectangle is marked with a flat, fully opaque, unique color
  (`white.dds` tinted via `color = { r g b a }`), so `analyze.ps1` can
  extract exact bounding boxes from a PNG screenshot;
- a written PREDICTION exists in `expectations.md` before the screenshot.
  Deviations are the interesting data.

Workflow per batch: copy the batch file over `<game>\gui\debug\test_gui.gui`
(keep the vanilla original as `test_gui.gui.vanilla.bak`), launch with
`-debug_mode -develop`, enter a game, console:
`gui.CreateWidget gui/debug/test_gui.gui test_window`
(despawn: `gui.clearwidgets test_window`). Screenshot as PNG with
`Win+PrtScr`, never Steam F12 (JPG compression ruins color matching), at
100% UI scaling. Hot-iterate with `reload gui` + respawn. Results are
written into the batch's `expectations.md` (measured column) and promoted
into `spec.md`; each measured table then becomes a golden fixture in
`packages/server/test/guiLayout.test.ts`.

## Cross-game probes

The engine's measured defaults are CK3-tuned. `probes/` carries the same
experiments as standalone probe windows for other titles, with the CK3
numbers as predictions: deltas feed `GameProfile.guiTextMetrics` (fonts
differ per game, so text metrics ALWAYS diverge) and, when a layout rule
itself diverges, a game-tagged entry in `spec.md`. Vic3 was measured
2026-08-09 (`vic3/`); EU5 waits on an external runner (`eu5/package/`).

Still unmeasured (future batches): nine-slice `spriteborder` and sprite
frames (needs a purpose-built calibration DDS), fixedgridbox cell math,
scrollarea viewport details, sub-pixel rasterization, and the open rows
listed under "engine-fact follow-ups" in `parity-checklist.md`.
