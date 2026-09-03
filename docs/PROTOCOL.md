# px-lsp wire protocol

The contract between the px-lsp language server (`@px-lsp/server`)
and any client — the bundled VSCode extension, neovim, or an embedding
application spawning `px-lsp --stdio`. TypeScript clients should import
the method constants and payload types from `@px-lsp/protocol/protocol`
(the single source of truth); this document mirrors that file for
non-TypeScript consumers.

Wiring the server into an application rather than an editor? `EMBEDDING.md`
next to this file is the guide for that: the process contract, the
initialization options worth sending, URI and document-sync conventions, and
the in-tree reference clients. This document stays the per-method reference.

**Versioning**: the protocol is versioned with `@px-lsp/protocol` (its own
version, independent of the extension since extension 0.3.3; first npm
release 0.1.0). Treat any change here as an API change: additions are
backward-compatible, renames/removals are called out in the package's
`CHANGELOG.md`. Current as of `@px-lsp/protocol` 0.2.0, which carries the
full contract below including `serverInfo` in the `initialize` result, the
`client` capability object superseding `clientCommands`, `client.fileLinks`,
`paradox/scopeAt`, the `paradox/exampleWiki` pair, and `dataDir`
(`paradox/*` has been the method prefix since extension 0.1.2).

## Transport and lifecycle

- Transports: `--stdio` (what external clients use; also the default when no
  transport argument is given and the process was not forked over IPC)
  and node-ipc (VSCode). `--socket=<port>` and `--pipe=<name>` are accepted by
  the underlying library, but nothing ships using them. Standard JSON-RPC 2.0
  LSP framing. The process-level contract around this (the `processId` orphan
  watchdog, the clean-stdout guarantee, the shutdown/exit sequence) is in
  `EMBEDDING.md`.
- Standard LSP: the server implements completion (+resolve), signatureHelp,
  hover, definition, references, rename (+prepare), documentSymbol,
  workspaceSymbol, codeAction, inlayHint, foldingRange, documentFormatting,
  documentColor + colorPresentation, semanticTokens (full), publishDiagnostics, and workDoneProgress for the
  vanilla scan.
- Document sync: `Incremental`, with `openClose` and `save`. A `didChange`
  content change carrying no `range` (a full-document replacement) is accepted
  too, and is the simpler choice for a non-editor client. `version` must
  increase on every change: the per-document parse cache is keyed by uri +
  version, so a reused version serves the previous parse.
- Language ids: `paradox` (script `.txt`), `paradox-loc` (localization
  `.yml`), `paradox-gui` (`.gui`). The client decides which files get which
  id; the server keys per-request behavior off it.

## Initialization

The `initialize` result carries standard LSP `serverInfo`:
`{ name: "px-lsp", version }`, where `version` is the `@px-lsp/server`
package version. Clients can use it for compatibility checks.

`initializationOptions` (all fields optional; the server has fail-soft
fallbacks for bare clients):

```ts
interface ParadoxInitOptions {
  storageDir?: string;   // server-side cache dir; default: <os tmp>/px-lsp
  dataDir?: string;      // root of the bundled per-game data: <dataDir>/<gameId>/{wikidocs/,freqs.json}
                         // default: data/ next to dist/server.js
  wikidocsDir?: string;  // DEPRECATED narrow override for the wikidocs folder alone, see below
  client?: ParadoxClientCapabilities; // what this client implements; absent = plain LSP client
  clientCommands?: boolean;           // DEPRECATED alias, see below
  settings?: ParadoxSettings;
}

interface ParadoxClientCapabilities {
  hoverHtml?: boolean;      // client renders the sanitized <span style="color:var(--vscode-*)"> hover markup
  commands?: string[];      // the px.* command ids this client registers (see "Client command ids")
  ownFileWatcher?: boolean; // client watches the mod tree itself and pushes paradox/modFileChanged
  fileLinks?: boolean;      // client's hover renderer navigates file: links (since @px-lsp/protocol 0.1.1)
  hoverIcons?: boolean;     // client sets supportThemeIcons, so hover badges may use $(codicon) glyphs
}

interface ParadoxSettings {
  gameId?: string;             // game profile: "ck3" | "vic3" | "eu5"; unknown/absent -> default game ("ck3")
  gamePath: string | null;     // the game's data folder ("<install>/game")
  logsPath: string | null;     // folder with script_docs logs
  modPath: string | null;      // default: first workspace folder
  parentPaths: string[];       // dependency mods, load order, base first
  workspaceMods?: string[];    // mods being EDITED (reference indexing + diagnostics)
  locLanguage: string;         // "english", ...
  scopeInlayHints: boolean;
  hoverDetail?: "compact" | "standard" | "full"; // how much a hover shows; default "standard"
  calendar?: CalendarSetting;  // custom era calendar for date display (inlay hints + hover); absent = off
                               //   { epoch: number; after: string; before?: string;
                               //     months?: { name: string; days: number }[] }
                               //   script year >= epoch displays as (year-epoch+1) <after>,
                               //   year < epoch as (epoch-year) <before>; sanitized on intake
  diagnosticsIgnore: string[];         // diagnostic codes to suppress
  diagnosticsIgnorePatterns: string[]; // workspace-relative globs to suppress
  diagnosticsVanilla: boolean;         // false (default) = never diagnose game files
}
```

