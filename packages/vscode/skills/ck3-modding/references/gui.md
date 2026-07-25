# Building custom GUI for CK3

Verified against the game install (`gui/`, `common/scripted_guis/`) and Princes of Darkness
(state-of-the-art custom UI). When the wiki (https://ck3.paradoxwikis.com/Interface) conflicts
with local files, the files win.

Companion material (paths relative to the px-toolkit repo this skill ships in,
`packages/vscode/skills/ck3-modding/` → repo root is `../../../../`; standalone copies of the skill: find the repo at
github.com/JDeffner/ck3-modding-toolkit):
- **Measured layout spec (pixel-exact, the authority for layout math)**:
  `docs/gui-designer/calibration/spec.md` — every rule carries in-game measurement provenance;
  the per-batch evidence (screenshots, predictions vs measured) sits in the same folder.
  Condensed version: "Layout semantics" below.
- Screenshot gallery of policy combinations:
  `docs/guides/ck3-ui-modding.md`, images in `docs/guides/images/`.
- To measure something new: copy a calibration batch's `test_gui.gui` pattern (flat-color
  markers via tinted white.dds, ruler bars) over `game/gui/debug/test_gui.gui`, spawn
  `gui.CreateWidget gui/debug/test_gui.gui test_window`, and run the analyzer
  `docs/gui-designer/calibration/analyze.ps1` on a PNG screenshot.

**Fallback if those `docs/` files aren't installed alongside this skill** (the skill can be
deployed without the repo): the "Layout semantics" section below carries the load-bearing rules,
but treat every specific pixel/number as **approximate** and verify it in-game with the test-window
loop before relying on it.

## What UI mods can and cannot do

**Can:** restyle, make windows movable/resizable, remove/rearrange elements, add buttons, surface
more game info, add entirely new windows.
**Cannot:** new HUD skins (`.skin` files in mods are ignored), new hotkeys (`.shortcuts` in mods
is ignored — only reuse existing ones), or show data from window A inside window B unless the
devs exposed a promote for it. UI mods change the multiplayer checksum (achievements are fine
since 1.9).

## Patch-safety ranking (prefer earlier options)

1. **Scripted widgets (use this).** Register a NEW `.gui` file's top-level widget into the running
   HUD via a `gui/scripted_widgets/*.txt` registry. Touches zero vanilla files, survives patches,
   never conflicts with other mods doing the same. Vanilla's `gui/scripted_widgets/_scripted_widgets.info`
   states the mechanism exists so widgets "not formally referenced by the code" get created on
   startup, and ALL registry files load, so multiple mods coexist. Additive by design.
2. **New types/templates in new files.** Define reusable `type`/`template` in your own `.gui` files.
   If you must add a usage into a vanilla window, extract the addition into your own type so other
   mods can hook it.
3. **Redefining a single vanilla type/template.** Put the redefinition in a file that loads FIRST
   alphabetically (`gui/00_my_types.gui`) inside a `types {}` block. Replaces one widget definition
   game-wide without copying a whole file. Fragile: silently changes every screen using it.
4. **Overriding a whole vanilla `.gui` file (avoid).** Copying `hud.gui`/`window_character.gui`
   forks a multi-thousand-line file, breaks on every patch, and hard-conflicts with other mods.
   PoD does this for deep character-window integration and pays for it every patch. Only do this
   if pixel-perfect placement inside a vanilla window is non-negotiable, and budget for re-diffing.

## Worked example: custom HUD bar (progressbar + click + tooltip)

Mirrors PoD's real implementation. Placeholder prefix `mymod`. Nothing overrides a vanilla file.

**A. Registry** `gui/scripted_widgets/mymod_widgets.txt` (one line = one widget instance at map load):

```
gui/mymod_windows/mymod_hud.gui = mymod_resource_hud
```

Format: `path/relative/to/mod/root.gui = top_level_widget_name`. The named widget must exist as a
top-level `widget`/`window` block in that file, name matching EXACTLY (mismatch = silently never spawns).

