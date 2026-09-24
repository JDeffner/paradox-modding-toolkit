# pxtk

Standalone commands and local MCP tools for the Paradox Modding Toolkit. Look up game documentation and mod definitions, inspect dependencies, and check saved mod files with the toolkit language server and Tiger. VS Code is optional.

## Install a local build

Requires Node 22.22.2 or newer. From the toolkit repository:

```sh
pnpm install
pnpm --filter @px-lsp/cli run compile
pnpm pxtk --help
pnpm --filter @px-lsp/cli pack --pack-destination .local/artifacts
```

Install the resulting tarball with `pnpm add -g <tarball>` to get the `pxtk` command. The package contains its own compiled LSP, per-game data, and licenses. It does not install the game or Tiger, and it makes no model API calls. This package is prepared locally; the commands above do not publish it.

## Configure a mod

Create `.px-toolkit/pxtk.json` in the mod/project folder:

```json
{
  "game": "ck3",
  "gamePath": null,
  "logsPath": null,
  "tigerPath": null,
  "parents": [],
  "language": "english"
}
```

Set the paths to your game data, generated script documentation and Tiger executable. A game installation root is accepted and normalized to its game folder. Omit gamePath for Steam discovery; null disables discovery. The selected game must be explicit. Profiles currently include ck3, vic3 and eu5; capabilities follow each profile, including whether Tiger is supported.

The nearest `.px-toolkit/pxtk.json` is found by walking upward from the current directory. Relative paths in that file use its project folder. An explicitly selected config outside `.px-toolkit` uses the config's own folder. The mod defaults to that folder. Keep local paths in an ignored config.

Flags override environment variables, which override the config. Supported variables are `PX_GAME_ID` and `PX_<GAME>_GAME_PATH`, `_LOGS_PATH`, `_MOD_PATH`, `_TIGER_PATH`, and `_TIGER_CONFIG`. Repeat `--parent <folder>` in dependency load order, base first. Explicit configuration errors are reported; they do not trigger discovery of another installation.

## Commands

```sh
pxtk status --json
pxtk search add_gold --json
pxtk inspect add_gold --kind effect --json
pxtk impact my_effect --kind scripted_effect --json
pxtk validate --json
pxtk validate --write-baseline .px-toolkit/before-change.json --json
pxtk validate --baseline .px-toolkit/before-change.json --json
```

Use `--limit` (1 to 200, default 20) to bound returned matches or findings. Totals and truncation flags describe each list. `--timeout` bounds each server request and Tiger process. Run `pxtk --help` for all flags.

Status reports actual loaded sources and missing capabilities. Search returns identifiers and definitions. Inspect accepts an exact name and asks for a kind when meanings conflict. Impact describes callers from the editable mod and outgoing dependencies; read-only callers are outside its coverage. Its override list inherits the LSP catalog's 2000-entry cap.

Validation checks the selected mod's supported saved files and runs Tiger against the selected game. It reports structural diagnostics, Tiger findings, and tool failures separately. Baselines preserve occurrence counts while ignoring line movement, so moving code does not make an existing error new. Create a baseline as a JSON file in an existing directory inside the editable mod. An existing file is never replaced. Comparison rejects a different game version, validator, schema, documentation, dependency content, or configuration. A clean static report does not establish in-game behavior.

Exit codes: **0** completed without new errors; **1** new errors, no match, or ambiguity; **2** invalid configuration, unavailable validation, cancellation, or execution failure. Warnings remain in the report and do not set exit 1.

## MCP and skills

Start the local stdio MCP server with:

```sh
pxtk mcp --config <config-file>
```

Only MCP messages go to stdout. Core tools expose the same operations: `pxtk_status`, `pxtk_search`, `pxtk_inspect`, `pxtk_impact`, and `pxtk_validate`. Configure the process working directory as the mod folder or pass an explicit config. Indexed operations start a fresh LSP session and reuse its disk cache. Preparation tools are pxtk_init, pxtk_create, pxtk_loc, pxtk_logs, pxtk_format and pxtk_image; their explicit write mode changes mod files. This trades startup time for reliable saved-file refresh between calls. Requests are serialized.

[plugins/paradox-toolkit](plugins/paradox-toolkit) contains Codex and Claude plugin manifests, the stdio connection configuration, and a portable Agent Skill. Install the CLI on PATH before loading the plugin. Clients supporting plain Agent Skills can load its `skills/paradox-toolkit` directory directly. This toolkit skill complements the separate Paradox AI Modding scripting, GUI and playtest skills.

## Boundaries

Commands read saved files. They cannot see an editor's unsaved buffers. Read queries reject concurrent input changes. Utility writers check their source snapshots before applying edits. Game installations and dependency mods are reference inputs. Normal operations also maintain an LSP cache and temporary validator configuration.

## Prepare mod content

All commands below show a preview until you add --write. A preview contains a previewToken; pass it with --expect to reject an apply request after its inputs or options change. Application recomputes the proposal from current saved files. Files are staged before writing. New files use exclusive creation; updates replace one file atomically. A batch is not a filesystem transaction: a write failure reports which files completed. Save editor buffers before applying disk edits.

