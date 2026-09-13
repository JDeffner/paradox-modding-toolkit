# Webview panels: how they are built, and how to add one

Every visual tool in the extension is a webview panel: the Project dashboard,
the event graph, the event simulator, the GUI editor, the Flag Builder, the
Workshop panel, the Examples Wiki. They all follow one pattern, and the build
discovers them by folder name, so adding a panel means adding a folder, not
editing build scripts.

Read this next to a working example. **`packages/vscode/src/webviews/exampleWiki/`
is the reference implementation**: a search list, a detail pane, one server
request in each direction, about 600 lines in total. The GUI editor is the
deep end; its [README](../packages/vscode/src/webviews/guiEditor/README.md)
documents the host contract idea in full.

## The pattern

A panel is a folder `packages/vscode/src/webviews/<name>/` with four parts:

| File | Runs where | What it is |
|---|---|---|
| `messages.ts` | both | The typed contract: an `AppToHost` union and a `HostToApp` union. Every byte that crosses the webview boundary is one of these messages. |
| `panel.ts` | extension host | The VS Code host: creates the panel, answers app messages, talks to the language server, opens files. The only file that imports `vscode`. |
| `html.ts` | extension host | The page: markup and page-specific CSS on top of the shared stylesheet, plus the CSP and the script tag. No logic. |
| `app/main.ts` | webview (browser) | The app: everything the user sees and clicks. It gets the DOM and nothing else. |

The split is the point. The app never imports `vscode`, never touches the
file system, and never talks to the server directly. It asks the host through
`messages.ts`, and the host does the two things a browser page cannot: fetch
over the wire and act on the workspace. This keeps the app testable in plain
jsdom and keeps every capability decision in one reviewable file.

Analysis stays out of both halves. Anything the panel knows about game script
comes from the language server over a `paradox/*` request, typed in
`packages/protocol` and documented in `docs/PROTOCOL.md`. The host is a
courier, not a brain.

### Creators are the same pattern, shared three ways

The definition creators (`traitCreator`, `legacyCreator`, `cultureCreator`) are
ordinary panels, but they share three modules instead of writing the same code
three times. `packages/vscode/src/creators/save.ts` is the host half: pick the
mod, pick the file, refuse a name that would replace a whole game file, apply
the server's edits as one `WorkspaceEdit`, and write the loc through the normal
loc writer. `src/webviews/shared/fields.ts` is the app half: the form controls
a creator draws its fields from, so creators differ in the form they lay out,
never in how a field behaves. `src/webviews/shared/scriptBlock.ts` reads a
`name = { ... }` block into statements and writes it back, keeping every
statement a form does not model verbatim; each app adds only its per-kind value
shapes on top. (`dynastyTree` sits in the same Create group and saves through
the same host flow, but it writes history entries, not a definition block, so
its block text comes from its own `blocks.ts`.)

None of the shared modules knows anything per kind. That comes over the wire, from
`paradox/definitionForm` and `paradox/definitionEdit`: the server assembles the
key list, the docs and the option lists out of the schema and the game's own
files. So a new creator is a new panel folder plus a `GameMeta.creators` row on
the profile that has the data for it, not a new field table.

## The build finds your panel

`scripts/compile-webviews.mjs` bundles every `src/webviews/<name>/app/main.ts`
to `dist/webview/<name>.js` (esbuild, IIFE, es2020). It runs as
`compile:webview` inside `pnpm run compile`, and with `--typecheck` inside
`pnpm run typecheck`. There is no list to edit.

Two files make discovery work for a new panel:

- `app/main.ts` is the entry point. Its presence is what marks the folder as
  a panel with its own bundle.
- `app/tsconfig.json` gives the app browser types (`lib: DOM`, `types: []`).
  Copy `exampleWiki/app/tsconfig.json`; the root tsconfig excludes `app/`
  folders on purpose, because extension-host types and DOM types must never
  mix.

`guiEditorPackaging.test.ts` replays the same discovery rule and fails if a
panel's bundle stops shipping in the .vsix or its `panel.ts` loads a path the
build does not produce. You do not extend it; it finds your panel too.

## Checklist for a new panel

1. **Create the folder** with the four parts above. Start from a copy of
   `exampleWiki/` and cut it down.
2. **Wire the command.** Register `px.show<YourPanel>` in
   `packages/vscode/src/extension.ts`, add it to `contributes.commands` in
   `packages/vscode/package.json` (category `Paradox`), and to the
   `commandPalette` menu with the same `when` clause its neighbours use.
3. **Add a Project panel row** in `src/webviews/dashboard/actions.ts`. The
   dashboard is the discoverable home for every tool; a command only in the
   palette does not exist for most users.
4. **Give the tab an icon.** Add the name to `TabIconName` in
   `src/webviews/tabIcons.ts` and to `scripts/gen-tab-icons.ts`, using the
   same Lucide glyph as the dashboard row, then regenerate.
5. **Feed it from the server.** New data means a new `paradox/*` request:
   type it in `packages/protocol`, implement it in `packages/server`, add it
   to `docs/PROTOCOL.md` (and its wiki mirror), and extend `lspSmoke.test.ts`.
   Never compute game facts in the extension host.
