#!/usr/bin/env python3
"""Query Victoria 3's own documentation instead of guessing at it.

Victoria 3 ships two first-party sources of truth, and both are awkward to read
directly. This resolves them.

  1. `script_docs` console dumps: every effect, trigger, modifier, event target,
     on_action and custom localization key the installed build knows about.
     About 12,800 identifiers spread over six files in FOUR different formats,
     so a plain grep gives wrong or empty answers.
  2. The 91 `*.md` schema docs shipped inside `game/`, which document the legal
     keys of a definition. Their filenames do not follow one rule, so finding
     the doc for a folder is guesswork without an index.

Subcommands:
    find <name>     Is this a real identifier? Which scopes accept it?
    find -s <text>  Substring search over every known identifier.
    folders [name]  Map common/ folders to their schema doc and file counts.
    stats           Entry counts and how stale the dumps are.

Paths are auto-detected. Override with --game / --docs, or the VIC3_GAME and
VIC3_DOCS environment variables.

Regenerate the dumps after a game patch: launch with -debug_mode, then run
`script_docs` and `dump_data_types` in the in-game console.
"""
import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# kind -> (filename, format). The three grammars are described in parse().
SOURCES = {
    "effect": ("effects.log", "md2"),
    "trigger": ("triggers.log", "md2"),
    "event_target": ("event_targets.log", "md3"),
    "modifier": ("modifiers.log", "block"),
    "on_action": ("on_actions.log", "delim"),
    "custom_loc": ("custom_localization.log", "delim"),
}

# modifiers.log embeds icon tokens as a 0x16 control byte ... "!" and uses
# non-breaking spaces, which corrupt the text unless stripped.
ICON_TOKEN = re.compile("\x16[^!]*!")

DOCS_CANDIDATES = [
    "~/Documents/Paradox Interactive/Victoria 3/docs",
    "D:/Documents/Paradox Interactive/Victoria 3/docs",
    "~/.local/share/Paradox Interactive/Victoria 3/docs",
]
GAME_CANDIDATES = [
    "C:/Program Files (x86)/Steam/steamapps/common/Victoria 3/game",
    "D:/SteamLibrary/steamapps/common/Victoria 3/game",
    "F:/SteamLibrary/steamapps/common/Victoria 3/game",
    "~/.local/share/Steam/steamapps/common/Victoria 3/game",
]


def resolve(explicit, env_var, candidates, marker):
    for cand in [explicit, os.environ.get(env_var), *candidates]:
        if not cand:
            continue
        p = Path(cand).expanduser()
        if (p / marker).exists():
            return p
    return None


def clean(line):
    return ICON_TOKEN.sub("", line).replace("\xa0", " ").rstrip()


