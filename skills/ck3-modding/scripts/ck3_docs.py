#!/usr/bin/env python3
"""Find Crusader Kings III's own ground truth instead of guessing at it.

Three things every CK3 modding session needs and every agent gets wrong from
memory: where the game and its logs live on this machine, whether a script
identifier really exists in the installed build, and which `_*.info` schema
doc describes a folder. This resolves all three.

Subcommands:
    paths           Resolve <game>, <logs>, <mods>, <workshop>, <tiger>; print the
                    installed patch, the DLC folders and how stale the
                    script_docs dumps are. Run this once at the start of a session.
    find <name>     Is this a real effect, trigger, event target, scope,
                    modifier or on_action? Prints the dump entry and exits 1
                    when it does not exist.
    find -s <text>  Substring search over every known identifier.
    info [folder]   Map common/ folders to their `_*.info` schema doc.

Paths are auto-detected from Steam's library list and the user's Documents
folder. Override with --game / --logs / --tiger, or the CK3_GAME, CK3_LOGS and
CK3_TIGER environment variables.

Regenerate the dumps after a game patch: launch with -debug_mode, then run
`script_docs` in the in-game console.
"""
import argparse
import difflib
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

APP_ID = "1158310"
GAME_DIR = "Crusader Kings III"

# Dump file -> record grammar, described in parse().
SOURCES = {
    "effect": ("effects.log", "dashed"),
    "trigger": ("triggers.log", "dashed"),
    "event_target": ("event_targets.log", "dashed"),
    "on_action": ("on_actions.log", "dashed"),
    "scope": ("event_scopes.log", "blank"),
    "modifier": ("modifiers.log", "tag"),
}


# ---------------------------------------------------------------- paths --

def steam_roots():
    """Every Steam install root worth checking, most likely first."""
    roots = []
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
                roots.append(winreg.QueryValueEx(k, "SteamPath")[0])
        except OSError:
            pass
        roots.append("C:/Program Files (x86)/Steam")
    elif sys.platform == "darwin":
        roots.append("~/Library/Application Support/Steam")
    else:
        roots += ["~/.steam/steam", "~/.local/share/Steam",
                  "~/.var/app/com.valvesoftware.Steam/.local/share/Steam"]
    return [Path(r).expanduser() for r in roots]


def steam_libraries():
    """Steam root plus every library listed in libraryfolders.vdf."""
    libs = []
    for root in steam_roots():
        if not root.is_dir():
            continue
        libs.append(root)
        vdf = root / "steamapps" / "libraryfolders.vdf"
        if vdf.is_file():
            for m in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace")):
                libs.append(Path(m.group(1).replace("\\\\", "\\")))
    seen, out = set(), []
    for lib in libs:
        key = str(lib).lower()
        if key not in seen:
            seen.add(key)
            out.append(lib)
    return out


def documents_dir():
    """The user's Documents folder, honoring a Windows redirect (OneDrive, another drive)."""
    if sys.platform == "win32":
        try:
            import winreg
            key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
                return Path(os.path.expandvars(winreg.QueryValueEx(k, "Personal")[0]))
        except OSError:
            pass
    return Path("~/Documents").expanduser()


def paradox_user_dir():
    if sys.platform.startswith("linux"):
        return Path("~/.local/share/Paradox Interactive").expanduser() / GAME_DIR
    return documents_dir() / "Paradox Interactive" / GAME_DIR


def find_game(explicit):
    for cand in [explicit, os.environ.get("CK3_GAME")]:
        if cand and (Path(cand).expanduser() / "common").is_dir():
            return Path(cand).expanduser()
    for lib in steam_libraries():
        game = lib / "steamapps" / "common" / GAME_DIR / "game"
        if (game / "common").is_dir():
            return game
    return None


def find_logs(explicit):
    for cand in [explicit, os.environ.get("CK3_LOGS"), paradox_user_dir() / "logs"]:
        if cand and Path(cand).expanduser().is_dir():
            return Path(cand).expanduser()
    return None


