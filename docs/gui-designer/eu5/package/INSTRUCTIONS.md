# EU5 data pack: what to run and what to send back

Thank you for helping! This takes about 30 minutes.

You do two things:

1. Copy some files out of your EU5 install and out of your EU5 user folder
   (fast, the game does not run).
2. Install a tiny mod that adds five invisible test windows, open each one
   from the console, and screenshot it.

Nothing here changes your game files. The test mod adds no gameplay. You
remove everything at the end by deleting one folder.

Everything you produce goes into ONE folder on your Desktop called
`EU5-for-PX`. At the end you zip that folder and send it back.

The commands below are PowerShell. Copy a whole block, paste it into the
PowerShell window, and press Enter.

If the mod does not show up, or the windows do not open, read the
**Troubleshooting** section after Step 6. A failure that you describe well
is as useful to us as a success. Nobody here owns EU5, so your report is
the only way we learn what is true.

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

**Keep this PowerShell window open.** Every later block uses `$out`, `$game`
and `$pdx`. If you close the window, paste Step 1 and Step 2 again first.

---

## Step 2: find your EU5 user folder

EU5 writes your logs, your settings and your mods into a folder under
`Documents\Paradox Interactive`. We do not know the folder name that EU5
uses, and guessing it wrong is the fastest way to install a mod that the
game never reads. So we find it first and keep it in `$pdx`. Every later
step uses that variable.

```powershell
$pdxRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "Paradox Interactive"
if (-not (Test-Path -LiteralPath $pdxRoot)) { $pdxRoot = "$env:USERPROFILE\Documents\Paradox Interactive" }
$cands = @(Get-ChildItem -LiteralPath $pdxRoot -Directory -ErrorAction SilentlyContinue)
$table = $cands | ForEach-Object { "{0,-30} logs={1,-5} mod={2,-5} docs={3,-5} last_written={4}" -f $_.Name, (Test-Path -LiteralPath (Join-Path $_.FullName "logs")), (Test-Path -LiteralPath (Join-Path $_.FullName "mod")), (Test-Path -LiteralPath (Join-Path $_.FullName "docs")), $_.LastWriteTime }
$table | Out-File -Encoding utf8 (Join-Path $out "paradox-folder-names.txt")
$table
$pdx = ($cands | Where-Object { $_.Name -match '^Europa Universalis (V|5)$' } | Select-Object -First 1).FullName
if (-not $pdx) { $pdx = ($cands | Where-Object { $_.Name -match 'Europa|EU5|Caesar' -and $_.Name -notmatch '(IV|III|II|Rome)$' } | Select-Object -First 1).FullName }
Write-Host "Paradox root: $pdxRoot"
if ($pdx) { Write-Host "EU5 user folder: $pdx" } else { Write-Host "EU5 USER FOLDER NOT FOUND. Read the note below." }
```

The block prints one line per Paradox game folder you have, and then the
folder it picked for EU5.

- **Look at the printed EU5 line.** If it names a different game, or if it
  says EU5 USER FOLDER NOT FOUND, pick the right name from the table and set
  it by hand, for example:

  ```powershell
  $pdx = "C:\Users\YourName\Documents\Paradox Interactive\Europa Universalis V"
  ```

- The EU5 folder is the one with `logs=True`, and usually with `mod=True`.
- If no folder looks like EU5 at all, start EU5 once, quit it, and paste the
  block again. The game creates the folder on the first start.
- If your Documents folder sits on OneDrive or on another drive, the block
  follows that. The printed `Paradox root:` line tells you where it looked.

Write the printed EU5 folder into the notes in Step 9.

Result: `EU5-for-PX\paradox-folder-names.txt`.

---

## Step 3: copy files out of the game folder

The game does not need to run for this step.

### 3a. Every vanilla .gui file (the most valuable item for the layout work)

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

### 3b. The vanilla script files and the schema docs

