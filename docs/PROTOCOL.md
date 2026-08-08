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

**Versioning**: the protocol is versioned with the packages (lockstep with
the extension). Treat any change here as an API change; additions are
backward-compatible, renames/removals are called out in the changelog.
Current as of 0.3.0 (the Paradox Toolkit rebrand and the three game
profiles; `paradox/*` has been the method prefix since 0.1.2). Four additions
are in the repository but not yet in a release: `serverInfo` in the
`initialize` result, the `client` capability object superseding
`clientCommands`, `paradox/scopeAt`, and `dataDir`. All four are additive:
a client written against 0.3.0 keeps working unchanged.

## Transport and lifecycle

- Transports: `--stdio` (auto-detected from argv; what external clients use)
  and node-ipc (VSCode). `--socket=<port>` and `--pipe=<name>` are accepted by
  the underlying library, but nothing ships using them. Standard JSON-RPC 2.0
  LSP framing. The process-level contract around this (the `processId` orphan
  watchdog, the clean-stdout guarantee, the shutdown/exit sequence) is in
  `EMBEDDING.md`.
- Standard LSP: the server implements completion (+resolve), signatureHelp,
  hover, definition, references, rename (+prepare), documentSymbol,
  workspaceSymbol, codeAction, inlayHint, foldingRange, documentFormatting,
  semanticTokens (full), publishDiagnostics, and workDoneProgress for the
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
  diagnosticsIgnore: string[];         // diagnostic codes to suppress
  diagnosticsIgnorePatterns: string[]; // workspace-relative globs to suppress
  diagnosticsVanilla: boolean;         // false (default) = never diagnose game files
}
```

Every capability in `client` is independent and defaults to **off**, so a
client declares exactly what it implements and the server tailors its output
per capability (see "Degraded modes"). A client can take the hover markup
without registering any command, or register one command and not the others.

`clientCommands: true` is a **deprecated** alias kept for older clients: it
resolves to `{ hoverHtml: true, commands: <every id below>, ownFileWatcher:
true }`, which is what the VSCode extension used to declare. `false` or absent
resolves to all-off. It is ignored when `client` is present. New clients should
send `client`.

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
| `paradox/eventGraph` | request | `EventGraphParams` → `EventGraph` — event/on_action reference graph |
| `paradox/dependencies` | request | `DependenciesParams` → `DependenciesResult` — dependents/dependencies of a definition (by cursor or name), plus the `.gui` paths reaching it when `guiUses` is set |
| `paradox/scopeAt` | request | `ScopeAtParams` → `ScopeAtResult \| null` — inferred scope chain (outermost first) and visible saved scopes at a position; null when the document is not an open script document |
| `paradox/guiTree` | request | `{ uri, text }` → `GuiTree` — widget tree of a .gui document |
| `paradox/guiLayout` | request | `{ uri, text, visibility? }` → `GuiLayoutResult` — measured layout rectangles for a .gui document, with stage timings and the conditional-visibility checks it met |
| `paradox/guiWidgetInfo` | request | `GuiWidgetInfoParams` → `GuiWidgetInfo \| null` — one widget's effective properties with the template/type each came from, its textures, and (on request) why its rect is where it is |
| `paradox/guiDependencies` | request | `GuiDependenciesParams` → `GuiDependenciesResult` — the scripted_guis and loc keys a .gui document (or one widget in it) reaches |
| `paradox/guiSourceEdit` | request | `GuiSourceEditParams` → `GuiSourceEditResult \| null` — source edits for a designer gesture, or a refusal with a reason |
| `paradox/guiWidgetEdit` | request | `GuiWidgetEditParams` → `GuiWidgetEditResult \| null` — DEPRECATED, the position/size half of `guiSourceEdit` |

`ModScopedParams` is `{ modRoot?: string | null }`: restrict a mod-scoped
request to one workspace mod (absolute root path); absent = all workspace
mods.

`paradox/scopeAt` reports scopes as string ARRAYS, never a single name: a link
or iterator with several documented outputs stays ambiguous, and an empty
array means unknown. That is the honest answer, not an error — the server
annotates and ranks, it never hides or diagnoses on scope grounds. Render
several as `a|b` and none as "unknown".

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

`paradox/guiSourceEdit` takes `{ uri, text, op }` and answers
`{ edits }` or `{ refused }`, never both, and `null` only for an op it does not
know. The server never writes: `edits` are `{ start, end, newText }` offsets
into the text of the REQUEST, computed against that one text and applied
end-first, so the host keeps undo, dirty state and the live preview
(host-owns-text). Every edit is surgical, over the exact span of the entry it
changes, so comments, CRLF, tabs-vs-spaces and single-line bodies survive a
write byte for byte.

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

- **`hoverHtml` off** — hover markdown is plain: no sanitized HTML spans. The
  span *content* is always self-sufficient plain text ("■ trigger", a scope
  name), so the cards read the same either way;
- **`px.editLocalization` not listed** — the "create localization key" quick
  fix carries a real `WorkspaceEdit` instead (appending to
  `<locRoot>/<lang>/zzz_px_lsp_edits_l_<lang>.yml`, creating it BOM-first when
  absent), and the "edit localization" action is omitted;
- **`px.openLocalizationSideBySide` not listed** — that action is omitted;
- **`px.showReferences` not listed** — the hover reference count renders as
  plain text instead of a `command:` link;
- **`ownFileWatcher` off** — the server dynamically registers
  `workspace/didChangeWatchedFiles` when the client supports dynamic
  registration, so external edits re-index without a restart. Declare
  `ownFileWatcher` only if you push `paradox/modFileChanged` yourself;
- index health is mirrored to `window/logMessage` regardless: a startup line
  naming the resolved bundled-data folders (or their absence) and `status:`
  lines with token/definition counts on indexing transitions.
