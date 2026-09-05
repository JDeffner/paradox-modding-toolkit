/**
 * Where the arms sit inside a preview frame, as the game's gui draws them.
 *
 * A frame widget draws the frame texture at one size and a `coat_of_arms_icon`
 * centred inside it at a smaller one. The icon draws the arms shrunk by
 * `coat_of_arms_scale` and moved UP by `coat_of_arms_offset` (fractions of the
 * icon; the culture keys are `house_coa_mask_offset` and `_scale`), under a
 * mask drawn at the icon's full size. Positive is up: a checkerboard on the
 * Norman house frame (offset 0.055, scale 0.9; 1.19 at 100 percent UI scale)
 * sits with its top row against the frame's hole and clipped by it, where
 * centred arms leave a band of 0.036 of the cell above the board and arms
 * moved down leave a whole square. Measured on 1.19:
 * gui/shared/coat_of_arms.gui, common/defines/graphic/00_graphics.txt
 * (DEFAULT_HOUSE_/DYNASTY_COA_FRAME_OFFSET and _SCALE, both 0 and 1) and the
 * data_types log (DefaultCoATitleMaskOffset { 0 0.04 }, DefaultCoATitleMaskScale
 * { 0.9 0.9 }). The house widget does not use the defines: it reads the offset
 * and scale off the culture wearing the frame (`house_coa_mask_offset` and
 * `_scale` in common/culture/cultures, 0.85 to 1 and up to 0.11 down), which
 * the caller passes per frame. No DOM here: the numbers are unit-tested as
 * numbers.
 */
export type FrameFamily = "house" | "dynasty" | "title";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ArmsFit {
  /** The icon's size over the frame's, both from the widget that draws the frame. */
  icon: number;
  scale: [number, number];
  /** Fractions of the icon; y positive moves the arms up. */
  offset: [number, number];
}

/** A frame's own fit, when the cultures wearing it declare one. */
export interface FrameFit {
  scale?: [number, number];
  offset?: [number, number];
}

/**
 * house: coa_house_huge, coa_house_frame at 156 over a 120 icon.
 * dynasty: coa_dynasty_huge, coa_dynasty_frame at 172 over a 120 icon.
 * title: coa_title_big, title_86.dds at 96 over an 86 icon, then the title defaults.
 */
export const ARMS_IN_FRAME: Record<FrameFamily, ArmsFit> = {
  house: { icon: 120 / 156, scale: [1, 1], offset: [0, 0] },
  dynasty: { icon: 120 / 172, scale: [1, 1], offset: [0, 0] },
  title: { icon: 86 / 96, scale: [0.9, 0.9], offset: [0, 0.04] },
};

/**
 * Where the mask is drawn (`icon`, the widget's full icon, centred) and where
 * the flag is drawn (`arms`, the icon shrunk by the scale and moved up by the
 * offset) inside one frame cell.
 */
export function placeArms(cell: Box, family: FrameFamily, own: FrameFit = {}): { icon: Box; arms: Box } {
  const base = ARMS_IN_FRAME[family];
  const scale = own.scale ?? base.scale;
  const offset = own.offset ?? base.offset;
  const iw = cell.w * base.icon;
  const ih = cell.h * base.icon;
  const icon: Box = { x: cell.x + (cell.w - iw) / 2, y: cell.y + (cell.h - ih) / 2, w: iw, h: ih };
  const w = iw * scale[0];
  const h = ih * scale[1];
  const arms: Box = {
    x: icon.x + (iw - w) / 2 + iw * offset[0],
    y: icon.y + (ih - h) / 2 - ih * offset[1],
    w,
    h,
  };
  return { icon, arms };
}

/** One drawImage call: a slice of the arms stretched over a strip of the icon outside them. */
export interface EdgeStrip {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * The game samples the arms texture with clamp-to-edge: where the icon reaches
 * past the arms (the title shield's 0.9 scale leaves a 5% band all round), it
 * shows the arms' outermost pixel row or column stretched to the mask, and the
 * corners show the corner pixel. An emblem touching an edge streaks; the field
 * simply continues. The strips reproduce that: four sides from one-pixel
 * slices, four corners from one pixel, only where the icon does reach past.
 * `arms` in canvas pixels, rounded to whole pixels for the source slices. The
 * slices are taken ONE PIXEL inside the arms' edge: the outermost row is the
 * canvas's anti-aliased blend of the arms against nothing, and stretching it
 * painted the band dark, where the game shows the arms' own edge colours
 * (checked against a checkerboard house shield, 1.19).
 */
export function edgeStrips(arms: Box, icon: Box): EdgeStrip[] {
  const x0 = Math.round(arms.x);
  const y0 = Math.round(arms.y);
  const x1 = Math.round(arms.x + arms.w);
  const y1 = Math.round(arms.y + arms.h);
  const left = Math.min(icon.x, x0);
  const top = Math.min(icon.y, y0);
  const right = Math.max(icon.x + icon.w, x1);
  const bottom = Math.max(icon.y + icon.h, y1);
  const out: EdgeStrip[] = [];
  const strip = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ) => {
    if (dw > 0 && dh > 0) out.push({ sx, sy, sw, sh, dx, dy, dw, dh });
  };
  const w = x1 - x0;
  const h = y1 - y0;
  // The source row and column, one pixel inside each edge.
  const sy0 = y0 + 1;
  const sy1 = y1 - 2;
  const sx0 = x0 + 1;
  const sx1 = x1 - 2;
  strip(x0, sy0, w, 1, x0, top, w, y0 - top);
  strip(x0, sy1, w, 1, x0, y1, w, bottom - y1);
  strip(sx0, y0, 1, h, left, y0, x0 - left, h);
  strip(sx1, y0, 1, h, x1, y0, right - x1, h);
  strip(sx0, sy0, 1, 1, left, top, x0 - left, y0 - top);
  strip(sx1, sy0, 1, 1, x1, top, right - x1, y0 - top);
  strip(sx0, sy1, 1, 1, left, y1, x0 - left, bottom - y1);
  strip(sx1, sy1, 1, 1, x1, y1, right - x1, bottom - y1);
  return out;
}