6. **Use the design system.** `src/webviews/shared/README.md` is the rulebook:
   inline `ui.css` (`import uiCss from "../shared/ui.css"`), px-ui classes,
   Lucide icons from `shared/icons.ts`, `menu()` instead of `<select>`,
   `confirmDialog()` for anything destructive. Check the page in a dark theme
   and a light theme before calling it done.
7. **Test the logic, not the pixels.** Keep decisions in pure modules the app
   imports, and test those directly with vitest. For app-level behavior,
   build the real bundle and boot it in jsdom against a stub host:
   `eventGraphQuery.test.ts` is the small version of that pattern,
   `guiEditorHarness.ts` the full one.
8. **Write the changelog bullet** under Unreleased in
   `packages/vscode/CHANGELOG.md`, in the same PR.

## Things that will bite you

- **The CSP is strict.** `default-src 'none'`, then allow only what the page
  needs (see `exampleWiki/panel.ts`). No remote assets of any kind; images
  are `data:` URIs or `webview.cspSource` files, icons come from
  `shared/icons.ts`.
- **`window.confirm` and `window.alert` do not exist** in VS Code webviews.
  They fail silently. Use the shared `confirmDialog()` and `toast()`.
- **A hidden tab suspends `requestAnimationFrame`.** Anything that animates
  or polls on rAF stops when the user switches tabs and must cope with the
  gap when it wakes.
- **`retainContextWhenHidden` is a choice, not a default.** Without it the
  webview is torn down when hidden and your app reboots on every tab switch;
  with it you pay memory. Either way, the host must be able to rebuild the
  app's state, because the panel can always be closed and reopened.
- **Per-game behavior is data, not `if (gameId === ...)`.** A panel that only
  works for some games gates on `GameProfile` facts, the same as everything
  else; `node scripts/check-game-boundary.mjs` enforces it on the server
  side.
- **Number the messages you wait for.** A request/response pair keyed by an
  `id` must answer every id exactly once, or a gesture stays armed forever.
  The GUI editor README explains why this rule is load-bearing.

## The dev loops

Three loops, from fastest to most complete. Pick by what you are iterating
on.

**Browser, for UI iteration.** `pnpm run preview:webviews` starts a dev
server (default port 5317) with two pages, both auto-reloading on save and
carrying a Dark/Light toggle that stands in for the VS Code theme:

- `/gallery` renders every px-ui component from the live `ui.css`, wired
  through the real shared modules (menu, dialog, toast, scrub, sortable,
  color picker). Edit anything under `shared/` and the page reloads. This is
  the gallery shared/README.md asks you to extend before shipping a new
  component.
- `/gui` boots the real GUI editor bundle over a stub host, with a real
  layout of one file: `pnpm run preview:webviews -- path/to/file.gui`
  (game and mod paths come from `dev-paths.json` or `--game`/`--mod`).
  Nothing is written; edit gestures answer with an honest refusal.

Use the browser's developer tools to inspect the page. In VS Code, **Developer: Open Webview Developer Tools** provides the equivalent tools. This browser loop uses a stub host; use the next loop to test real host behavior.

**Live Webview, for app work in VS Code.** Build the companion checkout with `pnpm build`, package it with `pnpm package`, and install its `artifacts/live-webview-<version>.vsix` into the VS Code profile used by the Extension Development Host. The companion's current extension ID is `local.live-webview`. Set `liveWebviewPath` in this repo's ignored `dev-paths.json` to that checkout root, or set `PX_LIVE_WEBVIEW_PATH` before starting VS Code. This local helper is optional and unpublished; normal builds need no helper installation.

Select **Run Extension + Live Webview** in Run and Debug, then press F5. The launch task builds the toolkit with the helper enabled and starts `pnpm run watch:webviews:live`. Open a mod folder in the development host, then open the panel you want to test. Each successful app build writes its own signal under `packages/vscode/.webview-dev/`; the companion reloads the registered instances of that app. Failed builds leave the current panel running. Use the **Live Webview** Explorer view to pause, resume, or reload an instance, and **Live Webview: Open Logs** to inspect callbacks. Stop the debug session and terminate the **live webviews** task when finished.

The command-line equivalent is `pnpm run compile:webview-dev`, followed by `pnpm run watch:webviews:live` and an Extension Development Host that loads `packages/vscode`. Changes to host code, HTML generators, or CSS imported by those generators require another `compile:webview-dev` and a host restart. Host-inline panels have the same limit. Reload restores only state the app already saves or requests from its host; unsaved DOM state can be lost.

The existing loop remains available: run `pnpm run watch:webviews` and use **Run Extension**. An installed test VSIX can load and watch these bundles through `px.dev.webviewSource`, set to the checkout's `packages/vscode/dist/webview` folder. The companion takes over reload scheduling only in the explicit Live Webview development build. Normal compilation and packaging remove the helper, and the VSIX excludes build signals.

**The real artifact.** `pnpm run package:test` builds a .vsix and installs
it into your own VS Code. Do this before calling a panel done; it is the
only loop that runs exactly what ships.
