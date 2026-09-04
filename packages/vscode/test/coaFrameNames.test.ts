/**
 * Where a preview frame's words come from. CK3 names no frame, but every
 * culture states the one its houses wear, so the heritages of those cultures
 * are the frame's words: cultures in, a plain label and a menu hint out.
 */
import { describe, expect, it } from "vitest";
import { frameLabel, frameUsage, type CultureFrames } from "../src/webviews/flagBuilder/database";
import { frameHint } from "../src/webviews/flagBuilder/messages";

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
  it("is the plain id, so the picker button fits beside the tier", () => {
    expect(frameLabel("house_frame_27")).toBe("House Frame 27");
    expect(frameLabel("title")).toBe("Title");
  });
});

describe("frameHint", () => {
  it("names two heritages and counts the rest", () => {
    expect(frameHint([])).toBe("");
    expect(frameHint(["Frankish"])).toBe("Frankish");
    expect(frameHint(["Turkic", "Mongolic"])).toBe("Turkic, Mongolic");
    expect(frameHint(["South Slavic", "Caucasian", "Albanian", "Balkan", "Carpathian"])).toBe(
      "South Slavic, Caucasian +3"
    );
  });
});
