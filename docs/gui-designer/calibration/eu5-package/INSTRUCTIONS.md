# EU5 GUI probe — what to run and what to send back

Thank you for helping! This takes about 20 minutes. You will install a tiny
mod that adds five invisible test windows (no gameplay changes at all), open
each one from the console, take a screenshot, and send back the screenshots
plus a few log folders the game generates. Nothing here modifies your game
files; removing the mod folder afterwards removes everything.

## 1. Install the mod

1. Copy the `mod/px-layout-probe` folder from this package into your EU5 mods
   folder, so you end up with:
   `Documents\Paradox Interactive\Europa Universalis V\mod\px-layout-probe`
2. Start the Paradox launcher, open your playset, and enable the mod
   "PX Layout Probe".

## 2. Enable the console

1. In Steam: right-click Europa Universalis V -> Properties -> General ->
   Launch Options, and enter: `-debug_mode`
   (if the console still does not open in step 3, use `-debug_mode -develop`)
2. Start the game and load ANY campaign (the main menu is not enough — enter
   an actual game).

## 3. Spawn each probe window and screenshot it

Before you start, note two things for the report:
- your screen resolution,
- the game's UI scaling setting (Settings -> Graphics; ideally set it to
  100% for the session).

Open the console (the `` ` `` key, next to 1 — on some keyboard layouts
`§` or `~`). Then, for each of the five windows below:

1. Type the spawn command and press Enter.
2. A dark test window with colored rectangles appears in the screen center.
3. Screenshot it with **Win+PrtScr** (saves a PNG into
   `Pictures\Screenshots`). Please do NOT use Steam F12 — those are JPG and
   compression ruins the measurement.
4. Type the despawn command before spawning the next window.

| # | Spawn | Despawn |
|---|---|---|
| 1 | `gui.createwidget gui/px_probe_a.gui px_probe_a` | `gui.clearwidgets px_probe_a` |
| 2 | `gui.createwidget gui/px_probe_b.gui px_probe_b` | `gui.clearwidgets px_probe_b` |
| 3 | `gui.createwidget gui/px_probe_c.gui px_probe_c` | `gui.clearwidgets px_probe_c` |
| 4 | `gui.createwidget gui/px_probe_d.gui px_probe_d` | `gui.clearwidgets px_probe_d` |
| 5 | `gui.createwidget gui/px_probe_e.gui px_probe_e` | `gui.clearwidgets px_probe_e` |

Rename the five screenshots to `px_probe_a.png` … `px_probe_e.png` (matching
the window you captured).

If a window does not appear:
- try the path with a prefix: `gui.createwidget in_game/gui/px_probe_a.gui px_probe_a`
- if it still fails, just note which window failed and move on — the error
  log you send in step 5 tells us why, and a missing window is itself a
  useful result. (Window 5 in particular is EXPECTED to possibly fail.)

## 4. Run the two documentation dumps

Still in the console (any loaded game):

1. Type `script_docs` and press Enter.
2. Type `dump_data_types` and press Enter.

These write documentation files under your `Documents\Paradox Interactive\
Europa Universalis V` folder; you will collect them next.

## 5. Collect and send back

Please zip the following and send it back:

- [ ] the five screenshots `px_probe_a.png` … `px_probe_e.png`
- [ ] the whole folder `Documents\Paradox Interactive\Europa Universalis V\docs`
      (created by `script_docs`)
- [ ] the whole folder `Documents\Paradox Interactive\Europa Universalis V\logs`
      (contains `error.log` and the `data_types` dump — the error log matters
      even if everything worked, and ESPECIALLY if a window failed)
- [ ] a short note with: your screen resolution, the UI scaling %, the game
      version (shown on the main menu), and which probe windows (if any)
      failed to spawn

Afterwards you can disable the mod in the launcher and delete the
`px-layout-probe` folder.

Thanks again!