Every capability in `client` is independent and defaults to **off**, so a
client declares exactly what it implements and the server tailors its output
per capability (see "Degraded modes"). A client can take the hover markup
without registering any command, or register one command and not the others.

One capability an embedder should declare is NOT in `client`, because LSP
already has it: `${1:…}` completion snippets are gated on the standard
`capabilities.textDocument.completion.completionItem.snippetSupport` of the
`initialize` params. Without it every completion insert is plain text (see
"Degraded modes").

`clientCommands: true` is a **deprecated** alias kept for older clients: it
resolves to `{ hoverHtml: true, commands: <every id below>, ownFileWatcher:
true, fileLinks: true }` plus snippet support, which is what the VSCode
extension used to declare. `false` or absent resolves to all-off. It is
ignored when `client` is present. New clients should send `client`.

One server instance serves one game at a time, and choosing it is the client's
job: there is no server-side auto-detection. The VSCode extension detects it
per workspace (descriptor shape, else configuration); any other client sends
what it knows. It travels as `settings.gameId` at initialize and in
`paradox/configChanged`; changing it triggers a full reload.

Bundled data is per-game: everything the server loads from disk lives under
`<root>/<gameId>/`, where the root is `dataDir` when the client sends one and
otherwise `data/` next to `dist/server.js`. `wikidocs/` and `freqs.json` are
resolved independently under that folder, and the root is re-resolved against
the new `gameId` when the game changes. Only `ck3` ships a `wikidocs/` bundle
today, so `vic3` and `eu5` report `tokens: 0` in `paradox/status` and never
render wiki-token hovers — a missing `<gameId>/` folder is a supported state,
not an error.

`wikidocsDir` is a **deprecated** narrow override kept for older clients: it
replaces the `wikidocs/` folder alone, leaves `freqs.json` on the `dataDir`/
bundle root, and, being one fixed folder, does not follow a `gameId` change.
Clients that ship the data apart from the server bundle should send `dataDir`
instead.

## Custom methods: client → server