This is the item that teaches the toolkit which keys are legal inside which
block, and how often each one is used. Without it, the code completion for
EU5 stays almost useless.

The block copies three things, and keeps the folder names they have in the
game:

- every `.txt` file that sits under a `common` or an `events` folder,
- every `.md` file anywhere in the game folder,
- every `.info` file anywhere in the game folder.

The `.md` and `.info` files are the schema docs the game ships. We do not
know whether EU5 ships any. Please run the block even if you think there
are none, and report the count.

The block leaves out `map_data` and the other large data folders on purpose.
They are big and they teach us nothing.

```powershell
$stage = Join-Path $out "script-corpus"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Get-ChildItem -LiteralPath $game -Recurse -File | Where-Object { $r = $_.FullName.Substring($game.Length + 1); ($_.Extension -eq ".txt" -and $r -match '(^|\\)(common|events)\\') -or ($_.Extension -eq ".md") -or ($_.Extension -eq ".info") } | ForEach-Object { $d = Join-Path $stage $_.FullName.Substring($game.Length + 1); New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $d }
Write-Host ("script files copied: " + (Get-ChildItem -LiteralPath $stage -Recurse -File).Count)
Write-Host ("of those, schema docs (.md and .info): " + (Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object { $_.Extension -eq ".md" -or $_.Extension -eq ".info" }).Count)
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath (Join-Path $out "eu5-script-corpus.zip") -Force
Remove-Item -Recurse -Force $stage
Write-Host "written: $out\eu5-script-corpus.zip"
```

The last part takes a minute or two, and PowerShell prints nothing while it
zips. That is normal. Wait for the `written:` line.

Result: `EU5-for-PX\eu5-script-corpus.zip`, usually between 3 MB and 20 MB.
If it comes out at several hundred MB, too much was copied. Say so in the
notes.

Write both printed numbers into the notes in Step 9.

Two more things:

- The folder names inside the zip must stay as they are. EU5 keeps its
  files under a stage folder such as `in_game`, and we need that prefix.
  Please do not flatten or reorganise the zip.
- This is game script text only. It holds no personal data, no save games
  and no account details.

### 3c. A two-level listing of the game folder

```powershell
Get-ChildItem -LiteralPath $game -Recurse -Depth 1 | ForEach-Object { $_.FullName.Substring($game.Length + 1) } | Out-File -Encoding utf8 (Join-Path $out "game-folder-listing.txt")
Write-Host "written: $out\game-folder-listing.txt"
```

Result: `EU5-for-PX\game-folder-listing.txt`.

### 3d. The fonts listing and the default UI font

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

## Step 4: the Steam app id and the launch options

1. In Steam, right-click Europa Universalis V, then Properties, then
   General, then Launch Options. Enter: `-debug_mode -develop`
2. Start the game once. If it does not start, or Steam refuses `-develop`,
   use only `-debug_mode`. Write down which of the two worked.
3. While the game is up, read the game version, for example `1.0.3`. The
   launcher shows it, and so does the corner of the main menu. You need it
   in Step 5b.
4. Open the game's Steam store page in a browser. The address holds a
   number, for example `store.steampowered.com/app/3450310/`. Write the
   number down.

The answers go into the notes file in Step 9.

---

## Step 5: install the probe mod

### 5a. Copy the mod into the folder that Step 2 found

Unzip this package first, if you have not done that yet. The block looks for
it on your Desktop and in your Downloads folder.

```powershell
$pkg = @("$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads") | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { @(Get-Item -LiteralPath $_) + @(Get-ChildItem -LiteralPath $_ -Directory) } | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "mod\px-layout-probe") } | Select-Object -First 1 -ExpandProperty FullName
if ($pkg -and $pdx) {
  $dest = Join-Path $pdx "mod\px-layout-probe"
  New-Item -ItemType Directory -Force -Path (Join-Path $pdx "mod") | Out-Null
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $pkg "mod\px-layout-probe") -Destination $dest -Recurse -Force
  Write-Host "package: $pkg"
  Write-Host "mod installed to: $dest"
  Get-ChildItem -LiteralPath $dest -Recurse -Force -File | ForEach-Object { $_.FullName.Substring($dest.Length + 1) }
} else {
  Write-Host "STOP. package found: '$pkg'   EU5 user folder: '$pdx'   Read the note below."
}
```