**B. HUD container** `gui/mymod_windows/mymod_hud.gui`:

```
widget = {
    name = "mymod_resource_hud"          # MUST match the registry name
    layer = bottom                        # HUD layer; toggled panels use layer = top/middle
    visible = "[And( Not(IsPauseMenuShown), And( IsDefaultGUIMode, GetPlayer.IsValid ) )]"
    size = { 100% 100% }                  # full-screen anchor container

    vbox = {
        parentanchor = bottom|hcenter
        position = { 17 -12 }
        set_parent_size_to_minimum = yes
        mymod_resource_bar = {
            visible = "[PlayerGuiIsShown('mymod_bar_show')]"
        }
    }
}
```

A scripted widget spawns at origin; the full-size outer container plus `parentanchor`/`position`
on the inner box is what places it (PoD's outer widget exists purely for this).

**C. Reusable type** `gui/mymod_shared/mymod_types.gui`:

```
types MyModTypes {
    type mymod_resource_bar = button {
        size = { 300 50 }
        using = tooltip_ne

        progressbar = {
            progresstexture = "gfx/interface/progressbars/progress_gnosis.dds"
            value = "[FixedPointToFloat(GetPlayer.MakeScope.ScriptValue('mymod_resource_level'))]"
            min   = 0
            max   = 5
            size  = { 218 15 }
        }
        onclick = "[PlayerGuiExecute('mymod_bar_click')]"
        tooltip = "[PlayerGuiBuildTooltip('mymod_bar_tooltip')]"
    }
}
```

**D. Script value** `common/script_values/mymod_values.txt` (plain script_value, read live by the bar;
PoD's `blood_level`/`masquerade_level` are exactly this):

```
mymod_resource_level = {
    value = 0
    if = { limit = { has_character_modifier = mymod_high } add = 5 }
}
```

**E. Scripted GUIs** `common/scripted_guis/mymod_bar_guis.txt`:

```
mymod_bar_show = {
    scope = character
    is_shown = { has_trait = mymod_trait }      # drives PlayerGuiIsShown(...)
}
mymod_bar_click = {
    scope = character
    is_valid = { is_imprisoned = no }           # gates the effect (checked even without `enabled`)
    effect  = { open_interaction_window = { interaction = mymod_interaction actor = root recipient = root } }
}
mymod_bar_tooltip = {
    scope  = character
    effect = { custom_tooltip = mymod_bar_desc }   # what PlayerGuiBuildTooltip renders
}
```

## PdxGui anatomy

Vanilla registers every base type in `gui/preload/defaults.gui` (`types Default {}`) and
`gui/preload/labels.gui`:

- `window`: top-level movable/framed panel (`layer = windows_layer`). `widget`/`container`: bare
  grouping rectangles (`widget` is lightest). `hbox`/`vbox`: auto-layout. `flowcontainer`: a
  single-row/column flow — MEASURED: it never wraps, even with an explicit `size` (the wiki's
  "wrapping flow" is wrong; content just overflows unclipped). `scrollarea`: scrollable viewport,
  pair with `scrollbar`. Plus `button`, `icon`, `progressbar`, `progresspie`, `checkbutton`,
  `textbox`.
- Text: `text_single` and `text_multi` are `textbox` subtypes (single-line vs `multiline = yes`).
  There is no separate richtext type in CK3; any textbox renders formatting markup.
- Layout: `layoutpolicy_horizontal/vertical`, `expand = {}` spacers, `parentanchor`, `position`
  (full treatment in "Layout semantics" below).
- More component behavior: `margin_widget` — MEASURED: margins only offset where its CHILDREN
  start; they do not shrink its own rect and it does not auto-size. The screen-adaptive HUD trick
  needs an explicit `size = { 100% 100% }` on it plus the margins. `container` hugs children
  including invisible ones unless `ignoreinvisible = yes` (measured: hug is exact, placed at the
  parent's origin, not centered). `dynamicgridbox` = datamodel list with
  variable item sizes (laggy on long lists); `fixedgridbox` = fixed cell size, much faster, but
  hidden items leave gaps. `overlappingitembox` overlaps items when cramped (portrait stacks).
  `button`: `onrightclick` needs `button_ignore = none`; a sizeless button is an invisible hotkey
  target. `textbox`: `elide = right` for overflow; `icon`: `mirror = horizontal|vertical`.
  Order in the file matters: later = drawn on top.
- **type vs template**: `type name = base {...}` (inside a `types Group {}` block) is a reusable
  widget class instantiated as `name = {}`. `template name {...}` (top-level) is a property snippet
  merged via `using = name` (vanilla's `tooltip_ne` etc.).
- **block/blockoverride**: a type declares `block "slot" {...}`; instances fill it with
  `blockoverride "slot" {...}` (or blank it with `{}`). This is the core reuse pattern; PoD's
  resource bars define `block "progressbar"/"button"/"texture"` and each concrete bar overrides them.
- **states**: `state = { name = _show duration = 0.6 using = Animation_Curve_Default ... }`.
  Auto-firing names: `_show`, `_hide`, `_mouse_hierarchy_enter/_leave`, `_mouse_press/click/release`,
  `daily_tick`, `monthly_tick`. Any other name fires manually:
  `onclick = "[PdxGuiWidget.TriggerAnimation('x')]"` (same widget),
  `PdxGuiTriggerAllAnimations('x')` (every visible state with that name), or
  `trigger_when = ...` / `trigger_on_create = yes`. States can `start_sound = { soundeffect = "event:..." }`
  and run functions via `on_start`/`on_finish` — prefer `on_finish`, `on_start` currently fires
  twice. Default easing curve: `bezier = { 0.25 0.1 0.25 1 }`.
- Tooltips: `tooltip = "loc_key_or_[...]"` for text; `tooltipwidget = {...}` for a full custom widget.

## Layout semantics, measured pixel-exact

A 4-batch in-game calibration campaign measured the exact layout rules (screenshot analysis,
flat-color markers). Full spec with per-rule provenance:
`docs/gui-designer/calibration/spec.md` in the px-toolkit repo — read it when a layout
question needs numbers. The load-bearing facts:

- **Anchors**: `widgetanchor` implicitly DEFAULTS to the `parentanchor` value (not top-left):
  `parentanchor = bottom|right` alone puts the child flush inside the corner. `position` is added
  AFTER anchoring and is always screen-space +right/+down (use negatives near bottom/right edges).
- **Nothing clips except `scrollarea`**: plain widgets let children render fully outside their
  rect. A `widget` with no `size` has a ZERO rect (children still render); `container` is the
  hug element. Percent sizes resolve against the parent; `scale` multiplies an icon's rect.
- **Box sizing is parent-kind dependent**: an hbox/vbox whose parent is a plain widget FILLS it
  entirely — its own explicit `size` is IGNORED (smaller or larger). A box inside another box
  HUGS its content. `position` still translates a stretched box.
- **Box distribution**: policy resizing first, then leftover free space spreads as space-around
  (each child gets `free/(2n)` margin on both sides; adjacent margins stack). Cross axis: each
  child individually centered unless its cross policy stretches. `margin = { horizontal vertical }`;
  `margin_top`/`_left`/... inset one side and compose with the model. Default spacing/margins 0.
- **Policy math** (k = children sharing the policy): `expanding` children each get
  floor + free/k (equal SHARE, not equal final size); `growing` gets nothing next to an expanding
  sibling but takes everything when alone (`expand = {}` is exactly a growing spacer); under
  deficit, `preferred` and `shrinking` each lose deficit/k — equal delta, no priority order.
- **Text** (`text_single`, font Gitan-Regular, `Font_Size_Small` = fontsize 15): line box 21px;
  width = (n-1)*advance + ink of the last glyph; all metrics scale exactly linearly with
  `fontsize`. `max_width` clamps + elides at exactly that width; `multiline = yes` + `max_width`
  wraps at word boundaries with line advance 21. `align` has zero internal padding.
  TRAP: the vanilla `text_multi` TYPE hardcodes `size = { 45 45 }` — override its size or your
  `max_width` does nothing and the text elides in a 45px box.
- **Color/alpha**: `color = { r g b a }` is a straight sRGB multiply — rendered = round(v*255),
  no gamma. `color`'s alpha and the `alpha` property multiply into one opacity, straight blend.
  Solid rectangles: tint `gfx/interface/colors/white.dds`.

Five policies per axis (`layoutpolicy_horizontal`, `layoutpolicy_vertical`):

1. `fixed` (default) — keeps size.
2. `expanding` — grows to the parent, never below original size; highest priority.
3. `growing` — like expanding but yields to expanding siblings (`expand = {}` uses this).
4. `preferred` — grows *and* shrinks with available space.
5. `shrinking` — only shrinks, never grows.

Boxes center themselves and their children — **never `parentanchor` inside a box**; push content
aside with an `expand = {}` spacer instead.

How each combination actually renders — Read these screenshots from the repo's
`docs/guides/images/` (black background = the hbox):

| Setup | In-game result | Image |
|---|---|---|
| bare hbox + 2 buttons | box hugs children tightly, centered | `simple_hbox_wide.jpg` |
| `expanding` on the hbox | box fills parent width, children spread out centered | `expanded_hbox.jpg` |
| + `expand = {}` after children | children pushed to the left, spacer eats the rest | `ordered_hbox.jpg` |
| `expanding` on the children too | children stretch to equal widths — instant tab bar | `tabs_hbox_2.jpg` |
| `expanding` both axes, box + children | everything fills all space | `big_hbox.png` |
| `expanding` vs `growing` sibling | expanding takes the extra space, growing keeps its floor | `growing_hbox_2.png` |
| `preferred`/`shrinking` under pressure | both compress below natural size | `shrinking_hbox_2.png` |

**Text stretches layouts.** Long German/Russian strings are the classic breakage: set `max_width`
on textboxes and test with the built-in `LOREM_IPSUM_TITLE` / `LOREM_IPSUM_DESCRIPTION` loc keys.

## Datamodels (lists)

```
dynamicgridbox = {
    datamodel = "[GetPlayer.MakeScope.GetList('my_list')]"
    item = {
        flowcontainer = {
            datacontext = "[Scope.GetCharacter]"   # on the widget INSIDE item, not on item
            portrait_head_small = {}
            text_single = { text = "[Character.GetNameNoTooltip]" }
        }
    }
}
```

- `datacontext` = one object; `datamodel` = a list. Feeds `vbox`/`hbox`/`flowcontainer`/
  `dynamicgridbox`/`fixedgridbox`/`overlappingitembox`; each entry renders the `item` block.
- Custom sorting = build a variable list in script (`add_to_variable_list`, `ordered_in_list`)
  and display that; many vanilla lists are hardcoded (hide items via `visible` at best).
- `datacontext_from_model = { datamodel = ... index = "1" }` picks a single item out of a list.

## GUI-to-script bridges (all verified in vanilla + PoD)

- `datacontext = "[GetPlayer]"` sets the object a subtree scopes to (also
  `"[GetScriptedGui('name')]"` or a datamodel item).
- Read a script_value: `[GetPlayer.MakeScope.ScriptValue('name')]`. Progressbars need
  `FixedPointToFloat(...)` around it or the bar reads wrong/empty. With breakdown tooltip:
  `[GuiScope.SetRoot( X.MakeScope ).GetScriptValueBreakdown('name')]` (vanilla
  `activity_window_widgets/hunt_success_chance.gui`).
- Read a variable: `[GetPlayer.MakeScope.Var('x').GetValue]`, existence via `.IsSet`.
- Visibility: `visible = "[PlayerGuiIsShown('name')]"` (the scripted_gui's `is_shown` on the player).
- Run an effect: `onclick = "[PlayerGuiExecute('name')]"`. Verbose form for custom scopes:
  `[GetScriptedGui('name').Execute( GuiScope.SetRoot( GetPlayer.MakeScope ).AddScope( 'faith', Faith.MakeScope ).End )]`
  with `enabled = "[ScriptedGui.IsValid( GuiScope... )]"` (vanilla `window_faith.gui`).
- Tooltip: `tooltip = "[PlayerGuiBuildTooltip('name')]"`.
- Heavy script_values read by UI recompute EVERY FRAME; keep them cheap.
- **No space before `(` or `.`** in data bindings — `Execute (` silently breaks.
- UI values are typed (int32, CFixedPoint, float, CString…); cast with `IntToFixedPoint`,
  `FixedPointToFloat` etc. when a property demands a type (`alpha` wants float).
- Text formatting suffixes: `|1` decimals, `|%` percent, `|=` / `|+` color by sign, `|O` ordinal.
- Number→string has no vanilla function; route through a `common/customizable_localization` entry.
- **UI variable system** (session-only state, no script needed):
  `visible = "[GetVariableSystem.Exists('show_w')]"`, button
  `onclick = "[GetVariableSystem.Toggle('show_w')]"`; tabs via `Set('tabs','t2')` +
  `HasValue('tabs','t2')` per pane. Use a script variable + scripted_gui instead when the state
  must persist in the save.

**scripted_guis file anatomy** (`common/scripted_guis/*.txt`): `scope = character` (root scope),
optional `saved_scopes = { host }` (extra named targets; if declared they MUST be passed via
`AddScope` or the SGUI silently no-ops), `is_shown` (drives visibility), `is_valid` (gates the
effect, always checked on Execute), `effect`. Only the blocks you use are required.

## Debugging workflow and the test-window feedback loop

- **Before launching the game: the CK3 Modding extension's "CK3: Preview GUI layout"**
  (editor title button on any `.gui` file, v1.5+) renders the file with the measured layout
  engine, real DDS textures and the game font — live while typing. Hover inspects any widget's
  rect, clicking the same spot repeatedly drills through overlapping widgets, the property panel
  edits `position`/`size` with write-back, and dragging a positioned widget moves it (box-managed
  and template-derived widgets are read-only with an explanatory hint). Use it for layout
  iteration; the in-game loop below is still the truth for data bindings, states and anything
  the preview does not model (datamodels, nine-slice, animations).
- Launch with `-debug_mode -develop`. Editing a `.gui` file hot-reloads; force with console
  `reload gui` (or `reload gui/somefile.gui`).
- **Test window loop (use this to show the user UI drafts):** the game ships an empty sandbox
  window at `game/gui/debug/test_gui.gui` (top-level window named `test_window`). Workflow:
  1. Edit `<game>\gui\debug\test_gui.gui`
     and put the widgets to preview inside its inner vbox (keep `name = "test_window"`).
  2. The user opens the UI component library in-game and clicks the "spawn test window" button
     (it runs `gui.CreateWidget gui/debug/test_gui.gui test_window`; close via
     `gui.clearwidgets test_window`, both also usable directly in console).
  3. Iterate: edit file, `reload gui`, respawn, ask the user what they see.
  A catalog of all available UI components with live examples is
  `game/gui/debug/window_component_library.gui` in the same folder; read it to discover widgets,
  and the user can browse it in-game. Note these edits touch game files: revert when done
  (Steam "Verify integrity" restores originals).
- Inspector: console `tweak gui.debug`, check ONLY GUI.Debug (the other options overwhelm the
  screen); hovering shows the exact file + line of any element. Alt+left-click cycles overlapping
  elements; Alt+right-click opens the file at that line in the editor — needs a one-time setup in
  `Documents\Paradox Interactive\Crusader Kings III\pdx_settings.txt`: set `editor` to the VS Code
  exe path and `editor_postfix` to `:$:1`. Faster than the Ctrl+F8 `gui_editor` (which can also
  save into the game folder by accident — avoid editing with it).
- `release_mode` shows an on-screen error counter, the fastest way to notice a broken `.gui`;
  its **UI Library** button previews vanilla's premade types live.
- Ask the user to run `dump_data_types` (writes every GUI promote/function to `logs/data_types/`),
  then grep the dumps yourself for exact signatures (`ScriptValue`, `MakeScope`,
  `GetScriptValueBreakdown`, ...) — see SKILL.md "Game logs".
- GUI load errors land in `error.log` and `gui_warnings.log`; read them yourself after the user
  reproduces the broken screen.

## Pitfalls

Known **hard crashes**:

- `size = { 100% 100% }` on an hbox/vbox (use layout policies instead).
- An hbox/vbox inside a `flowcontainer`.
- `resizeparent = yes` on more than one child of the same parent — even if only one is visible.
- A type that references itself (endless loading screen until RAM runs out).
- Plain brace mismatch; regex-hunt unquoted brackets with `= \[` and `\]$`.

Silent failures:

- `flowcontainer` does NOT wrap (measured; the wiki says otherwise) — a long item run silently
  overflows the parent. For wrapping grids use `fixedgridbox`/`dynamicgridbox`.
- `text_multi` silently ignores `max_width`: its type hardcodes `size = { 45 45 }` — set an
  explicit `size`, or use `text_single` with `multiline = yes` + `max_width`.
- An explicit `size` on an hbox/vbox inside a plain widget is silently ignored (the box fills
  the parent) — wrap the box in a fixed-size `widget` to constrain it.
- `margin_widget` without an explicit size renders nothing visible; the HUD pattern needs
  `size = { 100% 100% }`.
- Registry-vs-widget name mismatch: widget never spawns, no error.
- Wrong `layer`: renders behind/in front of everything or clips.
- Missing full-size anchor container: widget lands in the top-left corner.
- Raw `ScriptValue` into a progressbar without `FixedPointToFloat`: wrong/empty bar.
- `saved_scopes` declared but not `AddScope`d (or vice versa): SGUI silently does nothing.
- Failing `is_valid`: clicks silently no-op even without an `enabled` binding.
- **FIOS**: for types/templates the first-loaded file's definition is the one your `00_` prefix
  controls; name override files to sort first. Opposite of script (LIOS).
- Whole windows must keep their exact vanilla filename; two mods touching the same window are
  incompatible without a merge patch.
- `flowcontainer`/`fixedgridbox` leave gaps for hidden children; prefer `vbox`/`hbox` with
  `visible` toggles for dynamic stacks (as PoD does).

## Existing game views

Usable with `OpenGameView` / `IsGameViewOpen('...')`: `character`, `intrigue_window`, `military`,
`council_window`, `religion`, `faith`, `culture_window`, `dynasty_tree_view`, `decisions`,
`lifestyle`, `court_window`, `royal_court`, `inventory`, `activity_planner`, `travel_planner`,
`outliner`, `my_realm`, `barbershop`, `find_title`, `character_finder`, `war_overview`,
`struggle`, `factions_window`, `title_view_window`, `holding_view`, and more — full table:
https://ck3.paradoxwikis.com/Interface#List_of_existing_game_views

Key evidence files: vanilla `gui/scripted_widgets/_scripted_widgets.info`, `gui/preload/defaults.gui`,
`gui/preload/labels.gui` (label types + the text_multi 45x45), `gui/preload/fonts.gui` +
`fonts/fonts.font` (StandardGameFont = Gitan-Regular), `gui/window_faith.gui`,
`common/scripted_guis/ep2_activities.txt`;
PoD `gui/scripted_widgets/POD_scripted_widgets.txt`, `gui/POD_windows/POD_hud_resource_bars.gui`,
`gui/POD_shared/POD_types_resource_bars.gui`, `common/scripted_guis/POD_progressbar_guis.txt`;
measured layout rules: the repo's `docs/gui-designer/calibration/`
(spec.md + 4 batches of screenshot evidence, mirrored as golden fixtures in the extension's
`test/guiLayout.test.ts`).
