# Deferred features

Features and experiments that are not ready to expose. Each entry identifies the current implementation boundary and the work needed before release.

## Compatch (planned for 0.6.0)

Compatch is not included in 0.5.0. Its implementation remains on a separate development branch and needs its own real-mod verification before release.

## GUI editor: Interact mode (hidden 2026-08-24)

What it is: a tool mode where clicks run the variable-system half of a
widget's `onclick` and wheels scroll scrollareas, previewing the UI as the
game plays it. Not fleshed out enough yet.

Hidden by:

- `packages/vscode/src/webviews/guiEditor/html.ts`: `#modeGroup` carries
  `hidden` (plus the `#modeGroup[hidden]` CSS rule).
- `packages/vscode/src/webviews/guiEditor/app/main.ts`: `setMode` returns
  early on `"interact"`, which also disarms the `I` shortcut.

Everything else (interact.ts, the click tip, scroll offsets, the mode's
status line) is still live code and still compiled.

## GUI editor: preview values from a save game (hidden 2026-08-24)

What it is: the toolbar's "No save" dropdown (`#saveSource`), which feeds real
values from a chosen save (`paradox/guiSaveValues`) into `[datafunction]`
previews. Works, but the flow is not fleshed out enough to expose.

Hidden by:

- `packages/vscode/src/webviews/guiEditor/html.ts`: `#saveSource` carries
  `hidden` (plus the `#saveSource[hidden]` CSS rule).

The host side (pickSave, `px.guiEditor.save` state, the merge under the mod's
preview table) still runs; a save chosen before the button was hidden keeps
feeding values.

## Localization parser workers (deferred 2026-09-17)

Worker parsing remains an external experiment. No worker implementation, setting or bundle is included in this release. Full-result transfer cost exceeded the parser cost in the benchmark, and live editor results varied by file. Rapid overlapping edits, stale-result handling, cancellation and worker failures still need tests. The release uses synchronous incremental localization parsing and cached coverage instead. See [Performance](PERFORMANCE.md#incremental-localization-parsing-2026-09-17) for measurements and the remaining full-file definition rebuild cost.
