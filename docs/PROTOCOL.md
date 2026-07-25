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

`initializationOptions` (all fields optional; the server has fail-soft
fallbacks for bare clients):

```ts
interface ParadoxInitOptions {
  storageDir: string;    // server-side cache dir; default: <os tmp>/px-lsp
  wikidocsDir: string;   // bundled wikidocs folder; default: data/<gameId>/wikidocs next to dist/server.js
  settings: ParadoxSettings;
}

interface ParadoxSettings {
  gameId?: string;             // game profile ("ck3" today; more later); unknown/absent -> default game
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

One server instance serves one game at a time. The client detects the game
per workspace (descriptor file, else configuration) and sends it as
`settings.gameId` at initialize and in `paradox/configChanged`; changing it
triggers a full reload.

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
| `paradox/guiTree` | request | `{ uri, text }` → `GuiTree` — widget tree of a .gui document |
| `paradox/guiLayout` | request | `{ uri, text }` → `GuiLayoutResult` — measured layout rectangles for a .gui document |
| `paradox/guiWidgetEdit` | request | `GuiWidgetEditParams` → `GuiWidgetEditResult \| null` — text edit for a preview drag/property change |

`ModScopedParams` is `{ modRoot?: string | null }`: restrict a mod-scoped
request to one workspace mod (absolute root path); absent = all workspace
mods.

Full payload shapes: see `packages/protocol/src/protocol.ts` — every
interface there is part of this contract.

## Custom methods: server → client

| Method | Kind | Payload |
|---|---|---|
| `paradox/status` | notification | `{ tokens, tokensFromScriptDocs, definitions, indexing }` — data health for a status bar |
| `paradox/indexChanged` | notification | none — definition index changed (debounced); overview views should re-query |

## Client command ids

Code actions and hover markdown reference these client-side commands (a
client that does not register them simply loses the affordance; nothing else
breaks). The ids carry the `px.` prefix. They were renamed from `ck3.` in the
Paradox Toolkit rebrand; clients registering the old ids get no fallback:

- `px.editLocalization` (args: `[locKey]`)
- `px.openLocalizationSideBySide` (args: `[locKey]`)
- `px.showReferences` (args: `[uri, line, character]`, via a
  `command:` markdown link in hover — requires the client to trust it)

## Degraded modes (bare LSP clients)

Documented behavior without the VSCode client: no tiger diagnostics (tiger
runs client-side), no overview webview UIs, and no external-file-change
re-indexing unless the client sends `paradox/modFileChanged`. Completion,
hover, definition, references, rename, symbols, formatting, folding, inlay
hints, semantic tokens and structural diagnostics all work over plain LSP.
