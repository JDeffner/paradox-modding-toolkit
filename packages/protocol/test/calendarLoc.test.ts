import { describe, expect, it } from "vitest";
import type { CalendarSetting } from "../src/calendar";
import { generateCalendarLoc, type CalendarLocSpec } from "../src/calendarLoc";

// Hegemonia's declared rule: 3000 -> 1000 BC, 4000 -> 1 AD.
const HEGEMONIA: CalendarSetting = { epoch: 4000, after: "AD", before: "BC" };

// The CK3 spec's shape, reduced to what the generator consumes.
const SPEC: CalendarLocSpec = {
  dateFormats: {
    GAME_DATE_STRING: "$DAY$ $MONTH$, {year} {era}",
    GAME_DATE_STRING_SHORT: "$DAY$ $MONTH_SHORT$ {year} {era}",
  },
  monthKeys: [
    ["CW_DATE_January", "CW_DATE_Jan"],
    ["CW_DATE_February", "CW_DATE_Feb"],
    ["CW_DATE_May", "CW_DATE_May"],
  ],
};

function fileMap(cal: CalendarSetting, spec: CalendarLocSpec = SPEC, lang = "english") {
  const { files, notes } = generateCalendarLoc(cal, spec, lang);
  return { byPath: new Map(files.map((f) => [f.relPath, f.content])), notes };
}

describe("generateCalendarLoc", () => {
  it("writes era math to the normal loc folder and overrides to replace/", () => {
    const { byPath } = fileMap(HEGEMONIA);
    const math = byPath.get("localization/english/px_calendar_l_english.yml")!;
    const replace = byPath.get("localization/replace/english/px_calendar_dates_l_english.yml")!;
    expect(math.startsWith("l_english:\n")).toBe(true);
    expect(replace.startsWith("l_english:\n")).toBe(true);
    // Two-era cascade, mirroring displayYear: >= 4000 -> y - 3999, else 4000 - y.
    expect(math).toContain(
      ` PX_CAL_YEAR:0 "[Select_int32( GreaterThanOrEqualTo_int32( '(int32)$YEAR|q$', '(int32)4000' ), ` +
        `Subtract_int32( '(int32)$YEAR|q$', '(int32)3999' ), Subtract_int32( '(int32)4000', '(int32)$YEAR|q$' ) )]"`
    );
    expect(math).toContain(
      ` PX_CAL_ERA:0 "[Select_CString( GreaterThanOrEqualTo_int32( '(int32)$YEAR|q$', '(int32)4000' ), 'AD', 'BC' )]"`
    );
    expect(replace).toContain(' GAME_DATE_STRING:0 "$DAY$ $MONTH$, $PX_CAL_YEAR$ $PX_CAL_ERA$"');
    expect(replace).toContain(' GAME_DATE_STRING_SHORT:0 "$DAY$ $MONTH_SHORT$ $PX_CAL_YEAR$ $PX_CAL_ERA$"');
    // No custom months declared -> no month-name overrides.
    expect(replace).not.toContain("CW_DATE_");
  });

  it("single-era calendar clamps to 1 and uses the era label verbatim", () => {
    const { byPath } = fileMap({ epoch: 100, after: "TA" });
    const math = byPath.get("localization/english/px_calendar_l_english.yml")!;
    expect(math).toContain(
      ` PX_CAL_YEAR:0 "[Max_int32( Subtract_int32( '(int32)$YEAR|q$', '(int32)99' ), '(int32)1' )]"`
    );
    expect(math).toContain(' PX_CAL_ERA:0 "TA"');
    expect(math).not.toContain("Select_CString");
  });

  it("custom months override the engine month keys, sharing a key when long == short", () => {
    const cal: CalendarSetting = {
      ...HEGEMONIA,
      months: ["Narwain", "Ninui", "Lothron", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
    };
    const { byPath } = fileMap(cal);
    const replace = byPath.get("localization/replace/english/px_calendar_dates_l_english.yml")!;
    expect(replace).toContain(' CW_DATE_January:0 "Narwain"');
    expect(replace).toContain(' CW_DATE_Jan:0 "Narwain"');
    // CW_DATE_May doubles as its own short key: exactly one line for it.
    expect(replace.split("CW_DATE_May").length - 1).toBe(1);
    expect(replace).toContain(' CW_DATE_May:0 "Lothron"');
  });

  it("generates for the requested language", () => {
    const { byPath } = fileMap(HEGEMONIA, SPEC, "french");
    expect(byPath.has("localization/french/px_calendar_l_french.yml")).toBe(true);
    expect(byPath.get("localization/french/px_calendar_l_french.yml")!.startsWith("l_french:\n")).toBe(true);
  });

  it("strips quotes that would break the CString literals", () => {
    const { byPath } = fileMap({ epoch: 10, after: "Y'r", before: "B'f" });
    const math = byPath.get("localization/english/px_calendar_l_english.yml")!;
    expect(math).toContain("'Yr', 'Bf'");
  });
});
