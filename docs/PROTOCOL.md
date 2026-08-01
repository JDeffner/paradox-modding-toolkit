# px-lsp wire protocol

The contract between the px-lsp language server (`@px-lsp/server`)
and any client — the bundled VSCode extension, neovim, or an embedding
application spawning `px-lsp --stdio`. TypeScript clients should import
the method constants and payload types from `@px-lsp/protocol/protocol`
(the single source of truth); this document mirrors that file for
non-TypeScript consumers.

**Versioning**: the protocol is versioned with the packages (lockstep with
the extension). Treat any change here as an API change; additions are
backward-compatible, renames/removals are called out in the changelog.
Current as of 0.1.2 (the M2 `paradox/*` rename).

## Transport and lifecycle

- Transports: `--stdio` (auto-detected from argv; what external clients use)
  and node-ipc (VSCode). Standard JSON-RPC 2.0 LSP framing.
- Standard LSP: the server implements completion (+resolve), signatureHelp,
  hover, definition, references, rename (+prepare), documentSymbol,
  workspaceSymbol, codeAction, inlayHint, foldingRange, documentFormatting,
  semanticTokens (full), publishDiagnostics, and workDoneProgress for the
  vanilla scan.
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
  storageDir: string;   // server-side cache dir; default: <os tmp>/px-lsp
  wikidocsDir: string;  // bundled wikidocs folder; default: data/<gameId>/wikidocs next to dist/server.js
  client: ParadoxClientCapabilities; // what this client implements; absent = plain LSP client
  clientCommands: boolean;           // DEPRECATED alias, see below
  settings: ParadoxSettings;
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

One server instance serves one game at a time. The client detects the game
per workspace (descriptor file, else configuration) and sends it as
`settings.gameId` at initialize and in `paradox/configChanged`; changing it
triggers a full reload.

Bundled data is per-game: everything the server loads from disk lives under
`data/<gameId>/` next to `dist/server.js`. Only `ck3` ships a `wikidocs/`
bundle today, so `vic3` and `eu5` report `tokens: 0` in `paradox/status` and
never render wiki-token hovers — a missing `data/<gameId>/` folder is a
supported state, not an error.

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
| `paradox/dependencies` | request | `DependenciesParams` → `DependenciesResult` — dependents/dependencies of a definition (by cursor or name) |
| `paradox/scopeAt` | request | `ScopeAtParams` → `ScopeAtResult \| null` — inferred scope chain (outermost first) and visible saved scopes at a position; null when the document is not an open script document |
| `paradox/guiTree` | request | `{ uri, text }` → `GuiTree` — widget tree of a .gui document |
| `paradox/guiLayout` | request | `{ uri, text }` → `GuiLayoutResult` — measured layout rectangles for a .gui document |
| `paradox/guiWidgetEdit` | request | `GuiWidgetEditParams` → `GuiWidgetEditResult \| null` — text edit for a preview drag/property change |

`ModScopedParams` is `{ modRoot?: string | null }`: restrict a mod-scoped
request to one workspace mod (absolute root path); absent = all workspace
mods.

`paradox/scopeAt` reports scopes as string ARRAYS, never a single name: a link
or iterator with several documented outputs stays ambiguous, and an empty
array means unknown. That is the honest answer, not an error — the server
annotates and ranks, it never hides or diagnoses on scope grounds. Render
several as `a|b` and none as "unknown".

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
runs client-side) and no overview webview UIs. Completion, hover, definition,
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