| Method | Kind | Params → Result |
|---|---|---|
| `paradox/configChanged` | notification | `ParadoxSettings` |
| `paradox/modFileChanged` | notification | `{ fsPath: string }` — a mod file changed on disk (client-side watcher); triggers a single-file re-index |
| `paradox/reloadDocs` | request | `{ force: boolean }` → `{ tokens: number }` — re-parse script_docs logs |
| `paradox/indexStats` | request | `null` → `IndexStats` (definition counts by kind/source) |
| `paradox/lookupLoc` | request | `{ key: string }` → `LocEntryInfo[]` — localization entries for a key, mod first |
| `paradox/modOverview` | request | `ModScopedParams` → `ModOverview` — content inventory by kind |
| `paradox/locCoverage` | request | `ModScopedParams` → `LocCoverage[]` — per-language missing/orphaned/untranslated keys |
| `paradox/overrides` | request | `ModScopedParams` → `OverrideInfo[]` — mod definitions shadowing vanilla/parents, with LIOS/FIOS winner |
| `paradox/eventDetail` | request | `{ id: string }` → `EventDetail \| null` — full event structure for an inspector UI |
| `paradox/eventGraph` | request | `EventGraphParams` → `EventGraph` — event/on_action reference graph, plus the `suggestions` catalog a query box completes against |
| `paradox/eventVocabulary` | request | `EventVocabularyParams` → `EventVocabularyResult` — the keys, value sets, effect and trigger tokens an event editor may offer, each with its own documentation |
| `paradox/eventValueOptions` | request | `EventValueOptionsParams` → `EventValueOptionsResult \| null` — the value set one VALUE belongs to, resolved through the definition index (`secret_cultivator` is a `secret`, so the answer is every indexed secret, mod entries first); null when the value resolves to nothing enumerable |
| `paradox/eventBanner` | request | `{ theme }` → `EventBannerResult` — the illustration an event theme puts behind its window, as a mod-relative texture path, or a `reason` when it resolves to nothing |
| `paradox/dynastyTree` | request | `DynastyTreeParams` → `DynastyTreeResult` — without `dynasty`, every dynasty the index knows as a picker list (mod entries first, each with its member and house counts); with `dynasty`, that dynasty's houses and members read out of `history/characters`, plus the parents and spouses they name from other dynasties, marked `external` |
| `paradox/exampleWiki` | request | `null` → `ExampleWikiIndex` — one compact row (`name`, `kind`, `shortDoc`, `count`) per trigger, effect, event target, modifier, datafunction, data type, keyword, scope word, and indexed variable or list the server knows, most used first, plus the sentences naming where the rows came from |
| `paradox/exampleWikiEntry` | request | `ExampleWikiEntryParams` → `ExampleWikiDetail \| null` — everything known about one row: documentation, scopes, the `usage:` block, datafunction signature, observed literal arguments, members and producers, a variable's `valueType` and `containers`, the triggers, effects and targets usable from each scope the token outputs (`fromScope`), and example sites as absolute paths with inline context; null when the name is not in the catalog |
| `paradox/dependencies` | request | `DependenciesParams` → `DependenciesResult` — dependents/dependencies of a definition (by cursor or name), plus the `.gui` paths reaching it when `guiUses` is set |
| `paradox/scopeAt` | request | `ScopeAtParams` → `ScopeAtResult \| null` — inferred scope chain (outermost first) and visible saved scopes at a position; null when the document is not an open script document |
| `paradox/guiTree` | request | `{ uri, text }` → `GuiTree` — widget tree of a .gui document |
| `paradox/guiLayout` | request | `{ uri, text, visibility?, loc?, previewValues? }` → `GuiLayoutResult` — measured layout rectangles for a .gui document, with stage timings, the conditional-visibility checks it met, and each textbox's text resolved through the loc index unless `loc: "raw"` |
| `paradox/guiWidgetInfo` | request | `GuiWidgetInfoParams` → `GuiWidgetInfo \| null` — one widget's effective properties with the template/type each came from, its textures, and (on request) why its rect is where it is |
| `paradox/guiDependencies` | request | `GuiDependenciesParams` → `GuiDependenciesResult` — the scripted_guis and loc keys a .gui document (or one widget in it) reaches |
| `paradox/guiPreview` | request | `{ uri, text, entries: [{ name, kind: builtin\|type\|template\|raw, fragment? }] }` → `GuiPreviewResult` — one laid-out instance per palette entry for a library tile (the document's own declarations kept, the store shared with guiLayout); `node: null` + `reason` when nothing stands up; at most `GUI_PREVIEW_MAX` (48) entries per request |
| `paradox/guiSaveValues` | request | `{ path }` → `GuiSaveValuesResult` — preview values read out of a save game: `values` keyed by datafunction chain without brackets (the shape `guiLayout`'s `previewValues` takes), plus the `source` save's name, date and game. A chain the save has no field for is absent; an ironman or binary save comes back with `error` and no values. Victoria 3 (the played country, its ruler and heir) and Crusader Kings III (the played character's name, titles, currencies, age, house and character variables) both have an entity mapping; any other game answers the meta-only rows. A save whose script is zip-packed, which is what CK3 writes unless the game runs with `-debug_mode`, is unpacked while streaming |
| `paradox/guiVocabulary` | request | `{ uri, text }` → `GuiVocabularyResult` — the widget names a designer palette may offer, plus the property names an inspector may offer per widget type: the bundled per-game harvest plus this document's own templates and types |
| `paradox/guiSourceEdit` | request | `GuiSourceEditParams` → `GuiSourceEditResult \| null` — source edits for a designer gesture (one `op`, or a batch of `ops` answered as one edit set with a verdict each), or a refusal with a reason |
| `paradox/guiWidgetEdit` | request | `GuiWidgetEditParams` → `GuiWidgetEditResult \| null` — DEPRECATED, the position/size half of `guiSourceEdit` |

`ModScopedParams` is `{ modRoot?: string | null }`: restrict a mod-scoped
request to one workspace mod (absolute root path); absent = all workspace
mods.

`paradox/scopeAt` reports scopes as string ARRAYS, never a single name: a link
or iterator with several documented outputs stays ambiguous, and an empty
array means unknown. That is the honest answer, not an error — the server
annotates and ranks, it never hides or diagnoses on scope grounds. Render
several as `a|b` and none as "unknown".

`paradox/dynastyTree` is one method with two answers, because a family tree
needs the whole picker before it needs one family. Both come from the game's own
files: the folders are the ones the active profile's schema maps to the
`dynasty`, `dynasty_house` and `character` kinds, the members come from the
character blocks (`name`, `female`, `dynasty` or `dynasty_house`, `father`,
`mother`, `culture`, `religion`, `trait`, and the dated blocks whose KEY is the
date of the `birth`, `death` or `add_spouse` inside them), and the display names
come from the loc index, falling back to the loc key itself rather than
inventing one. A character reaches its dynasty through its house when it names
one. `nextCharacterId` and `nextDynastyId` are the largest numeric id seen
across game and mods plus one, so a client can offer a free id without
searching. A profile whose schema has no `dynasty` kind answers
`supported: false` with empty lists, which a client says out loud instead of
drawing an empty tree.

Answering costs one full read of the character corpus, because the link points
from a character to its dynasty and never back. The server does that read once
per index revision: measured on a vanilla CK3 install (71 142 characters in
17.4 MB), 0.8 s for the first request, 12 ms for the next, and 1 ms for one
dynasty; the list of 10 338 dynasties is a 2.7 MB answer.

The Examples Wiki is two requests because the shapes differ by orders of
magnitude. `paradox/exampleWiki` answers the whole catalog as thousands of tiny
rows, so a client filters and ranks locally instead of asking again per
keystroke; `paradox/exampleWikiEntry` answers ONE row with its prose, its usage
block and its example sites. Nothing in either answer is hand written: the rows
come from the user's `script_docs` dump (or the bundled snapshot / wiki tables
behind it), the datafunction tables (`DumpDataTypes` output or the bundled
tables), the vanilla usage harvest, and the definition and reference indexes,
and each answer says which of those it came from in its `provenance` /
`sources` text. Example sites are searched in the game files when the entry is
asked for, and come back as absolute paths with 1-based lines, so a client
opens them without resolving anything. Every capped list carries its own total
(`literalsTotal`, `membersTotal`, `producersTotal`, `containersTotal`), and an
example list that is short for a reason carries `examplesNote` saying why.

An engine token whose scopes declare one or more `output: <scope>` entries
(event targets, mostly) also carries `fromScope`, one `ExampleWikiFromScope`
per produced scope: `scope` (the produced scope word), plus `triggers`,
`effects` and `targets` with a `triggersTotal` / `effectsTotal` /
`targetsTotal` beside each. The lists answer "what can I write once I am
here": every trigger and effect whose own declared scopes contain that word,
and every event target that declares it as an `input:`. They are ordered by
vanilla usage count, most used first, and capped at 2000 names each with the
true count in the total. The matching is word for word against the game's own
docs, so a token that declares no scopes is simply absent from every list and
nothing is inferred from a scope model. The field is optional and absent when
the token produces no scope, so a client that ignores it is unaffected.

The two grammar `ExampleWikiKind`s (`keyword`, `scope_word`, exported as
`exampleWikiVocabularyKinds`) are the script glue the game documents nowhere:
`limit`, `NOT`, `base`, `days` and the scope words `root`, `this`, `prev`,
`from` (chained forms included). They are the one part of the catalog whose
prose is the toolkit's own rather than a dump's, they read the SAME table the
hover card reads so the two cannot disagree, and every such article says so in
its `provenance`. Their example sites are searched in the game files like an
engine token's. A logic word has ONE article under its uppercase spelling, so
`not` and `NOT` both resolve to `NOT`.

The seven variable `ExampleWikiKind`s (`variable`, `local_variable`,
`global_variable`, `variable_list`, `local_variable_list`,
`global_variable_list`, `list`, exported as `exampleWikiVariableKinds`) are the
rows that come from the indexed script rather than from the engine: names the
user's own files created with `set_variable`, `add_to_variable_list`,
`add_to_list` and their relatives. Their articles carry `valueType` (what the
set sites resolve to, or the word "unknown" — a value set from a runtime scope
is not guessed at), `containers` (the top-level definitions the set sites sit
in) and example sites `label`ed `set` or `read`. The rows follow the index, so
they change with a save.

Every example site may carry `context`, the lines around it as written and
dedented, with `contextStart` giving the 1-based line number of `context[0]`;
`line` stays the site's own line, so a client can pick it out of the block.
Both fields are optional and absent when the file could not be read, so a
client that ignores them still has `text`.

`paradox/eventGraph` answers `suggestions` alongside the graph: the mod-side
`ids` (event / on_action / decision, sorted, capped at 2000) and the
`namespaces` those ids imply. It is the VOCABULARY, not the selection — the
same list whatever `root` or `namespace` the request asked for — so a client
completes a query box from the answer it already has instead of asking again.
`modRoot` scopes it like the graph. The field is optional: a server that
predates it simply omits it.

`paradox/eventGraph` reports a namespace (or the whole mod) as its
DEFINITIONS, not as the endpoints of the edges between them, and then applies
`connectedOnly` (on unless the request says `false`): definitions with no edge
are dropped before their cards are read, `root` always stays, and a graph that
lost every node says so in `emptyReason`. A client that wants the event the
author just wrote, edges or not, sends `connectedOnly: false`. Edges that pass through a
scripted effect are followed transitively (visited-guarded, three hops) and
answered as a direct `from` -> `to` edge whose `label` reads
`via effect_a -> effect_b`, so an event whose `trigger_event` sits inside a
scripted effect is not reported as firing nothing.

An `EventGraphNode` also carries what a card says about itself without a second
request: `options` (its `option` blocks) and `triggerSummary` (the first keys of
its `trigger` block) for this mod's own definitions, read from the file the
answer already parses, and `fires` (how many nodes of this graph it fires),
counted from the edges; all three are optional and absent where unknown.

`paradox/eventVocabulary` is what an event editor is allowed to offer. Every
list in it is derived, never hand-written: `eventKeys` / `optionKeys` from the
active profile's structure table ordered by its usage counts, `values` from a
key's declared `enum:` spec or from the schema's reference field resolved
through the definition index (`theme` gives every indexed event_theme, this
mod's entries first), `effects` / `triggers` from the parsed script_docs (or
the bundled wiki fallback) with the log's own description, and `savedScopes`
from the mod's own `save_scope_as` sites. Docs are capped to one line for a
menu row. A key whose value is free text is simply absent from `values`; that
is the signal to render an input instead of a dropdown. `modRoot` scopes the
definition-backed sets like the graph.

`paradox/eventDetail` carries an event's blocks twice over: `keys` /
`effectKeys` summarize them for an inspector, and `lines` / `totalLines` /
`targets` render them for a walkthrough. `lines` is the block flattened back
into pseudo-script (`{ depth, text, line }` per statement) capped at 60 lines,
with `totalLines` giving the real count so a UI states what it hid instead of
truncating silently. An option's `lines` drop `name` / `trigger` / `ai_chance`
/ `ai_value`: those gate or label the option, they are not its effect.

Blocks and keys that only one game has are carried by the same shapes rather
than a per-game payload, since the names do not collide: `sections` may hold a
`cancellation_trigger` alongside `trigger` / `immediate` / `after` /
`on_trigger_fail`, and `flavor` is the event's third displayed string where
the game has one (absent otherwise). An option's `effectKeys` summary drops
that game's option markers (`default_option`, `highlighted_option`) the same
way it drops `custom_tooltip`; `lines` still renders them.

`fields` (on the detail and on each option) is the scalar `key = value`
statements written directly in that block, each with its line, so an editor can
rewrite one in place instead of re-parsing the file; `bodyLine` is where a new
statement may be inserted. Blocks are not fields: they are `sections` and
`options`. A key written twice keeps the LAST site, because that is the one the
game reads.

`targets` are the references that hand control on: the step-into edges of an
event chain. They come from the active profile's event/on_action reference
fields (`trigger_event` and its `{ id = X }` block form, `on_action`,
`on_actions`, `events`, `random_events`, `first_valid`, plus whatever a game
profile names), never from a hard-coded key list. The list is capped at 40 and
`targetsTotal` gives the real count, the same honesty rule `totalLines`
follows. Each target says what its name resolved to: `kind` is `"event"`,
`"on_action"` or `"unknown"`, and `"unknown"` means the index has no such
definition, so render it as unresolvable and do not guess. An on_action target
additionally carries `fires`, what that on_action's own definition fires,
resolved exactly one level deep: absent when there was nothing to read
(including a target that is itself already one level deep), `[]` when the
definition names no events, capped at 24 with `firesTotal` giving the true
count.

`paradox/guiWidgetInfo` is the designer inspector's read side: `{ uri, text,
line }` in, the widget's effective properties out, or `null` when that line
carries no widget of its own (the same answer `guiSourceEdit` refuses with). It
addresses the widget the way the WRITER does and resolves it the way the ENGINE
does, so a row it lists is a value the canvas laid the widget out with and a
line a `setProperties` op would rewrite. Properties are last-in-wins per key in
expansion order, and each carries an `origin`: the chain of definitions it was
spliced through, innermost first (`[template PxDeco, type px_card]`). An EMPTY
origin means the property is authored in the widget's own body, which is the
only case a write rewrites in place. Values are rendered from the parser's
tokens, not sliced from a file: an inherited block lives in a document this
request was not handed.

It is a per-selection request rather than a field on `GuiLayoutNode` on
purpose: a vanilla window lays out 500+ widgets, and every layout push would
carry every widget's expanded property list for rows one widget at a time is
ever shown.

A property assigned more than once also carries `overrides`: the values it
shadowed, in expansion order, base-most first, each with its own origin. That
is the "this overrides `{ 100 50 }` from type px_card" note, and it is the
engine's own discard recorded where the discard happens, not a second walk.
A key assigned once has no `overrides` field at all.

`textures` lists what the widget draws, its own fill first and then its
`background`, with the frame-sheet geometry of each: `framesize` and `frame` as
authored, plus `width` / `height` / `columns` / `rows` / `cell` once the file
resolves. Sizes come from the DDS **header** (128 bytes read, never a decode) so
an inspector row cannot cost a 4096x4096 BC7 decode; the path resolves the way
the game loads an asset, mod first, then parent mods from the last loaded back,
then the game. The grid is driven by `framesize` alone: neither the CK3 nor the
Victoria 3 gui tree, nor either harvested `guiSchema.json`, contains a
`noofframes`, so no second spelling is guessed at. Frames are 1-based and
row-major over `floor(width/cellW)` columns, and an out-of-range `frame` clamps
into the grid rather than reading off the sheet.

`placement` answers "why is it here", and only when the request sets
`placement: true` — it costs a full layout of the document, and the trace it
records is gated so an ordinary `paradox/guiLayout` never pays for it. Two
shapes, never both:

- an anchored widget carries `terms`, the contributions of the engine's own
  formula in order (`parentOrigin`, `parentanchor`, `widgetanchor`, `position`).
  Their `dx`/`dy` **sum exactly to the rect's `x`/`y`**, which is the invariant
  that keeps the readout from drifting from the placement it explains. A
  `widgetanchor` that was never written still appears, sourced from the
  `parentanchor` it mirrors;
- a widget inside a layout container carries `placedBy` and an EMPTY `terms`:
  the container computed the slot. `droppedPosition` is the `position` the
  engine discarded there (it logs "Widget cannot have a position in a layout"),
  which is the single most common "why is my widget not where I put it".

`clippedBy` rides along either way, naming the innermost `scrollarea` viewport
or `scissor = yes` ancestor and its clip rect. The rect is the clipper's, not an
intersection: the widget's own geometry stays true and the renderer clips.
`placement` is absent for a widget the layout never reaches, such as one inside
a `tooltipwidget` (created lazily in-engine, skipped in a static preview).

`paradox/guiLayout` takes an optional `visibility` mode for the widgets a static
preview cannot resolve, those whose `visible` holds an expression. `visible = no`
and `visible = yes` are deterministic and unaffected by the mode; only an
expression is a *check*.

- `showAll` (the default, and what the server did before this field existed):
  a conditional widget is KEPT. Showing it is the non-destructive default, and
  the same unknown is what makes a container's content unmeasurable;
- `hideAll`: every conditional widget collapses, exactly as `ignoreinvisible`
  collapses a `visible = no` one — its slot disappears and its siblings shift up;
- `evaluate`: the widgets whose check the caller assigned `false` collapse. A
  check with **no assignment behaves as shown**, so a partial map cannot hide
  something the caller never decided about.

The check KEY is the `visible` value exactly as authored, minus its quotes
(`[GetPlayer.IsAI]`). A static preview has no widget-independent identity for a
condition, and the source string is the one thing that is stable across edits
that do not touch the condition; two widgets written with the same condition
therefore share one toggle, which is what a toggle UI wants. `visibilityChecks`
reports every check met — in ALL modes, `showAll` included, so the UI can be
built before the user switches mode — each with the number of widgets carrying
it and whether THIS run resolved it to hidden.

Each `GuiLayoutNode` also carries its `onclick` and `tooltip` values verbatim
(minus quotes) when the widget has them. Neither is evaluated: a client's
interact mode reads the `GetVariableSystem.Set/Clear/Toggle` calls out of
`onclick` and turns them into `evaluate` assignments of the checks above, and
shows the rest as what the running game would do; `tooltip` is a loc key or a
datafunction the client resolves the same way it resolves text.

`paradox/guiLayout` resolves what a textbox SHOWS, as far as a static preview
can know it, and `loc` chooses between the two honest answers. `resolve` (the
default) looks a `text =` value up: a localization key becomes the configured
language's text, a `[datafunction]` becomes its `Localize('key')` /
`Concept('key', 'text')` value or the modder's own preview text, and a
`#bold`/`§Y`/`@icon!` formatting is stripped for measurement. What cannot be
known is shown as is and flagged, never invented: a key the index lacks shows
the key, a chain like `[GetPlayer.GetName]` shows its last segment (`Name`).
`raw` is the file's own value verbatim, which is what a layout measured before
this field existed. Sizes follow the shown text either way, so an autoresizing
label is as wide as what the player would read.

`previewValues` is the modder's table of preview text per expression, keyed
`[GetPlayer.GetName]` (the brackets are accepted either way) and kept by the
client with the mod (the VS Code host reads and writes
`<mod>/<configDirName>/gui-preview-values.json`). A value there wins over every
other resolution of that expression, and a value is text, never a number the
server would format.

The answer is on `GuiLayoutText`: `text` is what was measured and drawn, `raw`
is the `text =` value when it differs, and `segments` explains the pieces when
there is something to explain (absent for a plain literal). Each
`GuiTextSegment` has a `kind` (`literal`, `loc`, `datafn`), its `source` (the
key, or the expression without brackets) and `resolved`, false for a key the
index lacks or a datafunction only the running game evaluates. A key whose
value itself holds datafunctions resolves one level deep and yields one `loc`
segment per literal piece plus a `datafn` segment per expression, so a client
can style the unresolved chips inside an otherwise localized line.

`timings` is that request's own wall clock, split into `parseMs` (the document's
CST plus its own declarations), `defsMs` (the cross-file template/type store, 0
on a cache hit), `layoutMs` (widget tree and rects) and `totalMs`. Four clock
reads per request; there is no flag because there is nothing to switch off.

