import { describe, expect, it } from "vitest";
import { parseTigerJson } from "../src/tigerParser";

const SAMPLE = JSON.stringify([
  {
    confidence: "strong",
    key: "unknown-field",
    message: "unknown token `add_goldd`",
    info: "did you mean `add_gold`?",
    severity: "error",
    locations: [
      { column: 9, from: "MyMod", length: 9, linenr: 12, path: "events/my_events.txt", tag: "MOD" },
    ],
  },
  {
    key: "missing-loc",
    message: "missing english localization key",
    severity: "warning",
    locations: [{ path: "events/my_events.txt", linenr: 3 }],
  },
]);

describe("parseTigerJson", () => {
  it("parses a well-formed report array", () => {
    const reports = parseTigerJson(SAMPLE)!;
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      severity: "error",
      key: "unknown-field",
      message: "unknown token `add_goldd`",
    });
    expect(reports[0].locations[0]).toMatchObject({
      path: "events/my_events.txt",
      linenr: 12,
      column: 9,
      length: 9,
    });
  });

  it("tolerates progress noise before the JSON array", () => {
    const reports = parseTigerJson("Checking mod...\ndone\n" + SAMPLE);
    expect(reports).toHaveLength(2);
  });

  it("skips malformed entries instead of failing", () => {
    const reports = parseTigerJson(
      JSON.stringify([{ nonsense: true }, { message: "ok", severity: "tips", locations: [] }])
    )!;
    expect(reports).toHaveLength(1);
    expect(reports[0].severity).toBe("tips");
  });

  it("returns null for output with no JSON array", () => {
    expect(parseTigerJson("segmentation fault")).toBeNull();
    expect(parseTigerJson("")).toBeNull();
  });
});
