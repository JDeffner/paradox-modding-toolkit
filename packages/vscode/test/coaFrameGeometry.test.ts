/**
 * The preview frames place the arms where the game's gui does: the icon is a
 * centred share of the frame, the mask is drawn at the icon, and the arms are
 * scaled and moved inside it by the widget's coat_of_arms_scale and _offset.
 */
import { describe, expect, it } from "vitest";
import { edgeStrips, placeArms } from "../src/webviews/coaDesigner/frameGeometry";

const CELL = { x: 0, y: 0, w: 960, h: 960 };
const close = (a: number, b: number): void => expect(a).toBeCloseTo(b, 6);

describe("placeArms", () => {
  it("house: the arms are the 120 icon inside the 156 frame, centred, mask and arms alike", () => {
    const { icon, arms } = placeArms(CELL, "house");
    close(icon.w, (960 * 120) / 156);
    close(icon.x, (960 - icon.w) / 2);
    close(icon.y, (960 - icon.h) / 2);
    expect(arms).toEqual(icon);
  });

  it("house with its cultures' fit: the mask keeps the icon, the arms shrink inside it and move up", () => {
    // house_frame_22 as the Norse cultures declare it (common/culture/cultures,
    // 1.19): scale 0.85, offset 0.11 of the icon, which the game draws upward.
    const { icon, arms } = placeArms(CELL, "house", { scale: [0.85, 0.85], offset: [0, 0.11] });
    close(icon.w, (960 * 120) / 156);
    close(arms.w, icon.w * 0.85);
    close(arms.x + arms.w / 2, 480);
    close(arms.y + arms.h / 2, 480 - icon.h * 0.11);
  });

  it("dynasty: the same 120 icon inside a 172 frame", () => {
    const { icon, arms } = placeArms(CELL, "dynasty");
    close(icon.w, (960 * 120) / 172);
    expect(arms).toEqual(icon);
  });

  it("title: the mask keeps the 86 icon while the arms shrink to 0.9 of it and rise 0.04 of it", () => {
    const { icon, arms } = placeArms(CELL, "title");
    close(icon.w, (960 * 86) / 96);
    close(arms.w, icon.w * 0.9);
    close(arms.h, icon.h * 0.9);
    close(arms.x + arms.w / 2, 480);
    close(arms.y + arms.h / 2, 480 - icon.h * 0.04);
  });
});

describe("edgeStrips", () => {
  it("is empty when the arms fill the icon", () => {
    expect(edgeStrips(CELL, CELL)).toEqual([]);
  });

  it("stretches one-pixel slices from just inside the arms' edge over the band the title shield leaves", () => {
    // The title arms are 0.9 of the icon, centred: a band all round, eight
    // strips. The slice is the row one pixel inside the edge (the outermost
    // row is the anti-aliased edge, and stretched it painted the band dark).
    const { icon, arms } = placeArms(CELL, "title");
    const strips = edgeStrips(arms, icon);
    expect(strips).toHaveLength(8);
    const x0 = Math.round(arms.x);
    const y0 = Math.round(arms.y);
    const top = strips[0];
    expect(top).toEqual({
      sx: x0,
      sy: y0 + 1,
      sw: Math.round(arms.x + arms.w) - x0,
      sh: 1,
      dx: x0,
      dy: icon.y,
      dw: top.sw,
      dh: y0 - icon.y,
    });
    const corner = strips[4];
    expect([corner.sw, corner.sh]).toEqual([1, 1]);
    expect([corner.dx, corner.dy]).toEqual([icon.x, icon.y]);
    expect([corner.sx, corner.sy]).toEqual([x0 + 1, y0 + 1]);
  });

  it("skips a side the arms already reach past", () => {
    // Arms wider than the icon, short only at the top.
    const strips = edgeStrips({ x: -10, y: 10, w: 120, h: 100 }, { x: 0, y: 0, w: 100, h: 100 });
    expect(strips.map((s) => [s.dx, s.dy, s.dw, s.dh])).toEqual([[-10, 0, 120, 10]]);
  });
});
