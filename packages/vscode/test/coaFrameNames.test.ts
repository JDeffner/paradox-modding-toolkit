/**
 * Where a preview frame's name comes from (flagBuilder/database.ts). CK3 names
 * no frame, but every culture states the one its houses wear, so the heritages
 * of those cultures are the frame's words: cultures in, labels out.
 */
import { describe, expect, it } from "vitest";
import { frameLabel, frameUsage, type CultureFrames } from "../src/webviews/flagBuilder/database";

const culture = (heritage: string, house?: string, dynasty?: string): CultureFrames => ({
  heritage,
  ...(house ? { house } : {}),
  ...(dynasty ? { dynasty } : {}),
});

describe("frameUsage", () => {
  it("orders a frame's heritages by how many cultures wear it", () => {
    const use = frameUsage([
      culture("heritage_turkic", "house_frame_14"),
      culture("heritage_mongolic", "house_frame_14"),
      culture("heritage_turkic", "house_frame_14"),
      culture("heritage_tungusic", "house_frame_14"),
    ]);
    expect(use.get("house_frame_14")).toEqual({
      family: "house",
      heritages: ["heritage_turkic", "heritage_mongolic", "heritage_tungusic"],
    });
  });

  it("tells the two gui types apart and ignores a culture with no frame", () => {
    const use = frameUsage([
      culture("heritage_latin", "house_frame_22"),
      culture("heritage_latin", undefined, "dynasty"),
      culture("heritage_iberian"),
    ]);
    expect(use.get("house_frame_22")?.family).toBe("house");
    expect(use.get("dynasty")?.family).toBe("dynasty");
    expect(use.size).toBe(2);
  });
});

describe("frameLabel", () => {
  it("keeps the plain id when no culture names the frame", () => {
    expect(frameLabel("house_frame_27")).toBe("House Frame 27");
  });

  it("names up to three heritages, then says there are more", () => {
    expect(frameLabel("house_frame_03", ["Frankish"])).toBe("House Frame 03 (Frankish)");
    expect(frameLabel("house_frame_14", ["Turkic", "Mongolic", "Tungusic"])).toBe(
      "House Frame 14 (Turkic, Mongolic, Tungusic)"
    );
    expect(frameLabel("house_frame_16", ["Ancient Greek", "Mongolic", "Egyptian", "Gothic"])).toBe(
      "House Frame 16 (Ancient Greek, Mongolic, Egyptian, …)"
    );
  });
});
