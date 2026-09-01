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

## Trying it

Press F5 (the tracked launch config builds everything and opens an Extension
Development Host), open a mod folder in the new window, and run your command.
`Developer: Reload Window` in that window picks up a rebuild. When the panel
is worth showing someone, `pnpm run package:test` installs a real .vsix into
your own VS Code.
