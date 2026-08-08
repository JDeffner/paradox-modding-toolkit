/**
 * The words that make a `.gui` statement a DECLARATION rather than a widget or
 * a property, shared by the source model and the layout engine.
 *
 * A dependency-free leaf, like `fillGeometry.ts`, and for the same reason: the
 * writer's reorder/insert/delete sibling list (`GuiBody.children`) and the
 * engine's `srcIndex` for a laid-out node have to count the SAME entries. Two
 * copies of this set would drift, and the drift would show up as a reorder
 * moving the wrong block.
 *
 * No `vscode` imports: unit-tested in plain Node.
 */

/** Marker words that turn the FOLLOWING assignment into a declaration. */
export const DECL_MARKERS = new Set(["template", "local_template", "types", "type", "block", "blockoverride"]);

/**
 * Named slots, which vanilla spells two ways: `blockoverride "name" { ... }`
 * (272 uses in the game tree, the marker form) and `blockoverride = "name"
 * { ... }` (29 uses, one assignment whose value is a tagged block). Both are
 * declarations, so both count as one sibling.
 */
export const SLOT_KEYS = new Set(["block", "blockoverride"]);
