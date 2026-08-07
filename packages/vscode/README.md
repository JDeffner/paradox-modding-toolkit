<div align="center">

<img src="media/banner.png" alt="Paradox Toolkit">

# Paradox Toolkit for VS Code

Mod development for **Crusader Kings III**, **Victoria 3** and **Europa
Universalis V**: a language server with a real Paradox-script parser,
scope-aware completion, instant diagnostics for the silent-failure class of
bugs, deep [tiger](https://github.com/amtep/tiger) integration, a live mod
overview, and a localization workflow no other tool has.

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90-007ACC.svg?logo=visualstudiocode)

</div>

> **Early alpha (0.3.0).** This is a young project and things will change. It is
> already useful day to day, but you will hit rough edges. Feedback is not just
> welcome, it is the point: see [Contributing](#contributing--feedback) below.

## Which games

CK3 is the game this toolkit grew up on and is where every feature exists. The
other two get the same language core, and the table says exactly where they
stop.

| | Crusader Kings III | Victoria 3 | Europa Universalis V |
|---|---|---|---|
| Language support (completion, hover, navigation, references, rename, diagnostics) | full | full | full |
| Folder schema | 156 entries, verified against a live install | 72 entries, verified against a live install | 518 entries, **community-sourced and not yet verified against a live install** |
| Engine vocabulary before you dump `script_docs` | bundled wiki fallback | none | none |
| Deep validation | ck3-tiger, auto-download | vic3-tiger, auto-download | none exists yet |
| Sidebar views, event graph, event simulator, mod report, coverage | yes | yes | yes |
| `.gui` language support and Widget Tree | yes | yes | yes |
| `.gui` pixel-accurate layout preview | yes | no (calibrated against CK3 only) | no |
| `.gui` visual editor (drag, resize, inspector writes) | yes | no (same calibration) | no |
| Bundled tutorial and AI modding skill | yes | no (CK3 content) | no (CK3 content) |

**Existing CK3 users need to change nothing.** `px.gameId` defaults to `auto`
and the detection ladder ends in CK3: a mod folder with a `descriptor.mod` is
CK3, a folder with `.metadata/` plus `in_game/`-style stage folders is EU5,
`.metadata/` alone is Victoria 3, and anything else stays CK3. Set `px.gameId`
explicitly if that ever guesses wrong.

**First run on Vic3 or EU5:** dump your own game data before judging the
completion. Launch with `-debug_mode`, run `script_docs` in the console, then
run **Reload Game Data (script_docs)** from the command palette. Only CK3
ships bundled wiki tables to fall back on, so for the other two this is the
step that fills in effects, triggers, event targets and modifiers. **Run Setup
& Health Check** puts it at the top of the report when it is missing.

**EU5 honesty note:** the EU5 folder-to-definition table is imported from the
community [cwtools-eu5-config](https://github.com/kaiser-chris/cwtools-eu5-config)
rules (MIT, pinned commit) and has not been checked against a live install. The
damage a wrong entry can do is bounded on purpose: a minimal hand-verified set
of reference fields and **zero** required-localization patterns, so a mistake
costs you navigation, never a false error squiggle. Gaps are fixable without
waiting for a release through the `<mod>/.eu5modding/schema.json` overlay, and
reports are very welcome.

## Highlights

- **Scope-aware completion**: key positions offer verbs (triggers/effects),
  value positions offer nouns (traits, events, on_actions, loc keys), and
  `scope:`, `culture:`, `title:` prefixes complete their referents. Items valid
  in the current scope rank first; others are annotated, never hidden.
- **Hover docs with texture previews**: merged `script_docs` and (on CK3) wiki
  docs, the live scope chain at the cursor, resolved loc text, and inline
  `.dds` image previews from a pure-TS DDS decoder.
- **Structural diagnostics** for the bugs the game swallows silently: unbalanced
  braces, missing UTF-8 BOM, loc header/filename mismatches, folder traps
  (`localisation/`, plural `on_actions`), references to events that do not exist.
- **Deep tiger integration**: auto-download of ck3-tiger or vic3-tiger, run on
  save or manually, JSON reports as native Problems, and a baseline workflow to
  adopt tiger on a legacy mod (suppress today's reports, see only new ones).
  EU5 has no tiger build, so the toolkit says so instead of pretending.
- **Sidebar**: mod overview, localization coverage, overrides and conflicts
  (with the LIOS/FIOS winner), an interactive event graph with a node inspector,
  and a GUI widget tree.
- **Event simulator** (**Simulate Event**): a static walkthrough of what happens
  when an event fires (trigger, immediate, each option with its localized text,
  after) where every onward `trigger_event` is a step-into link, so you can
  walk a whole chain with a breadcrumb and a Back button. It reads each game's
  own event vocabulary, so a Victoria 3 event shows its `flavor` line and its
  `cancellation_trigger` in place.
- **DDS and images**: zoomable `.dds` preview, a PNG/JPEG/WebP to DDS converter
  in the explorer right-click menu, and **Show Image Guidelines** with the
  sizes vanilla actually uses.
- **Localization workflow**: inline loc as inlay hints, BOM-correct quick-fix
  editing, a coverage view, and scaffolds for whole translation mods.
- **Content scaffolds**: **New Content** generates events, decisions,
  interactions and on_action hooks that are correct by construction.
- **Live debugging**: the launch-in-debug-mode command plus a **Toggle
  error.log Watcher** that surfaces in-game script errors as editor squiggles.
- **GUI and data types** in `.gui` files: completion, hover, widget tree, and
  `[Character.GetFather...]` data-type chains that resolve through return types.
  The pixel-accurate layout preview is CK3-only, since its layout engine was
  calibrated against CK3 in-game screenshots.
- **GUI editor** (**Open GUI Editor**): the same measured layout, but you can
  work in it. Click to select the widget you meant, read its properties with the
  template or type each one came from, drag and resize on the canvas, and edit a
  property row. Every change is one surgical edit to your file (comments, tabs
  and single-line bodies survive), and one Ctrl+Z. When the engine would ignore
  what a gesture asks for, the editor says so before the widget moves instead of
  writing a line the game drops.
- **Multi-mod workspaces**: every workspace mod is a first-class mod, indexed
  together, with per-mod tiger baselines and no "primary mod" to configure.
- **Bundled 10-chapter CK3 tutorial** (**Open Tutorial**) with every
  snippet verified against the game files.
- **A [Claude/agent skill for CK3 modding](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Claude-Skill)**
  ships in `skills/ck3-modding/` for AI-assisted modding.

## Quick start

1. Install the extension, open your mod folder, and run **Run Setup & Health
   Check**. It detects the game, finds the install via Steam, checks the
   dump folder, and offers to download tiger where one exists. The walkthrough
   covers the rest.
2. *(Recommended on CK3, essential on Vic3 and EU5)* Launch the game with
   `-debug_mode`, open the console (\`), run `script_docs`, then run **Reload
   Game Data (script_docs)**. On CK3 this upgrades the token data from
   the bundled wiki lists to your exact game version; on the other two it is
   where the engine vocabulary comes from in the first place. EU5 writes its
   dumps to `Documents/Paradox Interactive/Europa Universalis V/docs`, not to
   `logs/`.

The default configuration is nothing: open your mod folder(s), run Setup once,
and everything else is optional. `px.gamePath`, `px.logsPath` and
`px.tigerPath` describe whichever game is active and are honored whenever you
set them; leave them empty and each game is detected on its own. Full
walkthrough and every setting are in the wiki:
**[Getting Started](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Getting-Started)**
and **[Configuration](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Configuration)**.

## Documentation

The full docs live in the
[wiki](https://github.com/JDeffner/ck3-modding-toolkit/wiki):

- [Home](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Home)
- [Getting Started](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Getting-Started)
- [Editor Features](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Editor-Features)
- [Sidebar Views](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Sidebar-Views)
- [DDS and Images](https://github.com/JDeffner/ck3-modding-toolkit/wiki/DDS-and-Images)
- [Configuration](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Configuration)
- [Multi-Mod and Translation](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Multi-Mod-and-Translation)
- [Claude Skill](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Claude-Skill)
- [Credits](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Credits)

Working in a workspace with a total conversion or a dozen mods?
[`docs/PERFORMANCE.md`](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/docs/PERFORMANCE.md)
has the measured costs and the settings that shrink them.

## Outside VS Code

The language server runs standalone over `--stdio` from any LSP client
(neovim, Zed, Helix, ...). Grab `px-lsp-server-<version>.tar.gz` from the
[releases](https://github.com/JDeffner/ck3-modding-toolkit/releases), or
`px-lsp-win-x64-<version>.zip` if you want one download that already contains
Node and a `px-lsp.cmd` launcher; setup,
the per-language capability table and the per-game matrix are in
[`packages/server/README.md`](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/packages/server/README.md).

## Contributing & feedback

This is an alpha shaped by the people who use it. The best thing you can do is
tell me what breaks and what is missing:

- **File an [issue](https://github.com/JDeffner/ck3-modding-toolkit/issues)** for
  bugs, false diagnostics, or feature ideas. Concrete examples from real mods
  are gold. Wrong or missing folder mappings, especially for EU5, have their
  own "Schema gap" issue form.
- **PRs are welcome.** The per-game schema tables
  (`packages/server/src/games/<game>/schema.ts`) are deliberately small and
  community-editable: adding a folder kind or loc requirement is a good first
  contribution.
- **Fork it and take inspiration.** If a piece of this is useful in your own
  tooling, use it. It is GPL-3.0-or-later, so keep distributed derivatives open.

### Dev quickstart

```
pnpm install
pnpm run compile      # esbuild bundles dist/extension.js (client) + dist/server.js
pnpm run typecheck
pnpm test             # vitest; copy dev-paths.example.json to dev-paths.json to also run the vanilla corpus suites
```

Layout (pnpm monorepo): `packages/vscode/` (this extension) ·
`packages/server/` (language server: parser, index, scopes, features, per-game
profiles, bundled data) · `packages/protocol/` (types, wire protocol, shared
helpers) · `packages/*/test/` (vitest suites incl. corpus/fixture tests). The extension is a
client/server LSP split: the thin client runs in the extension host, all parsing
and analysis lives in a separate server process. Everything game-specific sits
behind one `GameProfile` boundary that CI enforces. Design rationale and the
full plans are in [`docs/rework-plan.md`](docs/rework-plan.md),
[`docs/PLAN.md`](docs/PLAN.md) and
[`docs/PLAN-multigame.md`](docs/PLAN-multigame.md).

## Acknowledgements

The extension stands on work by others. The key sources and inspirations:

- [tiger](https://github.com/amtep/tiger) by amtep, the validator behind the
  ck3-tiger and vic3-tiger diagnostics integration.
- [cwtools](https://github.com/cwtools/cwtools) and cwtools-vscode, for the
  landscape and design inspiration.
- [kaiser-chris/cwtools-eu5-config](https://github.com/kaiser-chris/cwtools-eu5-config),
  the source of the EU5 folder schema (MIT, pinned commit; the Victoria 3
  equivalent was used as a cross-check only). Full notices in
  [THIRD-PARTY-NOTICES.md](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/THIRD-PARTY-NOTICES.md).
- [jesec/ck3-modding-wiki](https://github.com/jesec/ck3-modding-wiki), the source
  of the bundled CK3 fallback token lists (CC BY-SA 3.0, see
  [ATTRIBUTION.md](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/packages/server/data/ck3/wikidocs/ATTRIBUTION.md)).
- Paradox's own in-game `_*.info` format docs, the primary ground truth for the
  CK3 schema layers. No game assets are redistributed.

The complete table with licenses is on the
[Credits wiki page](https://github.com/JDeffner/ck3-modding-toolkit/wiki/Credits).

## License

GPL-3.0-or-later. In short: use, modify and redistribute freely, but any
distributed fork or derivative must publish its source under the GPL too. See
[LICENSE](LICENSE). Bundled third-party data keeps its own terms (the CK3 wiki
token lists are CC BY-SA, see [ATTRIBUTION.md](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/packages/server/data/ck3/wikidocs/ATTRIBUTION.md);
the EU5 schema import is MIT, see [THIRD-PARTY-NOTICES.md](https://github.com/JDeffner/ck3-modding-toolkit/blob/main/THIRD-PARTY-NOTICES.md)).
