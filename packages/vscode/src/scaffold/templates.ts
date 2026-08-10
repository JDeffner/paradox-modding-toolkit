/**
 * Pure content scaffolds — NO vscode imports, unit-testable. The domain rule is
 * "copy a working vanilla example": every generated file is shaped so it passes
 * the game's silent-failure checklist (correct folder, UTF-8-with-BOM loc with a
 * matching `l_<lang>:` header and `_l_<lang>.yml` filename, event namespace
 * declared, and the on_action APPEND pattern rather than an override).
 *
 * Template strings use tabs for indentation and LF only; the writer converts EOL
 * and prepends the BOM per the `bom` flag.
 */

export interface ScaffoldFile {
  /** Mod-relative path with forward slashes (e.g. `events/foo_events.txt`). */
  relPath: string;
  /** Full new-file content, used when the file does not already exist. */
  content: string;
  /** True → write a UTF-8 BOM when creating the file (all vanilla files carry one). */
  bom: boolean;
  /**
   * When true and the target already exists, the writer appends rather than
   * skips. It appends `appendContent` if present, else `content`.
   */
  appendIfExists?: boolean;
  /**
   * The block to append when the file already exists — just the new entry,
   * without the namespace/header preamble that `content` carries.
   */
  appendContent?: string;
  /**
   * A line the file MUST start with (e.g. `namespace = x` for event files —
   * the game silently drops events otherwise and tiger errors). When the
   * existing file does not start with it, the writer prepends it.
   */
  requiredHeader?: string;
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  /**
   * Where the cursor should land. `line`/`character` are 0-based and relative to
   * the content that gets written for `relPath` (the full `content` for a fresh
   * file, or `appendContent` for an appended block — the caller offsets it).
   */
  cursor: { relPath: string; line: number; character: number };
}

/** 0-based line index of the first line whose (trimmed) text equals `needle`. */
function lineOf(content: string, needle: string): number {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === needle) return i;
  }
  return 0;
}

// --- events -------------------------------------------------------------------

export function scaffoldEvent(prefix: string, eventId: string, locLanguage: string): ScaffoldResult {
  const titleKey = `${eventId.replace(/\./g, "_")}_t`;
  const descKey = `${eventId.replace(/\./g, "_")}_desc`;
  const optionKey = `${eventId.replace(/\./g, "_")}_a`;

  // A minimal working vanilla-shaped character event.
  const eventBlock = `${eventId} = {
	type = character_event
	title = ${titleKey}
	desc = ${descKey}
	theme = default

	left_portrait = root

	immediate = {
		# effects that run when the event fires
	}

	option = {
		name = ${optionKey}
		# trigger = { }
		# effects for this option
	}
}
`;

  const content = `namespace = ${prefix}

${eventBlock}`;

  const locBody = ` ${titleKey}:0 "${eventId} title"
 ${descKey}:0 "${eventId} description"
 ${optionKey}:0 "Option text"
`;
  const locContent = `l_${locLanguage}:
${locBody}`;

  // Cursor: inside the immediate block of the full new-file content.
  const cursorLine = lineOf(content, "# effects that run when the event fires");

  return {
    files: [
      {
        relPath: `events/${prefix}_events.txt`,
        content,
        bom: true, // vanilla script files all carry a UTF-8 BOM; tiger warns without it
        appendIfExists: true,
        appendContent: eventBlock,
        requiredHeader: `namespace = ${prefix}`,
      },
      {
        relPath: `localization/${locLanguage}/${prefix}_events_l_${locLanguage}.yml`,
        content: locContent,
        bom: true,
        appendIfExists: true,
        appendContent: locBody,
      },
    ],
    cursor: { relPath: `events/${prefix}_events.txt`, line: cursorLine, character: 2 },
  };
}

// --- decisions ----------------------------------------------------------------

export function scaffoldDecision(prefix: string, name: string, locLanguage: string): ScaffoldResult {
  const decisionBlock = `${name} = {
	picture = "gfx/interface/illustrations/decisions/decision_misc.dds"

	desc = ${name}_desc

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
		custom_tooltip = ${name}_tooltip
	}

	ai_potential = {
		always = no
	}

	ai_will_do = {
		base = 0
	}
}
`;

  const content = decisionBlock;

  const locBody = ` ${name}:0 "Decision name"
 ${name}_desc:0 "Decision description"
 ${name}_tooltip:0 "What the effect does"
 ${name}_confirm:0 "Confirm"
`;
  const locContent = `l_${locLanguage}:
${locBody}`;

  const cursorLine = lineOf(content, "# effects that run when the decision is taken");

  return {
    files: [
      {
        relPath: `common/decisions/${prefix}_decisions.txt`,
        content,
        bom: true, // vanilla script files all carry a UTF-8 BOM; tiger warns without it
        appendIfExists: true,
        appendContent: decisionBlock,
      },
      {
        relPath: `localization/${locLanguage}/${prefix}_decisions_l_${locLanguage}.yml`,
        content: locContent,
        bom: true,
        appendIfExists: true,
        appendContent: locBody,
      },
    ],
    cursor: { relPath: `common/decisions/${prefix}_decisions.txt`, line: cursorLine, character: 2 },
  };
}