def toolkit_tiger_dirs():
    """Where the Paradox Modding Toolkit VS Code extension keeps the tiger it downloaded."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", "")) / "Code"
    elif sys.platform == "darwin":
        base = Path("~/Library/Application Support/Code").expanduser()
    else:
        base = Path("~/.config/Code").expanduser()
    return [base / "User" / "globalStorage" / "jdeffner.px-toolkit" / "tiger"]


def find_tiger(explicit):
    exe = "ck3-tiger.exe" if sys.platform == "win32" else "ck3-tiger"
    for cand in [explicit, os.environ.get("CK3_TIGER")]:
        if cand and Path(cand).expanduser().is_file():
            return Path(cand).expanduser()
    on_path = shutil.which("ck3-tiger")
    if on_path:
        return Path(on_path)
    for base in toolkit_tiger_dirs():
        if base.is_dir():
            # Version folders sort newest last; the plain binary beats the -auto wrapper.
            for version in sorted(base.iterdir(), reverse=True):
                hits = sorted(version.rglob(exe))
                if hits:
                    return hits[0]
    return None


def resolve_all(args):
    game = find_game(args.game)
    logs = find_logs(args.logs)
    workshop = None
    if game:
        lib = game.parents[3] if len(game.parents) > 3 else None
        if lib and (lib / "steamapps").is_dir():
            workshop = lib / "steamapps" / "workshop" / "content" / APP_ID
    return {
        "<game>": game,
        "<logs>": logs,
        "<mods>": logs.parent / "mod" if logs else None,
        "<workshop>": workshop,
        "<tiger>": find_tiger(args.tiger),
    }


# ---------------------------------------------------------------- dumps --

def parse(path, fmt):
    """Yield (name, [body lines]) for one dump file.

    dashed  records separated by a line of hyphens; the first line is
            "name - description" or "name:", the rest is the body
    blank   "name:" at column 0, body runs to the next blank line (event_scopes.log)
    tag     "Tag: name" starts a record, body runs to the next blank line (modifiers.log)
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    if fmt == "dashed":
        for chunk in re.split(r"^-{4,}\s*$", text, flags=re.M):
            rows = [r.rstrip() for r in chunk.splitlines() if r.strip()]
            if not rows:
                continue
            m = re.match(r"^([A-Za-z0-9_.:<>|\[\]]+)\s*(?:-\s*(.*)|:)$", rows[0])
            if not m:
                continue
            body = ([m.group(2)] if m.group(2) else []) + rows[1:]
            yield m.group(1), body
        return
    head = re.compile(r"^Tag:\s*(\S+)\s*$" if fmt == "tag" else r"^([A-Za-z0-9_]+):\s*$")
    name, body = None, []
    for line in text.splitlines():
        line = line.rstrip()
        if not line.strip():
            if name:
                yield name, body
            name, body = None, []
            continue
        m = head.match(line)
        if m and name is None:
            name, body = m.group(1), []
        elif name is not None:
            body.append(line.strip())
    if name:
        yield name, body


def load_dumps(logs):
    index, missing = {}, []
    for kind, (fname, fmt) in SOURCES.items():
        path = logs / fname
        if not path.is_file():
            missing.append(fname)
            continue
        for name, body in parse(path, fmt):
            index.setdefault(name, []).append((kind, body, fname))
    return index, missing


def template_matches(index, name):
    """modifiers.log lists templated tags like $CULTURE$_opinion; match them to a concrete name."""
    hits = []
    for tag in index:
        if "$" not in tag:
            continue
        pattern = "^" + re.sub(r"\\\$[A-Z_]+\\\$", r"[a-z0-9_]+", re.escape(tag)) + "$"
        if re.match(pattern, name):
            hits.append(tag)
    return hits


def cmd_find(args, logs):
    index, missing = load_dumps(logs)
    if missing:
        print(f"note: missing dumps in {logs}: {', '.join(missing)}", file=sys.stderr)

    if args.search:
        needle = args.search.lower()
        hits = sorted(n for n in index if needle in n.lower())
        for n in hits:
            print(f"{n}  [{','.join(sorted({k for k, _, _ in index[n]}))}]")
        print(f"\n{len(hits)} match(es)" if hits else f"no identifier matching {args.search!r}")
        return 0 if hits else 1

    names = [args.name] if args.name in index else template_matches(index, args.name)
    if names:
        for n in names:
            for kind, body, fname in index[n]:
                label = kind if n == args.name else f"{kind}, from template {n}"
                print(f"\n{args.name}  [{label}]  ({fname})")
                for line in body:
                    print(f"    {line}")
        return 0

    print(f"NOT FOUND: {args.name!r} is not an effect, trigger, event target, scope, "
          f"modifier or on_action in this build. Do not use it. Pick a real one from the\n"
          f"suggestions below, or search with: ck3_docs.py find -s <text>")
    near = sorted(n for n in index if args.name.lower() in n.lower())[:10]
    if not near:
        near = difflib.get_close_matches(args.name, list(index), n=8, cutoff=0.75)
    for n in near:
        print(f"  {n}")
    return 1