`paradox/guiDependencies` is the GUI-to-script surface, forward. PdxGui reaches
script through exactly one door — `GetScriptedGui('name')`, the only spelling
the CK3 and Victoria 3 trees use — so a widget's script dependencies are the
scripted_guis its own SOURCE subtree calls (`line` scopes the answer to one
widget; absent means the whole document). Each row carries the definition site,
`callLines` in the requested document, `uses` across every `.gui` file the
layout store scanned, and `chains`: the events and on_actions that scripted_gui
hands control to. A chain's `via` is empty for "directly" and lists the scripted
effects otherwise, outermost first, so `["effect_a", "effect_b"]` renders as
"via effect_a -> effect_b". The walk follows the active profile's event/on_action
reference fields (never a hard-coded key list), goes at most three
scripted-effect hops, records the shortest path to each name, and terminates on
cycles. `locKeys` are the `text` / `tooltip` values the subtree names, deduped,
each flagged against the loc index (`raw_text` / `raw_tooltip` are literal
strings by definition and are not keys, and a `[datafunction]` value is not one
either).

The REVERSE direction is `paradox/dependencies` with `guiUses: true`, so a
client asking "what depends on this event" gets the GUI answer in the same
place. `guiUses` is off by default because it walks the scripted_gui definitions
that some `.gui` file calls; when set, the response carries `guiUses` (`[]` is a
real "none found", absent means it was not requested). Each site is one
`file:line` of a `GetScriptedGui(...)` call plus the `scriptedGui` it names and
the same `via` hop list, so the whole path reads
`file:line -> scripted_gui -> effects -> definition`.

