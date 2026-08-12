/**
 * Crusader Kings III "New Content" templates. Content copied from working
 * vanilla examples, so every generated file passes the game's silent-failure
 * checklist: correct folder, event namespace declared, loc keys that match the
 * script, and the on_action APPEND pattern rather than an override.
 *
 * Tabs for indentation and LF only; the writer converts EOL and adds the BOM.
 */
import type { ScaffoldTemplate } from "../profile";

/** The vanilla on_actions worth hooking, all present in common/on_action/. */
const CK3_ON_ACTIONS = [
  "on_birth",
  "on_death",
  "on_marriage",
  "on_divorce",
  "on_yearly_pulse",
  "on_five_year_pulse",
  "on_game_start",
  "on_game_start_after_lobby",
  "on_character_culture_change",
  "on_character_faith_change",
  "on_title_gain",
  "on_war_won_attacker",
];

export const CK3_SCAFFOLDS: ScaffoldTemplate[] = [
  {
    id: "event",
    label: "$(zap) Event",
    detail: "events/<prefix>_events.txt (+ loc stubs)",
    nameLabel: "event id",
    nameKind: "eventId",
    scriptPath: "events/$PREFIX$_events.txt",
    requiredHeader: "namespace = $PREFIX$",
    cursorMarker: "# effects that run when the event fires",
    block: `$NAME$ = {
	type = character_event
	title = $KEY$_t
	desc = $KEY$_desc
	theme = default

	left_portrait = root

	immediate = {
		# effects that run when the event fires
	}

	option = {
		name = $KEY$_a
		# trigger = { }
		# effects for this option
	}
}
`,
    locPath: "localization/$LANG$/$PREFIX$_events_l_$LANG$.yml",
    locBody: ` $KEY$_t:0 "$NAME$ title"
 $KEY$_desc:0 "$NAME$ description"
 $KEY$_a:0 "Option text"
`,
  },
  {
    id: "decision",
    label: "$(checklist) Decision",
    detail: "common/decisions/ (+ loc stubs)",
    nameLabel: "decision",
    nameKind: "identifier",
    scriptPath: "common/decisions/$PREFIX$_decisions.txt",
    cursorMarker: "# effects that run when the decision is taken",
    block: `$NAME$ = {
	picture = "gfx/interface/illustrations/decisions/decision_misc.dds"

	desc = $NAME$_desc

	is_shown = {
		# who can see this decision
	}

	is_valid_showing_failures_only = {
		# validity requirements shown as tooltip failures
	}

	cost = {
		gold = 50
	}

	effect = {
		# effects that run when the decision is taken
		custom_tooltip = $NAME$_tooltip
	}

	ai_potential = {
		always = no
	}

	ai_will_do = {
		base = 0
	}
}
`,
    locPath: "localization/$LANG$/$PREFIX$_decisions_l_$LANG$.yml",
    locBody: ` $NAME$:0 "Decision name"
 $NAME$_desc:0 "Decision description"
 $NAME$_tooltip:0 "What the effect does"
 $NAME$_confirm:0 "Confirm"
`,
  },
  {
    id: "interaction",
    label: "$(person) Character interaction",
    detail: "common/character_interactions/ (+ loc stubs)",
    nameLabel: "interaction",
    nameKind: "identifier",
    scriptPath: "common/character_interactions/$PREFIX$_interactions.txt",
    cursorMarker: "# effects that run when the recipient accepts",
    block: `$NAME$ = {
	category = interaction_category_friendly

	desc = $NAME$_desc

	is_shown = {
		# who can use this interaction (scope = actor, recipient = target)
	}

	on_accept = {
		# effects that run when the recipient accepts
		send_interface_toast = {
			title = $NAME$
			left_icon = scope:recipient
		}
	}
}
`,
    locPath: "localization/$LANG$/$PREFIX$_interactions_l_$LANG$.yml",
    locBody: ` $NAME$:0 "Interaction name"
 $NAME$_desc:0 "Interaction description"
`,
  },
  {
    id: "on_action",
    label: "$(git-merge) on_action hook",
    detail: "common/on_action/ (append pattern, no override)",
    nameLabel: "vanilla on_action",
    nameKind: "identifier",
    picks: CK3_ON_ACTIONS,
    scriptPath: "common/on_action/$PREFIX$_on_actions.txt",
    cursorMarker: "# your effects here",
    // The APPEND pattern: hook into the vanilla on_action by adding a mod-owned
    // on_action to its `on_actions` list, instead of redefining the vanilla
    // block (which would OVERRIDE it and break every other mod + vanilla
    // content). This directly targets the #1 compatibility bug.
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
    // Prefaced with a PdxDoc stub (§E) so the documentation convention spreads
    // by default: a prose line, a `@scope` tag and a `@param` placeholder.
    block: `# What this does.
# @scope character (root is the character affected)
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
    // No `@returns`: a trigger implicitly returns yes/no.
    block: `# What this checks.
# @scope character (root is the character tested)
$NAME$ = {
	# conditions here
}
`,
  },
];
