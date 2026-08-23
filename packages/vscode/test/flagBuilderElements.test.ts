/**
 * The flag builder's canvas gestures, as pure modules: which element a click
 * lands on, what a drag and an aspect-locked corner resize write back, and the
 * middle-ellipsis the save-target menu shortens a mod path with.
 *
 * The two claims worth pinning down are the ones a mouse gets wrong silently:
 * an element's box lives in the flag's own (non-square, rotatable) space, so
 * hit-testing has to run in that space, and a corner resize must leave the
 * OPPOSITE corner exactly where it was while both axes scale by one factor.
 */
import { describe, expect, it } from "vitest";
import type { CoaLayer } from "../../server/src/coa/coa";
import {
  boxOf,
  containsPoint,
  cornerAt,
  hitElement,
  moveBox,
  resizeBox,
  writeBox,
  type ElementBox,
} from "../src/webviews/flagBuilder/app/elements";
import { middleEllipsis } from "../src/webviews/flagBuilder/app/paths";

function emblem(
  ...instances: { rotation: number; scale: [number, number]; position: [number, number] }[]
): CoaLayer {
  return { kind: "colored_emblem", texture: "e.dds", mask: 0, colors: [], instances };
}

const at = (position: [number, number], scale: [number, number], rotation = 0) => ({
  rotation,
  scale,
  position,
});

describe("element boxes", () => {
  it("falls back to the default instance the renderer draws", () => {
    expect(boxOf(emblem(), 0)).toEqual({ cx: 0.5, cy: 0.5, w: 1, h: 1, rotation: 0 });
  });

  it("centres a sub flag's corner-based offset, and writes it back as a corner", () => {
    const sub: CoaLayer = {
      kind: "sub",
      parent: "p",
      instances: [{ offset: [0.1, 0.2], scale: [0.4, 0.5] }],
    };
    const box = boxOf(sub, 0);
    expect(box.cx).toBeCloseTo(0.3, 10);
    expect(box.cy).toBeCloseTo(0.45, 10);
    expect([box.w, box.h, box.rotation]).toEqual([0.4, 0.5, 0]);
    writeBox(sub, 0, moveBox(boxOf(sub, 0), 0.1, -0.1));
    expect(sub.instances[0]).toEqual({ offset: [0.2, 0.1], scale: [0.4, 0.5] });
  });
});

describe("hit testing", () => {
  const layers = [emblem(at([0.5, 0.5], [0.8, 0.8])), emblem(at([0.5, 0.5], [0.2, 0.2]))];

  it("picks the topmost element under the pointer", () => {
    expect(hitElement(layers, 0.5, 0.5)).toEqual({ layer: 1, instance: 0 });
    expect(hitElement(layers, 0.25, 0.5)).toEqual({ layer: 0, instance: 0 });
    expect(hitElement(layers, 0.02, 0.02)).toBeNull();
  });

  it("turns the box in flag space, not on screen", () => {
    const box = boxOf(emblem(at([0.5, 0.5], [0.6, 0.2], 90)), 0);
    // 90 degrees swaps the box's own axes: tall now, not wide.
    expect(containsPoint(box, 0.5, 0.75)).toBe(true);
    expect(containsPoint(box, 0.75, 0.5)).toBe(false);
  });

  it("finds a corner handle only within its tolerance", () => {
    const box = boxOf(emblem(at([0.5, 0.5], [0.4, 0.4])), 0);
    expect(cornerAt(box, 0.702, 0.698, 0.006, 0.009)).toBe("se");
    expect(cornerAt(box, 0.5, 0.5, 0.006, 0.009)).toBeNull();
  });
});

describe("aspect-locked resize", () => {
  /** The box's own north-west corner in flag space, rotation included. */
  const northWest = (b: ElementBox): [number, number] => {
    const t = (b.rotation * Math.PI) / 180;
    const [lx, ly] = [-b.w / 2, -b.h / 2];
    return [b.cx + lx * Math.cos(t) - ly * Math.sin(t), b.cy + lx * Math.sin(t) + ly * Math.cos(t)];
  };

  it("scales both axes by one factor and pins the opposite corner", () => {
    const box: ElementBox = { cx: 0.5, cy: 0.5, w: 0.4, h: 0.2, rotation: 0 };
    const next = resizeBox(box, "se", 0.9, 0.9);
    expect(next.w / box.w).toBeCloseTo(next.h / box.h, 10);
    expect(next.w).toBeGreaterThan(box.w);
    expect(northWest(next)[0]).toBeCloseTo(0.3, 10);
    expect(northWest(next)[1]).toBeCloseTo(0.4, 10);
  });

  it("pins the opposite corner of a rotated element too", () => {
    const box: ElementBox = { cx: 0.5, cy: 0.5, w: 0.4, h: 0.4, rotation: 30 };
    const next = resizeBox(box, "se", 0.8, 0.7);
    expect(next.w / box.w).toBeCloseTo(next.h / box.h, 10);
    expect(northWest(next)[0]).toBeCloseTo(northWest(box)[0], 10);
    expect(northWest(next)[1]).toBeCloseTo(northWest(box)[1], 10);
  });
});

describe("middleEllipsis", () => {
  it("leaves a path that fits alone", () => {
    expect(middleEllipsis("D:/mods/my_mod", 40)).toBe("D:/mods/my_mod");
  });

  it("keeps both ends and eats the middle", () => {
    const short = middleEllipsis("F:/SteamLibrary/steamapps/workshop/content/1158310/3472248460", 30);
    expect(short).toHaveLength(30);
    expect(short.startsWith("F:/SteamLibrary")).toBe(true);
    expect(short.endsWith("3472248460")).toBe(true);
  });
});