`paradox/guiVocabulary` is what a designer palette is allowed to offer. Every
name is harvested rather than listed: the active game's bundled
`guiSchema.json` (built from the vanilla `gui/` tree) plus the requested
document's own `template` and `type` declarations, which come first and are
never capped. `container` says the vanilla tree writes widgets inside that
type, which is what a "wrap in a container" menu should show; it is derived
from the harvest's own child counts, with the engine's attribute blocks
excluded, not from a list of container names. The harvested tail is capped and
`total` gives the real count.

The same answer carries what an inspector's add-property row may offer.
`properties` maps a widget type to its harvested property names, most used
first: only the types the requested document NAMES are in it (the keys it
writes blocks under, plus the bases of its own `type X = base` declarations),
because the harvest holds hundreds of types and a designer re-asks after every
layout. `commonProperties` is the vanilla tree's overall ranking, the fallback
for a widget whose type the harvest has never seen. Both are capped, both are
empty for a game with no harvest, and neither ever contains a name the vanilla
`gui/` tree does not write.

`paradox/guiSourceEdit` takes `{ uri, text, op }` and answers
`{ edits }` or `{ refused }`, never both, and `null` only for an op it does not
know. The server never writes: `edits` are `{ start, end, newText }` offsets
into the text of the REQUEST, computed against that one text and applied
end-first, so the host keeps undo, dirty state and the live preview
(host-owns-text). Every edit is surgical, over the exact span of the entry it
changes, so comments, CRLF, tabs-vs-spaces and single-line bodies survive a
write byte for byte.

