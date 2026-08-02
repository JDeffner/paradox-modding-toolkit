/**
 * Sprite fill geometry: nine-slice regions and frame-sheet cells. Deterministic
 * arithmetic over a rect plus the source texture's pixel size, with no engine
 * state behind it, which is why it lives in its own dependency-free leaf module:
 * the layout engine re-exports it, and the webview GUI editor bundles it
 * DIRECTLY into the canvas renderer. One implementation means the drawn pixels
 * cannot drift from the measured rules (parity-checklist.md L21a-d, L22).
 */

/** The destination rect a fill covers; structurally LayoutRect. */
export interface FillRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Nine-slice (corneredtiled/corneredstretched) region layout: corners drawn
 * 1:1, edges stretched on one axis, center on both. Pure deterministic
 * geometry — border widths come from the .gui `spriteborder` attributes and
 * the source texture's own pixel size. Returns 9 src->dst blits in row-major
 * order (TL, T, TR, L, C, R, BL, B, BR); zero-area slices are dropped.
 */
export interface NineSliceRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}
export function computeNineSlice(
  rect: FillRect,
  border: [number, number, number, number],
  texW: number,
  texH: number
): NineSliceRegion[] {
  // Clamp borders so opposite sides never overlap on a small texture or rect.
  const bl = Math.max(0, Math.min(border[0], texW, rect.w));
  const bt = Math.max(0, Math.min(border[1], texH, rect.h));
  const br = Math.max(0, Math.min(border[2], texW - bl, rect.w - bl));
  const bb = Math.max(0, Math.min(border[3], texH - bt, rect.h - bt));
  // Source and destination column/row spans: [start, size] triples.
  const sCols: [number, number][] = [
    [0, bl],
    [bl, texW - bl - br],
    [texW - br, br],
  ];
  const sRows: [number, number][] = [
    [0, bt],
    [bt, texH - bt - bb],
    [texH - bb, bb],
  ];
  const dCols: [number, number][] = [
    [rect.x, bl],
    [rect.x + bl, rect.w - bl - br],
    [rect.x + rect.w - br, br],
  ];
  const dRows: [number, number][] = [
    [rect.y, bt],
    [rect.y + bt, rect.h - bt - bb],
    [rect.y + rect.h - bb, bb],
  ];
  const out: NineSliceRegion[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const [sx, sw] = sCols[c];
      const [sy, sh] = sRows[r];
      const [dx, dw] = dCols[c];
      const [dy, dh] = dRows[r];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      out.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    }
  }
  return out;
}

/**
 * Frame-sheet cell for `framesize = { w h }` + `frame = N`: the texture is a
 * cols x rows GRID indexed ROW-MAJOR and 1-based, so frame 4 on a 3-wide sheet
 * is the first cell of the SECOND row, not a fourth column. `frame <= 0`
 * clamps to the first cell, a frame past the last clamps to the last.
 * (Studio §L, in-game 2026-07-17; L22.) Deterministic geometry like
 * computeNineSlice: the texture's pixel size comes from the renderer.
 */
export function computeFrameCell(
  framesize: [number, number],
  frame: number,
  texW: number,
  texH: number
): { sx: number; sy: number; sw: number; sh: number } {
  const [fw, fh] = framesize;
  if (fw <= 0 || fh <= 0) return { sx: 0, sy: 0, sw: texW, sh: texH };
  const cols = Math.max(1, Math.floor(texW / fw));
  const rows = Math.max(1, Math.floor(texH / fh));
  const index = Math.min(Math.max(Math.floor(frame) - 1, 0), cols * rows - 1);
  return { sx: (index % cols) * fw, sy: Math.floor(index / cols) * fh, sw: fw, sh: fh };
}
