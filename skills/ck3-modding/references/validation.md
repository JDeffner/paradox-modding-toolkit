# Validating mod code with ck3-tiger

ck3-tiger (github.com/amtep/tiger) is the standard CK3 lint/validator. It loads vanilla plus the
mod and checks cross-references, scopes, syntax, loc, and idioms. Run it after writing code,
BEFORE telling the user to test in-game. It tracks each CK3 patch within days/weeks; right after
a game update expect transient false positives (it warns at startup on a version mismatch).

**Install:** grab the release matching the game version from github.com/amtep/tiger (Windows and
Linux builds; each ships `ck3-tiger`, the zero-config `ck3-tiger-auto`, a sample `ck3-tiger.conf`,
and docs `filter.md`/`annotations.md`). `<tiger>` below = the full path to the ck3-tiger
executable on this machine (SKILL.md Step 0); its sibling files (`ck3-tiger-auto`, `ck3-tiger.conf`,
`filter.md`) live in the same folder. A Linux build for headless sandbox runs, if installed, sits
next to the Windows install folder as a `ck3-tiger-linux-<version>` sibling — list the parent
folder of `<tiger>` to find it. The VS Code extension this repo ships can also download it for you
(command "CK3 Tiger: Download or Update Binary").

The `.exe` cannot run in a Linux sandbox and the Linux binary cannot run on Windows; pick the one
that matches the shell the agent actually has. Read `filter.md`/`annotations.md` in the install
folder for anything not covered here. See "Autonomous validation" below for how an agent runs
tiger itself.

## Invocation

```
ck3-tiger [OPTIONS] <MODPATH>
```

`<MODPATH>` = the mod's `.mod` descriptor file (recommended; its `path=` locates the files) or the
mod folder. Standard Windows command:

```powershell
& "<tiger>" --no-color "<mods>\YourMod.mod" > tiger_report.txt
```

Real flags (do NOT invent others; there are no severity/level CLI flags):
`--game <dir>` (only if auto-detect fails; pass the `<game>` folder),
`--paradox <dir>`, `--config <file>`, `--show-vanilla` (very noisy, avoid), `--show-mods`,
`--json` (machine-readable output, prefer for parsing), `-c/--consolidate` (collapse repeats),
`--unused`, `--pod` (Princes-of-Darkness-specific checks, use for PoD submods), `--no-color`,
`--suppress <baseline.json>` (hide a saved set of reports; great for "only show NEW issues"),
`-V/--version`.

Tiger auto-detects the CK3 install and Paradox user directory; the path flags are fallbacks.

## Autonomous validation (agent runs tiger itself, then reviews the output)

Prefer whichever route matches the agent's actual shell. Both produce a report the agent reads and
triages without the user.

### Route A: Linux sandbox + Linux binary (fully headless, preferred)

The sandbox mounts the Windows drives, so it can reach both the game files and the Linux tiger
binary. Because a binary on an NTFS mount may lack the exec bit, copy it into the sandbox, mark it
executable, and run it pointing `--game` at the mounted game dir:

```bash
# paths below use each connected folder's sandbox mount (…/mnt/<folder>); the mount prefix
# (/sessions/<id>/mnt) changes per session — resolve it from the folder-connection message.
BIN="/sessions/<id>/mnt/<tiger-linux-folder>"   # the ck3-tiger-linux-<version> folder (see Install above)
GAME="/sessions/<id>/mnt/<...>/steamapps/common/Crusader Kings III/game"
MOD="/sessions/<id>/mnt/<your-mod-folder>"          # the mod being validated (must be mounted)

cp "$BIN/ck3-tiger" /tmp/ck3-tiger && chmod +x /tmp/ck3-tiger
/tmp/ck3-tiger --no-color --game "$GAME" "$MOD/descriptor.mod" > /tmp/tiger_report.txt 2>&1
```

Then Read `/tmp/tiger_report.txt` (or write it into the mounted outputs folder) and triage.
Requirements: the sandbox must actually start (it fails when the host disk is low on space), the
mod folder being validated must be a connected folder, and network is not needed (the binary is
already local). Drop a `ck3-tiger.conf` (below) in the mod root, or pass
`--config "$BIN/ck3-tiger.conf"` after editing it.

