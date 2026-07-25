# Chapter 7: Custom GUI

CK3's interface is built in PdxGui, a declarative widget language in `.gui` files. UI modding has a reputation for pain, mostly earned by people copying `hud.gui` into their mod. This chapter teaches the additive approach that survives patches: **scripted_widgets injection**, plus the data-binding bridges that connect UI to your script.

Ground rules first. UI mods **can** restyle windows, add buttons, surface more information and add entirely new windows. They **cannot** add new hotkeys (mod `.shortcuts` files are ignored) or display data the developers exposed no function for. Remember from Chapter 1 that GUI types and templates resolve **FIOS** (first-loaded wins), the opposite of script.

## The patch-safety ladder

From safest to most fragile:

1. **Scripted widgets (use this).** Register your own new `.gui` file's top-level widget into the running HUD via a registry file. Touches zero vanilla files. All mods' registries load additively, so mods never conflict here.
2. **New types/templates in new files.** Your own reusable widget classes, referenced from your own windows.
3. **Redefining a single vanilla type** in a file that loads first (`gui/00_yourmod.gui`). Changes every screen using that type; fragile.
4. **Overriding a whole vanilla `.gui` file.** Forks thousands of lines, breaks every patch, hard-conflicts with other UI mods. Some big mods pay this cost for deep integration; do not imitate them unless pixel-perfect placement inside a vanilla window is truly non-negotiable.

## Worked example: a chronicle fame HUD bar

Five small files give you a progress bar on the HUD that reads a script value, shows a tooltip and reacts to clicks. This mirrors how production mods actually build resource bars.

**A. The registry.** `gui/scripted_widgets/chron_widgets.txt`:

```
gui/chron_windows/chron_hud.gui = chron_fame_hud
```

One line per widget: `path/relative/to/mod/root.gui = top_level_widget_name`. At map load the engine creates the named widget. The name must match a top-level widget in that file **exactly**; a mismatch means it silently never spawns.

**B. The HUD container.** `gui/chron_windows/chron_hud.gui`:

```
widget = {
	name = "chron_fame_hud"              # MUST match the registry line
	layer = bottom
	visible = "[And( Not(IsPauseMenuShown), And( IsDefaultGUIMode, GetPlayer.IsValid ) )]"
	size = { 100% 100% }                  # full-screen anchor container

	vbox = {
		parentanchor = bottom|hcenter
		position = { 17 -12 }
		set_parent_size_to_minimum = yes

		chron_fame_bar = {
			visible = "[PlayerGuiIsShown('chron_fame_show')]"
		}
	}
}
```

A scripted widget spawns at the screen origin. The full-size outer widget exists purely so `parentanchor` and `position` on the inner box can place your content anywhere on screen.

**C. The reusable type.** `gui/chron_shared/chron_types.gui`:

```
types ChronTypes {
	type chron_fame_bar = button {
		size = { 300 50 }
		using = tooltip_ne

		progressbar = {
			progresstexture = "gfx/interface/progressbars/progress_green.dds"
			value = "[FixedPointToFloat(GetPlayer.MakeScope.ScriptValue('chron_fame_level'))]"
			min = 0
			max = 5
			size = { 218 15 }
		}
		onclick = "[PlayerGuiExecute('chron_fame_click')]"
		tooltip = "[PlayerGuiBuildTooltip('chron_fame_tooltip')]"
	}
}
```

**D. The script value.** `common/script_values/chron_gui_values.txt`:

```
chron_fame_level = {
	value = 0
	if = { limit = { has_variable = chron_has_archive } add = 2 }
	if = { limit = { has_trait = chron_famed_chronicler } add = 3 }
}
```

**E. The scripted GUIs.** `common/scripted_guis/chron_fame_guis.txt`:

```
chron_fame_show = {
	scope = character
	is_shown = { has_variable = chron_has_archive }
}
chron_fame_click = {
	scope = character
	is_valid = { is_imprisoned = no }
	effect = { trigger_event = chron.0001 }
}
chron_fame_tooltip = {
	scope = character
	effect = { custom_tooltip = chron_fame_bar_tt }
}
```

Launch the game: rulers with an archive see a fame bar above the bottom HUD. No vanilla file was touched.

## The three bridges between GUI and script

Everything in the example reduces to three bridge families, and they cover nearly all custom UI:

1. **Numbers**: `[GetPlayer.MakeScope.ScriptValue('name')]` reads a script value. Progressbars need the result wrapped in `FixedPointToFloat(...)` or they read wrong or empty. For a breakdown tooltip of how the value was computed: `[GuiScope.SetRoot( GetPlayer.MakeScope ).GetScriptValueBreakdown('name')]`. Variables read via `[GetPlayer.MakeScope.Var('x').GetValue]` and `.IsSet`.
2. **Visibility**: `visible = "[PlayerGuiIsShown('sgui_name')]"` evaluates the scripted_gui's `is_shown` on the player.
3. **Actions and tooltips**: `onclick = "[PlayerGuiExecute('sgui_name')]"` runs the scripted_gui's `effect` (gated by its `is_valid`); `tooltip = "[PlayerGuiBuildTooltip('sgui_name')]"` renders what its effect's `custom_tooltip` produces.

The verbose forms (`GetScriptedGui('name').Execute( GuiScope.SetRoot(...).AddScope('faith', Faith.MakeScope).End )`) let you pass extra scopes; if a scripted_gui declares `saved_scopes = { host }`, those scopes **must** be passed via `AddScope` or the scripted_gui silently does nothing.

Two syntax landmines in data binding strings: **no space before `(` or `.`** (`Execute (` silently breaks), and UI values are typed (int32, CFixedPoint, float, CString), so cast when a property demands it (`FixedPointToFloat`, `IntToFixedPoint`).