// --- character interactions ---------------------------------------------------

export function scaffoldInteraction(prefix: string, name: string, locLanguage: string): ScaffoldResult {
  const interactionBlock = `${name} = {
	category = interaction_category_friendly

	desc = ${name}_desc

	is_shown = {
		# who can use this interaction (scope = actor, recipient = target)
	}

	on_accept = {
		# effects that run when the recipient accepts
		send_interface_toast = {
			title = ${name}
			left_icon = scope:recipient
		}
	}
}
`;

  const content = interactionBlock;

  const locBody = ` ${name}:0 "Interaction name"
 ${name}_desc:0 "Interaction description"
`;
  const locContent = `l_${locLanguage}:
${locBody}`;

  const cursorLine = lineOf(content, "# effects that run when the recipient accepts");

  return {
    files: [
      {
        relPath: `common/character_interactions/${prefix}_interactions.txt`,
        content,
        bom: true, // vanilla script files all carry a UTF-8 BOM; tiger warns without it
        appendIfExists: true,
        appendContent: interactionBlock,
      },
      {
        relPath: `localization/${locLanguage}/${prefix}_interactions_l_${locLanguage}.yml`,
        content: locContent,
        bom: true,
        appendIfExists: true,
        appendContent: locBody,
      },
    ],
    cursor: {
      relPath: `common/character_interactions/${prefix}_interactions.txt`,
      line: cursorLine,
      character: 2,
    },
  };
}

// --- scripted effects / triggers ----------------------------------------------

/**
 * A scripted effect or trigger, prefaced with a PdxDoc stub (§E) so the
 * documentation convention spreads by default: a prose line plus a `@scope`
 * tag the modder fills in. Effects get an `@param` placeholder; triggers a
 * `@returns`-shaped hint is not emitted (triggers implicitly return yes/no).
 */
export function scaffoldScripted(prefix: string, name: string, isEffect: boolean): ScaffoldResult {
  const kind = isEffect ? "scripted_effects" : "scripted_triggers";
  const cursorMarker = isEffect ? "# effects here" : "# conditions here";
  const docStub = isEffect
    ? `# What this does.
# @scope character — root is the character affected
# @param EXAMPLE_PARAM describe each $PARAM$ the caller must pass`
    : `# What this checks.
# @scope character — root is the character tested`;

  const block = `${docStub}
${name} = {
	${cursorMarker}
}
`;

  return {
    files: [
      {
        relPath: `common/${kind}/${prefix}_${kind}.txt`,
        content: block,
        bom: true, // vanilla script files all carry a UTF-8 BOM; tiger warns without it
        appendIfExists: true,
        appendContent: block,
      },
    ],
    cursor: {
      relPath: `common/${kind}/${prefix}_${kind}.txt`,
      line: lineOf(block, cursorMarker),
      character: 1,
    },
  };
}

// --- on_action hooks ----------------------------------------------------------

export function scaffoldOnActionHook(
  prefix: string,
  vanillaOnAction: string,
  _locLanguage: string
): ScaffoldResult {
  // The APPEND pattern: hook into the vanilla on_action by adding a mod-owned
  // on_action to its `on_actions` list, instead of redefining the vanilla block
  // (which would OVERRIDE it and break every other mod + vanilla content). This
  // directly targets the #1 compatibility bug.
  const hookBlock = `${vanillaOnAction} = {
	on_actions = { ${prefix}_${vanillaOnAction} }
}

${prefix}_${vanillaOnAction} = {
	effect = {
		# your effects here
	}
}
`;

  const content = hookBlock;
  const cursorLine = lineOf(content, "# your effects here");

  return {
    files: [
      {
        relPath: `common/on_action/${prefix}_on_actions.txt`,
        content,
        bom: true, // vanilla script files all carry a UTF-8 BOM; tiger warns without it
        appendIfExists: true,
        appendContent: hookBlock,
      },
    ],
    cursor: { relPath: `common/on_action/${prefix}_on_actions.txt`, line: cursorLine, character: 2 },
  };
}