`ops: GuiSourceOp[]` replaces `op` for a BATCH: several ops against the one
text, answered as one edit set, which is what makes a gesture over a
multi-selection one document change and one undo step. Sending both `op` and
`ops` answers `null` — a request carrying two shapes cannot say which it meant.
A batch answers with `results`, one `GuiSourceOpResult` per op in request
order:

- `edits` (top level) is every applied op's edits together, already checked for
  overlap. Apply the whole set as ONE change.
- `results[i].refused` is that op's own answer and skips only that op; the rest
  still applied. A client shows the reason verbatim, per member.
- `results[i].edits` is what that op contributed (empty for a refused op, and
  empty for an op whose bytes were already what it would write).
- Ops are computed in the order given, and a later one whose bytes an earlier
  one already rewrites is refused rather than dropped: `applyAll` discards an
  overlapping edit silently, and an op reported as applied must have been.
- Top-level `refused` on a batch names a WHOLE-REQUEST failure only (a document
  that does not parse, an empty `ops`); it is never a per-op refusal.
- `warning` joins the distinct per-op warnings; each op also carries its own.

The op is a discriminated union on `kind`: `setProperties` (a batch; a null
value removes), `reorder`, `insert`, `insertRaw` (paste), `delete`,
`duplicate`, `wrap` and the read-only `blockText`. A widget is addressed by the
0-based `line` its own statement starts on, the same `line` `GuiLayoutNode`
reports; a node spliced in from a template or a type has no line of its own and
resolves to nothing. An `index` counts SOURCE children, not the
template-expanded ones the preview shows, and out of range appends.