~~~sh
pxtk init --game ck3 --mod <existing-mod> --write
pxtk create
pxtk create event mymod.1 --prefix mymod --write
pxtk loc get mymod_1_t --json
pxtk loc set mymod_1_t --value "A new title" --write
pxtk loc check --language german --json
pxtk format events/mymod_events.txt --check
pxtk format events/mymod_events.txt --write
~~~

Init creates .px-toolkit/pxtk.json for an existing mod and never replaces configuration. It saves the game, relative mod root and language; supply installation paths through environment variables or local configuration. Create lists supported kinds from the selected profile. CK3 and Victoria 3 expose their existing scaffold templates; EU5 currently exposes scripted effects and triggers, under its selected stage root. No unverified event template is supplied for EU5. Use --stage only for a stage listed by that game profile.

Create appends to compatible files and rejects duplicate mod definitions, localization keys and mismatched headers. Generated script and localization files have a UTF-8 BOM. Localization set preserves existing comments, versions, line endings and sibling entries. It updates an existing mod entry, places vanilla overrides in localization/replace, and puts new keys with their siblings. Use --file to resolve multiple mod destinations. Check reports the selected language's indexed missing keys and untranslated values; dynamic references can remain unknown. Formatting changes only leading indentation in script and GUI files. It does not format localization.

## Prepare images

~~~sh
pxtk image inspect art/icon.png --json
pxtk image convert art/icon.png --to dds --dds auto --output gfx/interface/icon.dds --write
pxtk image convert art --to dds --output gfx/interface/prepared --write
pxtk image convert art/icon.png --to png --width 128 --height 128 --fit contain --output prepared/icon.png --write
pxtk image convert art/icon.png --to jpeg --background "#ffffff" --output prepared/icon.jpg --write
~~~

Inputs can be DDS, TGA, PNG, JPEG or WebP. Outputs can be DDS, PNG, JPEG or WebP. Folder batches preserve subfolders, report unsupported files and reject output collisions. Destinations must be new files inside the editable mod. Source files remain unchanged.

Resize modes are contain (default, transparent padding), cover (crop to fill), inside (keep the image within the bounds), and fill (stretch). JPEG requires a background when pixels are transparent. DDS auto selects BC3 for transparency and BC1 otherwise; BGRA8 is also available. BC1 rejects transparent pixels. DDS output has one mip level, and existing mipmaps are not copied. Cubemaps, texture arrays, volumes and animated inputs are unsupported. The operation applies EXIF orientation and does not copy image metadata. Inspection reports dimensions, format, alpha channel and mip count.

The CLI uses Sharp for headless common-format decoding, encoding and resizing. Package installation supplies its native runtime; optional platform dependencies must be enabled. The toolkit's DDS and TGA codecs remain shared with the editor. There is no VS Code or external image-editor requirement. Limits are 200 images, 16 megapixels per image, 64 MiB per input file, and 256 MiB of compressed inputs per batch.

## Read playtest errors

~~~sh
pxtk logs checkpoint --output .px-toolkit/before-playtest.json --write
# Reproduce the behavior in the game.
pxtk logs --since .px-toolkit/before-playtest.json --json
~~~

Logs reads error.log from the profile's runtime log folder, which can differ from script_docs. Use --file to select a saved log. Checkpoints record file identity, a complete-line byte offset and a prefix hash. Rotation, truncation or rewriting resets the read and is reported. Incomplete final lines wait until a later read. Records spanning the checkpoint retain preceding context. Duplicate messages are grouped with occurrence counts and source locations; unparsed records remain visible. Checkpoint output files are created exclusively. The command reads at most 32 MiB and does not launch or control the game.

## Focus queries and validation

~~~sh
pxtk inspect <identifier> --kind <kind> --examples --templates --json
pxtk impact <identifier> --kind <kind> --json
pxtk validate events/mymod_events.txt --json
~~~

Inspect's optional lists contain sourced examples and templates measured from documentation, harvested skeletons or indexed definitions. Empty template lists mean no supported template was found. Impact reports exact standard-LSP reference sites separately from callers grouped by definition, plus override candidates, ordering rules and the winner. Dynamic reference forms can be missed.

Supplying files to validate focuses structural checks. Tiger still checks the whole mod, and all its findings remain visible. The scope field states both scopes, and baseline compatibility includes the selected file set. This is not a full structural workspace pass.

Formatting, scaffolding, logs, initialization and image preparation do not start the LSP. Localization and indexed queries use a fresh session and reuse its cache.

Source labels identify generated dumps, bundled snapshots, or wiki data. They do not certify a documentation/game patch match. The toolkit's per-mod `playset.json` adds parents after the configured list, matching the LSP. Launcher playsets are not read. An existing Tiger configuration controls Tiger dependency loading and suppressions; it takes precedence over generated dependency blocks.

The CLI, MCP and JSON result contract is documented in [PROTOCOL.md](../../docs/PROTOCOL.md). Developer checks live in `packages/cli/test`; the real CK3 exercise is `scripts/test-pxtk-real.ts`.