def parse(path, fmt):
    """Yield (name, [body lines], tier) for one dump file.

    md2/md3  heading line "## name" / "### name", body runs to the next heading
    block    "name:" at column 0, body is the indented lines under it, and
             "--- Section ---" lines split the file into tiers
    delim    records separated by a line of hyphens; the record's first line is
             "name:" and the rest are "Key: value" lines, also at column 0
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = [clean(l) for l in text.splitlines()]

    if fmt == "delim":
        # Delimiter-driven, because entry names inside a record also sit at
        # column 0 and would otherwise be mistaken for record headers.
        for chunk in re.split(r"^-{5,}$", "\n".join(lines), flags=re.M):
            rows = [r for r in chunk.splitlines() if r.strip()]
            if not rows:
                continue
            m = re.match(r"^(\S+):$", rows[0])
            if m:
                yield m.group(1), rows[1:], None
        return

    heads = {"md2": r"^## (\S.*)$", "md3": r"^### (\S.*)$"}
    head = re.compile(heads.get(fmt, r"^(\S+):$"))
    name, body, tier = None, [], None
    for line in lines:
        section = re.match(r"^-{3,} (.+?) -{3,}$", line)
        if section:
            if name:
                yield name, body, tier
            name, body = None, []
            tier = section.group(1)
            continue
        m = head.match(line)
        if m:
            if name:
                yield name, body, tier
            name, body = m.group(1).strip(), []
        elif name is not None:
            if fmt == "block" and line and not line.startswith((" ", "\t")):
                yield name, body, tier
                name, body = None, []
            elif line.strip():
                body.append(line.strip())
    if name:
        yield name, body, tier


def load_dumps(docs):
    index, missing = {}, []
    for kind, (fname, fmt) in SOURCES.items():
        path = docs / fname
        if not path.is_file():
            missing.append(fname)
            continue
        for name, body, tier in parse(path, fmt):
            index.setdefault(name, []).append((kind, body, fname, tier))
    return index, missing


def schema_docs(game):
    """Map each common/ subfolder to the schema doc it ships, if any."""
    common = game / "common"
    out = {}
    for folder in sorted(p for p in common.iterdir() if p.is_dir()):
        # rglob, because two docs sit one level deeper than the folder itself
        # (technology/eras/ and history/military_formations/).
        docs = sorted(folder.rglob("*.md"))
        scripts = sorted(folder.rglob("*.txt"))
        out[folder.name] = (docs, len(scripts))
    return out


def cmd_find(args, docs):
    index, missing = load_dumps(docs)
    if missing:
        print(f"note: missing dumps in {docs}: {', '.join(missing)}", file=sys.stderr)

    if args.search:
        hits = sorted(n for n in index if args.search.lower() in n.lower())
        for n in hits:
            print(f"{n}  [{','.join(sorted({k for k, _, _, _ in index[n]}))}]")
        print(f"\n{len(hits)} match(es)" if hits else f"no identifier matching {args.search!r}")
        return 0

    if args.name in index:
        for kind, body, fname, tier in index[args.name]:
            label = f"{kind}, {tier.lower()}" if tier else kind
            print(f"\n{args.name}  [{label}]  ({fname})")
            for line in body:
                print(f"    {line}")
            if tier and tier.startswith("Potential"):
                print("    WARNING: a potential dynamic modifier. The engine accepts the key\n"
                      "    only if the content it is built from exists, and it carries no display\n"
                      "    name. Prefer a static or dynamic modifier unless you know the referenced\n"
                      "    content is present, or this silently does nothing.")
        return 0

    print(f"NOT FOUND: {args.name!r} is not an effect, trigger, modifier, event "
          f"target, on_action, or custom localization key in this build.\n"
          f"Do not use it. Pick a real one from the suggestions below or search "
          f"with: vic3_docs.py find -s <text>")
    near = sorted(n for n in index if args.name.lower() in n.lower())[:10]
    for n in near:
        print(f"  {n}")
    return 1


def cmd_folders(args, game):
    mapping = schema_docs(game)
    rows = {k: v for k, v in mapping.items() if not args.name or args.name in k}
    if not rows:
        print(f"no common/ folder matching {args.name!r}")
        return 1
    documented = 0
    for folder, (docs, n_txt) in rows.items():
        if docs:
            documented += 1
            names = ", ".join(f"common/{folder}/{d.name}" for d in docs)
            print(f"{folder:42} {n_txt:5} .txt   doc: {names}")
        else:
            print(f"{folder:42} {n_txt:5} .txt   doc: none, read the vanilla files")
    print(f"\n{documented}/{len(rows)} folders ship a schema doc. "
          f"Where there is none, a vanilla .txt in that folder is the reference.")
    return 0


def cmd_stats(args, game, docs):
    print(f"game:  {game if game else 'NOT FOUND'}")
    print(f"docs:  {docs if docs else 'NOT FOUND'}")
    if game:
        settings = game.parent / "launcher" / "launcher-settings.json"
        if settings.is_file():
            m = re.search(r'"rawVersion"\s*:\s*"([^"]+)"', settings.read_text(encoding="utf-8"))
            if m:
                print(f"build: {m.group(1)}")
        n_docs = len(list(game.rglob("*.md")))
        n_dirs = sum(1 for p in (game / "common").iterdir() if p.is_dir())
        print(f"       {n_dirs} common/ subfolders, {n_docs} schema docs")
    if not docs:
        print("\nNo script_docs dumps. Generate them: launch with -debug_mode, "
              "then run `script_docs` and `dump_data_types` in the console.")
        return 1
    index, _ = load_dumps(docs)
    now = datetime.now(timezone.utc)
    print()
    oldest = 0
    for kind, (fname, _fmt) in SOURCES.items():
        path = docs / fname
        if not path.is_file():
            print(f"  {kind:14} MISSING   {fname}")
            continue
        n = sum(1 for e in index.values() for k, _, _, _ in e if k == kind)
        age = (now - datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)).days
        oldest = max(oldest, age)
        print(f"  {kind:14} {n:6} entries   {age:4}d old   {fname}")
    print(f"  {'TOTAL':14} {sum(len(v) for v in index.values()):6} identifiers")
    if oldest > 30:
        print(f"\nWARNING: dumps are {oldest} days old. If the game has patched since, "
              f"they list stale identifiers. Regenerate before trusting them.")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", help="path to <Victoria 3>/game")
    ap.add_argument("--docs", help="path to <Documents>/Paradox Interactive/Victoria 3/docs")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("find", help="look up a script identifier")
    p.add_argument("name", nargs="?")
    p.add_argument("-s", "--search", metavar="TEXT")

    p = sub.add_parser("folders", help="map common/ folders to their schema docs")
    p.add_argument("name", nargs="?", help="filter to folders containing this text")

    sub.add_parser("stats", help="entry counts, build version, dump freshness")

    args = ap.parse_args()
    game = resolve(args.game, "VIC3_GAME", GAME_CANDIDATES, "common")
    docs = resolve(args.docs, "VIC3_DOCS", DOCS_CANDIDATES, "effects.log")

    if args.cmd == "stats":
        return cmd_stats(args, game, docs)
    if args.cmd == "folders":
        if not game:
            sys.exit("Victoria 3 game folder not found. Pass --game or set VIC3_GAME.")
        return cmd_folders(args, game)
    if not docs:
        sys.exit("script_docs dumps not found. Pass --docs, set VIC3_DOCS, or generate "
                 "them in-game: launch with -debug_mode, console `script_docs`.")
    if not args.name and not args.search:
        sys.exit("give an identifier to look up, or -s <text> to search")
    return cmd_find(args, docs)


if __name__ == "__main__":
    sys.exit(main())
