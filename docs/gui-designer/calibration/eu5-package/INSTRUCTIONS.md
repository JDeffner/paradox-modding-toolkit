# EU5 data pack: what to run and what to send back

Thank you for helping! This takes about 30 minutes.

You do two things:

1. Copy some files out of your EU5 install (fast, the game does not run).
2. Install a tiny mod that adds five invisible test windows, open each one
   from the console, and screenshot it.

Nothing here changes your game files. The test mod adds no gameplay. You
remove everything at the end by deleting one folder.

Everything you produce goes into ONE folder on your Desktop called
`EU5-for-PX`. At the end you zip that folder and send it back.

The commands below are PowerShell. Copy a whole block, paste it into the
PowerShell window, and press Enter.

---

## Step 1: make the return folder and find the game

Open PowerShell: press the Start button, type `PowerShell`, press Enter.
Then paste this block.

```powershell
$out = "$env:USERPROFILE\Desktop\EU5-for-PX"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$roots = @()
$vdf = "${env:ProgramFiles(x86)}\Steam\steamapps\libraryfolders.vdf"
if (Test-Path $vdf) { $roots += (Select-String -Path $vdf -Pattern '"path"\s+"(.+?)"').Matches | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' } }
$roots += Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root + "SteamLibrary" }
$roots += "${env:ProgramFiles(x86)}\Steam"
$game = $roots | ForEach-Object { "$_\steamapps\common\Europa Universalis V" } | Where-Object { Test-Path $_ } | Select-Object -First 1
Write-Host "Return folder: $out"
if ($game) { Write-Host "Game folder: $game" } else { Write-Host "GAME NOT FOUND. Read the note below." }
```

If it says GAME NOT FOUND: in Steam, right-click Europa Universalis V, then
Manage, then Browse local files. Copy the path from the Explorer address bar
and set it by hand, for example:

```powershell
$game = "D:\Games\steamapps\common\Europa Universalis V"
```

**Keep this PowerShell window open.** Every later block uses `$out` and
`$game`. If you close the window, paste Step 1 again first.

---

## Step 2: copy the interface files

The game does not need to run for this step.

### 2a. Every vanilla .gui file (the most valuable item)

This copies all `.gui` files into one zip and keeps the folder names they
have in the game. It is a block and not a single line, because the folder
names must be preserved.

```powershell
$stage = Join-Path $out "gui-files"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $game -Recurse -File -Filter *.gui | ForEach-Object { $d = Join-Path $stage $_.FullName.Substring($game.Length + 1); New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $d }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath (Join-Path $out "eu5-gui-files.zip") -Force
Remove-Item -Recurse -Force $stage
Write-Host "written: $out\eu5-gui-files.zip"
```

Result: `EU5-for-PX\eu5-gui-files.zip`.

### 2b. A two-level listing of the game folder

```powershell
Get-ChildItem -LiteralPath $game -Recurse -Depth 1 | ForEach-Object { $_.FullName.Substring($game.Length + 1) } | Out-File -Encoding utf8 (Join-Path $out "game-folder-listing.txt")
Write-Host "written: $out\game-folder-listing.txt"
```

Result: `EU5-for-PX\game-folder-listing.txt`.

### 2c. The fonts listing and the default UI font

```powershell
$fontOut = Join-Path $out "fonts"
New-Item -ItemType Directory -Force -Path $fontOut | Out-Null
@((Join-Path $game "fonts"), (Join-Path $game "in_game\fonts")) | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse | ForEach-Object { $_.FullName.Substring($game.Length + 1) } } | Out-File -Encoding utf8 (Join-Path $out "fonts-listing.txt")
Get-ChildItem -LiteralPath $game -Recurse -File | Where-Object { $_.Name -like "*.font" -or $_.Name -like "*Regular*.otf" -or $_.Name -like "*Regular*.ttf" } | Copy-Item -Destination $fontOut -Force
Write-Host ("font files copied: " + (Get-ChildItem $fontOut).Count)
```

Results: `EU5-for-PX\fonts-listing.txt` and `EU5-for-PX\fonts\`.

If it says `font files copied: 0`, open the game's `fonts` folder in
Explorer, right-click it, then "Send to", then "Compressed (zipped) folder",
and move that zip into `EU5-for-PX`.

---

## Step 3: the Steam app id and the launch options

1. In Steam, right-click Europa Universalis V, then Properties, then
   General, then Launch Options. Enter: `-debug_mode -develop`
2. Start the game once. If it does not start, or Steam refuses `-develop`,
   use only `-debug_mode`. Write down which of the two worked.
3. Open the game's Steam store page in a browser. The address holds a
   number, for example `store.steampowered.com/app/3450310/`. Write the
   number down.

Both answers go into the notes file in Step 7.

---

## Step 4: install the probe mod

1. Copy the `mod\px-layout-probe` folder from this package into your EU5
   mods folder, so you end up with:
   `Documents\Paradox Interactive\Europa Universalis V\mod\px-layout-probe`
2. Start the Paradox launcher, open your playset, and enable the mod
   "PX Layout Probe".
3. Start the game and load ANY campaign. The main menu is not enough. You
   must be inside a running game.

---

## Step 5: spawn each probe window and screenshot it

Before you start, note two things for the report:

- your screen resolution,
- the game's UI scaling setting (Settings, then Graphics). Please set it to
  100% for this session.

Open the console with the `` ` `` key, next to the 1 key. On some keyboard
layouts it is `§` or `~`. Then, for each of the five windows below:

