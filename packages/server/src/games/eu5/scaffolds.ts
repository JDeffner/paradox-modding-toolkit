/**
 * Europa Universalis V "New Content" templates. Nothing here is verified
 * against a live install (nobody on the team owns the game), so only the two
 * content types whose whole shape is engine-generic are offered: a scripted
 * effect and a scripted trigger are a bare `name = { }` block, and their
 * folders come from the community CWT rules (schema.generated.ts:
 * in_game/common/scripted_effects, in_game/common/scripted_triggers).
 *
 * Events, on_action hooks and database content wait for the calibration pack
 * (docs/gui-designer/eu5/package/): a template whose keys we cannot
 * check would create exactly the silent failure this command exists to prevent.
 *
 * The `in_game/` stage prefix is NOT written here; the writer adds
 * `stageRoots[0]` to every path.
 */
import type { ScaffoldTemplate } from "../profile";

export const EU5_SCAFFOLDS: ScaffoldTemplate[] = [
  {
    id: "scripted_effect",
    label: "$(symbol-method) Scripted effect",
    detail: "common/scripted_effects/ (with a PdxDoc stub)",
    nameLabel: "effect",
    nameKind: "identifier",
    scriptPath: "common/scripted_effects/$PREFIX$_scripted_effects.txt",
    cursorMarker: "# effects here",
    // No `@scope` line: the scope names are unverified for this game.
    block: `# What this does.
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
$NAME$ = {
	# conditions here
}
`,
  },
];