# ----------------------------------------------------------------- info --

def cmd_info(args, game):
    docs = sorted(game.rglob("_*.info"))
    rows = [d for d in docs if not args.folder or args.folder.lower() in str(d.parent.relative_to(game)).lower()]
    if not rows:
        print(f"no _*.info doc for a folder matching {args.folder!r}; a vanilla .txt in that "
              f"folder is the reference")
        return 1
    for d in rows:
        rel = d.relative_to(game)
        n_txt = sum(1 for _ in d.parent.glob("*.txt"))
        print(f"{rel.as_posix():70} {n_txt:4} .txt  {d.stat().st_size:6} bytes")
    print(f"\n{len(rows)} schema doc(s). Read the doc before scripting the system; its "
          f"comments carry each field's type, default and scope.")
    return 0


# ---------------------------------------------------------------- paths --

def cmd_paths(args):
    paths = resolve_all(args)
    hints = {
        "<game>": "pass --game or set CK3_GAME to .../Crusader Kings III/game",
        "<logs>": "pass --logs or set CK3_LOGS to .../Paradox Interactive/Crusader Kings III/logs",
        "<mods>": "derived from <logs>",
        "<workshop>": "no Workshop content folder next to the game (nothing subscribed?)",
        "<tiger>": "pass --tiger or set CK3_TIGER; releases at github.com/amtep/tiger",
    }
    for key, val in paths.items():
        print(f"{key:12} {val if val else 'NOT FOUND, ' + hints[key]}")

    game, logs = paths["<game>"], paths["<logs>"]
    if game:
        settings = game.parent / "launcher" / "launcher-settings.json"
        m = settings.is_file() and re.search(r'"rawVersion"\s*:\s*"([^"]+)"', settings.read_text(encoding="utf-8"))
        print(f"\nbuild:       {m.group(1) if m else 'unknown'}")
        dlc = game / "dlc"
        if dlc.is_dir():
            print(f"dlc folders: {', '.join(sorted(p.name for p in dlc.iterdir() if p.is_dir()))}")
    if not logs:
        return 1

    now = datetime.now(timezone.utc)
    print("\nscript_docs dumps (regenerate: launch with -debug_mode, console `script_docs`):")
    oldest, any_dump = 0, False
    for kind, (fname, fmt) in SOURCES.items():
        path = logs / fname
        if not path.is_file():
            print(f"  {kind:13} MISSING   {fname}")
            continue
        any_dump = True
        n = sum(1 for _ in parse(path, fmt))
        age = (now - datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)).days
        oldest = max(oldest, age)
        print(f"  {kind:13} {n:6} entries  {age:4}d old   {fname}")
    err = logs / "error.log"
    if err.is_file():
        age = now - datetime.fromtimestamp(err.stat().st_mtime, timezone.utc)
        print(f"\nerror.log:   {err.stat().st_size} bytes, last written {age.days}d {age.seconds // 3600}h ago")
    if not any_dump:
        print("\nNo script_docs dumps yet. Ask the user to generate them before trusting any identifier.")
    elif oldest > 30:
        print(f"\nWARNING: dumps are {oldest} days old. If the game has patched since, they list "
              f"stale identifiers. Regenerate before trusting them.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", help="path to <Crusader Kings III>/game")
    ap.add_argument("--logs", help="path to <Documents>/Paradox Interactive/Crusader Kings III/logs")
    ap.add_argument("--tiger", help="path to the ck3-tiger executable")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("paths", help="resolve the five locations, build, DLC, dump freshness")
    p = sub.add_parser("find", help="look up a script identifier in the script_docs dumps")
    p.add_argument("name", nargs="?")
    p.add_argument("-s", "--search", metavar="TEXT")
    p = sub.add_parser("info", help="list _*.info schema docs, optionally filtered by folder name")
    p.add_argument("folder", nargs="?")

    args = ap.parse_args()
    if args.cmd == "paths":
        return cmd_paths(args)
    if args.cmd == "info":
        game = find_game(args.game)
        if not game:
            sys.exit("Crusader Kings III game folder not found. Pass --game or set CK3_GAME.")
        return cmd_info(args, game)
    logs = find_logs(args.logs)
    if not logs:
        sys.exit("CK3 logs folder not found. Pass --logs or set CK3_LOGS.")
    if not args.name and not args.search:
        sys.exit("give an identifier to look up, or -s <text> to search")
    return cmd_find(args, logs)


if __name__ == "__main__":
    sys.exit(main())