### Route B: Windows, via a batch file (uses the local .exe, no terminal typing)

Computer-use grants terminals "click-only" (typing blocked), but Explorer is full-access and a
double-click runs a `.bat`. So: write a batch file into a connected folder, launch it by
double-clicking in Explorer via computer-use (or ask the user to double-click it), then Read the
report file it writes.

```bat
@echo off
"<tiger>" --no-color "<mods>\YourMod.mod" > "%~dp0tiger_report.txt" 2>&1
```

`ck3-tiger-auto.exe` is the zero-config variant (auto-detects everything) if you don't need flags.

Only fall back to "here's the command, please run it and send the report back" if neither route is
available.

## Config: ship a `ck3-tiger.conf` in the mod root

Named exactly `ck3-tiger.conf`, placed in the mod's top directory (next to `common/`, `events/`),
Paradox-script format. Recommended default (localization checks OFF, since the goal is
usually working code; re-enable when asked or when polishing for release):

```
# ck3-tiger.conf
languages = {
    check = "english"          # skip "missing loc" spam for other languages
}

filter = {
    show_vanilla = no
    show_loaded_mods = no

    trigger = {
        # implicit AND: a report prints only if it matches every line
        severity >= Warning        # hide Tips and Untidy
        confidence >= Reasonable   # hide the false-positive-prone Weak reports
        NOT = { key = missing-localization }   # loc checks OFF by default
    }
}
```

To re-enable loc checks: delete the `NOT = { key = missing-localization }` line.

Vocabulary (exact spellings): severity `Tips < Untidy < Warning < Error < Fatal`; confidence
`Weak < Reasonable < Strong`; both support comparisons (`severity >= Warning`). The `key` is the
token printed in parentheses on each report's first line (e.g. `Error(missing-localization):`).
Only filter on keys you have actually seen in output; documented ones include
`missing-localization`, `missing-item`, `duplicate-item`, `duplicate-field`.

Other useful config blocks: per-file suppression
`trigger = { ignore_keys_in_files = { keys = { missing-localization } files = { localization/ } } }`;
`scope_override = { my_trigger = ALL }` to fix false wrong-scope reports;
`characters = { only_born = "1511.1.1" }` for history noise;
`load_mod = { label = "AGOT" workshop_id = "2962333032" }` blocks to declare parent mods a submod
depends on (parents load first so references resolve; their own problems stay hidden by default).

In-file alternative: `#tiger-ignore` comment on the line above, or scoped forms
`#tiger-ignore(block)`, `#tiger-ignore(file)`, `#tiger-ignore(begin)`/`(end)`,
`#tiger-ignore(key=missing-item)`. Works in script, gui, and loc files.

## Output and triage

Human format: `Severity(key): message`, then `--> [MOD] path/file.txt`, then the offending line
with a caret. A summary count prints at the end; a clean run says so explicitly. `--json` emits
the same reports as JSON (inspect the actual field names once before depending on them).

Agent triage order:

1. `Fatal` / `Error`: real bugs, fix first (Fatal = likely crash or fully broken item).
2. `Warning`: player-facing glitches; fix or consciously suppress.
3. `Untidy` / `Tips`: style/perf advice; ignore while iterating.

Cross-check `confidence`: `Weak` reports are the false-positive-prone ones.

## Facts an agent must know

- **Whole-mod only.** Tiger cannot meaningfully validate a single file; references resolve across
  game + mod. To focus output on one area, filter instead:
  `trigger = { file = common/traits/ }` restricts *printing*, not parsing.
- Runs take seconds to low tens of seconds (it parses all of vanilla each run; no watch mode).
- **Do not rely on exit codes** (undocumented); parse the output and count Error/Fatal, or diff
  against a `--suppress` baseline.
- Tiger is mature but "will still warn about some things that are actually correct" (its own
  README). Manage false positives via confidence filters, `scope_override`, `#tiger-ignore`, and
  baselines, not by ignoring the tool.
- A run drowning in loc Warnings is not "broken code": fix Error/Fatal first, defer loc until the
  content is stable, then re-enable the loc key and clean up.
- Run `--version` once per session to confirm the build matches the installed CK3 patch (both local
  builds are v1.19.0 = CK3 1.19; re-download the matching release from
  github.com/amtep/tiger/releases after a CK3 update).
