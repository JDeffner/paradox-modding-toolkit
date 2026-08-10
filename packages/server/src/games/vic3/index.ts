/**
 * The Victoria 3 game profile (shipped, PLAN-multigame.md M7): schema verified
 * against a real install, gui widget schema harvested from vanilla, freqs from
 * the vanilla corpus; engine tokens come from the user's script_docs dumps
 * (markdown format). No wiki fallback and no structures layer — see below.
 */
import type { GameProfile } from "../profile";
import { vic3Meta } from "./meta";
import { VIC3_BLOCK_REF_FIELDS, VIC3_PREFIX_REFS, VIC3_REF_FIELDS, VIC3_SCHEMA } from "./schema";
import GUI_SCHEMA from "../../../data/vic3/guiSchema.json";

export const vic3Profile: GameProfile = {
  ...vic3Meta,
  schema: VIC3_SCHEMA,
  refFields: VIC3_REF_FIELDS,
  prefixRefs: VIC3_PREFIX_REFS,
  blockRefFields: VIC3_BLOCK_REF_FIELDS,
  guiSchema: GUI_SCHEMA,
  // Measured in-game 2026-08-09 (px_probe_d/e, 1920x1080 @ 100% GUI scaling;
  // docs/gui-designer/calibration/vic3-expectations.md). The measured law:
  // advance(M) = round(0.9 * fontsize) — 14 @15, 15 @17 (the default size),
  // 27 @30 — and line box = 1.3 * fontsize exactly (the game ceils the box:
  // 20 @15, 39 @30, 23 @17). A base-30 table + roundPerSize reproduces every
  // measured box EXACTLY: 10xM = 140 @15 / 150 @default / 270 @30,
  // "M M M M M" = 82, "MMMM MMMM" = 115, 10xi = 40. A bare textbox renders
  // at fontsize 17.
  guiTextMetrics: {
    baseFontsize: 30,
    lineHeight: 39,
    glyphs: {
      M: { adv: 27, ink: 27 },
      i: { adv: 8, ink: 8 },
      " ": { adv: 6, ink: 0 },
    },
    defaultGlyph: { adv: 18, ink: 16 }, // unmeasured average guess
    defaultFontsize: 17,
    roundPerSize: true,
  },
  // Vic3 keeps an authored size on an EMPTY container (px_probe_c C5: the
  // 150x60 rendered in full, engine warning logged yet applied) where the
  // default profile measured collapse-to-0 (L25 narrow).
  guiLayoutQuirks: { emptySizedContainerKept: true },
  // No `_*.info` docs exist anywhere in the Vic3 tree (verified 2026-08-01) —
  // the structures layer has no source. The tree does ship ~75 `.md` files
  // (common/buildings/buildings.md and friends), but they are freeform prose
  // sketches of a format, not the machine-readable `.info` docs docsParser
  // reads, so they cannot feed structure/modifier placeholders either.
  structureSources: {},
  modifierPlaceholders: {},
  // No bundled wiki tokens in the preview cut, so nothing ever renders this.
  wikiNote: "",
  diagnosticSource: "vic3-script",
};