Performance: any script value the UI reads recomputes **every frame**. Keep GUI-facing values trivially cheap; precompute heavy things into variables on a timer.

For session-only UI state (a collapsed panel, an active tab) skip script entirely and use the **variable system**: `onclick = "[GetVariableSystem.Toggle('show_panel')]"` with `visible = "[GetVariableSystem.Exists('show_panel')]"`. It resets every session; use a script variable plus scripted_gui when the state must survive saving.

## PdxGui anatomy in brief

Vanilla registers the base types in `gui/preload/defaults.gui`; skim it once, it is the real reference.

- **Containers**: `window` (movable framed panel), `widget` and `container` (bare rectangles), `hbox`/`vbox` (auto-layout boxes), `flowcontainer` (wrapping flow), `scrollarea` (+ `scrollbar`), `margin_widget` (sizes itself by margins, the trick for screen-size-adaptive layouts).
- **Leaves**: `button`, `icon`, `progressbar`, `progresspie`, `checkbutton`, `textbox` (with `text_single` and `text_multi` as the standard subtypes).
- **type vs template**: `type name = base { ... }` inside a `types Group {}` block is a reusable widget class, instantiated as `name = {}`. `template name { ... }` is a property snippet merged with `using = name`.
- **block/blockoverride**: a type declares `block "slot" { ... }`; instances fill or blank slots with `blockoverride "slot" { ... }`. This is the core reuse pattern across vanilla.
- **states** animate: `state = { name = _show duration = 0.6 ... }`. Names like `_show`, `_hide`, `_mouse_hierarchy_enter` fire automatically; custom names fire via `[PdxGuiWidget.TriggerAnimation('x')]`.
- Later elements in a file draw on top of earlier ones.

### Layout policies

`hbox`/`vbox` center themselves and their children. **Never use `parentanchor` inside a box**; push content aside with an `expand = {}` spacer. Each axis takes one of five policies via `layoutpolicy_horizontal` / `layoutpolicy_vertical`: `fixed` (default), `expanding` (grows to parent, highest priority), `growing` (grows but yields to expanding siblings), `preferred` (grows and shrinks), `shrinking`. Two `expanding` siblings split space equally, which is the instant tab bar recipe.

Long text stretches layouts; German and Russian strings are the classic breakage. Set `max_width` on textboxes and test with the built-in `LOREM_IPSUM_TITLE` / `LOREM_IPSUM_DESCRIPTION` loc keys.

### Lists (datamodels)

`datacontext` binds one object to a subtree; `datamodel` binds a list, rendering the `item` block per entry:

```
dynamicgridbox = {
	datamodel = "[GetPlayer.MakeScope.GetList('chron_patrons')]"
	item = {
		flowcontainer = {
			datacontext = "[Scope.GetCharacter]"
			portrait_head_small = {}
			text_single = { text = "[Character.GetNameNoTooltip]" }
		}
	}
}
```

Note `datacontext` goes on the widget **inside** `item`, not on `item` itself. For custom ordering, build a variable list in script and display that; many vanilla lists are hardcoded. `fixedgridbox` is much faster than `dynamicgridbox` for long lists but leaves gaps for hidden items.

## The iteration loop

- Launch with `-debug_mode -develop`. Saving a `.gui` file hot-reloads; force with console `reload gui`.
- Console `tweak gui.debug` (enable only the GUI.Debug checkbox) turns on the inspector: hovering any element shows its file and line. Alt+left-click cycles overlapping elements.
- Console `release_mode` shows an on-screen error counter, the fastest way to notice a broken `.gui`, and its UI Library button previews vanilla's premade types live.
- The game ships an empty sandbox window at `gui/debug/test_gui.gui` and a component gallery at `gui/debug/window_component_library.gui`; spawning the test window from the component library (or console `gui.CreateWidget gui/debug/test_gui.gui test_window`) gives you a scratch canvas. These live in the game folder, so revert any edits when done (Steam "Verify integrity" restores them).
- GUI errors land in `error.log` and `gui_warnings.log`.

In VS Code, the extension gives `.gui` files their own language mode with highlighting, and **Paradox: Show GUI Widget Tree** (also in the editor title bar for `.gui` files) renders the file's widget hierarchy as a collapsible tree, which beats scrolling a thousand-line file to understand its nesting.

## Pitfalls: crashes and silences

Known **hard crashes**: `size = { 100% 100% }` on an hbox/vbox (use layout policies); an hbox/vbox inside a `flowcontainer`; `resizeparent = yes` on more than one child of the same parent; a type referencing itself (infinite loading screen).

Classic **silent failures**: registry name not matching the widget name (never spawns); wrong `layer` (renders behind everything); missing full-size anchor container (widget stuck top-left); raw `ScriptValue` into a progressbar without `FixedPointToFloat`; `saved_scopes` declared but never `AddScope`d; a failing `is_valid` making clicks no-op; forgetting FIOS and wondering why your type override loses to vanilla.

## Try it

1. Build the five-file fame bar above. Launch, take the archive decision, confirm the bar appears with the right fill.
2. Open `gui/chron_shared/chron_types.gui` and run **Paradox: Show GUI Widget Tree** to see the structure you built.
3. Turn on `tweak gui.debug` in-game and hover your bar: confirm it reports your file and line.
4. Stretch goal: add a `text_single` under the progressbar showing `[GetPlayer.MakeScope.ScriptValue('chron_fame_level')]` as a number, and a state animation on `_show`.

Next: [Chapter 8: Graphics and icons](08-graphics.md) · [Back to index](index.md)