`refused` is an ANSWER, not an error: it is what the server says when a gesture
would not do what it looks like it does. A layout container places its children
itself, so a `position` on one of its children is dropped by the game; an
hbox/vbox/flowcontainer takes its size from its children, so an explicit `size`
does nothing; a child expanding on both axes inside a container has both taken
from it (one axis writes and sets `warning` naming the other); a `type`
definition is not restructured through one instance's preview; the only root
widget is not deleted; and a document that does not parse is not edited at all.
Render the string.

Full payload shapes: see `packages/protocol/src/protocol.ts` — every
interface there is part of this contract.

## Custom methods: server → client

| Method | Kind | Payload |
|---|---|---|
| `paradox/status` | notification | `{ tokens, tokensFromScriptDocs, definitions, indexing }` — data health for a status bar |
| `paradox/indexChanged` | notification | none — definition index changed (debounced); overview views should re-query |
| `paradox/progress` | notification | `{ phase, state: "start" \| "done", detail? }` — one coarse loading phase (`index`, `engine`, `guiStore`); `detail` carries the label, sent with `start` |

## Client command ids

Code actions and hover markdown reference these client-side commands. A client
lists the ones it registers in `client.commands`; the server emits `command:`
links and command-carrying code actions only for listed ids, so an unlisted
command is never shipped dead (the affordance degrades, nothing else breaks).
The ids carry the `px.` prefix. They were renamed from `ck3.` in the Paradox
Toolkit rebrand; clients registering the old ids get no fallback:

