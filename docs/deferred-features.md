# Deferred features

Features that exist in the code but are hidden from users because they are not
fleshed out yet. Each entry says where the off switch is, so re-enabling one is
a two-line change.

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