The block prints the full path it installed to, and then the nine files that
landed there. Copy the printed path into the notes in Step 9.

If it says STOP:

- an empty EU5 user folder means Step 2 found nothing. Go back to Step 2.
- an empty package means the unzipped package sits somewhere else. Set it by
  hand. It is the folder that holds `INSTRUCTIONS.md` and a `mod` folder:

  ```powershell
  $pkg = "C:\Users\YourName\Downloads\eu5-package"
  ```

### 5b. Write your game version into the mod

The launcher compares the mod's `supported_game_version` with your game
version. A wrong value can make the launcher mark the mod as incompatible,
or hide it. Real mods never use a plain `*` there, so we do not either.

Edit the first line to the version you read in Step 4, then paste the whole
block.

```powershell
$gameVersion = "1.0.3"
$parts = $gameVersion -split '\.'
if ($parts.Count -ge 2) { $sgv = $parts[0] + "." + $parts[1] + ".*" } else { $sgv = $gameVersion }
$meta = Join-Path $dest ".metadata\metadata.json"
$text = (Get-Content -LiteralPath $meta -Raw) -replace '"supported_game_version"\s*:\s*"[^"]*"', ('"supported_game_version": "' + $sgv + '"')
[System.IO.File]::WriteAllText($meta, $text, (New-Object System.Text.UTF8Encoding($false)))
Get-Content -LiteralPath $meta
```

The block prints the finished file. Check that the
`"supported_game_version"` line holds your version with a `.*` at the end,
for example `"1.0.*"`.

If the launcher later refuses the mod anyway, Troubleshooting A below has
the two next values to try.

### 5c. Enable the mod

1. Start the Paradox launcher.
2. Open Mods, or Playsets. The mod is called "PX Layout Probe". Enable it in
   the playset that you start the game with.
3. **If the launcher does not list the mod at all, go to Troubleshooting A
   now**, before you start the game.
4. Start the game and load ANY campaign. The main menu is not enough. You
   must be inside a running game.

---

## Step 6: spawn each probe window and screenshot it

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
- if it still fails, note which window failed and go on. Window 5 in
  particular is EXPECTED to possibly fail, and a single missing window is
  itself a useful result.
- if NO window appears at all, read Troubleshooting B below.

---

## Troubleshooting: the mod does not work

Two different things can go wrong. They have different causes and they need
different reports. Please read the one that matches what you saw.

### A. The launcher does not list "PX Layout Probe"

Then the launcher never saw the mod, and the game never loaded it. Paste
this block and copy the whole output into `notes.txt` under
"Troubleshooting A".

```powershell
Write-Host "EU5 user folder: $pdx"
Write-Host "mod folder: $dest"
if (Test-Path -LiteralPath $dest) { Get-ChildItem -LiteralPath $dest -Recurse -Force -File | ForEach-Object { $_.FullName.Substring($dest.Length + 1) } } else { Write-Host "THE MOD FOLDER DOES NOT EXIST" }
Write-Host "--- metadata.json ---"
Get-Content -LiteralPath (Join-Path $dest ".metadata\metadata.json")
Write-Host "--- Paradox folders ---"
Get-Content -LiteralPath (Join-Path $out "paradox-folder-names.txt")
```

Then try these, in this order, and stop as soon as the mod appears. Close
and restart the launcher after each try, because it caches its mod list.

1. **Wrong folder.** The mod must sit in the same folder that holds your EU5
   `logs` folder. Compare the two paths the block printed with the table of
   Paradox folders. If Step 2 picked the wrong one, set `$pdx` by hand and
   run Step 5a and Step 5b again.