- `px.editLocalization` (args: `[locKey]`)
- `px.openLocalizationSideBySide` (args: `[locKey]`)
- `px.showReferences` (args: `[uri, line, character]`, via a
  `command:` markdown link in hover — requires the client to trust it)
- `px.showExamplesWiki` (args: `[]` for the catalog, or
  `[{ name, kind }]` for one article, via a `command:` markdown link on the
  hover card of a variable or list — requires the client to trust it)

## Degraded modes (bare LSP clients)

Documented behavior without the VSCode client: no tiger diagnostics (tiger
runs client-side), no overview webview UIs (the data behind every one of them
is on the wire; only the drawing is VSCode's), and no `.dds` rendering (a
texture hover carries a `data:` URI, which a client that does not render
images in markdown shows as link text). Completion, hover, definition,
references, rename, symbols, formatting, folding, inlay hints, semantic
tokens and structural diagnostics all work over plain LSP.

The `client` capabilities switch the remaining surface automatically, one
capability at a time. A client declaring nothing (every field off) gets:

- **`hoverIcons` off** — hover kind badges use a `■` square instead of a
  `$(codicon)` glyph. The default matters: a client that does not render theme
  icons prints the literal text `$(symbol-method)`, which is worse than the
  square. The `<details>` disclosure that caps long examples is also omitted,
  since it needs `hoverHtml`;
- **`hoverHtml` off** — hover markdown is plain: no sanitized HTML spans. The
  span *content* is always self-sufficient plain text ("■ trigger", a scope
  name), so the cards read the same either way;
- **`px.editLocalization` not listed** — the "create localization key" quick
  fix carries a real `WorkspaceEdit` instead (appending to
  `<locRoot>/<lang>/zzz_px_lsp_edits_l_<lang>.yml`, creating it BOM-first when
  absent), and the "edit localization" action is omitted;
- **`px.openLocalizationSideBySide` not listed** — that action is omitted;
- **`px.showReferences` not listed** — the hover reference line is dropped
  entirely. A count the user cannot click answers no question, so the card
  ends with the provenance instead (changed in server 0.2.0: it used to
  render the count as plain text);
- **`px.showExamplesWiki` not listed** — the "Examples Wiki" link the shared
  hover footer carries (engine tokens, datafunctions and data types, keywords
  and scope words, variables and lists) is dropped, exactly like the reference
  count;
- **`fileLinks` off** — every `file:` link any hover would carry (provenance,
  variable and saved-scope set sites, define sources, gui template/type
  definitions, `#format` sources, `[ ... ]` datafunction examples) renders as
  the same `file.txt:12` label without the link, so a renderer that cannot
  navigate `file:` targets never shows a dead link. A texture hover's "open
  file" becomes the resolved path as text (since server 0.2.0);
- **standard `snippetSupport` off** — no completion item carries `${…}` or
  `insertTextFormat: Snippet`. Inserts that would be snippets (parameter
  skeletons for scripted effects, `key = { }` for schema keys that open a
  block, engine block templates from the `usage:` dumps) arrive as plain-text
  skeletons instead: same shape, no tabstops (since server 0.2.0; before
  that, snippet syntax could reach clients that never declared it);
- **`ownFileWatcher` off** — the server dynamically registers
  `workspace/didChangeWatchedFiles` when the client supports dynamic
  registration, so external edits re-index without a restart. Declare
  `ownFileWatcher` only if you push `paradox/modFileChanged` yourself;
- index health is mirrored to `window/logMessage` regardless: a startup line
  naming the resolved bundled-data folders (or their absence) and `status:`
  lines with token/definition counts on indexing transitions.
