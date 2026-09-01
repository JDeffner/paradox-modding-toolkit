/**
 * Text metrics measured in-game for Gitan-Regular (StandardGameFont) at
 * fontsize 15, probe batches 01-03 (docs/gui-designer/probes/).
 *
 * They serve twice: as the measured table of the profile whose font this is,
 * and as the layout engine's assumption for a game whose own probe has not run
 * yet. That is why they sit in their own module: a game's meta reads them, and
 * the engine may not import a game profile (the games/ -> gui/ direction only).
 */
import type { GuiTextMetrics } from "./layoutEngine";

export const GITAN_MEASURED_METRICS: GuiTextMetrics = {
  baseFontsize: 15,
  lineHeight: 21, // B1-G
  glyphs: {
    M: { adv: 14, ink: 13 }, // B1-G, B2-L
    i: { adv: 4, ink: 4 }, // B1-G, B2-L
    " ": { adv: 4, ink: 0 }, // B3-S2
  },
  defaultGlyph: { adv: 9, ink: 8 }, // unmeasured average guess
};
