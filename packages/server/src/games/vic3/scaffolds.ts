/**
 * Victoria 3 "New Content" templates, written from the live 1.13 install
 * (game/events/acceptance_events.txt, game/common/on_actions/) and the workshop
 * corpus (Community Mod Framework's events/ and common/on_actions/). Only
 * content types verified there are offered: decisions and character
 * interactions exist in Vic3 too, but their vanilla shape is unlike CK3's and
 * has not been transcribed, so the command does not guess one.
 *
 * Tabs for indentation and LF only; the writer converts EOL and adds the BOM.
 */
import type { ScaffoldTemplate } from "../profile";

/**
 * Vanilla on_actions worth hooking. Each name checked against
 * game/common/on_actions/00_code_on_actions.txt; the trailing scope word is the
 * root the effect runs on (`_country`, `_character`, `_state`).
 */
const VIC3_ON_ACTIONS = [
  "on_game_started",
  "on_game_started_after_lobby",
  "on_monthly_pulse_country",
  "on_yearly_pulse_country",
  "on_five_year_pulse_country",
  "on_monthly_pulse_character",
  "on_yearly_pulse_state",
  "on_character_creation",
  "on_character_death",
  "on_new_ruler",
  "on_battle_won",
  "on_building_built",
  "on_acquired_technology",
  "on_diplomatic_play_started",
];

export const VIC3_SCAFFOLDS: ScaffoldTemplate[] = [
  {
    id: "event",
    label: "$(zap) Event",
    detail: "events/<prefix>_events.txt (+ loc stubs)",
    nameLabel: "event id",
    nameKind: "eventId",
    scriptPath: "events/$PREFIX$_events.txt",
    requiredHeader: "namespace = $PREFIX$",
    cursorMarker: "# effects that run when the event fires",
    // Country event shaped after vanilla acceptance_events.1: the loc keys are
    // `<id>.t/.d/.f/.a` (dots, unlike CK3's underscores), and an option needs
    // `default_option` on exactly one entry.
    block: `$NAME$ = {
	type = country_event
	placement = root

	title = $NAME$.t
	desc = $NAME$.d
	flavor = $NAME$.f

	duration = 3

	trigger = {
		# conditions under which this event can fire
	}

	immediate = {
		# effects that run when the event fires
	}

	option = {
		default_option = yes
		name = $NAME$.a
		# effects for this option
	}
}
`,
    locPath: "localization/$LANG$/$PREFIX$_events_l_$LANG$.yml",
    locBody: ` $NAME$.t:0 "$NAME$ title"
 $NAME$.d:0 "$NAME$ description"
 $NAME$.f:0 "$NAME$ flavor text"
 $NAME$.a:0 "Option text"
`,
  },
  {
    id: "on_action",
    label: "$(git-merge) on_action hook",
    detail: "common/on_actions/ (append pattern, no override)",
    nameLabel: "vanilla on_action",
    nameKind: "identifier",
    picks: VIC3_ON_ACTIONS,
    // Plural folder here, unlike CK3's common/on_action/.
    scriptPath: "common/on_actions/$PREFIX$_on_actions.txt",
    cursorMarker: "# your effects here",
    // The APPEND pattern, same as vanilla's own on_monthly_pulse: add a
    // mod-owned on_action to the vanilla one's `on_actions` list instead of
    // redefining the vanilla block, which would override it for every mod.
    block: `$NAME$ = {
	on_actions = { $PREFIX$_$NAME$ }
}

$PREFIX$_$NAME$ = {
	effect = {
		# your effects here
	}
}
`,
  },
  {
    id: "scripted_effect",
    label: "$(symbol-method) Scripted effect",
    detail: "common/scripted_effects/ (with a PdxDoc stub)",
    nameLabel: "effect",
    nameKind: "identifier",
    scriptPath: "common/scripted_effects/$PREFIX$_scripted_effects.txt",
    cursorMarker: "# effects here",
    block: `# What this does.
# @scope country (root is the country affected)
# @param EXAMPLE_PARAM describe each $PARAM$ the caller must pass
$NAME$ = {
	# effects here
}
`,
  },
  {
    id: "scripted_trigger",
    label: "$(symbol-boolean) Scripted trigger",
    detail: "common/scripted_triggers/ (with a PdxDoc stub)",
    nameLabel: "trigger",
    nameKind: "identifier",
    scriptPath: "common/scripted_triggers/$PREFIX$_scripted_triggers.txt",
    cursorMarker: "# conditions here",
    block: `# What this checks.
# @scope country (root is the country tested)
$NAME$ = {
	# conditions here
}
`,
  },
];
