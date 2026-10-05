# Embedding px-lsp in an application

How to run the px-lsp language server (`@px-lsp/server`) inside a desktop
application that already knows where the game, the logs and the mod live.

The audience is the person wiring the server into a host application, not an
editor user. If you are configuring neovim or another editor, read
`packages/server/README.md` instead: it covers filetypes, root markers and the
setup failure modes. This document covers the process contract, the
initialization options an application should send, the wire surface beyond
standard LSP, and what deliberately does not exist for a non-VS Code client.

The wire types are the contract. TypeScript hosts should import them from
`@px-lsp/protocol/protocol`; everyone else reads `docs/PROTOCOL.md`, which
mirrors that file method by method.

The exported `GameMeta.launchOptionsFile` names an optional launch-options reference relative to the game's data directory. CK3 supplies `_commandline_options.info`; `null` or an absent value means no source has been verified. The VS Code Wiki reads and watches this file locally. There is no launch-options LSP request, and the browser service does not read installed files. Other hosts can use the metadata with their own file reader.

## Headless agent clients

Use the separate `@px-lsp/cli` package when the host needs game research and saved-file validation through commands or MCP. Its `pxtk` command bundles the LSP and per-game data; it does not depend on a VS Code installation. See the [CLI setup guide](../packages/cli/README.md) and [JSON/MCP contract](PROTOCOL.md#pxtk-cli-and-mcp).

Indexed CLI operations start a stdio LSP session, wait for indexing to finish, then shut it down. Formatting, scaffolding, initialization, logs and image preparation use shared modules without starting the LSP. It reuses the server's disk cache. MCP serializes calls and resolves project configuration again between calls, so subsequent saved edits are loaded. The CLI does not synchronize unsaved editor buffers. Hosts that need live editor state should use the document-sync contract below.

Game metadata and Steam discovery are shared with the editor. Explicit CLI paths override environment and project configuration; invalid explicit paths are errors. The resolved dependency list includes the toolkit's per-mod playset overlay and is passed to both LSP and Tiger. Existing Tiger configuration retains its own load-mod and suppression settings. Deep validation uses the same bounded process and strict report handling as the editor, with capabilities gated by the selected GameProfile.

Queries read saved mod and reference files and maintain caches or temporary process configuration. Preparation operations preview changes and require explicit write mode to apply them inside the editable mod. Preview tokens reject changed inputs. New image, configuration, checkpoint and baseline outputs cannot replace existing files. Updates replace individual files atomically; a batch failure reports completed paths. Image preparation installs Sharp as a native CLI dependency; the editor keeps its existing codec adapter. Queries reject concurrent changes to editable script/GUI/localization content and relevant configuration, generated documentation or dependency content. Runtime behavior still requires a game playtest.

## Live documents and symbol identity

Send each unsaved script or localization change through `textDocument/didChange` with a new version before requesting language features. The server refreshes definitions and script references from that buffer; closing it restores the saved file. File watcher events update closed files and invalidate cached dependency searches. They do not replace an open buffer.

Reloading game documentation or changing indexed definitions, schema or root-scope context also invalidates derived scope inference. Subsequent scope, hover and completion requests reflect the new data even when document text and version are unchanged. Syntax-only parses remain reusable. This behavior uses the existing requests and capability gates; clients do not need to send a dummy text edit after a reload.

Definition kinds have independent names and override chains. A localization key and a trait may share a name, as may a scripted GUI and a scripted trigger. Navigation uses the type required at the cursor and still returns the mod, parent and vanilla declarations of that type.

CK3 also indexes `faith` definitions inside a religion's `faiths` block and `law` definitions inside law groups. Completion, hover, navigation, workspace symbols and typed references use the child kind; the definition's `container` identifies its parent. This applies to saved files and current open buffers. Rename for these nested kinds is unavailable because indirect forms, such as faith-derived modifier names, are not fully indexed. Victoria 3 and EU5 keep their existing profile extraction rules.

Schema overlay entries can add `nestedDefinitions: { "kind": "child_kind", "path": ["wrapper"], "excludedKeys": ["property_block"] }`. The path is the exact sequence of wrapper blocks below each top-level definition; an empty path selects direct child blocks. Only unquoted block assignments with valid definition names are extracted. The parent entry's required-localization patterns apply to the parent kind, not the child kind. Cache identity includes this rule, so changing it rebuilds the index.

Declare `workspace.workspaceEdit.documentChanges: true` in standard LSP capabilities if the host can enforce document versions when applying rename. The server supplies versions for open files and null for closed files. Without that capability, rename requires open sources to match disk and returns plain `changes`. Show rename errors to the user; do not apply a partial edit after an error. See [the rename contract](PROTOCOL.md#symbol-lookup-and-rename) for unsupported and ambiguous cases.

`paradox/dynastyTree` includes optional `DynastyCharacter.deathReason` from character history. Character names remain raw source values and may be localization keys. Existing clients can ignore the added field for display, but writers must preserve the source details their forms do not model. The quotation controls and character save workflow belong to the VS Code Dynasty Tree; they do not change LSP formatting or other clients.

## Semantic coloring

The Node LSP server supplies semantic tokens for script, GUI and localization, including datafunction expressions inside GUI strings and localization entries. Use the legend returned at initialization. Standard token types work without a toolkit-specific theme; clients may additionally style `pxEffect`, `pxTrigger` and `pxScope` modifiers. Declaration, constant and write roles use the standard `declaration`, `readonly` and `modification` modifiers. See [the token contract](PROTOCOL.md#semantic-tokens).

The VS Code extension supplies bold declarations and TextMate scope fallbacks. Its built-in light and dark theme defaults relate text colors to the existing glyph families: purple for conditions and functions, orange for effects and events, and blue for runtime state. Definition references and script values have separate colors. Light-theme colors are darker where the icon color has insufficient contrast for small text. These defaults apply only to toolkit tokens and do not write user settings. `editor.semanticTokenColorCustomizations` can override them; other themes retain their own colors. Disabling semantic highlighting leaves the grammar's prefix, parameter, constant and expression styling available.

The browser service still has no semantic-token API. This change does not add a workspace index or GUI support to that service.

## The process contract

### Spawning

The server is one Node process speaking JSON-RPC 2.0 with LSP framing. It picks
its transport from `process.argv`, so the transport is a command-line argument,
not an API call:

| Argument | Transport |
|---|---|
| `--stdio` | stdin/stdout. What an embedding application uses. |
| `--node-ipc` | Node's parent/child IPC channel. Requires `child_process.fork`. |
| `--socket=<port>` (or `--socket <port>`) | TCP: the server connects out to `127.0.0.1:<port>`, so the host listens. |
| `--pipe=<name>` (or `--pipe <name>`) | Named pipe / unix domain socket, same direction. |

With none of them, the server defaults to `--stdio` (unless it was forked over
node IPC, which it detects from `process.send`), so a bare `px-lsp` behaves
like `px-lsp --stdio`. `px-lsp --version` prints the server version and exits
without a handshake, for install scripts and health checks.

```
node /path/to/px-lsp-server-<version>/dist/server.js --stdio
```

The Windows zip ships `px-lsp.cmd`, which is exactly that line against the
bundled `node.exe` with every path resolved from `%~dp0`, and forwards any
extra arguments. Point your host at the `.cmd` and pass nothing.

**Heap ceiling.** The definition index is the dominant allocation and it is
large by design: measured at roughly 924 bytes per definition, about 408 MB for
a full vanilla scan, with peak during the scan around 1.5x that, plus the whole
definition set of every extra root (workspace mods and the `parentPaths` submod
chain). Node sizes its default old space from system RAM, which lands near 2 GB
on an 8 GB machine, inside crash range for a total conversion on top of a
framework parent. The VS Code client therefore forks the server with
`--max-old-space-size`: 4 GB, cut toward half of physical RAM on a small
machine but never below 2 GB (`packages/vscode/src/serverHeap.ts`). Do the
same:

- spawning `node` yourself: pass `--max-old-space-size=4096` before the script
  path;
- launching `px-lsp.cmd`: set `NODE_OPTIONS=--max-old-space-size=4096` in the
  child environment, since the launcher's forwarded arguments reach the script,
  not the runtime.

### The orphan watchdog

`vscode-languageserver` installs a watchdog for you, but only if you tell it
which process to watch. Send your own pid as `processId` in the `initialize`
params (or pass `--clientProcessId <pid>` on the command line). The server then
polls that pid every 3 seconds with a null signal and exits as soon as it
disappears, with code 0 if `shutdown` had been received and 1 otherwise.

Send it. A host that crashes without it leaves an orphaned server holding its
index, and the next launch adds another one.

Over `--stdio` there is a second safety net: an `end` or `close` on stdin exits
the process the same way. It fires when the pipe is actually torn down, which a
hard-killed parent on Windows does not always do, so it is a backstop and not a
replacement for `processId`.

### The clean-stdout guarantee

Over `--stdio`, stdout carries protocol frames and nothing else. The server
source writes to neither `console.log` nor `process.stdout`; its own logging
goes through `connection.console.log`, which is a `window/logMessage`
notification. On top of that, `vscode-languageserver` replaces the whole
`console.*` family with connection-routed logging when the transport is stdio,
so even a stray `console.log` from a dependency arrives as a log notification
rather than as corruption in the middle of a JSON-RPC frame.

stderr is not part of the contract. Node's own warnings and an unhandled
exception trace land there. Capture it into your host's log, do not parse it.

Everything the server knows about its own health is mirrored to
`window/logMessage`: a startup line naming the resolved bundled-data folder (or
its absence) and `status:` lines with token and definition counts on indexing
transitions. Surface that channel somewhere reachable. "Completion is empty" is
answered by those lines and by almost nothing else.

### Shutdown

The standard LSP sequence, and it is worth following exactly:

1. `shutdown` request, await the response;
2. `exit` notification;
3. the process exits 0.

Skipping the `shutdown` request and sending only `exit` also terminates the
server, but with exit code 1, because an exit that was never announced is
indistinguishable from a crash. If your host treats a non-zero exit as an error
worth reporting, that is where the spurious report comes from.

## Initialization

### The minimal options for an application that knows its paths

An editor plugin has to discover the mod root from the workspace. An
application usually knows it already, and can say so:

```jsonc
{
  "processId": 12345,
  "rootUri": null,
  "capabilities": { /* your LSP client capabilities */ },
  "initializationOptions": {
    "storageDir": "C:/Users/you/AppData/Local/YourApp/px-lsp",
    "settings": {
      "gameId": "ck3",
      "gamePath": "D:/Steam/steamapps/common/Crusader Kings III/game",
      "logsPath": "C:/Users/you/Documents/Paradox Interactive/Crusader Kings III/logs",
      "modPath": "D:/mods/my_mod",
      "workspaceMods": ["D:/mods/my_mod"],
      "locLanguage": "english"
    }
  }
}
```

That is the whole useful minimum. Every field is optional and the server has
fail-soft fallbacks for all of them, but each one you omit costs something
concrete:

- **`gameId`** picks the game profile (`"ck3"` default, `"vic3"`, `"eu5"`).
  There is no auto-detection outside VS Code, so set it explicitly for anything
  but CK3. One server instance serves one game; changing it later through
  `paradox/configChanged` triggers a full reload.
- **`gamePath`** is the game's `game/` folder, the source of vanilla
  definitions, asset paths and override detection. Without it the index knows
  only the mod.
- **`logsPath`** is the folder holding the user's `script_docs` dumps. CK3 and
  Vic3 ship bundled fallbacks (wiki tables, dump snapshots), so there it is an
  exact-version upgrade; EU5 ships only a data-type snapshot so far, so for
  engine tokens it is the
  difference between working completion and a thin index of the user's own
  definitions. Vic3/EU5 write script_docs to `Documents/.../docs`; the
  data-type dump lands under `logs/` and the server probes the sibling
  `logs/` folder of a docs-style `logsPath` automatically.
- **`modPath`** is the mod root. A nonempty value and any `workspaceMods` take precedence over the workspace fallback. When both are empty, the server uses the first initialization workspace folder, or `rootUri` when no folder is supplied. The fallback survives later settings updates. Sending `modPath: null` with `workspaceMods: []` restores it. Without any root, features that require a known mod stay silent.
- **`workspaceMods`** are the roots being *edited*. Listing a root here is what
  upgrades it from a plain definition scan to reference indexing plus reference
  diagnostics. `modPath` itself always gets that treatment, so a single-mod
  host can send `modPath` alone (setting `workspaceMods` to `[modPath]` is
  equivalent) — which is also why a bare editor client whose workspace root
  becomes the fallback `modPath` still gets reference diagnostics. Read-only
  dependency mods go in `parentPaths` instead, base first, in load order.
- **`locLanguage`** selects the localization language for inlay previews and
  coverage.

Set `indexAssets: false` to skip graphics `.asset` definition and reference indexing in all roots. It defaults to `true` for profiles that support `.asset` files. Send the changed settings through `paradox/configChanged` to rebuild the index without a restart. This does not disable open-file syntax features or on-demand texture previews.

Set `texturePreviewBackground` to `checkerboard` (the default), `dark`, `light`, or a six-digit hex color to choose the background behind texture hover images. Invalid values use checkerboard. The background is part of the generated thumbnail, so it works with ordinary Markdown image rendering. A settings update changes subsequent hovers without an index rebuild. VS Code uses the same workspace choice for its DDS editors; source files and exported PNGs retain their transparency.

Declare the supported completion documentation formats in `textDocument.completion.completionItem.documentationFormat`, in preference order. Omit it or send `["plaintext"]` for plain insertion previews and value hints. The exported snippet catalogue keeps its explicitly documented Markdown format regardless of these capabilities.

Set `completionMode` to `minimal` (the default), `examples`, or `names` to control ordinary script keyword insertion. Minimal adds the documented operator and blank values and the fields from valid documented examples or scripted parameters, omitting fields marked optional. Examples restores the documented example values and scripted-call parameters. Names inserts only the keyword. Explicit definition templates and the `paradox/snippets` catalogue retain their full templates in every mode. The standard `snippetSupport` capability still decides whether inserts carry tabstops or plain text. This setting applies through `paradox/configChanged` without an index rebuild. Resolving a completion adds an insertion preview and expected-value descriptions from the token documentation or the definition's `@param` tags. Example values are not treated as confirmed datatypes. These hints are documentation only; `insertText` is unchanged.

The remaining settings (`parentPaths`, `scopeInlayHints`, `diagnosticsIgnore`, `diagnosticsIgnorePatterns`, `diagnosticsVanilla`) are documented in `docs/PROTOCOL.md`. Existing hosts can continue to send the whole settings object through `paradox/configChanged`; omitted fields return to defaults.

Event localization value completion can propose a key before its localization entry exists. CK3 uses `<event ID>.t`, `.desc`, and successive option suffixes `.a` through `.z`; Victoria 3 uses `.t`, `.d`, `.f`, and the same option suffixes. The current unsaved document supplies the event ID and option order. Proposed keys are labelled as new, existing keys keep their definition information, and accepting a suggestion inserts only the reference. The user still supplies its localization text. No new-key convention is assumed for EU5.

For standard LSP updates, send a partial settings object under `pxLsp`. This example changes hover detail without clearing roots, changing the selected game, or rebuilding the index:

```json
{ "jsonrpc": "2.0", "method": "workspace/didChangeConfiguration", "params": { "settings": { "pxLsp": { "hoverDetail": "compact" } } } }
```

Standard updates retain omitted fields and replace supplied arrays in full. `gamePath`, `logsPath`, and `modPath` accept `null` to clear a configured path before root fallback is applied. `calendar: null` clears the configured calendar. Invalid `texturePreviewBackground` values use checkerboard. Unrelated sections and other malformed updates are ignored. The `pxLsp` shape is `Partial<ParadoxSettings>`, separate from the VS Code extension's native `px` configuration.

If the host advertises `capabilities.workspace.configuration: true`, answer `workspace/configuration` requests for section `pxLsp` with `[partialSettings]`. The server requests it after `initialized`, before its first build, using the initialization workspace URI as `scopeUri` when available. Returned fields patch initialization settings; absent/null results and request failures preserve them. Send an empty or null `didChangeConfiguration.settings` to request another pull. Late responses cannot overwrite a newer push, custom update, or pull. The server dynamically registers configuration notifications only when `workspace.didChangeConfiguration.dynamicRegistration` is true. Hosts without these capabilities can continue to use initialization options and pushed updates.

Include `<mod>/<configDir>/schema.json`, `playset.json` and `project.json` in a host-owned file watcher, including the profile's legacy config directory where supported. Send creation, change, and deletion events through `workspace/didChangeWatchedFiles` or `paradox/modFileChanged`. The server reloads the schema, dependency roots, project validation rules and dependent data in one debounced rebuild for the burst. Its dynamically registered file watcher includes these files automatically.

Schema entries can distinguish database layouts with `kindByField: { field, kind, otherwise }`. A direct scalar assignment to `field` selects `kind`; otherwise the definition uses `otherwise`. All three values must be non-empty strings. CK3 uses this rule to distinguish current standalone laws from older nested law groups in the same folder. Definition extraction, navigation, semantic colors and structural completion use the same classification.

A playset reload does not extend the client's watched roots. Hosts must also watch dependency files outside their existing watched folders to report later edits in those dependencies.

### Shared rules and personal paths

Commit shared authoring rules with the mod in `.px-toolkit/project.json`. Its version-1 schema and client-setting mapping are in [Portable project rules](PROTOCOL.md#portable-project-rules). Calendar, localization defaults, schema overlays, playsets and Workshop metadata keep their own files. Resolve each artifact separately: its current path wins, otherwise use only the active game's legacy path. Report invalid current files instead of falling back to older ones.

The server reads each editable mod's diagnostic ignore rules from `project.json`; declared arrays replace client defaults. It reports malformed, unreadable, wrong-game or unsupported declarations as `invalid-project-settings`, then uses the client's diagnostic settings until the file is fixed. Hosts still choose the server game through `settings.gameId`. VS Code also uses the declaration for character quotation, descriptor validation and changelog selection. A relative changelog path is measured from the Workshop listing directory. Bare LSP clients do not gain those VS Code workflows.

Private installation paths belong to the host's User configuration. VS Code stores them in User `px.machinePaths`, a version-1 registry with this shape:

```ts
interface MachineSettings {
  version: 1;
  defaults?: Record<string /* gameId */, MachinePathValues>;
  workspaces?: Record<string /* workspace URI */, Record<string /* gameId */, MachinePathValues>>;
  folders?: Record<string /* folder URI */, Record<string /* gameId */, MachinePathValues>>;
}
```

`MachinePathValues` contains flat keys `gamePath`, `logsPath`, `tigerPath`, `modPath`, `modProjectsDir`, `parentMods`, `excludedMods`, `coaLibraryDir`, `workshop.dir`, `workshop.changelog` and `dev.webviewSource`. `parentMods` and `excludedMods` are string arrays; the other values are strings. These fields hold personal paths and lists, including external or parent-relative changelogs that cannot be shared safely. A `px.machinePaths` object in Workspace or folder settings is not a canonical registry.

The registry separates game defaults from workspace and folder bindings. A workspace identity is the saved workspace URI, or the single folder URI in a single-folder window. A folder identity is the containing workspace folder's URI. URI keys are normalized local identities, not portable project IDs. Moving a project does not carry its private binding to the new URI. Canonical values take priority over legacy values at the same scope; folder bindings precede workspace bindings, then game defaults and legacy User settings. Unknown fields survive edits. Invalid known fields or unsupported registry versions are reported and block writes.

Editor choices, such as hover detail, completion mode, display language and scope hints, retain native VS Code User, Workspace and supported folder scopes. Other hosts can use their own preference and private-path stores. The shared pure `@px-lsp/protocol/machineSettings` model does not require a host to use VS Code's registry.

Toolkit Settings presents these stores in one catalogue. The selected mod is an inspection context, separate from each row's save destination. Every row shows its destination and effective source, and broader defaults remain distinguishable from an active override. Destination choices are restricted to the setting's storage contract and the selected mod's containing workspace folder. Changing the settings context does not change the working focus mod. This is a VS Code presentation change; storage formats and LSP settings remain the same.

VS Code upgrades storage on trusted startup in a detected mod workspace and through **Upgrade Toolkit Settings** (`px.migrateToolkitStorage`). Granting workspace trust also runs the command. It copies legacy artifacts into missing current paths without renaming the old directory or deleting originals. Different current files remain authoritative and produce conflicts. It imports explicit Workspace and folder authoring settings into each selected editable mod's `project.json`; valid relative changelog values are copied unchanged. Personal paths move into User registry bindings for the active game. Legacy User settings remain available as fallbacks.

Explicit Workspace and folder `px.calendar` values move into the existing bare `calendar.json` format, outside `project.json`. An equal usable calendar needs no rewrite, preserving its unknown fields and encoding. A different or invalid current calendar retains the old native setting and reports a conflict or error. User calendar values are never copied or removed.

The upgrade verifies each destination and rechecks its sources before removing an old Workspace or folder setting. A shared Workspace setting is removed only after every affected editable mod has the verified value. Unsaved config sources, stale snapshots, links, conflicts and failed writes retain their sources and appear in the upgrade report. The operation can run again after a partial failure. The command reports unchanged storage, successful moves and items that need attention, with the full report in the Output channel. It does not modify vanilla or read-only reference inputs. These upgrade actions belong to the VS Code host; the standalone server only reads configuration.

### storageDir: put it somewhere persistent

`storageDir` is where the server caches parsed `script_docs` and the harvested
data-function usage tables, per game (the filenames carry a per-profile
suffix, so several games can share one directory).

Unset, it defaults to `<os tmpdir>/px-lsp`. That works and it is what a bare
editor client gets, but it is the wrong choice for an application: temp
directories get swept, so the first launch after a cleanup pays the full parse
again for no reason. Point it at your host's own per-user data directory (the
VS Code client uses the extension's global storage path).

Create that directory yourself. The server only creates the tmpdir default, and
every cache write swallows its own failure, so a path that does not exist costs
you the cache silently instead of raising anything.

### serverInfo

The `initialize` result carries standard LSP `serverInfo`:

```json
{ "name": "px-lsp", "version": "0.3.0" }
```

`version` is the `@px-lsp/server` package version, read from the manifest that
ships with the bundle, so it cannot drift from the artifact you unpacked. Log
it, and gate any feature you added against a version check on it rather than
against the presence of a method.

### The client capability object

What the server emits is tailored per capability, and a client declares exactly
what it implements:

```ts
interface ParadoxClientCapabilities {
  hoverHtml?: boolean;      // renders the sanitized <span style="color:var(--vscode-*)"> hover markup
  commands?: string[];      // the px.* command ids this client actually registers
  ownFileWatcher?: boolean; // client watches the mod tree and pushes paradox/modFileChanged
  fileLinks?: boolean;      // hover renderer navigates file: links
  hoverIcons?: boolean;     // client sets supportThemeIcons, so hover badges may use $(codicon) glyphs
}
```

Every field is independent and defaults to **off**, which is the honest default
for an embedder: send only what you have built. The combinations are real, not
theoretical. A host with a custom hover renderer can take `hoverHtml` and list
zero commands. A host that registers `px.showReferences` but not the
localization commands lists just that one, and the localization quick fix
arrives as a real `WorkspaceEdit` instead of a command it could not run.

`clientCommands: boolean` is the **deprecated** predecessor and should not be
used in new code. It conflated three unrelated questions behind one "is this VS
Code" switch. It still works: `true` means
`{ hoverHtml: true, commands: <every id>, ownFileWatcher: true, fileLinks:
true }` plus snippet support, `false` or absent means all-off, and `client`
wins when both are sent.

One more capability matters here and is NOT part of this object, because
standard LSP already carries it: snippet support. Declare
`textDocument.completion.completionItem.snippetSupport: true` in the
`initialize` capabilities if your editor expands `${1:…}` tabstops.

The full set an embedder should consider, and what each one buys:

| Declare | If your client | Without it |
|---|---|---|
| `snippetSupport` (standard LSP) | expands `${1:…}` tabstops in completion inserts | completion inserts are plain-text skeletons: same block shape, no tabstops, never a literal `${` |
| `client.hoverHtml` | renders the sanitized `<span style="color:var(--vscode-*)">` hover markup | hover cards are plain markdown; the span content is self-sufficient text, so nothing is lost but color |
| `client.commands` | registers some/all `px.*` commands | command-link affordances degrade per id: the localization quick fix becomes a plain `WorkspaceEdit`, the hover reference-count line is dropped |
| `client.fileLinks` | navigates `file:` links from hover markdown | every hover location line (provenance, set sites, define/gui/format sources, datafunction examples, texture paths) renders as plain text instead of a dead link |
| `client.ownFileWatcher` | watches the mod tree and pushes `paradox/modFileChanged` | the server registers its own `didChangeWatchedFiles` watcher (needs dynamic registration) |

The concrete per-capability behavior (what the hover looks like without
`hoverHtml`, which quick fix replaces which) is the "Degraded modes" section of
`docs/PROTOCOL.md`.

### dataDir

Two bundled assets are read from disk at runtime rather than compiled into the
bundle: the wiki token mirror (`wikidocs/`, CK3 only) and the completion
frequency table (`freqs.json`). By default the server looks for them in
`data/<gameId>/` next to its own `dist/server.js`, which is the layout both
release artifacts ship.

If your installer puts the data somewhere else, send `dataDir`: the directory
that **contains** the per-game folders, not one of them.

```jsonc
"initializationOptions": {
  "dataDir": "C:/Program Files/YourApp/resources/px-lsp-data"
  // the server reads <dataDir>/ck3/wikidocs/ and <dataDir>/ck3/freqs.json
}
```

Both files resolve independently under `<dataDir>/<gameId>/`, and the whole
path is re-derived when `paradox/configChanged` switches the game, so the
override stays profile-correct. A `<gameId>/` folder holding only one of the
two assets, or missing entirely, is a supported state and not an error.

CK3 and Victoria 3 ship script-doc snapshots, and all three games ship data-type dump snapshots. User-generated dumps take priority; a missing bundle remains a supported state.

`wikidocsDir` is the **deprecated** predecessor. It overrides the `wikidocs/`
folder alone, leaves `freqs.json` on the bundle root, and does not follow a
`gameId` change. Send `dataDir`.

## Documents

### URIs

Send `file:` URIs. The server converts them with
[`vscode-uri`](https://github.com/microsoft/vscode-uri), and on Windows that
**lowercases the drive letter**: `file:///F:/mods/my_mod/events/a.txt` becomes
`f:\mods\my_mod\events\a.txt`.

Two consequences worth building in from the start:

- compare paths case-insensitively on Windows whenever you match a server
  answer against a path of your own (the server does this internally for its
  own root matching);
- treat the URI string, not the derived path, as the document identity. Echo
  back exactly the URI the server sent you in a location or diagnostic, and
  exactly the URI you opened the document with in every subsequent request. A
  URI that differs only in drive-letter case is a different open document, and
  the request will find nothing.

### Sync, and why full-document didChange is fine

The server declares `TextDocumentSyncKind.Incremental`, but that is the maximum
it accepts, not a requirement. A `textDocument/didChange` whose content change
carries no `range` is a full-document replacement, and it is legal under
Incremental sync. The document store applies both forms.

An embedder is often better off sending the full text. The host's editor buffer
rarely produces LSP-shaped incremental deltas for free, and hand-computing
ranges is the classic source of client/server desync, which shows up much later
as offsets that drift by a few characters. The server re-parses the whole
document per version either way: every position feature shares one cached parse
per document version rather than re-scanning per request, so the saving from an
incremental delta is the text splice alone.

**Bump `version` on every change, monotonically.** The parse cache is keyed by
URI plus version. Reusing a version with different text serves the previous
parse, and the symptom is completion and diagnostics answering for text the
user no longer has.

Also send `textDocument/didSave`. The server declares `save: true` and uses it
for more than re-validation (see below).

### BOM state comes from disk

The server reports `missing-bom` as an Error for localization files and a Warning for mod script `.txt` files. The script warning applies only inside an editable workspace mod. It does **not** look for the BOM in your buffer text: editors routinely strip `U+FEFF` when they read a file. The server reads the first three bytes on disk on `didOpen` and again on `didSave`.

Encoding fixes belong to the host editor. VS Code supplies a local quick fix that opens its native encoding picker for the affected document; other hosts should offer their own save-encoding control. A BOM-only save clears the diagnostic even when the document version has not changed.

A host whose buffers have the BOM stripped therefore needs to do nothing
special, which is the point. Two things follow:

- an unsaved or unreadable file yields "unknown", and the check is skipped
  rather than guessed at, so a brand new buffer never gets a false BOM error;
- if your host writes files itself, send `didSave` after the write. Otherwise
  the server keeps the BOM state it read at open time and the diagnostic
  disagrees with what is now on disk.

## The paradox/* methods, by audience

Beyond standard LSP the server answers a set of custom requests. A plain client
can ignore all of them. Full payload shapes are in `docs/PROTOCOL.md` and
`packages/protocol/src/protocol.ts`.

| If you are building | Wire these |
|---|---|
| Anything at all | `paradox/configChanged` (push settings without a restart), `paradox/status` and `paradox/indexChanged` (server to client; index health and a re-query signal) |
| A status bar or an index panel | `paradox/status`, `paradox/indexStats`, `paradox/reloadDocs` (reload both script docs and data types after the user generates them) |
| A scope indicator | `paradox/scopeAt` (see below) |
| An “insert a definition” command or palette | `paradox/snippets` (see below) |
| Localization tooling | `paradox/lookupLoc`, `paradox/locCoverage` |
| Mod-wide reports | `paradox/modOverview` (content inventory), `paradox/overrides` (what shadows vanilla, with the LIOS/FIOS winner) |
| An impact view for one definition | `paradox/dependencies` (dependents and dependencies, by cursor or by name) |
| An event browser or graph | `paradox/eventGraph`, `paradox/eventDetail` |
| A `.gui` designer | `paradox/guiTree`, `paradox/guiLayout`, `paradox/guiSourceEdit` (`paradox/guiWidgetEdit` is the deprecated position/size half of the last one) |
| Your own file watcher | declare `client.ownFileWatcher` and push `paradox/modFileChanged` per changed file |

The mod-scoped requests (`modOverview`, `locCoverage`, `overrides`) take
`{ modRoot?: string | null }`: one workspace mod by absolute root path, or
absent for all of them.

For data health, show the script-doc and data-type sources separately. `tokensFromScriptDocs && !tokensFromBundledDumps` means a generated script dump is loaded. `StatusPayload.dataTypesSource` reports `generated`, `bundled` or `none`; absent means the server does not report it. The optional `status` in `paradox/reloadDocs` is the refreshed status, also sent through `paradox/status`. Recommend generating both dumps after game patches, then reloading. The status identifies their source, not their age.

When opening a specific indexed definition, pass its source as `file` (absolute path or file URI) to `paradox/eventDetail` alongside `id`, or to `paradox/definitionForm` alongside `kind` and `name`. This avoids selecting another mod's definition with the same ID. An exact source that cannot be loaded returns `null` for event detail or leaves the form's `current` absent. Omitting `file` preserves the existing lookup behavior.

Event detail includes an optional `sourceHash` for the decoded source used by its coordinates. Treat it as a freshness value and refresh a stale form before writing. Older servers can omit it; the VS Code Event Graph then keeps fields and options read-only. The graph checks current editor text, writes only within editable mod roots, and preserves comments, operators and neighboring statements. Its event and option actions locate the destination in current source and reject duplicate or malformed destinations. Failed saves or localization writes retain retry state without inserting duplicate script blocks.

For a localization row in a specific language, pass `language` with `key` to `paradox/lookupLoc`. Omitting it uses the configured completion language. An explicit identifier uses lowercase letters and underscores; missing translations and invalid identifiers return an empty list. The request includes open unsaved text and does not change the completion language.

### Localization defaults and writes

A mod can store author defaults in `.px-toolkit/localization.json`. The profile's legacy configuration directory remains a read fallback. These defaults control writes, not the workspace's display or completion language. VS Code exposes **Configure Localization Defaults** for the focused mod; the same file also controls bare-LSP missing-key edits.

```json
{
  "language": "english",
  "newKeyFile": "localization/{language}/{source}_l_{language}.yml",
  "overrideFile": "localization/replace/{language}/overrides_l_{language}.yml",
  "entryVersion": "preserve"
}
```

Every field is optional. Omitted fields use automatic routing and the workspace language. Empty language or file paths restore automatic behavior. File templates are relative to the mod, remain inside a profile localization root, and can use `{language}`, `{source}` (the script filename stem) and `{subject}` (the caller's content category). A template that needs unavailable context reports an error. For staged games, include the appropriate stage in explicit templates, for example `in_game/localization/{language}/...`. Automatic source-based placement retains the source stage.

Existing owned keys stay in their files. New keys use an explicit default, then related source keys, a specific key family, a matching source filename or a language counterpart. A mod-wide prefix alone does not select a file. With no useful match, the writer creates a source-named file and can reuse an unambiguous existing directory layout. Established `replace` layouts are accepted for new mod keys; fresh mods use ordinary localization folders. New overrides require a `replace` directory. Ambiguous ownership or placement requires a file choice in VS Code; bare-LSP actions explain the unresolved choice without writing.

The `entryVersion` choices are `preserve` (follow nearby entries; no number in an empty file), `none` and `zero`. These affect new entries only. Existing versions, comments, line endings and unrelated content stay intact. Writers enforce a matching filename, language header and UTF-8 BOM. Explicit generated-file comments prevent handwritten edits and direct the author to the source workflow; the toolkit does not run external template generators.

VS Code shows **Create Localization Key** for a missing recognized key, **Edit Key at Cursor** for an owned key and **Override Localization Key** for an inherited key. The input identifies the language, destination mod and file. Source and destination snapshots are checked before saving, including unsaved buffers and changes made while the input is open. Translation exports and generated calendar files retain their specialized layouts and preserve current documents. When translation source files collapse to one output path, unique keys are merged; conflicting values for the same source key stop generation before files are written. A failed edit or save is reported as a failure.

The native Explorer exposes **Copy Vanilla File to Focus Mod** and **Create Vanilla Folder Path in Focus Mod** under the configured vanilla game root. Files retain their game-relative path, including stage directories. A folder action creates the selected path and missing parents only. Existing files are never overwritten; the actions offer opening or comparison. Clean files retain their bytes; unsaved source text is copied from its buffer with the required script or localization encoding. Game files are not saved, and these actions do not alter descriptor replacement rules.

### paradox/guiSourceEdit

The server never writes a file. A designer gesture goes out as an op and comes
back as offsets into the text you sent, which YOU apply: your editor keeps
undo, dirty state and the live preview loop. Send the buffer's current text
with every request and apply the edits to that same text, end-first.

```jsonc
// -> paradox/guiSourceEdit
{ "uri": "file:///d%3A/mods/my_mod/gui/window_my.gui",
  "text": "window = {\n\tname = \"my_window\"\n}\n",
  "op": { "kind": "setProperties", "line": 0,
          "properties": [{ "key": "size", "value": "{ 320 200 }" }] } }
// <- { "edits": [{ "start": 31, "end": 31, "newText": "\tsize = { 320 200 }\n" }] }
```

The other ops are `reorder`, `insert`, `insertRaw` (paste), `delete`,
`duplicate`, `wrap` and `blockText` (read-only, for a clipboard); a widget is
addressed by the 0-based line of its own statement, the `line` that
`paradox/guiLayout` reports for it.

Expect `{ "refused": "…" }` instead of edits and show the string: it is the
server saying the gesture would not do what it looks like it does (a box owns
its children's slots, a content-sized container ignores an explicit size, a
type definition is used by other files). A write that lands but is only half
honoured returns `edits` plus a `warning`.

### paradox/snippets

Everything the server can offer to insert at a cursor, so a host can build an
"Insert Snippet" command without shipping a snippet table of its own. Request a
position in an open script document:

```jsonc
// -> paradox/snippets
{ "uri": "file:///d%3A/mods/my_mod/events/my_events.txt",
  "position": { "line": 0, "character": 0 } }
```

```jsonc
// <- result (abbreviated; the strings carry real newlines and tabs)
{
  "snippets": [
    { "id": "event", "label": "new event", "form": "definition",
      "detail": "skeleton measured over 9,791 vanilla definitions",
      "snippet": "namespace = ${1:my_namespace}\n\n${1:my_namespace}.${2:1} = {\n\ttype = ${3|character_event,activity_event,letter_event,court_event|}\n\t…\n}",
      "plain":   "namespace = my_namespace\n\nmy_namespace.1 = {\n\ttype = character_event\n\t…\n}" },
    { "id": "event.option", "label": "option block", "form": "block", "…": "…" },
    { "id": "if", "label": "if", "form": "token", "…": "…" }
  ]
}
```

Notes worth reading before you draw it:

- **Both insert forms always ship.** Use `snippet` only if you expand `${1:…}`
  tabstops; `plain` is the same shape with the placeholder text written out and
  is guaranteed free of `${`. This mirrors the `snippetSupport` gate on
  completion inserts.
- **`form` groups the list**: one `definition` (the document folder's own kind),
  then its `block` children, then `token` entries for the engine
  triggers/effects legal in the block the cursor sits in, frequency-ordered and
  capped at 60.
- **The definition entry already knows about the file it lands in.** It writes
  the `namespace =` header only when the document declares none, and reuses the
  namespace the document already has when it does.
- **An empty list is a normal answer**, not an error: the document is not an
  open script document, or its folder maps to no definition kind, or nobody has
  measured that game's vanilla files yet.

### paradox/scopeAt

The scope inference that ranks completion and annotates hovers, exposed
structurally so a host can render it. Request a position in an open script
document:

```jsonc
// -> paradox/scopeAt
{ "uri": "file:///d%3A/mods/my_mod/events/my_events.txt",
  "position": { "line": 6, "character": 4 } }
```

```jsonc
// <- result, for a cursor inside  liege = { capital_province = { … } }
{
  "scopes": ["province"],
  "chain": [
    { "scopes": ["character"] },
    { "entryKeyword": "liege", "scopes": ["character"] },
    { "entryKeyword": "capital_province", "scopes": ["province"] }
  ],
  "savedScopes": [{ "name": "the_actor", "scopes": ["character"] }]
}
```

Rendering notes that will save you a redesign:

- **`scopes` is an array, never one name.** A link or iterator with several
  documented output scopes stays ambiguous instead of guessing. Render several
  as `a|b`.
- **An empty array means unknown, and it is a first-class answer**, not an
  error. Render it as "unknown". The server annotates and ranks, it never
  diagnoses on scope grounds and never asserts more than the derived link
  tables actually say.
- **`chain` is outermost first**, one entry per scope-changing step. The first
  step carries no `entryKeyword`: it is the enclosing definition's root scope
  and comes from no key.
- **`savedScopes` is file-wide, not flow-sensitive.** Every `save_scope_as` /
  `save_scope_value_as` site in the document, plus the engine-provided ambient
  scopes of its definition kind, including saves below the cursor. That is what
  completion and hover already offer, so a panel built on it cannot disagree
  with the popup.
- **`null`** means the document is not an open script document. Render nothing.

## In a browser, with no process at all

Everything above assumes a host that can spawn a process. A web page cannot,
and `@px-lsp/server/browser` is the answer to that: the same parser, schema,
token tables and scope engine, assembled as a plain library against a single
in-memory document. No child process, no JSON-RPC, no workspace scan, no
filesystem.

```ts
import { createBrowserLanguageService } from "@px-lsp/server/browser";

const tokens = await (await fetch("/px/tokens.json")).json();
const freqs = await (await fetch("/px/freqs.json")).json();
const service = createBrowserLanguageService({ tokens, freqs });

const doc = service.openDocument("events/tutorial.txt", text);
doc.diagnostics();
doc.completions(offset);
doc.hover(offset);
doc.scopeAt(offset);

doc.update(newText); // keep the handle; it holds the parse across edits
```

`openDocument` takes a **mod-relative** path. Nothing opens it, but the schema
classifies a file by its folder, so `events/tutorial.txt` gets the event
grammar and root scope while `common/scripted_effects/00_x.txt` gets that one.
`doc.kind` reports which schema entry matched, or `null` when the folder is not
one the schema knows, which is worth showing rather than silently defaulting.

### The data is baked, not parsed at runtime

On node the server parses `data/<gameId>/script_docs/*.log` at startup. That is
1.1 MB of text a browser should not download or parse, so
`scripts/bake-browser-data.ts` runs the same parsers at build time and splits
the result by how often it is needed:

| Artifact | Raw | Brotli | Needed for |
|---|---|---|---|
| `dist/browser.js` | 838 KB | 163 KB | everything (parser, schema, features) |
| `browser-data/<gameId>/tokens.json` | 527 KB | 36 KB | completion, diagnostics, scope inference |
| `browser-data/<gameId>/freqs.json` | 104 KB | 26 KB | completion ranking (optional) |
| `browser-data/<gameId>/docs.json` | 608 KB | 72 KB | hover prose only |

So a page is answering completions and diagnostics after 225 KB brotli, and
`docs.json` can wait until the first hover:

```ts
service.attachDocs(await (await fetch("/px/docs.json")).json());
```

Hover works before that call; it just has names and scopes instead of prose.
`capabilities.hoverDocs` says which state you are in.

Regenerate the payloads with `pnpm run bake:browser`, which bakes every game
that ships `script_docs` (add `-- --game <id>` for one). They carry
a version that `createBrowserLanguageService` checks, so a payload baked by a
different server version fails loudly at startup instead of producing subtly
wrong answers.

Browser hovers use plain Markdown without VS Code command links, HTML spans, theme variables or codicons. Completion items retain snippet tabstops for the host to expand. Each synchronous browser feature call restores the surrounding host's output capabilities before it returns.

### What a browser build cannot know

The service has exactly one file: the one you opened. `capabilities` states
this field by field, and a host should surface it rather than imply the
fidelity of the editor:

- `workspaceIndex: false`. No vanilla scan and no other mod files, so a
  reference to a trait, decision or scripted effect defined elsewhere does not
  resolve. Definitions in the **open document** do, which is why hover on a
  `scripted_effect` you just wrote above still works.
- `referenceDiagnostics: false`. The unknown-reference checks need that index.
  They are omitted rather than approximated, because a false "unknown trait" on
  a trait that exists is worse than no check.
- `guiAndAssets: false`. `.gui` layout, DDS decoding, `[ ... ]` datafunctions
  and the tiger runner are node-only or need a game install.

Diagnostics are therefore the structural and file-layout class only: unbalanced
braces, encoding traps, and folder traps like `common/on_actions/` (plural,
which CK3 silently ignores).

### How the node builtins are handled

The feature modules import `fs`, `path` and `os` on paths a browser never
reaches (`loadSchema(null)` takes no filesystem path, and the token tables
arrive as JSON). The browser bundle aliases all three to
`src/browser/shims/`, plus `vscode-languageserver/node` to
`vscode-languageserver-types`, which drops the JSON-RPC transport the library
form has no use for.

The `fs` shim is an empty filesystem: `existsSync` is false and the readers
throw `ENOENT`, so anything that ever did slip onto a disk-backed path fails
the way a missing file fails on node. The `path` shim is POSIX-only and is
pinned against node's own `path.posix` in
`packages/server/test/browserPath.test.ts`, because `classifyFile` picks a
schema entry with `path.relative` and a shim that disagrees by one segment
would produce a wrong diagnostic rather than a visible failure.

Consumers do not need any of these aliases: `@px-lsp/server/browser` resolves
to the prebuilt `dist/browser.js` with the shims already linked in.

### What this is not

It is not the VS Code editor in a page, and it is not an LSP server in a Web
Worker. It is the language knowledge as a library. A worker-hosted LSP would
wrap this module with `BrowserMessageReader`/`BrowserMessageWriter` and the
transport alias above changed back to `vscode-languageserver/browser`; nothing
in the service would need to move.

## What is deliberately absent

These VS Code extension features are implemented in the client rather than the language server.

- **No tiger diagnostics.** Deep validation (unknown effects, unknown traits,
  wrong argument types) is [ck3-tiger / vic3-tiger](https://github.com/amtep/tiger)'s
  job by design, not this server's, and the download-and-run integration lives
  in the client. The server's own diagnostics stay in the class it can decide
  with certainty: structural damage, encoding and file-layout traps, missing
  required localization, and references to events no declared namespace
  contains. Run tiger from your host and map its output into your own
  diagnostics if you want it, exactly as the extension does. There is no EU5
  tiger build at all.
- **No overview UIs.** The event graph, GUI preview, mod report and coverage
  views are VS Code webviews. The *data* behind every one of them is on the
  wire (`paradox/eventGraph`, `paradox/guiLayout`, `paradox/modOverview`,
  `paradox/locCoverage`), which is the split on purpose: the server computes,
  the client draws.
- **No `.dds` rendering.** Hovering a texture path still produces a hover, but
  the image is a `data:` URI in the markdown. A client that does not render
  images in hover markdown shows the link text instead. The DDS decoder itself
  is vscode-free (`packages/server/src/dds/`) if you need to build your own
  viewer.

The `@px-lsp/server/dds` module also exports `encodeDds(width, height, rgba, format, mipmaps = false)`. Formats are `bc1`, `bc3` and `bgra8`. BC1/BC3 base dimensions must be positive multiples of four; incompatible dimensions throw instead of producing a texture Direct3D cannot load. Set `mipmaps` to `true` to write a full chain down to 1×1, or pass an integer count including the base level to write a partial chain. Invalid counts throw. Mip filtering treats RGBA channels independently, without gamma correction or normal-vector normalization. Callers replacing texture-array entries must match the original dimensions, format and mip count. These helpers do not add a conversion request to the LSP protocol.

`ddsMipLevels(bytes)` returns the stored levels as `{ level, width, height, offset, byteLength }[]`, validating the count and byte ranges. `decodeDds(bytes, mipLevel = 0)` decodes the selected stored level. Both operate on the first array slice or cubemap face. Mip enumeration rejects volume textures and padded uncompressed rows; default base-level decoding keeps its existing behavior. Layout follows [Microsoft's DDS texture layout](https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-file-layout-for-textures), including complete blocks for compressed levels smaller than 4×4. No new LSP request or client capability is required.

`ddsFormatInfo(bytes)` returns `{ format, width, height, mipLevelCount }` for a valid header, including unsupported pixel formats and images above the decode budget. `mipLevelCount` includes the base image and normalizes header counts of zero to one without requiring the mipmap flag. It describes the header declaration, not the integrity of the mip payload. Invalid or truncated headers return `null`.

## Compatibility Patch

`px.openCompatibilityPatch(uri?)` opens a maintained patch project in VS Code. An optional file URI selects its output mod. The workflow requires workspace trust, `px.experimentalFeatures` and a non-null `GameMeta.compatchComposition` policy. It is off by default. CK3 supplies the initial policy; Victoria 3 and EU5 do not support this workflow yet. This adds no LSP request or browser-service workflow. The pure engine and project model have no VS Code or Node imports; the filesystem and editor adapters are separate.

The output mod contains `.px-toolkit/compatibility.json`, version 1. It stores a project ID, ordered source IDs, decision intent and fingerprints, and previous generated content. The baseline permits three-way updates against current output, including unsaved text. Adopted files also retain their original content so retiring a generated change can restore that content instead of deleting an existing file. Unknown metadata survives writes; unsupported format versions are rejected. Source and output paths are private `px.machinePaths.patches[projectId]` bindings. Recovery journals and pointers remain private extension storage. Share the portable file with the patch and reconnect source folders on another machine.

The user creates or opens a patch, adds source folders, matches launcher order, then scans. Creation uses the existing launcher-link helper to register the new mod, records its game in `project.json`, and installs the standard Toolkit upload exclusions. Existing launcher links are never overwritten. The engine resolves whole-file shadowing before definition identity. It explains suppressed contributions and inferred winners, and reports missing, late or ambiguous descriptor dependencies without changing the chosen order. Save a source contribution, follow the expected winner, combine supported direct fields, write a manual result, or choose **Handle outside toolkit**. That last choice records outstanding manual work; it is not a compatibility approval. Decisions depend on relevant contributions, declarations and loading policy. Changed or removed inputs reopen affected decisions. Unrelated siblings do not invalidate a definition choice. A refresh rereads the selected inputs; saving a choice reuses the frozen inventory.

CK3 semantic composition covers events, decisions, script values, scripted effects, scripted triggers and localization. Direct-field composition is restricted to supported decision/event shapes; ordered operations and repeated fields are never treated as sets. Event priority follows installed game documentation. The engine rebuilds original relative files, preserving sibling definitions and required context. Localization uses the shared ownership and placement policy, including existing files and `replace` defaults. Unsupported cross-file precedence, `replace_path` effects, first-in-wins output and incompatible contexts block automatic writes. Binary assets are inventoried for external review. History, nested databases and GUI semantics require separate rules. A patch loaded after its source mods cannot automatically win every first-in-wins resource.

**Build patch** prepares exact output and metadata changes. Independent manual edits are merged against the previous generated baseline with Git; Git must be available on the host when this merge is needed. Overlapping edits, deleted generated files and unowned collisions need an explicit choice. **Apply patch** uses the same frozen-file transaction and journal implementation as version migrations. It rejects changed sources, descriptors, output, routing inputs or editor buffers. Metadata is written last. A pending recovery pointer is saved before mutation; interrupted updates remain blocked until restored. **Restore last update** preserves later edits by reporting conflicts. The output descriptor records source dependencies, but the user must still enable and order the patch in the launcher. No Crozier-compatible validator is available, and successful generation does not establish gameplay compatibility.

## Compatch replacement intent

The VS Code workflow requires `px.experimentalFeatures`, which defaults to `false`. The setting hides Compatch commands, menus and views, and command handlers reject direct calls while it is disabled. Disabling it stops target validation and suspends active sessions without deleting files or saved reviews. Bare LSP clients and the browser service have no Compatch entry point.

New game-update sessions require a separate Result folder. Setup copies the original mod's files, including assets and localization, without overwriting existing Result files. Merges use the current Result text and check the original mod for stale input. The original mod and both game versions stay read-only. Saved sessions that used the original mod as their output retain the legacy in-place workflow and its recovery checks.

Result initialization does not register a separate launcher entry. Before testing in the game, register the Result folder as a mod and enable that entry in a test playset. The original mod's launcher entry still points to the original files.

In game-update sessions, selecting a review row or using Next Unreviewed opens read-only snapshots of the old and target game versions. These differences are review candidates, not required mod edits or compatibility findings. The entry actions offer old-game and target-game comparisons against read-only mod snapshots, including current unsaved text. These references cannot copy game content into the mod through the diff editor. **Open result file** opens the editable Result file; legacy in-place sessions retain **Open mod file**. Explicit merge previews and apply commands remain separate; a text merge without conflicts does not establish applicability to a total conversion.

Compatch is a VS Code client workflow, with no LSP methods or browser-service equivalent. In a game-update session, a file row's **Set Replacement Intent** action records an explicit file or folder rule in the workspace's saved Compatch session. Folder rules include descendants and future mod files. Rules persist across rescans and session reloads; removing a folder rule affects every matching mod file. They do not edit the mod descriptor, exclude additional vanilla files from the game, or transfer to a newly created session.

Matching mod files and their definitions have an **Intentional replacement** queue state. They remain visible in All and Intentional replacements, but Next Unreviewed skips them. Merge previews, clean merges, previously prepared merge results and localization key updates cannot publish game content into a protected file. Manual editor edits remain available. Replacement intent is independent of reviewed/skipped decisions and target-validation results.

Target validation runs against the whole Result mod, including intentional replacements and mod-only definitions. Source and Result changes make earlier validation results outdated. Replacement intent does not establish compatibility, infer required fields from vanilla usage, or automatically identify new vanilla files that could enter the mod. Replacement suggestions and structural migration comparisons are not implemented. File and folder rules work for every game profile; semantic matching and target validation retain their existing profile capability gates.

## Mod Compatibility

For combining several mods, use the separate [Compatibility Patch workflow](#compatibility-patch). Game-version recipes retain their explicit source and target build model.

Mod Compatibility is a VS Code workflow gated by `px.experimentalFeatures`. `px.openMigrations` opens the panel. `px.loadMigrationRecipe` opens multi-file contribution loading; `px.loadMigrationFolder` opens folder selection. Both accept `(uri?, selection?: vscode.Uri[])` for Explorer actions, preferring a nonempty selection. Folder discovery includes nested `.json`, `.cjs` and `.js` files, deduplicates overlapping selections and excludes linked descendants, `.git`, `node_modules` and `.px-toolkit`. A multi-select checklist precedes loading folder candidates. Discovery has explicit size and depth limits and never executes code. Compatibility notes and migration recipes share explicit exact-build transitions. The planner includes every contribution on each selected edge, orders declared entry dependencies, presents distinct routes after **Find route** for an explicit choice, and reports route gaps. Connection alone does not establish complete game-change coverage.

The host pins selected file hashes before a single executable-code trust decision for the batch, stages worker results, and validates IDs before replacing the local library. Load failures leave the previous library and prepared plan in place. The transaction covers toolkit state, not side effects of trusted author code. Loading a folder is a one-time import, not a file watcher. **Create an entry…** offers a data-only JSON note or a self-contained JavaScript recipe demonstrating recursive folder inputs and edits to several files.

Data-only JSON notes contain `{manifest}` or an array of those objects and never evaluate author code. Self-contained `.cjs` or `.js` artifacts can export one contribution or an array. Executable artifacts require workspace trust and an explicit **Trust and load** notification. Their code runs with the user's permissions. Workers, timeouts and termination are not a security sandbox. Changed code needs a new trust decision, and saved local metadata does not grant execution trust after reopening. Saved executable artifacts require reload and trust; saved JSON notes use **Refresh note** without an executable-code trust decision.

The host captures declared inputs, including current unsaved mod text, then runs detector inspection and questions. Static advisories display guidance without a detector or an empty edit plan. **Use migration** inspects a recipe, **Review changes** prepares its exact diff, and **Apply migration** applies the reviewed bytes. A detector advisory uses **Check mod**. Required manual work uses **Record manual resolution** with the user's note; recipes also offer it after inspection when automatic changes cannot complete the work, including unknown applicability. Informational guidance uses **Mark read**. Human decisions and required manual work pause a route. Completion records distinguish applied changes, no affected content, manual reports and read acknowledgments. None is a whole-mod compatibility certificate.

The host applies one step before inspecting the next, so later inspection sees earlier file changes. The version-2 session saves exact route builds, the chosen route, answers, local manifests and hashes, per-entry completion notes, and explicitly selected read-only reference folders per build. An entry without source inputs does not require old-game data; intermediate edges can require their own references. Built-in libraries live behind the game profile. The progress fingerprint covers route, catalog and artifact identities and completed entries' declared inputs. Missing future references can be selected and future-only inputs can change without clearing earlier progress. A change to completed-entry inputs reopens the route for review.

Preparation records exact before/after bytes and hashes of inputs, artifact and plan. Apply does not rerun author code. Changed files, references, code or editor documents require a fresh preview. Apply saves touched open documents with their reviewed unsaved content. Their encoding must match the expected UTF-8 or UTF-8-with-BOM output before a new preview. The journal restores applied steps in reverse order and rejects later edits. Write and recovery failures remain failures.

The compiled `@px-lsp/server/migrations` export provides `defineMigration`, `defineAdvisory` and SDK types; `/migrations/engine` provides inspection, preparation and validation; `/migrations/testing` provides `createMigrationSnapshot({ gameId, mod, source?, target?, metadata? })`, in-memory fixtures and idempotence checks. Snapshot file maps accept text or bytes, preserve supplied encoding and clone byte arrays. Preparation errors identify failed findings or checks; idempotence failures identify files changed again. `/migrations/routes` exports `planMigrationRoutes(catalog, gameId, fromVersion, toVersion)` returning `{ versions, routes, issues }`. The planner reports incomplete enumeration at its 128-route or 10,000-search-step limit. Embedders must supply their own capture, route progress, preview, apply and recovery. No new LSP methods, bare-client UI or browser-service workflow are provided. See the [author guide](../packages/server/migrations/README.md).

SDK 2 adds listing and fixed-prefix captures, file-size metadata, extension filters, reference selectors that match mod paths, and an optional discovery phase that requests exact full files. The host freezes the capture in plans and completion records. Apply does not rerun discovery. Continuation batches leave the entry open; partial group selection cannot mark the whole recipe complete. SDK 1 remains supported. See the author guide for capture limits and host responsibilities.

CK3 offers faith/rite and portrait/clothing mask recipes from `1.19.0.6` to the explicit targets `1.20.0.2` and `1.20.0.3`. The 1.20.0.3 route uses audited installed schemas and target texture requirements; it does not imply support for other patch versions. Faith conversion requests representation, parent, holy-site and reference decisions, preserves supported inheritance and blocks unresolved cases. Mask conversion identifies actual consumers, compares compatible target requirements, or asks for an explicit policy. Binary review includes DDS dimensions, format and stored levels. Source evidence includes an archived folder label; target structure comes from installed documentation. No Crozier-compatible Tiger validator is available, and gameplay behavior remains unverified. Victoria 3 and EU5 have empty built-in libraries. Dependency load-order composition remains unavailable. Synthetic tests establish host mechanics, not whole-mod game compatibility.

## Reference clients in this repository

Three of them, all runnable, all kept honest by CI or by the release checklist.

- **`packages/server/test/lspSmoke.test.ts`** is the closest thing to a worked
  example of a rich embedder. It forks the packaged bundle over node IPC and
  drives the real protocol end to end: `initialize` with `processId` and full
  `ParadoxInitOptions`, the `serverInfo` assertion, `didOpen`, completion and
  resolve, hover, definition, semantic tokens, `paradox/scopeAt`,
  `paradox/guiTree`, then `shutdown`. It also forks a second server declaring
  `hoverHtml` with zero commands, which is the capability combination the old
  boolean could not express.
- **`packages/server/test/stdioSmoke.test.ts`** is the same flow over
  `--stdio` with **no** `initializationOptions` at all, so it is the executable
  statement of what the fallbacks do on their own. `PX_LSP_SERVER` points it at
  another bundle, which is how CI smokes the extracted release tarball.
- **`scripts/nvim-parity/`** drives headless neovim through the plain-client
  setup against a real mod. Beyond feature presence it checks that hovers carry
  no VS Code markup or dead `command:` links, that external edits are picked up
  without a restart, and that the status mirror reaches the log. It needs
  neovim, a game install and a real mod, so it is run by hand before a release
  rather than in CI. Its README has the invocation.

## Release artifacts

Both are attached to every [GitHub release](https://github.com/JDeffner/paradox-modding-toolkit/releases)
and stage the identical server payload, defined once in
`scripts/server-package.mjs` so the two cannot drift apart.

**`px-lsp-server-<version>.tar.gz`**, the portable one. Needs Node 18+ on the
target machine.

```
px-lsp-server-<version>/
  dist/server.js
  data/ck3/  data/vic3/          # bundled fallback data, found automatically
  README.md LICENSE THIRD-PARTY-NOTICES.md
```

**`px-lsp-win-x64-<version>.zip`**, the one to embed on Windows. Same payload
plus an unmodified official nodejs.org build, so nothing has to be installed
first.

```
px-lsp-win-x64-<version>/
  px-lsp.cmd         # runs the bundled node against dist/server.js --stdio
  node.exe           # official win-x64 build, unmodified
  NODE-LICENSE       # Node's own license (the GPL LICENSE keeps the plain name)
  dist/ data/ README.md LICENSE THIRD-PARTY-NOTICES.md
```

The Node build is pinned to an Active LTS release, downloaded from nodejs.org
and verified against that release's own `SHASUMS256.txt` at build time.

**Do not flatten either archive.** The server finds its bundled data at
`../data/<gameId>/` relative to `dist/server.js`, so `dist/` and `data/` must
stay siblings, or `dataDir` must name the new root. Flattened, the server still
starts and still answers requests, it just silently loses the bundled wiki
tokens and the frequency tables. The startup `window/logMessage` line names the
directory it resolved, which is how you tell the two apart.

Redistribution: the server is GPL-3.0-or-later, `node.exe` keeps its own
license as `NODE-LICENSE`, the bundled CK3 wiki token lists are CC BY-SA 3.0
(`data/ck3/wikidocs/ATTRIBUTION.md`) and the EU5 schema table derives from
MIT-licensed community CWT rules. `THIRD-PARTY-NOTICES.md` ships in both
archives with the full texts.

### Exporting generated snippets

Call `paradox/snippetCatalogue` with `{}` for the full active-game catalogue, without requiring an open document or applying the cursor picker's cap. The response includes engine templates, definition and child-block skeletons, and effective indexed scripted calls. Every available variant includes snippet syntax, plain insertion text and completion-preview Markdown. An `indexing: true` response has no entries; request again after indexing finishes. VS Code uses this request for `px.exportSnippets`, which saves a self-contained, searchable HTML file with copy and print controls. See the Protocol Reference for the response fields.
