# GUI and the script-to-UI bridge

- [Layout of the UI files](#layout-of-the-ui-files)
- [GUI is first-loaded-wins](#gui-is-first-loaded-wins)
- [Adding UI without touching vanilla](#adding-ui-without-touching-vanilla)
- [Scripted GUIs](#scripted-guis)
- [Scripted buttons](#scripted-buttons)
- [Scripted progress bars](#scripted-progress-bars)
- [The tooltip builder](#the-tooltip-builder)
- [Debugging GUI](#debugging-gui)

## Layout of the UI files

`gui/` holds 204 `.gui` files plus one `.shortcuts`, one `.layout`, and
`gui/scripted_widgets/scripted_widgets.md`. Subfolders: `achievements`, `frontend`, `jomini`,
`journal_entry_widgets`, `notifications`, `pdx_account`, `settings`, `shared`, `tools`,
`scripted_widgets`.

`interface/` is **one file** (`interface/messagetypes.txt`), not the CK3-style GUI tree. All UI
lives in `gui/`.

`data_binding/gui_macros.txt` defines text macros for data-binding expressions.

Format is the Jomini `types` / `type X = base { }` / `blockoverride` family, same as CK3:

```
types decisions_panel_types
{
    type decisions_panel = default_block_window {
        name = "decisions_panel"

        blockoverride "window_header_name" {
            raw_text = "DECISIONS_PANEL_HEADER"
        }
    }
}
```

## GUI is first-loaded-wins

Files load in ASCII order. For script, the last definition loaded wins. **For GUI it is the
opposite: once a GUI type or template is loaded it cannot be overwritten.** The first one wins.

This inverts CK3 intuition and is the most common reason a GUI override "does nothing". Naming a
file `zzz_*.gui` to win a conflict, which works for script, guarantees losing it for GUI.

## Adding UI without touching vanilla

Victoria 3 ships a first-party injection mechanism, so overriding a vanilla `.gui` is almost
never necessary. From `gui/scripted_widgets/scripted_widgets.md`, quoted:

> Files here can contain pairs of file path and widget names to automatically create widgets on
> startup that are not formally referenced by the code.

A mod drops its own file into `gui/scripted_widgets/` containing lines of the form:

```
gui/my_mod_widgets.gui = my_mod_status_panel
gui/my_mod_widgets.gui = my_mod_side_bar
```

The doc notes that all files in the folder are loaded, so several mods can each add widgets
without colliding, as long as their paths differ. Vanilla ships only the `.md` in that folder, so
there is nothing to conflict with.

**Second route:** a journal entry can mount a widget directly, with no scripted_widgets entry:

```
widget = {
    gui = "gui/my_mod_widgets.gui"
    name = "my_widget"
    container = "custom_widget_container_1"
}
```

The named anchors are `custom_widget_container_1` through `_7`, plus
`custom_widget_container_je_icon`.

## Scripted GUIs

`common/scripted_guis/` (4 files), documented by `scripted_guis.md`:

```
scripted_gui_key = {
    scope = < string >          # what scope type this is available to
    is_shown = { trigger }
    is_valid = { trigger }
    effect = { effect }
    saved_scopes = { scopes }
    notification_key = < key >  # default jomini_scripted_gui_confirm
    confirm_title = {}
    confirm_text = {}
    ai_is_valid = { trigger }   # default false
    ai_chance = { }             # script value between 1 and 100
    ai_frequency = {}           # in months
}
```

Scope values used across vanilla's scripted GUIs and buttons: `country` (18),
`political_movement` (2), `character` (2), `state` (1).

## Scripted buttons

`common/scripted_buttons/` (51 files), documented. Script side is `name`, `desc`,
`effect_desc`, `visible`, `possible`, `ai_chance`, `effect`. A journal entry attaches one with
`scripted_button = <key>`.

The doc names the exact UI-side accessors, which is what you need when writing the `.gui`:
`[JournalEntry.GetScriptedButtons]` returns the datamodel, then `[ScriptedButton.GetName]`,
`.GetDesc`, `.GetEffectDesc`, `.IsVisible`, `.IsPossible`, `.ExecuteEffect`.

## Scripted progress bars

`common/scripted_progress_bars/` (15 files), documented. Fields: `name`, `desc`, `second_desc`,
`is_inverted`, `start_value`, `min_value`, `max_value`, a style flag (`default`,
`default_green`, `default_bad`, `double_sided_gold`, `double_sided_bad`), and
`weekly_progress` / `monthly_progress` / `yearly_progress` blocks taking
`add = { desc = <key>  value = ... }`.

Attached to a journal entry with `scripted_progress_bar = <name>`. The doc notes these execute
**before** the corresponding journal entry pulses, which matters when both change the same
variable.

## The tooltip builder

A documented idiom worth knowing: a scripted GUI whose `effect` only emits `custom_tooltip`
lines, called from localization to build a dynamic list:

```
[GetScriptedGui('SGUI_KEY').ExecuteTooltip(GuiScope.SetRoot(ROOT.GetCountry.MakeScope).End)]
```

The doc carries its own warning: this is UI work, so it re-runs every frame while visible. Keep
the effect cheap and never iterate the world inside it.

## Debugging GUI

Ask the user to launch with `-debug_mode`, then:

| Need | Command or file |
|---|---|
| The data-binding surface (promotes, functions, return types) | console `dump_data_types`, then read `<logs>\data_types\` |
| Spawn a widget to test it | console `GUI.CreateWidget gui/my_file.gui my_widget_name` |
| Remove it again | console `gui.clearwidgets <name>` |
| GUI load errors | `<logs>\gui.log` and `<logs>\error.log` |

`data_types_gui.txt` and `data_types_internalclausewitzgui.txt` hold the widget-side surface;
`data_types_script.txt` is the small slice most useful when writing localization.