2. **The launcher did not rescan.** In the launcher, open Mods, use the
   refresh or "scan for mods" action, and look at the full list of installed
   mods, not only at your playset.
3. **The version value.** Set it to your exact game version first, for
   example `1.0.3`. If the mod still does not appear, set it to `*` as a
   last try. Edit the first line of the block each time.

   ```powershell
   $sgv = "1.0.3"
   $meta = Join-Path $dest ".metadata\metadata.json"
   $text = (Get-Content -LiteralPath $meta -Raw) -replace '"supported_game_version"\s*:\s*"[^"]*"', ('"supported_game_version": "' + $sgv + '"')
   [System.IO.File]::WriteAllText($meta, $text, (New-Object System.Text.UTF8Encoding($false)))
   Get-Content -LiteralPath $meta
   ```

4. If none of that works, stop there and go on with Step 7. That is a
   result, not a failure of yours.

Please report, in `notes.txt`:

- the whole output of the block above,
- which of the three tries you did, and what the launcher showed after each,
- the exact wording the launcher used, if it showed the mod as broken,
  invalid or incompatible instead of hiding it.

### B. The mod is listed and enabled, but no probe window opens

Then the launcher accepted the mod and the game loaded it, but the game did
not find or did not like the `.gui` files. Two things could be wrong: where
the files sit inside the mod, and the path you type in the console. The
steps below cover both.

**The folder layout inside the mod is a guess.** EU5 keeps its own files
under a stage folder called `in_game`, so we placed the probe files under
`in_game\gui` and `in_game\gfx`. Nobody here could check whether an EU5 mod
must do the same. If a mod must instead put `gui` and `gfx` at its top
level, the game never reads our files. This block adds a second copy at the
top level, so both layouts exist at the same time:

```powershell
Get-ChildItem -LiteralPath (Join-Path $dest "in_game") -Directory | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dest $_.Name) -Recurse -Force }
Get-ChildItem -LiteralPath $dest -Recurse -Force -File | ForEach-Object { $_.FullName.Substring($dest.Length + 1) }
```

Quit the game, start it again, load a campaign, and try the spawn commands
once more. Try both forms of the path:

- `gui.createwidget gui/px_probe_a.gui px_probe_a`
- `gui.createwidget in_game/gui/px_probe_a.gui px_probe_a`

Please report, in `notes.txt`:

- whether a window appeared never, only after the extra copy, or already
  before it,
- which of the two command forms worked,
- what the console answered, word for word, if it answered at all,
- whether `error.log` holds any line about the probe. Step 7 collects those
  lines into `probe-log-lines.txt`, so you only need to say whether that
  file has content.

The error log is the important part here. "Nothing happened and the log is
silent" and "the log says the file was not found" mean two different things
to us.

---

## Step 7: the documentation dumps and the logs

Still in the console, inside a loaded game:

1. Type `script_docs` and press Enter.
2. Type `dump_data_types` and press Enter.

If the console answers "unknown command", skip that command and say so in
the notes in Step 9.

Now **quit the game**, so that the error log is complete. Then paste this
block into your PowerShell window:

```powershell
if (Test-Path -LiteralPath (Join-Path $pdx "docs")) { Copy-Item -LiteralPath (Join-Path $pdx "docs") -Destination (Join-Path $out "docs") -Recurse -Force }
if (Test-Path -LiteralPath (Join-Path $pdx "logs")) { Copy-Item -LiteralPath (Join-Path $pdx "logs") -Destination (Join-Path $out "logs") -Recurse -Force }
Get-ChildItem -LiteralPath $pdx -File -Force | Where-Object { $_.Name -like "*content_load*" -or $_.Name -like "*dlc_load*" } | Copy-Item -Destination $out -Force
$err = Join-Path $pdx "logs\error.log"
if (Test-Path -LiteralPath $err) {
  Get-Content -LiteralPath $err -TotalCount 50 | Out-File -Encoding utf8 (Join-Path $out "error-log-first-50.txt")
  Select-String -LiteralPath $err -Pattern "px_probe|px-layout-probe|Layout Probe" | ForEach-Object { $_.Line } | Out-File -Encoding utf8 (Join-Path $out "probe-log-lines.txt")
} else { Write-Host "NO error.log under $pdx\logs" }
Write-Host "game data folder: $pdx"
Get-ChildItem $out | Select-Object Name
```

