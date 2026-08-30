# Paradox Modding Toolkit 0.4.0 (beta, pre-release)

Until now the toolkit helped you write a mod and then left you alone for the
annoying part: getting it onto the Steam Workshop and keeping the listing in
shape. 0.4.0 is the release where that part moves into the editor too. It
ships as a pre-release because the upload path is young; the file-editing
side is the same toolkit as before.

### Publish without the launcher

**Upload straight through your running Steam client.** The toolkit talks to
the same Steam UGC API the Paradox launcher uses, so there is no launcher
step, no web form, and no password typed anywhere: your logged-in Steam
session authorizes the upload, and a progress bar shows what Steam is doing.
New items are created **private**, and the Workshop id is written back where
the game's tooling expects it (`remote_file_id` in `descriptor.mod` for CK3,
`workshop.json` for the newer games), so the launcher and any build scripts
agree with the toolkit about which item is yours. Mods first published
through the launcher can be linked instead: pick the item from your published
list and the next upload updates it.

Every upload passes one confirmation dialog first. It re-offers the three
parts (mod files, details, translations), shows the changenote and visibility
that ride along, and says plainly that a Workshop update reaches subscribers
in minutes and has no rollback. Unchecking "mod files" and shipping only a
description fix is one click, and gigabytes stay home.

### The Workshop panel

`Paradox: Open Steam Workshop Panel` puts the whole listing on one page,
side by side with what Steam currently serves:

- **Description** in Steam's BBCode, with an Edit | Preview toggle that
  renders it the way the Workshop page will.
- **Visibility** including *unlisted*, which the Workshop's own manifest
  tooling cannot set without risking a flip to public.
- **Title, mod version, supported game version and tags** edit in place and
  write straight into the descriptor. Lowering a version asks first, because
  that is usually a typo.
- **Translations** of the title and description per Steam language, with the
  mod's own localization folders suggested first. Each language uploads as
  its own Steam submit with no changenote, so the item's Change Notes tab
  shows one entry per update, not one per language. Under each draft the
  panel shows what Steam currently serves in that language.
- **Statistics**: subscribers, favorites, page visits, votes, comments.

One honest limit: *uploading* translations is gated until a steamworks.js
build ships with per-language updates. The current binding can read
translated text but not write it, and writing through it would overwrite
your default-language description. The panel says exactly this; drafts save
locally and upload the moment a capable build is bundled.

### Your listing is files now

The panel can store the whole listing in a `workshop` folder next to the
mod's content folder: `description.bbcode`, a `title.txt` +
`description.bbcode` pair per translated language, and `item.json`. That
means the listing lives in git, diffs like code, and survives whatever
happens in a web form. A toolbar button downloads the live listing from
Steam into those files in one query, translated languages included, and from
then on the folder is the source of truth. `px.workshop.dir` moves it if
your layout differs.

Changenotes come from the same place. Keep a `changelog` folder with one
file per version (`1.2.md`, `v1.2.bbcode`) or point `px.workshop.changelog`
at one big changelog file, and the panel picks the entry matching the
descriptor's version, converting Markdown to BBCode on the way. A dropdown
under the changenote box shows where the text came from and switches between
changelog, last git commit, and manual.

### BBCode is a language

`.bbcode` files get syntax highlighting, tag completion (type `[` and pick),
a blue **BB** file icon, and a live preview that works like Markdown's:
Ctrl+Shift+V renders in place, Ctrl+K V opens it to the side, and the
preview follows your edits as you type.

### A place to say what broke

The Project panel now ends with a quiet **Join the Discord** link
([discord.gg/ESstwqycug](https://discord.gg/ESstwqycug)). Release notes land
there, and a screenshot of something misbehaving is worth more than most bug
reports.

### Also in this line since 0.3.3

The 0.3.4 pre-release carried the large-workspace round, folded into 0.4.0
for everyone who skipped it: a big workspace opens in half the time and
holds 229 MB less, the typing-and-saving stall went from 4.2 s to 0.6 s,
`Paradox: Reduce VS Code Indexing Load` keeps VS Code itself from indexing
the game, and excluded mods can stay as read-only context. Hovers got real
kind icons, definition bodies, and a detail setting. For embedders,
`@px-lsp/server` 0.3.0 adds a browser entry: completion, hover and
diagnostics against a single document with no Node process at all.

### Full changelog

[CHANGELOG.md](https://github.com/JDeffner/paradox-modding-toolkit/blob/main/packages/vscode/CHANGELOG.md).

Beta means young, not unusable, and pre-release means the Workshop path
wants field reports before it faces everyone. Tell me what breaks:
[issues](https://github.com/JDeffner/paradox-modding-toolkit/issues) or the
Discord above.
