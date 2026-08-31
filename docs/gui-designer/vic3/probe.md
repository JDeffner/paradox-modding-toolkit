# Vic3 probe run checklist (Joel)

**STATUS: RUN 2026-08-09, results analyzed and calibrated — see
`expectations.md`.** The checklist below is kept for re-runs.

The probe mod is ALREADY INSTALLED at
`D:\Documents\Paradox Interactive\Victoria 3\mod\px-layout-probe`
(same five windows as the EU5 package; canonical sources in `../probes/`).
`GUI.CreateWidget` / `GUI.ClearWidgets` are confirmed present in the Vic3
binary. Expected session time: ~15 minutes.

1. Launcher: enable "PX Layout Probe" in the active playset.
2. Steam launch options: `-debug_mode` (add `-develop` only if the console
   won't open).
3. Set UI scaling to 100% (Settings -> Graphics), note the resolution.
4. Load any campaign, open the console (`` ` ``), then per window:
   - `gui.createwidget gui/px_probe_a.gui px_probe_a`
   - **Win+PrtScr** (PNG in `Pictures\Screenshots`; not Steam F12)
   - `gui.clearwidgets px_probe_a`
   - repeat for `px_probe_b` … `px_probe_e`
5. Afterwards, keep a copy of
   `D:\Documents\Paradox Interactive\Victoria 3\logs\error.log` — the engine
   corroborates several rules in text there (position-in-layout,
   size-on-container warnings).
6. Hand me the five PNGs (named `px_probe_a.png` … `px_probe_e.png`) + the
   error.log + the resolution/UI-scale note. I take it from there:
   `../analyze.ps1` extraction, a `expectations.md` with
   measured-vs-predicted (predictions live in `../probes/engine-predictions.txt`),
   and the deltas go into the layout engine behind the GameProfile text seam.

What the probes will most likely catch on Vic3 (worth eyeballing in-game):

- **Probe D/E (text)**: guaranteed deltas — Vic3's default font is Open Sans
  (not CK3's Gitan-Regular), so every advance/ink/line-box number changes.
  These measurements feed `games/vic3`'s text metrics.
- **T5 (max_width)**: Vic3's text templates carry `fontsize_min = 12`; the
  raw textbox probe pins whether the ENGINE shrinks-then-elides or elides
  outright at explicit fontsize.
- **B11 (policy-less deficit)**: unmeasured in every game so far, including
  CK3.
- Everything else is expected to match CK3 (same Jomini engine); a mismatch
  there is a real per-game rule and gets a spec entry with vic3 provenance.