Results: `EU5-for-PX\docs\`, `EU5-for-PX\logs\`,
`EU5-for-PX\error-log-first-50.txt`, `EU5-for-PX\probe-log-lines.txt` and,
if EU5 writes one, `content_load.json`.

Notes:

- The `docs` folder is written by `script_docs`.
- The `logs` folder holds `error.log` and the `data_types` dump. The error
  log matters even when everything worked, and ESPECIALLY when a window
  failed.
- `probe-log-lines.txt` holds only the log lines that name the probe. If it
  is empty, the game never said anything about our mod. Say so in the notes.
- `content_load.json` is the launcher's list of the mods it handed to the
  game. It tells us whether the launcher passed our mod on at all.
- The logs and `content_load.json` hold file paths, so they contain your
  Windows user name. They hold no account data and no save games.
- If a copy fails because the folder does not exist, say so in the notes.

---

## Step 8: one real EU5 mod, as an example

This one item also fixes the toolkit itself. The extension writes the
descriptor file for a new EU5 mod from a guess. One real example settles it:
which fields EU5 needs, how the game version is written, and whether EU5
wants a `game_id`.

Any EU5 mod counts, from the Workshop or a local one. It does not matter
which mod it is. If you have none, subscribe to any small EU5 mod on the
Workshop, start the launcher once so that Steam downloads it, and then paste
the block.

```powershell
$exOut = Join-Path $out "example-mods"
New-Item -ItemType Directory -Force -Path $exOut | Out-Null
Get-ChildItem -LiteralPath (Join-Path $pdx "mod") -Force | Select-Object -ExpandProperty Name | Out-File -Encoding utf8 (Join-Path $out "mod-folder-listing.txt")
$steamapps = Split-Path (Split-Path $game -Parent) -Parent
$installdir = Split-Path $game -Leaf
$appidFound = ""
Get-ChildItem -LiteralPath $steamapps -Filter "appmanifest_*.acf" -File -ErrorAction SilentlyContinue | ForEach-Object { if ((Get-Content -LiteralPath $_.FullName -Raw) -match ('"installdir"\s+"' + [regex]::Escape($installdir) + '"')) { $appidFound = $_.BaseName -replace "appmanifest_", "" } }
if (-not $appid) { $appid = $appidFound }
$modDirs = @()
if (Test-Path -LiteralPath (Join-Path $pdx "mod")) { $modDirs += @(Get-ChildItem -LiteralPath (Join-Path $pdx "mod") -Directory -Force) }
if ($appid) { $ws = Join-Path $steamapps ("workshop\content\" + $appid); if (Test-Path -LiteralPath $ws) { $modDirs += @(Get-ChildItem -LiteralPath $ws -Directory -Force) } }
$examples = @($modDirs | Where-Object { $_.Name -ne "px-layout-probe" -and (Test-Path -LiteralPath (Join-Path $_.FullName ".metadata\metadata.json")) } | Select-Object -First 3)
foreach ($m in $examples) {
  Copy-Item -LiteralPath (Join-Path $m.FullName ".metadata\metadata.json") -Destination (Join-Path $exOut ($m.Name + "-metadata.json")) -Force
  Get-ChildItem -LiteralPath $m.FullName -Force | Select-Object -ExpandProperty Name | Out-File -Encoding utf8 (Join-Path $exOut ($m.Name + "-root-listing.txt"))
}
Write-Host ("Steam app id: " + $appid)
Write-Host ("example mods copied: " + $examples.Count)
Get-ChildItem $exOut | Select-Object Name
```

Results: `EU5-for-PX\example-mods\` and `EU5-for-PX\mod-folder-listing.txt`.

For every mod it finds, the block copies two small text items: the mod's
`.metadata\metadata.json`, and the list of the names in the mod's top
folder. It copies no game content.

- If it prints `example mods copied: 0` and you do have EU5 mods, the mods
  may keep their descriptor somewhere else. Open one mod folder in Explorer
  and say in the notes which files sit in it.
- If `Steam app id:` prints nothing, set the number you wrote down in Step 4
  by hand and paste the block again:

  ```powershell
  $appid = "3450310"
  ```

- `mod-folder-listing.txt` shows what else lives next to the mod folders.
  If EU5 needs a separate descriptor file per mod, it shows up there.

---

## Step 9: the notes file

Paste this block. It writes a template and opens it in Notepad. Fill in the
answers and save.

```powershell
@'
Screen resolution:
UI scaling %:
Game version (shown on the launcher and the main menu):
Steam app id from the store page address:
Launch options that worked (-debug_mode -develop, or only -debug_mode):
EU5 user folder that Step 2 printed:
Mod install path that Step 5a printed:
Did the launcher list the mod "PX Layout Probe" (yes / no):
Script files copied in Step 3b (the number the block printed):
Schema docs found in Step 3b (.md and .info, the second number):
Probe windows that failed to spawn (a b c d e, or none):
Which gui path worked (gui/... or in_game/gui/... or neither):
Did probe-log-lines.txt have any content (yes / no):
Did the script_docs command work (yes / no / unknown command):
Did the dump_data_types command work (yes / no / unknown command):
Example mods copied in Step 8 (the number the block printed):
Troubleshooting A, if you used it (paste the block output here):
Troubleshooting B, if you used it (what worked, what the console said):
Anything else that looked odd:
'@ | Out-File -Encoding utf8 (Join-Path $out "notes.txt")
Start-Process notepad (Join-Path $out "notes.txt")
```

---

## Step 10: zip it and send it back

```powershell
Compress-Archive -Path (Join-Path $out "*") -DestinationPath "$env:USERPROFILE\Desktop\EU5-for-PX.zip" -Force
Write-Host "send this file: $env:USERPROFILE\Desktop\EU5-for-PX.zip"
```

Send `EU5-for-PX.zip` from your Desktop. If it is too large for e-mail, use
WeTransfer, Google Drive, or Dropbox.

The zip should hold:

- [ ] `paradox-folder-names.txt` (Step 2)
- [ ] `eu5-gui-files.zip` (Step 3a)
- [ ] `eu5-script-corpus.zip` (Step 3b)
- [ ] `game-folder-listing.txt` (Step 3c)
- [ ] `fonts-listing.txt` and the `fonts` folder (Step 3d)
- [ ] `px_probe_a.png` up to `px_probe_e.png` (Step 6)
- [ ] the `docs` folder (Step 7)
- [ ] the `logs` folder, with `error.log` inside (Step 7)
- [ ] `error-log-first-50.txt` and `probe-log-lines.txt` (Step 7)
- [ ] `content_load.json`, if EU5 writes one (Step 7)
- [ ] the `example-mods` folder and `mod-folder-listing.txt` (Step 8)
- [ ] `notes.txt` (Step 9)

Anything you could not produce is fine. Just say so in `notes.txt`.

---

## Cleanup

1. Disable the mod "PX Layout Probe" in the launcher, and delete the folder
   that Step 5a printed. This block deletes it for you:

   ```powershell
   if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force; Write-Host "deleted: $dest" }
   ```

2. Remove `-debug_mode -develop` from the Steam launch options, if you do
   not want to keep the console.
3. Delete the `EU5-for-PX` folder and the zip from your Desktop.

Thanks again!