1. Type the spawn command and press Enter.
2. A dark test window with colored rectangles appears in the screen center.
3. Screenshot it with **Win+PrtScr**. This saves a PNG into
   `Pictures\Screenshots`. Please do NOT use the Steam F12 key, because
   those are JPG and the compression ruins the measurement.
4. Type the despawn command before you spawn the next window.

| # | Spawn | Despawn |
|---|---|---|
| 1 | `gui.createwidget gui/px_probe_a.gui px_probe_a` | `gui.clearwidgets px_probe_a` |
| 2 | `gui.createwidget gui/px_probe_b.gui px_probe_b` | `gui.clearwidgets px_probe_b` |
| 3 | `gui.createwidget gui/px_probe_c.gui px_probe_c` | `gui.clearwidgets px_probe_c` |
| 4 | `gui.createwidget gui/px_probe_d.gui px_probe_d` | `gui.clearwidgets px_probe_d` |
| 5 | `gui.createwidget gui/px_probe_e.gui px_probe_e` | `gui.clearwidgets px_probe_e` |

Rename the five screenshots to `px_probe_a.png` up to `px_probe_e.png`, so
that each name matches the window you captured. Then move all five into the
`EU5-for-PX` folder.

If a window does not appear:

- try the path with a prefix:
  `gui.createwidget in_game/gui/px_probe_a.gui px_probe_a`
- if it still fails, note which window failed and go on. The error log you
  send in Step 6 tells us why, and a missing window is itself a useful
  result. Window 5 in particular is EXPECTED to possibly fail.

---

## Step 6: the documentation dumps and the logs

Still in the console, inside a loaded game:

1. Type `script_docs` and press Enter.
2. Type `dump_data_types` and press Enter.

If the console answers "unknown command", skip that command and say so in
the notes in Step 7.

Now **quit the game**, so that the error log is complete. Then paste this
block into your PowerShell window:

```powershell
$pdxRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "Paradox Interactive"
Get-ChildItem -LiteralPath $pdxRoot | Select-Object -ExpandProperty Name | Out-File -Encoding utf8 (Join-Path $out "paradox-folder-names.txt")
$pdx = Join-Path $pdxRoot "Europa Universalis V"
Copy-Item -LiteralPath (Join-Path $pdx "docs") -Destination (Join-Path $out "docs") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $pdx "logs") -Destination (Join-Path $out "logs") -Recurse -Force
Get-Content -LiteralPath (Join-Path $pdx "logs\error.log") -TotalCount 50 | Out-File -Encoding utf8 (Join-Path $out "error-log-first-50.txt")
Write-Host "game data folder: $pdx"
Get-ChildItem $out | Select-Object Name
```

Results: `EU5-for-PX\docs\`, `EU5-for-PX\logs\`,
`EU5-for-PX\error-log-first-50.txt` and
`EU5-for-PX\paradox-folder-names.txt`.

Notes:

- The `docs` folder is written by `script_docs`.
- The `logs` folder holds `error.log` and the `data_types` dump. The error
  log matters even when everything worked, and ESPECIALLY when a window
  failed.
- If a copy fails because the folder does not exist, say so in the notes.

---

## Step 7: the notes file

Paste this block. It writes a template and opens it in Notepad. Fill in the
answers and save.

```powershell
@'
Screen resolution:
UI scaling %:
Game version (shown on the main menu):
Steam app id from the store page address:
Launch options that worked (-debug_mode -develop, or only -debug_mode):
Probe windows that failed to spawn (a b c d e, or none):
Did the script_docs command work (yes / no / unknown command):
Did the dump_data_types command work (yes / no / unknown command):
Anything else that looked odd:
'@ | Out-File -Encoding utf8 (Join-Path $out "notes.txt")
Start-Process notepad (Join-Path $out "notes.txt")
```

---

## Step 8: zip it and send it back

```powershell
Compress-Archive -Path (Join-Path $out "*") -DestinationPath "$env:USERPROFILE\Desktop\EU5-for-PX.zip" -Force
Write-Host "send this file: $env:USERPROFILE\Desktop\EU5-for-PX.zip"
```

Send `EU5-for-PX.zip` from your Desktop. If it is too large for e-mail, use
WeTransfer, Google Drive, or Dropbox.

The zip should hold:

- [ ] `eu5-gui-files.zip` (Step 2a)
- [ ] `game-folder-listing.txt` (Step 2b)
- [ ] `fonts-listing.txt` and the `fonts` folder (Step 2c)
- [ ] `px_probe_a.png` up to `px_probe_e.png` (Step 5)
- [ ] the `docs` folder (Step 6)
- [ ] the `logs` folder, with `error.log` inside (Step 6)
- [ ] `error-log-first-50.txt` (Step 6)
- [ ] `paradox-folder-names.txt` (Step 6)
- [ ] `notes.txt` (Step 7)

Anything you could not produce is fine. Just say so in `notes.txt`.

---

## Cleanup

1. Disable the mod "PX Layout Probe" in the launcher and delete
   `Documents\Paradox Interactive\Europa Universalis V\mod\px-layout-probe`.
2. Remove `-debug_mode -develop` from the Steam launch options, if you do
   not want to keep the console.
3. Delete the `EU5-for-PX` folder and the zip from your Desktop.

Thanks again!
